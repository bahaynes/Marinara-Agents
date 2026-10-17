// Call Sheet: its own Home page for scene-by-scene story play. It owns its stories and builds every
// prompt itself (see the layout in sheet.mjs), so no Engine chat preset, memory agent or lorebook
// shapes it. The Engine's character and persona library is read for the cast; the Engine's model API
// runs the jobs: main model for the narrator, impersonate and scene planner, agent model for the
// scene summarizer. Scenes end only when the player says so.

import {
  REPLY_LENGTHS,
  cacheStats,
  castCard,
  cleanOutcomes,
  cleanSettings,
  cleanUsage,
  cleanPlan,
  cleanSpine,
  emptySheet,
  impersonatePrompt,
  narratorPrompt,
  newTurn,
  openScene,
  proposalPrompt,
  summaryPrompt,
  transcript,
  transcriptBudget,
} from "./sheet.mjs";
import {
  analyzePromptPolicy,
  optimizePresetForCaching,
} from "./prompt-policy.mjs";

export const PACKAGE_ID = "call-sheet";
const STORY_KIND = "story";
const TURNS_KIND = "scene-turns";
const LAST_SCENE_TAIL = 6;
const SUMMARY_TOKENS = 1500;
const MAX_SWIPES = 8;
// Scene jobs repeat the previous request, so they ask for the long cache: replies arrive minutes apart.
const SCENE_CACHE = Object.freeze({ ttl: "1h", depth: 1 });
const silent = () => {};

const storyDocId = (storyId) => `${PACKAGE_ID}:story:${storyId}`;
const turnsDocId = (storyId, sceneId) => `${PACKAGE_ID}:turns:${storyId}:${sceneId}`;

export class SheetError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

/** One write at a time per story, so two clicks cannot interleave. */
function createLocks() {
  const tails = new Map();
  return (key, work) => {
    const run = (tails.get(key) ?? Promise.resolve()).then(work, work);
    const tail = run.catch(() => {});
    tails.set(key, tail);
    void tail.then(() => tails.get(key) === tail && tails.delete(key));
    return run;
  };
}

export function createStore(documents) {
  const lock = createLocks();

  async function read(id) {
    return documents.getById(PACKAGE_ID, id);
  }

  async function write(id, kind, name, data, revision) {
    const now = new Date().toISOString();
    const base = { id, packageId: PACKAGE_ID, name, description: "", data };
    if (revision) {
      const updated = await documents.update({ ...base, expectedRevision: revision, updatedAt: now });
      if (!updated) throw new SheetError(409, "This story changed in another window. Reload and try again.");
      return updated;
    }
    return documents.create({ ...base, kind, createdAt: now, updatedAt: now });
  }

  async function loadStory(storyId) {
    const doc = await read(storyDocId(storyId));
    if (!doc) throw new SheetError(404, "Story not found.");
    const story = {
      ...doc.data,
      settings: cleanSettings(doc.data.settings),
      sheet: { ...emptySheet(), ...doc.data.sheet },
    };
    return { story, revision: doc.revision };
  }

  async function loadTurns(storyId, sceneId) {
    const doc = await read(turnsDocId(storyId, sceneId));
    return { turns: doc?.data?.turns ?? [], revision: doc?.revision ?? 0 };
  }

  return {
    lock,
    loadStory,
    loadTurns,
    async listStories() {
      const docs = await documents.list(PACKAGE_ID, STORY_KIND);
      return docs
        .map((doc) => ({
          id: doc.data.id,
          title: doc.data.title,
          scenes: doc.data.sheet?.scenes?.length ?? 0,
          updatedAt: doc.updatedAt ?? doc.data.createdAt,
        }))
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    },
    async createStory(story) {
      await write(storyDocId(story.id), STORY_KIND, story.title, story, 0);
      return story;
    },
    /** Read, change and write a story under its lock. `change` may return a value to hand back. */
    updateStory(storyId, change) {
      return lock(storyId, async () => {
        const { story, revision } = await loadStory(storyId);
        const result = await change(story);
        await write(storyDocId(storyId), STORY_KIND, story.title, story, revision);
        return result ?? story;
      });
    },
    /** Returns the new revision, for a second save in the same request. */
    async saveTurns(storyId, sceneId, turns, revision) {
      return (await write(turnsDocId(storyId, sceneId), TURNS_KIND, `Scene ${sceneId}`, { turns }, revision)).revision;
    },
    async removeStory(storyId) {
      const { story, revision } = await loadStory(storyId);
      for (const scene of story.sheet.scenes) {
        const doc = await read(turnsDocId(storyId, scene.id));
        if (doc) await documents.remove(PACKAGE_ID, doc.id, doc.revision);
      }
      await documents.remove(PACKAGE_ID, storyDocId(storyId), revision);
    },
  };
}

// ── Library and models ──

const parseRecord = (value) => {
  if (value && typeof value === "object") return value;
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
};

/**
 * The Engine's characters and personas for the story form, with the card colors and avatar the page uses
 * to draw them the way Roleplay does. Character cards keep their colors under `extensions`.
 */
export async function library(runtime) {
  const [characters, personas] = await Promise.all([
    runtime.resources.listCharacters(),
    runtime.resources.listPersonas(),
  ]);
  const text = (value) => (typeof value === "string" ? value.trim().slice(0, 300) : "");
  const entry = (id, data, colors) => ({
    id,
    name: text(data.name),
    nameColor: text(colors.nameColor),
    dialogueColor: text(colors.dialogueColor),
  });
  const sorted = (list) => list.filter((r) => r.name).sort((a, b) => a.name.localeCompare(b.name));
  return {
    characters: sorted(
      characters.map((r) => {
        const data = parseRecord(r.data);
        return {
          ...entry(r.id, data, parseRecord(data.extensions)),
          avatarPath: `/api/characters/${encodeURIComponent(r.id)}/avatar`,
        };
      }),
    ),
    personas: sorted(
      personas.map((r) => {
        const data = parseRecord(r.data);
        const avatarPath = text(data.avatarPath);
        return { ...entry(r.id, data, data), avatarPath: avatarPath.startsWith("/api/") ? avatarPath : "" };
      }),
    ),
  };
}

async function storyCast(runtime, story) {
  const [characters, personas] = await Promise.all([
    story.characterIds.length ? runtime.resources.listCharacters(story.characterIds) : [],
    story.personaId ? runtime.resources.listPersonas([story.personaId]) : [],
  ]);
  const cast = characters.map((r) => castCard(parseRecord(r.data))).filter(Boolean);
  const persona = castCard(parseRecord(personas[0]?.data)) ?? { name: "The player character", description: "" };
  return { cast, persona };
}

/** A connection id from the page, or null for the user's default main connection. */
const connectionId = (value) => (typeof value === "string" && value.trim() ? value.trim().slice(0, 120) : null);

const mainModel = (runtime, story) => runtime.languageModels.resolve(story.mainConnectionId ?? null);

async function agentModel(runtime, story) {
  const config = await runtime.getAgentConfig?.();
  return runtime.languageModels.resolveForRequest({
    connectionId: story.agentConnectionId ?? config?.connectionId ?? null,
  });
}

/**
 * One scene turn on the main model. `emit` gets `{type: "start", speaker}` and then each streamed chunk as
 * `{type: "token", text}`; an Engine without streaming simply sends no chunks.
 */
async function completeText(model, messages, emit, speaker, maxTokens, signal) {
  const fitted = model.fitContext ? model.fitContext(messages, { maxTokens }).messages : messages;
  emit({ type: "start", speaker });
  const result = await model.chatComplete(fitted, {
    maxTokens,
    promptCache: SCENE_CACHE,
    onToken: (text) => emit({ type: "token", text }),
    ...(signal ? { signal } : {}),
  });
  const content = String(result.content ?? "").trim();
  if (!content) throw new SheetError(502, "The model returned an empty reply.");
  return { content, usage: cleanUsage(result.usage) };
}

async function completeJson(runtime, model, messages, maxTokens) {
  const result = await model.chatComplete(messages, { temperature: 0.7, maxTokens });
  const parsed = runtime.json.parseJsonish(result.content ?? "");
  if (!parsed || typeof parsed !== "object") throw new SheetError(502, "The model did not return a usable answer.");
  return parsed;
}

// ── Stories ──

export async function createStory(runtime, store, body) {
  const characterIds = Array.isArray(body.characterIds) ? body.characterIds.map(String).slice(0, 24) : [];
  const story = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    title:
      String(body.title ?? "")
        .trim()
        .slice(0, 120) || "Untitled story",
    personaId: body.personaId ? String(body.personaId) : null,
    characterIds,
    mainConnectionId: connectionId(body.mainConnectionId),
    agentConnectionId: connectionId(body.agentConnectionId),
    settings: cleanSettings(body),
    createdAt: new Date().toISOString(),
    sheet: { ...emptySheet(), spine: cleanSpine(body) },
  };
  return store.createStory(story);
}

/** The story with every scene's turns, for the page. */
export async function storyView(store, storyId) {
  const { story } = await store.loadStory(storyId);
  const turns = {};
  const stats = {};
  for (const scene of story.sheet.scenes) {
    turns[scene.id] = (await store.loadTurns(storyId, scene.id)).turns;
    stats[scene.id] = cacheStats(turns[scene.id]);
  }
  return { story, turns, stats };
}

// ── Scenes ──

/** Scene planner: the main model. Rerolls keep earlier proposals until one is accepted. */
export async function propose(runtime, store, storyId, rawInstruction) {
  const instruction = String(rawInstruction ?? "").trim();
  const { story } = await store.loadStory(storyId);
  const { cast, persona } = await storyCast(runtime, story);
  const sheet = story.sheet;
  const last = openScene(sheet) ?? sheet.scenes[sheet.scenes.length - 1];
  const tail = last ? (await store.loadTurns(storyId, last.id)).turns.slice(-LAST_SCENE_TAIL) : [];
  const prompt = proposalPrompt({ sheet, cast, persona, lastScene: transcript(tail, persona), instruction });
  const plan = cleanPlan(await completeJson(runtime, await mainModel(runtime, story), prompt, 1200));
  return store.updateStory(storyId, (fresh) => {
    const earlier = fresh.sheet.proposal?.instruction === instruction ? fresh.sheet.proposal.plans : [];
    fresh.sheet.proposal = { instruction, plans: [...earlier, plan].slice(-5) };
  });
}

/** Scene summarizer: the agent model, falling back to main so a scene can always end. */
export async function endScene(runtime, store, storyId) {
  const { story } = await store.loadStory(storyId);
  const scene = openScene(story.sheet);
  if (!scene) throw new SheetError(409, "There is no scene in play to end.");
  const { turns } = await store.loadTurns(storyId, scene.id);
  let summary = "Nothing happened in this scene.";
  let outcomes = scene.plan.goals.map((goal) => ({ goal, status: "open" }));
  if (turns.length) {
    const { persona } = await storyCast(runtime, story);
    const summarize = async (model) =>
      completeJson(
        runtime,
        model,
        summaryPrompt({
          plan: scene.plan,
          sceneText: transcript(turns, persona, transcriptBudget(model.maxContext, SUMMARY_TOKENS)),
        }),
        SUMMARY_TOKENS,
      );
    let parsed;
    try {
      parsed = await summarize(await agentModel(runtime, story));
    } catch (error) {
      runtime.logger?.warn?.("Call Sheet summary on the agent model failed, using the main model: %s", error?.message);
      parsed = await summarize(await mainModel(runtime, story));
    }
    summary = String(parsed.summary ?? "").trim() || summary;
    outcomes = cleanOutcomes(parsed.goals, scene.plan.goals);
  }
  return store.updateStory(storyId, (fresh) => {
    const open = openScene(fresh.sheet);
    if (!open || open.id !== scene.id) throw new SheetError(409, "The scene changed while it was being summarized.");
    Object.assign(open, { summary, outcomes, endedAt: new Date().toISOString() });
  });
}

/** Record a 1-5 player rating on a finished scene (KPI 2). */
export function rateScene(store, storyId, sceneId, rawRating) {
  const rating = rawRating === null ? null : Number(rawRating);
  if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
    throw new SheetError(400, "Scene rating must be an integer from 1 to 5.");
  }
  return store.updateStory(storyId, (story) => {
    const scene = story.sheet.scenes.find((s) => s.id === sceneId);
    if (!scene) throw new SheetError(404, "Scene not found.");
    scene.rating = rating;
  });
}

/** Change any of: title, story model, summary model, reply length, review-before-reply. */
export function updateSettings(store, storyId, body) {
  return store.updateStory(storyId, (story) => {
    if (typeof body.title === "string" && body.title.trim()) story.title = body.title.trim().slice(0, 120);
    if ("mainConnectionId" in body) story.mainConnectionId = connectionId(body.mainConnectionId);
    if ("agentConnectionId" in body) story.agentConnectionId = connectionId(body.agentConnectionId);
    story.settings = cleanSettings({ ...cleanSettings(story.settings), ...body });
  });
}

export function acceptScene(store, storyId, rawPlan) {
  return store.updateStory(storyId, (story) => {
    if (openScene(story.sheet)) throw new SheetError(409, "End the current scene before starting a new one.");
    story.sheet.scenes.push({
      id: `s${story.sheet.scenes.length + 1}-${Date.now().toString(36)}`,
      plan: cleanPlan(rawPlan),
      instruction: story.sheet.proposal?.instruction ?? "",
      startedAt: new Date().toISOString(),
      summary: null,
      outcomes: null,
    });
    story.sheet.proposal = null;
  });
}

// ── Turns ──

const sceneResult = (sceneId, turns) => ({ sceneId, turns, stats: cacheStats(turns) });

async function sceneContext(runtime, store, storyId) {
  const { story } = await store.loadStory(storyId);
  const scene = openScene(story.sheet);
  if (!scene) throw new SheetError(409, "Start a scene first.");
  const { cast, persona } = await storyCast(runtime, story);
  const { turns, revision } = await store.loadTurns(storyId, scene.id);
  const settings = cleanSettings(story.settings);
  const args = { sheet: story.sheet, cast, persona, settings };
  return {
    story,
    scene,
    cast,
    persona,
    turns,
    revision,
    settings,
    args,
    tokens: REPLY_LENGTHS[settings.replyLength].tokens,
  };
}

/**
 * Play one turn. `instruction`: the persona's turn is written from the player's note (impersonate), then
 * the narrator answers. `written`: the player's text is the persona's turn. `continue`: the narrator goes on.
 */
export function playTurn(runtime, store, storyId, body, emit = silent, signal) {
  const kind = body.kind;
  const input = String(body.text ?? "").trim();
  if (!["instruction", "written", "continue"].includes(kind)) throw new SheetError(400, "Unknown turn kind.");
  if (kind !== "continue" && !input) throw new SheetError(400, "Write something first.");
  return store.lock(`turns:${storyId}`, async () => {
    const ctx = await sceneContext(runtime, store, storyId);
    const model = await mainModel(runtime, ctx.story);
    const turns = [...ctx.turns];
    const { args, tokens } = ctx;
    let revision = ctx.revision;
    if (kind !== "continue") {
      const written =
        kind === "instruction"
          ? await completeText(
              model,
              impersonatePrompt({ ...args, turns, instruction: input }),
              emit,
              "persona",
              tokens,
              signal,
            )
          : { content: input, usage: null };
      turns.push(
        newTurn("persona", written.content, {
          kind,
          instruction: kind === "instruction" ? input : "",
          usage: written.usage,
        }),
      );
      // Saved before the narrator runs, so a failed reply never loses the player's turn.
      revision = await store.saveTurns(storyId, ctx.scene.id, turns, revision);
      // With review on, the player checks the written turn first and asks for the reply with Continue.
      if (kind === "instruction" && ctx.settings.reviewTurns) return sceneResult(ctx.scene.id, turns);
    }
    const reply = await completeText(model, narratorPrompt({ ...args, turns }), emit, "narrator", tokens, signal);
    turns.push(newTurn("narrator", reply.content, { kind: "reply", usage: reply.usage }));
    await store.saveTurns(storyId, ctx.scene.id, turns, revision);
    return sceneResult(ctx.scene.id, turns);
  });
}

/** Write a new version of the newest turn. Earlier versions stay selectable. */
export function rerollTurn(runtime, store, storyId, turnId, emit = silent, signal) {
  return store.lock(`turns:${storyId}`, async () => {
    const ctx = await sceneContext(runtime, store, storyId);
    const turns = structuredClone(ctx.turns);
    const turn = turns[turns.length - 1];
    if (!turn || turn.id !== turnId) throw new SheetError(409, "Only the newest turn can be rerolled.");
    const before = turns.slice(0, -1);
    const args = { ...ctx.args, turns: before };
    const model = await mainModel(runtime, ctx.story);
    const prompt =
      turn.speaker === "persona" && turn.instruction
        ? impersonatePrompt({ ...args, instruction: turn.instruction })
        : turn.speaker === "narrator"
          ? narratorPrompt(args)
          : null;
    if (!prompt) throw new SheetError(400, "A turn you wrote yourself can be edited, not rerolled.");
    const version = await completeText(model, prompt, emit, turn.speaker, ctx.tokens, signal);
    const usage = turn.swipes.map((_, i) => turn.usage?.[i] ?? null);
    turn.swipes = [...turn.swipes, version.content].slice(-MAX_SWIPES);
    turn.usage = [...usage, version.usage].slice(-MAX_SWIPES);
    turn.active = turn.swipes.length - 1;
    await store.saveTurns(storyId, ctx.scene.id, turns, ctx.revision);
    return sceneResult(ctx.scene.id, turns);
  });
}

/** Edit a turn's text, or pick which version is shown (`active`). */
export function editTurn(runtime, store, storyId, turnId, body) {
  return store.lock(`turns:${storyId}`, async () => {
    const ctx = await sceneContext(runtime, store, storyId);
    const turns = structuredClone(ctx.turns);
    const turn = turns.find((t) => t.id === turnId);
    if (!turn) throw new SheetError(404, "Turn not found.");
    if (Number.isInteger(body.active) && body.active >= 0 && body.active < turn.swipes.length)
      turn.active = body.active;
    if (typeof body.text === "string" && body.text.trim()) turn.swipes[turn.active] = body.text.trim();
    await store.saveTurns(storyId, ctx.scene.id, turns, ctx.revision);
    return sceneResult(ctx.scene.id, turns);
  });
}

/** Delete a turn and every turn after it. Finished scenes are frozen and cannot be changed. */
export function deleteTurn(runtime, store, storyId, turnId) {
  return store.lock(`turns:${storyId}`, async () => {
    const ctx = await sceneContext(runtime, store, storyId);
    const index = ctx.turns.findIndex((t) => t.id === turnId);
    if (index < 0) throw new SheetError(404, "Turn not found.");
    const turns = ctx.turns.slice(0, index);
    await store.saveTurns(storyId, ctx.scene.id, turns, ctx.revision);
    return sceneResult(ctx.scene.id, turns);
  });
}

// ── Activation ──

export async function activate(context) {
  const runtime = context.api.runtime;
  const store = createStore(runtime.persistence.documents);
  const handle = (work) => async (request, reply) => {
    try {
      return reply.send(await work(request.params ?? {}, request.body ?? {}));
    } catch (error) {
      const status = error instanceof SheetError ? error.statusCode : 500;
      if (status >= 500) runtime.logger?.error?.(error, "Call Sheet request failed");
      return reply
        .status(status)
        .send({ error: error instanceof SheetError ? error.message : "Call Sheet request failed." });
    }
  };
  // Turn routes stream as server-sent events when asked: start/token events, then one done or error event.
  const stream = (work) => async (request, reply) => {
    if (!String(request.headers?.accept ?? "").includes("text/event-stream")) {
      return handle((params, body) => work(params, body, silent, undefined))(request, reply);
    }
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    });
    const ac = new AbortController();
    const onClose = () => ac.abort();
    request.raw?.on?.("close", onClose);
    reply.raw?.on?.("close", onClose);
    const send = (event) => {
      if (!ac.signal.aborted) reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    try {
      send({ type: "done", result: await work(request.params ?? {}, request.body ?? {}, send, ac.signal) });
    } catch (error) {
      if (!ac.signal.aborted) {
        if (!(error instanceof SheetError)) runtime.logger?.error?.(error, "Call Sheet turn failed");
        send({ type: "error", error: error instanceof SheetError ? error.message : "Call Sheet request failed." });
      }
    } finally {
      request.raw?.off?.("close", onClose);
      reply.raw?.off?.("close", onClose);
    }
    if (!reply.raw.writableEnded) reply.raw.end();
  };
  const release = await context.api.registerPrivilegedRoutes(
    async (routes) => {
      routes.get(
        "/library",
        handle(() => library(runtime)),
      );
      routes.get(
        "/stories",
        handle(() => store.listStories()),
      );
      routes.post(
        "/stories",
        handle((_p, body) => createStory(runtime, store, body)),
      );
      routes.get(
        "/stories/:storyId",
        handle(({ storyId }) => storyView(store, storyId)),
      );
      routes.delete(
        "/stories/:storyId",
        handle(async ({ storyId }) => (await store.removeStory(storyId), { ok: true })),
      );
      routes.put(
        "/stories/:storyId/settings",
        handle(({ storyId }, body) => updateSettings(store, storyId, body)),
      );
      routes.put(
        "/stories/:storyId/spine",
        handle(({ storyId }, body) =>
          store.updateStory(storyId, (story) => {
            story.sheet.spine = cleanSpine(body);
          }),
        ),
      );
      routes.post(
        "/stories/:storyId/propose",
        handle(({ storyId }, body) => propose(runtime, store, storyId, body.instruction)),
      );
      routes.delete(
        "/stories/:storyId/proposal",
        handle(({ storyId }) =>
          store.updateStory(storyId, (story) => {
            story.sheet.proposal = null;
          }),
        ),
      );
      routes.post(
        "/stories/:storyId/end",
        handle(({ storyId }) => endScene(runtime, store, storyId)),
      );
      routes.put(
        "/stories/:storyId/scenes/:sceneId/rating",
        handle(({ storyId, sceneId }, body) => rateScene(store, storyId, sceneId, body.rating)),
      );
      routes.post(
        "/stories/:storyId/accept",
        handle(({ storyId }, body) => acceptScene(store, storyId, body.plan)),
      );
      routes.post(
        "/stories/:storyId/turns",
        stream(({ storyId }, body, emit, signal) => playTurn(runtime, store, storyId, body, emit, signal)),
      );
      routes.post(
        "/stories/:storyId/turns/:turnId/reroll",
        stream(({ storyId, turnId }, _body, emit, signal) => rerollTurn(runtime, store, storyId, turnId, emit, signal)),
      );
      routes.put(
        "/stories/:storyId/turns/:turnId",
        handle(({ storyId, turnId }, body) => editTurn(runtime, store, storyId, turnId, body)),
      );
      routes.delete(
        "/stories/:storyId/turns/:turnId",
        handle(({ storyId, turnId }) => deleteTurn(runtime, store, storyId, turnId)),
      );
      routes.post(
        "/stories/:storyId/policy/analyze",
        handle(async (_p, body) => analyzePromptPolicy(body?.preset, { provider: body?.provider || "anthropic" })),
      );
      routes.post(
        "/stories/:storyId/policy/optimize",
        handle(async (_p, body) => {
          const optimized = optimizePresetForCaching(body?.preset);
          const analysis = analyzePromptPolicy(optimized, { provider: body?.provider || "anthropic" });
          return { preset: optimized, analysis };
        }),
      );
    },
    { prefix: `/api/${PACKAGE_ID}/v1` },
  );
  return async () => {
    await release();
  };
}

export { analyzePromptPolicy, optimizePresetForCaching };
