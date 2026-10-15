// Call Sheet: scene-by-scene story play on top of a normal Roleplay chat. The Engine still writes every
// reply and impersonate; this package keeps the sheet (story, frozen scene summaries, current scene plan),
// adds it to each turn's system prompt, and runs the two scene-boundary jobs: the scene planner (main
// model) and the scene summarizer (agent model). Scenes end only when the player says so.

import {
  cleanOutcomes,
  cleanPlan,
  cleanSpine,
  emptySheet,
  idsBefore,
  openScene,
  proposalPrompt,
  sceneMessages,
  sheetContext,
  summaryPrompt,
  transcript,
} from "./sheet.mjs";

export const PACKAGE_ID = "call-sheet";
const DOC_KIND = "call-sheet";
const LAST_SCENE_TAIL = 6;
const CAST_NOTE_LIMIT = 300;

const docId = (chatId) => `${PACKAGE_ID}:${chatId}`;
const parseMeta = (value) => {
  if (value && typeof value === "object") return value;
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
};

export function isEnabled(meta, mode) {
  return (
    mode === "roleplay" &&
    meta?.enableAgents === true &&
    Array.isArray(meta.activeAgentIds) &&
    meta.activeAgentIds.includes(PACKAGE_ID)
  );
}

class SheetError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function createStore(persistence) {
  const { documents } = persistence;

  async function load(chatId) {
    const doc = await documents.getById(PACKAGE_ID, docId(chatId));
    return doc
      ? { sheet: { ...emptySheet(), ...doc.data }, revision: doc.revision }
      : { sheet: emptySheet(), revision: 0 };
  }

  async function save(chatId, sheet, revision) {
    const now = new Date().toISOString();
    const base = {
      id: docId(chatId),
      packageId: PACKAGE_ID,
      name: `Call Sheet ${chatId}`,
      description: "",
      data: sheet,
    };
    if (revision) {
      const updated = await documents.update({ ...base, expectedRevision: revision, updatedAt: now });
      if (!updated) throw new SheetError(409, "The call sheet changed in another window. Reload and try again.");
      return updated;
    }
    return documents.create({ ...base, kind: DOC_KIND, createdAt: now, updatedAt: now });
  }

  /** Read, change and write the sheet under the chat's lock, so two clicks cannot interleave. */
  function update(chatId, change) {
    return persistence.withChatLock(chatId, async () => {
      const { sheet, revision } = await load(chatId);
      const result = await change(sheet);
      await save(chatId, sheet, revision);
      return result ?? sheet;
    });
  }

  return { load, update };
}

async function chatOrFail(persistence, chatId) {
  const chat = await persistence.getChat(chatId);
  if (!chat) throw new SheetError(404, "Chat not found.");
  if (chat.mode !== "roleplay") throw new SheetError(400, "Call Sheet runs in Roleplay chats.");
  return chat;
}

async function castNames(runtime, chat) {
  const characters = new Map();
  const cast = [];
  let persona = "the player character";
  const resources = runtime.resources;
  try {
    for (const record of (await resources?.listCharacters?.(chat.characterIds)) ?? []) {
      const data = parseMeta(record.data);
      const name = String(data.name ?? "").trim();
      if (!name) continue;
      characters.set(record.id, name);
      const note = String(data.description ?? "")
        .replace(/\s+/gu, " ")
        .trim()
        .slice(0, CAST_NOTE_LIMIT);
      cast.push(note ? `- ${name}: ${note}` : `- ${name}`);
    }
    if (chat.personaId) {
      const [record] = (await resources?.listPersonas?.([chat.personaId])) ?? [];
      const name = String(parseMeta(record?.data).name ?? "").trim();
      if (name) persona = name;
    }
  } catch (error) {
    runtime.logger?.warn?.("Call Sheet could not read the cast: %s", error?.message);
  }
  return { characters, persona, cast: cast.join("\n") };
}

async function completeJson(runtime, model, messages, maxTokens) {
  const result = await model.chatComplete(messages, { temperature: 0.7, maxTokens });
  const parsed = runtime.json.parseJsonish(result.content ?? "");
  if (!parsed || typeof parsed !== "object") throw new SheetError(502, "The model did not return a usable answer.");
  return parsed;
}

/** Scene planner: always the main model, the one the chat itself replies with. */
export async function propose(runtime, store, chatId, instruction) {
  const chat = await chatOrFail(runtime.persistence, chatId);
  const [{ sheet }, messages, names] = await Promise.all([
    store.load(chatId),
    runtime.persistence.listMessages(chatId),
    castNames(runtime, chat),
  ]);
  const last = openScene(sheet) ?? sheet.scenes[sheet.scenes.length - 1];
  const tail = last ? sceneMessages(last, messages).slice(-LAST_SCENE_TAIL) : messages.slice(-LAST_SCENE_TAIL);
  const model = await runtime.languageModels.resolve(chat.connectionId);
  const prompt = proposalPrompt({
    sheet,
    cast: names.cast,
    persona: names.persona,
    lastScene: transcript(tail, names),
    instruction: String(instruction ?? "").trim(),
  });
  const plan = cleanPlan(await completeJson(runtime, model, prompt, 1200));
  return store.update(chatId, (fresh) => {
    // Rerolls keep earlier proposals until one is accepted.
    const earlier = fresh.proposal?.instruction === String(instruction ?? "").trim() ? fresh.proposal.plans : [];
    fresh.proposal = { instruction: String(instruction ?? "").trim(), plans: [...earlier, plan].slice(-5) };
  });
}

/** Scene summarizer: the agent model. Freezes the open scene; it is never edited again. */
export async function endScene(runtime, store, chatId) {
  const chat = await chatOrFail(runtime.persistence, chatId);
  const [{ sheet }, messages, names] = await Promise.all([
    store.load(chatId),
    runtime.persistence.listMessages(chatId),
    castNames(runtime, chat),
  ]);
  const scene = openScene(sheet);
  if (!scene) throw new SheetError(409, "There is no scene in play to end.");
  const played = sceneMessages(scene, messages);
  const endMessageId = played[played.length - 1]?.id ?? scene.startAfterMessageId;
  let summary = "Nothing happened in this scene.";
  let outcomes = scene.plan.goals.map((goal) => ({ goal, status: "open" }));
  if (played.length) {
    const config = await runtime.getAgentConfig?.();
    const model = await runtime.languageModels.resolveForRequest({
      connectionId: config?.connectionId ?? null,
      chatConnectionId: chat.connectionId,
    });
    const parsed = await completeJson(
      runtime,
      model,
      summaryPrompt({ plan: scene.plan, sceneText: transcript(played, names) }),
      1500,
    );
    summary = String(parsed.summary ?? "").trim() || summary;
    outcomes = cleanOutcomes(parsed.goals, scene.plan.goals);
  }
  return store.update(chatId, (fresh) => {
    const open = openScene(fresh);
    if (!open || open.id !== scene.id) throw new SheetError(409, "The scene changed while it was being summarized.");
    Object.assign(open, { summary, outcomes, endMessageId, endedAt: new Date().toISOString() });
  });
}

/**
 * Start the edited proposal as the new scene. Returns the ids of every earlier message so the client can
 * take them out of the prompt; the frozen summaries stand in for them from now on.
 */
export async function acceptScene(runtime, store, chatId, rawPlan) {
  await chatOrFail(runtime.persistence, chatId);
  const messages = await runtime.persistence.listMessages(chatId);
  const anchor = messages[messages.length - 1]?.id ?? null;
  const sheet = await store.update(chatId, (fresh) => {
    if (openScene(fresh)) throw new SheetError(409, "End the current scene before starting a new one.");
    fresh.scenes.push({
      id: `scene-${fresh.scenes.length + 1}-${Date.now().toString(36)}`,
      plan: cleanPlan(rawPlan),
      instruction: fresh.proposal?.instruction ?? "",
      startAfterMessageId: anchor,
      startedAt: new Date().toISOString(),
      summary: null,
      outcomes: null,
      endMessageId: null,
    });
    fresh.proposal = null;
  });
  return { sheet, hideMessageIds: anchor ? idsBefore(messages, anchor) : [] };
}

export function updateSpine(store, chatId, rawSpine) {
  return store.update(chatId, (sheet) => {
    sheet.spine = cleanSpine(rawSpine);
  });
}

export function discardProposal(store, chatId) {
  return store.update(chatId, (sheet) => {
    sheet.proposal = null;
  });
}

export function promptContributor(store) {
  return async (request) => {
    if (!isEnabled(request.chatMeta, request.mode)) return null;
    const { sheet } = await store.load(request.chatId);
    return sheetContext(sheet);
  };
}

export async function activate(context) {
  const runtime = context.api.runtime;
  const store = createStore(runtime.persistence);
  const fail = (reply, error) => {
    const status = error instanceof SheetError ? error.statusCode : 500;
    if (status >= 500) runtime.logger?.error?.(error, "Call Sheet request failed");
    return reply
      .status(status)
      .send({ error: error instanceof SheetError ? error.message : "Call Sheet request failed." });
  };
  const handle = (work) => async (request, reply) => {
    try {
      return reply.send(await work(request.params.chatId, request.body ?? {}));
    } catch (error) {
      return fail(reply, error);
    }
  };
  const releases = [];
  try {
    releases.push(context.api.registerPromptContext(promptContributor(store)));
    releases.push(
      await context.api.registerPrivilegedRoutes(
        async (routes) => {
          routes.get(
            "/chats/:chatId",
            handle(async (chatId) => (await store.load(chatId)).sheet),
          );
          routes.put(
            "/chats/:chatId/spine",
            handle((chatId, body) => updateSpine(store, chatId, body)),
          );
          routes.post(
            "/chats/:chatId/propose",
            handle((chatId, body) => propose(runtime, store, chatId, body.instruction)),
          );
          routes.delete(
            "/chats/:chatId/proposal",
            handle((chatId) => discardProposal(store, chatId)),
          );
          routes.post(
            "/chats/:chatId/end",
            handle((chatId) => endScene(runtime, store, chatId)),
          );
          routes.post(
            "/chats/:chatId/accept",
            handle((chatId, body) => acceptScene(runtime, store, chatId, body.plan)),
          );
        },
        { prefix: `/api/${PACKAGE_ID}/v1` },
      ),
    );
  } catch (error) {
    for (const release of releases.reverse()) await release();
    throw error;
  }
  return async () => {
    for (const release of releases.reverse()) await release();
  };
}
