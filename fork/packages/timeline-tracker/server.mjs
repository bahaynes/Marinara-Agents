// Timeline Tracker: a per-chat story clock and the milestones that started on it, so the story
// model never stretches "yesterday" into "for weeks". The post-processing agent reports only what
// the turn says (time passed, the stated date/time, milestones begun or ended); this code keeps
// the totals and does every duration, and the prompt context injects the result next turn.
// Each turn's report is anchored to its assistant message and swipe, so swipes, regenerations
// and deleted messages drop that turn's report.

export const PACKAGE_ID = "timeline-tracker";
const DOC_KIND = "timeline";
const MODES = new Set(["roleplay", "game"]);
const KINDS = new Set(["SK", "REL", "EV", "ST"]);
const KIND_LABEL = { SK: "skill/practice", REL: "relationship", EV: "event", ST: "status" };
// ponytail: fixed cap on milestones shown to the models; make it an agent setting if 12 proves wrong.
const SHOWN_MILESTONES = 12;

const docId = (chatId) => `${PACKAGE_ID}:${chatId}`;
const parseMeta = (value) => {
  if (value && typeof value === "object") return value;
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
};
const isEnabled = (meta, mode) =>
  MODES.has(mode) &&
  meta?.enableAgents === true &&
  Array.isArray(meta.activeAgentIds) &&
  meta.activeAgentIds.includes(PACKAGE_ID);

/** World State's committed date/time, only while World State is active (an old snapshot outlives it). */
async function worldTime(runtime, chatId, meta) {
  if (!meta?.activeAgentIds?.includes?.("world-state")) return null;
  const world = await runtime.persistence.getGameState?.(chatId).catch(() => null);
  return [world?.date, world?.time].filter(Boolean).join(", ") || null;
}
const text = (value, max = 160) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const minutes = (value) => (Number.isFinite(value) && value >= 0 ? Math.round(value) : 0);

/** "40 minutes", "5 hours", "2 days, 3 hours", "3 weeks", "4 months". */
export function formatDuration(min) {
  const m = Math.max(0, Math.round(min));
  const plural = (n, unit) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  if (m < 60) return plural(m, "minute");
  const hours = Math.floor(m / 60);
  if (hours < 24) return plural(hours, "hour");
  const days = Math.floor(hours / 24);
  if (days < 3) return hours % 24 ? `${plural(days, "day")}, ${plural(hours % 24, "hour")}` : plural(days, "day");
  if (days < 14) return plural(days, "day");
  if (days < 60) return plural(Math.floor(days / 7), "week");
  return plural(Math.floor(days / 30), "month");
}

/**
 * Fold the turn reports that sit on the active message path, oldest first.
 * `skipMessageId` leaves out the message being regenerated or continued.
 */
export function resolve(doc, messages, skipMessageId = null) {
  const order = new Map(messages.map((message, index) => [message.id, index]));
  const swipes = new Map(messages.map((message) => [message.id, message.activeSwipeIndex ?? 0]));
  const turns = (doc?.turns ?? [])
    .filter((turn) => turn.m !== skipMessageId && order.has(turn.m) && swipes.get(turn.m) === turn.w)
    .sort((a, b) => order.get(a.m) - order.get(b.m));
  const state = { elapsed: null, stated: "", milestones: new Map() };
  for (const turn of turns) {
    state.elapsed = state.elapsed === null && Number.isFinite(turn.total) ? turn.total : (state.elapsed ?? 0) + turn.d;
    if (turn.s) state.stated = turn.s;
    for (const id of turn.end ?? []) state.milestones.delete(id);
    for (const [index, item] of (turn.start ?? []).entries()) {
      state.milestones.set(`${turn.m}.${index}`, { ...item, at: state.elapsed });
    }
  }
  return state;
}

/** Turn the extractor's JSON into a stored turn report. Returns null when it is unusable. */
export function parseReport(parsed, known) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const start = (Array.isArray(parsed.start) ? parsed.start : [])
    .map((item) => ({ k: KINDS.has(item?.kind) ? item.kind : "EV", who: text(item?.who, 80), what: text(item?.what) }))
    .filter((item) => item.what);
  const end = (Array.isArray(parsed.end) ? parsed.end : []).filter((id) => typeof id === "string" && known.has(id));
  const report = { d: minutes(Number(parsed.minutesPassed)), s: text(parsed.stated, 80) };
  if (Number.isFinite(Number(parsed.totalElapsedMin)) && parsed.totalElapsedMin !== null) {
    report.total = minutes(Number(parsed.totalElapsedMin));
  }
  if (start.length) report.start = start;
  if (end.length) report.end = end;
  return report;
}

/** Newest milestones first, capped, with how long ago each began. */
function shownMilestones(state) {
  return [...state.milestones.entries()]
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, SHOWN_MILESTONES)
    .map(([id, item]) => ({ id, ...item, ago: formatDuration((state.elapsed ?? 0) - item.at) }));
}

const nowLabel = (state, world) => world || state.stated || "not yet stated";

/** The block the story model reads. */
export function timelineBlock(state, world) {
  if (state.elapsed === null) return null;
  const total = formatDuration(state.elapsed);
  const lines = [
    "Story timeline (authoritative; keep every duration consistent with it):",
    `- Now: ${nowLabel(state, world)}. Time since the story began: ${total}.`,
  ];
  const shown = shownMilestones(state);
  if (shown.length) {
    lines.push("- Began during the story:");
    for (const item of shown) {
      lines.push(`  - ${item.who ? `${item.who}: ` : ""}${item.what} (${KIND_LABEL[item.k]}, began ${item.ago} ago)`);
    }
  }
  lines.push(
    `- Nothing that began in this story has lasted longer than ${total}. Never describe skills, habits, ` +
      "relationships or familiarity from the story as older than shown here.",
  );
  return lines.join("\n");
}

export function createStore(runtime) {
  const { persistence } = runtime;
  const { documents } = persistence;

  async function load(chatId, depth = 0) {
    const doc = await documents.getById(PACKAGE_ID, docId(chatId));
    if (doc) return { doc: doc.data, revision: doc.revision };
    // A branch starts with its parent's timeline, remapped onto the copied messages.
    const chat = await persistence.getChat(chatId);
    const parentId = chat?.branch?.parentChatId;
    if (parentId && depth < 8) {
      const parent = await load(parentId, depth + 1);
      if (parent.doc.turns.length) {
        const [parentMessages, messages] = await Promise.all([
          persistence.listMessages(parentId),
          persistence.listMessages(chatId),
        ]);
        return { doc: inherit(parent.doc, parentMessages, messages), revision: 0 };
      }
    }
    return { doc: { turns: [] }, revision: 0 };
  }

  async function save(chatId, doc, revision) {
    const now = new Date().toISOString();
    const base = { id: docId(chatId), packageId: PACKAGE_ID, name: `Timeline ${chatId}`, description: "", data: doc };
    if (revision) {
      // The host returns null (not a throw) when the revision moved underneath us.
      const updated = await documents.update({ ...base, expectedRevision: revision, updatedAt: now });
      if (!updated) throw new Error("Timeline changed concurrently");
      return updated;
    }
    return documents.create({ ...base, kind: DOC_KIND, createdAt: now, updatedAt: now });
  }

  return { load, save };
}

export function inherit(parentDoc, parentMessages, branchMessages) {
  const map = new Map(parentMessages.slice(0, branchMessages.length).map((m, i) => [m.id, branchMessages[i].id]));
  const remapId = (id) => {
    const [m, index] = id.split(".");
    return map.has(m) ? `${map.get(m)}.${index}` : null;
  };
  return {
    turns: parentDoc.turns
      .filter((turn) => map.has(turn.m))
      .map((turn) => ({
        ...turn,
        m: map.get(turn.m),
        ...(turn.end ? { end: turn.end.map(remapId).filter(Boolean) } : {}),
      })),
  };
}

/** The message a post-processing run describes: the newest assistant message matching mainResponse. */
function anchorFor(messages, mainResponse) {
  const assistants = messages.filter((message) => message.role === "assistant");
  const target =
    assistants.findLast((message) => mainResponse && message.content.trim() === mainResponse.trim()) ??
    assistants.at(-1);
  return target ? { m: target.id, w: target.activeSwipeIndex ?? 0 } : null;
}

/** The extractor's view: the clock so far and the open milestones, before this turn. */
export async function prepare(runtime, store, context) {
  if (!MODES.has(context?.chatMode)) return null;
  const [{ doc }, messages, world] = await Promise.all([
    store.load(context.chatId),
    runtime.persistence.listMessages(context.chatId),
    runtime.persistence
      .getChat(context.chatId)
      .then((chat) => worldTime(runtime, context.chatId, parseMeta(chat?.metadata))),
  ]);
  const anchor = anchorFor(messages, context.mainResponse);
  const state = resolve(doc, messages, anchor?.m);
  return {
    firstRun: state.elapsed === null,
    elapsedSoFar: state.elapsed === null ? null : formatDuration(state.elapsed),
    lastStatedTime: state.stated || null,
    worldStateTime: world,
    milestones: shownMilestones(state).map((item) => [item.id, item.k, item.who, item.what, `${item.ago} ago`]),
  };
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
  if (!raw.trim()) return done({ error: "empty extractor output" });
  let parsed;
  try {
    parsed = runtime.json.parseJsonish(raw);
  } catch {
    return done({ error: "extractor output was not JSON" });
  }

  // Single writer per chat, but retry once if a concurrent run bumped the revision.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const [{ doc, revision }, messages] = await Promise.all([
      store.load(context.chatId),
      runtime.persistence.listMessages(context.chatId),
    ]);
    const anchor = anchorFor(messages, context.mainResponse);
    if (!anchor) return done({ error: "no assistant message to anchor to" });
    const before = resolve(doc, messages, anchor.m);
    const report = parseReport(parsed, new Set(before.milestones.keys()));
    if (!report) return done({ error: "extractor output had the wrong shape" });
    if (before.elapsed !== null) delete report.total;
    doc.turns = doc.turns.filter((turn) => !(turn.m === anchor.m && turn.w === anchor.w));
    doc.turns.push({ m: anchor.m, w: anchor.w, ...report });
    try {
      await store.save(context.chatId, doc, revision);
      const after = resolve(doc, messages);
      runtime.logger?.info(
        "[timeline-tracker] turn chat=%s +%dmin total=%dmin started=%d ended=%d",
        context.chatId,
        report.d,
        after.elapsed ?? 0,
        report.start?.length ?? 0,
        report.end?.length ?? 0,
      );
      return done({ minutesPassed: report.d, totalMin: after.elapsed, open: after.milestones.size });
    } catch (error) {
      if (attempt === 1) throw error;
    }
  }
  return done({ error: "timeline changed concurrently" });
}

export function timelineContext(runtime, store) {
  return async (request) => {
    if (!isEnabled(request?.chatMeta, request?.mode)) return null;
    const [{ doc }, messages, world] = await Promise.all([
      store.load(request.chatId),
      runtime.persistence.listMessages(request.chatId),
      worldTime(runtime, request.chatId, request.chatMeta),
    ]);
    // A trailing assistant message is being regenerated or continued: its own report doesn't count yet.
    const last = messages.at(-1);
    return timelineBlock(resolve(doc, messages, last?.role === "assistant" ? last.id : null), world);
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
    releases.push(context.api.registerPromptContext(timelineContext(runtime, store)));
  } catch (error) {
    for (const release of releases.reverse()) await release();
    throw error;
  }
  return async () => {
    for (const release of releases.reverse()) await release();
  };
}
