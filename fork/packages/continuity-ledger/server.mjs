// Continuity Ledger: dated milestones and secrets per chat, so the narrator knows since when something is true and
// who knows what. One post-processing extractor run per reply (local Gemma by design) adds entries and reports
// which open entries the reply contradicted; the prompt contributor shows the entries for the people in the scene.
// The block is shown on a deterministic share of at-risk turns (pOn) so the in-flight posterior can compare the two
// arms (spec section 3). Every turn's arm and outcome is kept in the ledger's log.

import {
  applyOps,
  blockShown,
  cleanSettings,
  emptyLedger,
  inScene,
  isYes,
  judgeQuestions,
  playerTurn,
  record,
  render,
  resolve,
} from "./ledger.mjs";

export const PACKAGE_ID = "continuity-ledger";
const DOC_KIND = "continuity-ledger";
const SETTINGS_ID = `${PACKAGE_ID}:settings`;
const MODES = new Set(["roleplay", "game"]);
const docId = (chatId) => `${PACKAGE_ID}:${chatId}`;

const parseMeta = (value) => {
  if (value && typeof value === "object") return value;
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
};
export const isEnabled = (meta, mode) => {
  const m = parseMeta(meta);
  return (
    MODES.has(mode) &&
    m.enableAgents === true &&
    Array.isArray(m.activeAgentIds) &&
    m.activeAgentIds.includes(PACKAGE_ID)
  );
};

export function createStore(runtime) {
  const { documents } = runtime.persistence;
  const now = () => new Date().toISOString();
  return {
    async load(chatId) {
      const doc = await documents.getById(PACKAGE_ID, docId(chatId));
      return { ledger: doc?.data ?? emptyLedger(), revision: doc?.revision ?? 0 };
    },
    async save(chatId, ledger, revision) {
      const base = {
        id: docId(chatId),
        packageId: PACKAGE_ID,
        name: `Continuity ledger ${chatId}`,
        description: "",
        data: ledger,
      };
      if (revision) {
        const updated = await documents.update({ ...base, expectedRevision: revision, updatedAt: now() });
        if (!updated) throw new Error("continuity ledger changed concurrently");
        return updated;
      }
      return documents.create({ ...base, kind: DOC_KIND, createdAt: now(), updatedAt: now() });
    },
    async settings() {
      return cleanSettings((await documents.getById(PACKAGE_ID, SETTINGS_ID))?.data);
    },
  };
}

/** The extractor's view: open entries (newest first, capped) and the cast names it may use. */
export async function prepare(runtime, store, context) {
  if (!MODES.has(context?.chatMode)) return null;
  const [{ ledger }, messages, settings] = await Promise.all([
    store.load(context.chatId),
    runtime.persistence.listMessages(context.chatId),
    store.settings(),
  ]);
  const open = resolve(ledger, messages)
    .sort((x, y) => y.since - x.since)
    .slice(0, settings.maxInput);
  const player = playerTurn(messages, context.mainResponse, ledger.last);
  return {
    entries: open.map((item) => [item.id, item.kind, item.who.join(", "), item.text]),
    cast: [...(context.characters ?? []).map((c) => c.name), context.persona?.name].filter(Boolean),
    ...(player.length ? { player_turn: player } : {}),
  };
}

/** The message this run describes: the newest message matching mainResponse (any role, so impersonate counts). */
export function anchorFor(messages, mainResponse) {
  const text = typeof mainResponse === "string" ? mainResponse.trim() : "";
  const index = text ? messages.findLastIndex((m) => m.content.trim() === text) : -1;
  const at = index >= 0 ? index : messages.findLastIndex((m) => m.role === "assistant");
  return at >= 0 ? { index: at, anchor: { m: messages[at].id, w: messages[at].activeSwipeIndex ?? 0 } } : null;
}

/**
 * The outcome for the posterior: which in-scene entries this reply contradicted. One yes/no call per question on the
 * agent's own connection (local Gemma by design); an entry counts when any of its questions says yes. Folding this
 * into the extractor prompt failed on Gemma (11-22 probe), single closed questions worked.
 */
export async function judge(runtime, items, reply, now, settings) {
  if (!settings.judge || !items.length || !runtime.languageModels) return [];
  const config = await runtime.getAgentConfig?.();
  const model = await runtime.languageModels.resolve(config?.connectionId ?? null);
  const passage = reply.agentContent ?? reply.content ?? "";
  const hits = [];
  for (const item of items.slice(0, settings.maxJudged)) {
    for (const question of judgeQuestions(item, now)) {
      const answer = await model.chatComplete(
        [
          { role: "system", content: "Answer with one word: yes or no." },
          { role: "user", content: `${question}\n\nPassage:\n${passage}` },
        ],
        { temperature: 0, maxTokens: 5, reasoningEffort: "none" },
      );
      if (isYes(answer?.content)) {
        hits.push(item.id);
        break;
      }
    }
  }
  return hits;
}

export async function finalize(runtime, store, { context, result }) {
  const done = (diagnostics) => ({
    ...result,
    type: "context_injection",
    data: { text: "", diagnostics },
    success: true,
    error: null,
  });
  if (!result?.success || !MODES.has(context?.chatMode)) return result;
  const raw = typeof result.data?.text === "string" ? result.data.text : "";
  let parsed;
  try {
    parsed = raw.trim() ? runtime.json.parseJsonish(raw) : {};
  } catch {
    return done({ error: "extractor output was not JSON" });
  }
  const ops = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.ops) ? parsed.ops : [];
  const settings = await store.settings();
  let contradicted = null; // judged once, even if the save retries

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const [{ ledger, revision }, messages] = await Promise.all([
      store.load(context.chatId),
      runtime.persistence.listMessages(context.chatId),
    ]);
    const found = anchorFor(messages, context.mainResponse);
    if (!found) return done({ error: "no message to anchor to" });
    const { index, anchor } = found;
    if (ledger.last?.m === anchor.m && ledger.last?.w === anchor.w)
      return done({ applied: 0, skipped: 0, repeat: true });

    // What the narrator had when it wrote this reply: the ledger before this reply, the messages before it.
    const before = messages.slice(0, index);
    const shown = inScene(resolve(ledger, before), before, settings);
    const previous = before.at(-1);
    const arm =
      shown.length && previous ? (blockShown(context.chatId, previous.id, settings.pOn) ? "on" : "off") : null;
    const ids = new Set(shown.map((item) => item.id));
    if (arm) {
      contradicted ??= await judge(runtime, shown, messages[index], index + 1, settings);
      record(ledger, { ...anchor, arm, pOn: settings.pOn, items: [...ids], contradicted });
    }

    const counts = applyOps(ledger, ops, anchor, messages, settings);
    ledger.last = anchor;
    try {
      await store.save(context.chatId, ledger, revision);
      return done({ ...counts, arm });
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
  return done({ applied: 0, skipped: ops.length });
}

/** Prompt contributor: read-only. Shows the in-scene entries on the turns where the deterministic arm is "on". */
export function ledgerContext(runtime, store) {
  return async (request) => {
    if (!request?.chatId || !isEnabled(request.chatMeta, request.mode)) return null;
    const [{ ledger }, messages, settings] = await Promise.all([
      store.load(request.chatId),
      runtime.persistence.listMessages(request.chatId),
      store.settings(),
    ]);
    const last = messages.at(-1);
    if (!last || !blockShown(request.chatId, last.id, settings.pOn)) return null;
    return render(inScene(resolve(ledger, messages), messages, settings), messages.length);
  };
}

export async function activate(context) {
  const runtime = context.api.runtime;
  const store = createStore(runtime);
  const releases = [];
  try {
    releases.push(
      context.api.registerService(`agent-runtime:${PACKAGE_ID}`, {
        prepareContext: ({ context: agentContext }) => prepare(runtime, store, agentContext),
        finalizeResult: (input) => finalize(runtime, store, input),
      }),
    );
    releases.push(context.api.registerService(PACKAGE_ID, { load: (chatId) => store.load(chatId) }));
    releases.push(context.api.registerPromptContext(ledgerContext(runtime, store)));
  } catch (error) {
    for (const release of releases.reverse()) await release();
    throw error;
  }
  return async () => {
    for (const release of releases.reverse()) await release();
  };
}
