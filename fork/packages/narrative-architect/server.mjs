// Narrative Architect: Pre-generation structural pass.
// Uses the local Decision model to detect scene breaks, then invokes
// a thinking model to scaffold recursive beats, information asymmetry,
// and turning points without repetitive input token costs.

export const PACKAGE_ID = "narrative-architect";
const MODES = new Set(["roleplay", "game"]);
const SCENE_BREAK_REGEX = /(?:^|\n)\s*(?:[*_-]{3,}|#{1,3}\s+(?:Scene|Chapter)|\[Scene Break\])/iu;

export const docId = (chatId) => `${PACKAGE_ID}:${chatId}`;

export const isEnabled = (meta, mode) =>
  MODES.has(mode) &&
  meta?.enableAgents === true &&
  Array.isArray(meta.activeAgentIds) &&
  meta.activeAgentIds.includes(PACKAGE_ID);

export function createStore(runtime) {
  const { documents } = runtime.persistence;

  async function load(chatId) {
    const doc = await documents.getById(PACKAGE_ID, docId(chatId));
    if (doc) return { state: doc.data, revision: doc.revision };
    return { state: null, revision: 0 };
  }

  async function save(chatId, state, revision) {
    const entry = {
      id: docId(chatId),
      packageId: PACKAGE_ID,
      name: `Narrative Architect ${chatId}`,
      description: "Cached scene beat sheet and narrative architecture state",
      data: state,
    };
    if (revision) {
      await documents.update(entry, revision);
    } else {
      await documents.create(entry);
    }
  }

  return { load, save };
}

export async function isSceneBreak(runtime, messages, state, settings = {}) {
  if (!messages || messages.length === 0) return true;

  // 1. Explicit scene break marker in the latest message
  const lastMsg = messages[messages.length - 1];
  if (lastMsg?.content && SCENE_BREAK_REGEX.test(lastMsg.content)) {
    return true;
  }

  // 2. Try the Decision Model if available
  let decisionAnswered = false;
  if (typeof runtime?.decisions?.evaluate === "function") {
    try {
      const decisionRequest = {
        messages: messages.slice(-4).map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          name: m.name,
          content: m.content || "",
        })),
        questions: [
          {
            id: "scene_break",
            question:
              "Did the latest message begin a new scene, change location, skip forward in time, or conclude the previous encounter?",
          },
        ],
      };
      const result = await runtime.decisions.evaluate(decisionRequest);
      if (result && typeof result.answers?.scene_break === "number") {
        decisionAnswered = true;
        const threshold = typeof result.threshold === "number" ? result.threshold : 0.5;
        return result.answers.scene_break >= threshold;
      }
    } catch (err) {
      runtime?.logger?.warn?.("[narrative-architect] decision evaluation error: %s", err?.message);
    }
  }

  // 3. Fallback when Decision model is missing or gives no answer:
  // Trigger every `fallbackInterval` messages (default: 5 turns) so the story never stalls
  if (!decisionAnswered) {
    const fallbackInterval = typeof settings.fallbackInterval === "number" ? settings.fallbackInterval : 5;
    const lastMessageCount = typeof state?.lastMessageCount === "number" ? state.lastMessageCount : 0;
    if (messages.length - lastMessageCount >= fallbackInterval) {
      return true;
    }
  }

  return false;
}

export function buildArchitectPrompt(recentMessages, customTemplate) {
  const systemInstruction =
    "You are a narrative architect. Build the scene's logical skeleton before any prose is written.\n" +
    "Do not write prose, dialogue, or story narration—only provide the structured beat sheet.";

  const template =
    customTemplate ||
    "Act as a narrative architect. Based on the story context and character motivations:\n" +
      "1. Information Asymmetry: What each character knows vs. what they are hiding.\n" +
      "2. Recursive Dramatic Beats: Map out the factual and emotional beats of the scene.\n" +
      "3. Turning Point: The pivot where emotional dynamic or leverage flips.\n" +
      "4. Next Shift: How this scene's conclusion shifts the dynamic for the next chapter.\n\n" +
      "Give me only the beat sheet.";

  const historySnippet = recentMessages
    .slice(-6)
    .map((m) => `${m.role === "assistant" ? "Assistant" : (m.name || "User")}: ${m.content}`)
    .join("\n\n");

  return [
    { role: "system", content: systemInstruction },
    {
      role: "user",
      content: `Recent Context:\n${historySnippet}\n\nTask:\n${template}`,
    },
  ];
}

export function formatContribution(beatSheet) {
  if (!beatSheet || !beatSheet.trim()) return null;
  return `[SCENE BEAT SHEET — NARRATIVE ARCHITECTURE]\n${beatSheet.trim()}`;
}

export function architectContext(store, runtime) {
  return async (request) => {
    if (!isEnabled(request?.chatMeta, request?.mode)) return null;

    let messages = [];
    try {
      messages = await runtime.persistence.listMessages(request.chatId);
    } catch {
      return null;
    }

    if (!messages || messages.length === 0) return null;

    const { state, revision } = await store.load(request.chatId);
    const agentSettings = {
      ...(request.chatMeta?.agentSettings?.[PACKAGE_ID] || {}),
      ...(state?.settings || {}),
    };
    let needsNewScene = false;

    if (!state?.beatSheet) {
      needsNewScene = true;
    } else {
      needsNewScene = await isSceneBreak(runtime, messages, state, agentSettings);
    }

    if (!needsNewScene && state?.beatSheet) {
      return formatContribution(state.beatSheet);
    }

    // New scene required: invoke the thinking model
    try {
      const customTemplate = request.chatMeta?.agentTemplates?.[PACKAGE_ID];

      const model = await runtime.languageModels.resolveForRequest({
        connectionId: agentSettings.connectionId || null,
        chatConnectionId: request.chatMeta?.connectionId || null,
      });

      const prompt = buildArchitectPrompt(messages, customTemplate);
      const result = await model.chatComplete(prompt, {
        maxTokens: agentSettings.maxTokens || 1200,
        temperature: agentSettings.temperature || 0.7,
      });

      const newBeatSheet = String(result?.content || "").trim();
      if (!newBeatSheet) {
        return state?.beatSheet ? formatContribution(state.beatSheet) : null;
      }

      const newState = {
        ...state,
        beatSheet: newBeatSheet,
        sceneIndex: (state?.sceneIndex ?? 0) + 1,
        lastMessageCount: messages.length,
        updatedAt: new Date().toISOString(),
      };

      await store.save(request.chatId, newState, revision);
      return formatContribution(newBeatSheet);
    } catch (err) {
      runtime?.logger?.warn?.("[narrative-architect] failed to generate beat sheet: %s", err?.message);
      return state?.beatSheet ? formatContribution(state.beatSheet) : null;
    }
  };
}

export async function activate(context) {
  const runtime = context.api.runtime;
  const store = createStore(runtime);
  const releases = [];

  try {
    releases.push(context.api.registerPromptContext(architectContext(store, runtime)));

    if (typeof context.api.registerPrivilegedRoutes === "function") {
      const routesRelease = await context.api.registerPrivilegedRoutes(
        (routes) => {
          routes.get("/settings/:chatId", async (req) => {
            const { state } = await store.load(req.params.chatId);
            return state?.settings ?? { connectionId: "", fallbackInterval: 5 };
          });
          routes.patch("/settings/:chatId", async (req) => {
            const { state, revision } = await store.load(req.params.chatId);
            const existing = state ?? { sceneIndex: 0 };
            const newSettings = { ...(existing.settings ?? {}), ...(req.body ?? {}) };
            await store.save(req.params.chatId, { ...existing, settings: newSettings }, revision);
            return newSettings;
          });
        },
        { prefix: "/api/narrative-architect" },
      );
      releases.push(routesRelease);
    }
  } catch (err) {
    for (const release of releases.reverse()) {
      if (typeof release === "function") await release();
    }
    throw err;
  }

  return async () => {
    for (const release of releases.reverse()) {
      if (typeof release === "function") await release();
    }
  };
}
