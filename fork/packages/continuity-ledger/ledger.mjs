// Continuity Ledger: pure helpers (no host calls), so they can be tested directly.
// Spec: plan/continuity-ledger/spec.md. Two kinds of entry, both dated by the message that made them:
//   milestone: a change for named people that the story must date ("became lovers", "moved into the flat")
//   secret:    a private fact and the people who know it
// The log is append-only and anchored to message + swipe, resolved on every read (npc-registry's pattern):
// swiping, regenerating or deleting a message hides what it added, and swiping back restores it.

// Placeholders until in-flight data says otherwise; every one is a setting (settings document), not a design limit.
export const DEFAULTS = Object.freeze({
  maxInput: 40, // open entries shown to the extractor, newest first
  maxPrompt: 8, // entries in the narrator block
  mentionWindow: 6, // messages scanned for the names that put an entry in the scene
  maxNewPerRun: 3, // new entries one reply may add
  pOn: 0.5, // probability the narrator block is shown on an at-risk turn (updated from the posterior)
  judge: true, // ask the yes/no contradiction questions after each at-risk reply
  maxJudged: 8, // entries judged per reply
});
const MAX_TEXT = 200;
const MAX_LOG = 2000;

const int = (value, fallback, min, max) => (Number.isFinite(value) && value >= min && value <= max ? value : fallback);
export function cleanSettings(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  return {
    maxInput: int(s.maxInput, DEFAULTS.maxInput, 1, 200),
    maxPrompt: int(s.maxPrompt, DEFAULTS.maxPrompt, 1, 50),
    mentionWindow: int(s.mentionWindow, DEFAULTS.mentionWindow, 1, 50),
    maxNewPerRun: int(s.maxNewPerRun, DEFAULTS.maxNewPerRun, 0, 20),
    pOn: int(s.pOn, DEFAULTS.pOn, 0, 1),
    judge: typeof s.judge === "boolean" ? s.judge : DEFAULTS.judge,
    maxJudged: int(s.maxJudged, DEFAULTS.maxJudged, 0, 50),
  };
}

export const emptyLedger = () => ({ v: 1, seq: 0, entries: [], log: [], last: null });

const clean = (value, max = MAX_TEXT) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
// Gemma sometimes returns ["Ana, Ben"] for ["Ana", "Ben"].
const names = (list) => [
  ...new Set(
    (Array.isArray(list) ? list : [])
      .flatMap((n) => (typeof n === "string" ? n.split(",") : []))
      .map((n) => clean(n, 80))
      .filter(Boolean),
  ),
];
export const normalizeName = (name) => clean(name, 80).toLowerCase();

/** messageId -> active swipe index. */
export const activeSwipes = (messages) => new Map(messages.map((m) => [m.id, m.activeSwipeIndex ?? 0]));
/** Unanchored entries are manual corrections and always hold. */
const holds = (entry, swipes) => !entry.a || swipes.get(entry.a.m) === entry.a.w;

/**
 * Open items, oldest first: `{id, kind, text, who: string[], since}` where `since` is the 1-based number of the
 * message that created the item. Items an `end` closed are left out.
 */
export function resolve(ledger, messages) {
  const swipes = activeSwipes(messages);
  const number = new Map(messages.map((m, i) => [m.id, i + 1]));
  const items = new Map();
  for (const entry of ledger.entries) {
    if (!holds(entry, swipes)) continue;
    if (entry.op === "milestone" || entry.op === "secret") {
      items.set(entry.id, {
        id: entry.id,
        kind: entry.op,
        text: entry.text,
        who: [...entry.who],
        since: number.get(entry.a?.m) ?? 0,
      });
    } else if (entry.op === "tell") {
      const item = items.get(entry.item);
      if (item) item.who = names([...item.who, ...entry.who]);
    } else if (entry.op === "end") {
      items.delete(entry.item);
    }
  }
  return [...items.values()];
}

/** Gemma writes ids as "e12", "[e12]", "e12: text"; anything else is unknown. */
const itemId = (raw) => (typeof raw === "string" ? (raw.match(/\be\d+\b/i)?.[0] ?? "").toLowerCase() : "");

/**
 * Append the extractor's ops, anchored to `anchor`. Filters in code, never in the prompt (models always return
 * something): empty text or people dropped, unknown ids dropped, telling someone who already knows dropped,
 * new entries capped per run. Returns counts.
 */
export function applyOps(ledger, ops, anchor, messages, settings = DEFAULTS) {
  const open = new Map(resolve(ledger, messages).map((item) => [item.id, item]));
  let added = 0;
  let applied = 0;
  let skipped = 0;
  for (const op of Array.isArray(ops) ? ops : []) {
    const kind = op?.op;
    if (kind === "milestone" || kind === "secret") {
      const text = clean(op.text);
      const who = names(op.who);
      const duplicate = [...open.values()].some(
        (item) => item.kind === kind && normalizeName(item.text) === normalizeName(text),
      );
      if (!text || !who.length || duplicate || added >= settings.maxNewPerRun) {
        skipped += 1;
        continue;
      }
      const id = `e${(ledger.seq += 1)}`;
      ledger.entries.push({ id, op: kind, text, who, a: anchor });
      open.set(id, { id, kind, text, who, since: 0 });
      added += 1;
      applied += 1;
    } else if (kind === "tell" || kind === "end") {
      const id = itemId(op.item);
      const item = open.get(id);
      const known = new Set((item?.who ?? []).map(normalizeName));
      const who = kind === "tell" ? names(op.who).filter((n) => !known.has(normalizeName(n))) : [];
      if (!item || (kind === "tell" && !who.length)) {
        skipped += 1;
        continue;
      }
      ledger.entries.push({
        id: `e${(ledger.seq += 1)}`,
        op: kind,
        item: id,
        ...(kind === "tell" ? { who } : {}),
        a: anchor,
      });
      if (kind === "end") open.delete(id);
      else item.who = names([...item.who, ...who]);
      applied += 1;
    } else {
      skipped += 1;
    }
  }
  return { applied, skipped };
}

const textOf = (message) => message.agentContent ?? message.content ?? "";

/**
 * The player's messages just before this reply that had no ledger run of their own: with "Block agents" ticked
 * for impersonate (Ben's and Erin's setting on 11-22), an impersonated message gets no post-processing run, and
 * a confession written there would never be recorded. The trailing run of user messages, after dropping the reply
 * when it is already saved, so the cache prefill (which can run before the reply is saved) sees the same text.
 * Stops at the message the ledger last ran on.
 */
export function playerTurn(messages, mainResponse, last) {
  const text = typeof mainResponse === "string" ? mainResponse.trim() : "";
  let end = messages.length;
  if (text && messages[end - 1]?.content?.trim() === text) end -= 1;
  const turn = [];
  for (let i = end - 1; i >= 0 && messages[i].role === "user" && messages[i].id !== last?.m; i -= 1)
    turn.unshift(textOf(messages[i]));
  return turn;
}

/**
 * Items in the scene: one of the item's people is named in the last `mentionWindow` messages, by full name or
 * first name ("Jackson Abbot" is mostly written "Jackson"). Code only, so card-less NPCs count. Newest first, capped.
 */
export function inScene(items, messages, settings = DEFAULTS) {
  const recent = messages.slice(-settings.mentionWindow).map(textOf).join("\n").toLowerCase();
  const word = (text) => new RegExp(`(^|[^\\p{L}])${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}])`, "u");
  const named = (name) => {
    const full = normalizeName(name);
    return word(full).test(recent) || word(full.split(" ")[0]).test(recent);
  };
  return items
    .filter((item) => item.who.some(named))
    .sort((x, y) => y.since - x.since)
    .slice(0, settings.maxPrompt);
}

/** The narrator block. `now` is the number of the newest message. */
export function render(items, now) {
  if (!items.length) return null;
  const ago = (since) => (since ? `M${since}, ${Math.max(0, now - since)} messages ago` : "earlier");
  const lines = items.map((item) =>
    item.kind === "milestone"
      ? `- Since ${ago(item.since)}: ${item.who.join(", ")}: ${item.text}. Before that, this was not so.`
      : `- Known only to ${item.who.join(", ")} (since ${ago(item.since)}): ${item.text}`,
  );
  return [
    "<story_ledger>",
    "Dated facts for the people in this scene. Something is true only from its message on; everyone not listed for a secret does not know it.",
    ...lines,
    "</story_ledger>",
  ].join("\n");
}

/**
 * Arm for the reply that follows `previousMessageId`: a hash of chat and message against `pOn`. Deterministic, so
 * the read-only prompt contributor and the extractor afterwards agree on what the narrator saw, with no write at
 * prompt time. Swipes of the same reply share an arm.
 */
export function blockShown(chatId, previousMessageId, pOn) {
  let h = 2166136261;
  for (const ch of `${chatId}:${previousMessageId}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h / 2 ** 32 < pOn;
}

/** Keep one row per reply for the posterior: was it at risk, which arm, which items, which the reply contradicted. */
export function record(ledger, row) {
  ledger.log = [...ledger.log.filter((r) => !(r.m === row.m && r.w === row.w)), row].slice(-MAX_LOG);
}

/**
 * Closed questions for the contradiction judge. Milestones get two wordings because on Gemma each caught a case
 * the other missed (11-22 probe: a remembered courtship, a familiar new home), with no false alarm on neutrals.
 */
export function judgeQuestions(item, now) {
  const who = item.who.join(" and ");
  if (item.kind === "secret")
    return [
      `Fact: only ${who} know this: ${item.text}\nQuestion: Does anyone other than ${who} show in the passage that they know it?`,
    ];
  const ago = item.since ? Math.max(0, now - item.since) : 0;
  return [
    `Fact: ${who}: ${item.text}, ${ago} messages ago. Before that, it was not so.\nQuestion: Does the passage treat this as having been true for longer than ${ago} messages, for example by remembering it from before?`,
    `Fact: ${who}: ${item.text}, only recently (${ago} messages ago). Before that, they had not.\nQuestion: Does the passage describe or remember a time BEFORE that when it was already so? (A shared past as a couple, years of living somewhere, a long-held habit.)`,
  ];
}

export const isYes = (text) => /^\W*yes\b/i.test(String(text ?? ""));
