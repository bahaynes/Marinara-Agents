// Shared World's pure logic: what a party's settled Game Master replies publish to a shared game's log, and
// what the log gives every other party's chat as `gameLedgerForeign` and `gameWorldDayFloor`.
//
// The log is append-only and in `seq` order. A record either publishes one reply's world entries or retracts
// them (the reply was swiped, edited or deleted after it was published). Nothing here touches storage.

import { createHash } from "node:crypto";

const DAY_MS = 86_400_000;
const WORLD_TAG = /\[world:([^[\]]*)\]/gi;
// Time and holds are the author's own: the reader's calendar is the shared floor, never another party's days.
const PRIVATE_FIELDS = new Set(["days", "at", "from", "hold", "release", "ground", "untilDay", "by", "result"]);

export const parseMeta = (value) => {
  if (value && typeof value === "object") return value;
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

/** The chat's link to a shared game, or null. */
export function sharedLink(meta) {
  const link = meta?.sharedWorld;
  return link && typeof link.gameId === "string" && typeof link.playerId === "string" ? link : null;
}

const WORD = /\w/;
const SPACE = /\s/;

/** A value at `at`: a closed quote, or an unquoted run that is not itself a `key=`. The Engine's own reader. */
function readValue(body, at) {
  const opener = body[at];
  if (opener === '"' || opener === "'") {
    const close = body.indexOf(opener, at + 1);
    if (close >= 0) return { raw: body.slice(at, close + 1), end: close + 1 };
  }
  if (WORD.test(body[at] ?? "")) {
    let probe = at;
    while (probe < body.length && WORD.test(body[probe])) probe += 1;
    while (probe < body.length && SPACE.test(body[probe])) probe += 1;
    if (body[probe] === "=") return null;
  }
  let end = at;
  while (end < body.length && !SPACE.test(body[end]) && body[end] !== "]") end += 1;
  return end === at ? null : { raw: body.slice(at, end), end };
}

/** A tag body's `key = value` pairs, in one linear pass, as the Engine's `readGmTagAttributes` reads them. */
function readAttributes(body) {
  const pairs = [];
  let index = 0;
  while (index < body.length) {
    if (!WORD.test(body[index])) {
      index += 1;
      continue;
    }
    const start = index;
    while (index < body.length && WORD.test(body[index])) index += 1;
    let cursor = index;
    while (cursor < body.length && SPACE.test(body[cursor])) cursor += 1;
    if (body[cursor] !== "=") continue;
    cursor += 1;
    while (cursor < body.length && SPACE.test(body[cursor])) cursor += 1;
    const value = readValue(body, cursor);
    if (!value) continue;
    pairs.push([body.slice(start, index), value.raw]);
    index = value.end;
  }
  return pairs;
}

/** The answered `[world: …]` tags of one reply, normalized the way the Engine's ledger reads them. */
export function readWorldEntries(text) {
  const entries = [];
  for (const match of String(text ?? "").matchAll(WORLD_TAG)) {
    const values = new Map();
    for (const [key, raw] of readAttributes(match[1])) {
      const value = raw
        .trim()
        .replace(/^["']|["']$/g, "")
        .replace(/[\s"[\]]+/g, " ")
        .trim()
        .slice(0, 200);
      values.set(key.toLowerCase(), value);
    }
    if (values.get("result") !== "ok") continue;
    const entry = {};
    for (const [key, value] of values) if (!PRIVATE_FIELDS.has(key) && value) entry[key] = value;
    if (entry.deed || entry.fact || entry.event) entries.push(entry);
  }
  return entries;
}

const isGameMasterReply = (message) =>
  message.role === "assistant" &&
  typeof message.content === "string" &&
  !message.content.trimStart().startsWith("[party-turn]");

/** A one-line feed note: the reply's first sentence, without its tags. */
function noteOf(text) {
  const plain = text
    .replace(/\[[a-z_]+:[^[\]]*\]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const sentence = plain.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? plain;
  return sentence.length > 160 ? `${sentence.slice(0, 157)}…` : sentence;
}

const hashOf = (entries) => createHash("sha256").update(JSON.stringify(entries)).digest("hex").slice(0, 16);

/**
 * One session's Game Master replies that carry world entries, each marked `settled` when it can no longer
 * be swiped in normal play: a later player message exists, or the session has concluded.
 */
export function sessionReplies(messages, meta = {}) {
  const concluded = meta.gameSessionStatus === "concluded";
  const startsAfter = typeof meta.gameWorldStartsAfter === "string" ? meta.gameWorldStartsAfter : null;
  let started = !startsAfter || !messages.some((message) => message.id === startsAfter);
  const replies = [];
  let lastUser = -1;
  messages.forEach((message, index) => {
    if (message.role === "user") lastUser = index;
  });
  messages.forEach((message, index) => {
    if (!started) {
      started = message.id === startsAfter;
      return;
    }
    if (!isGameMasterReply(message)) return;
    const entries = readWorldEntries(message.content);
    if (!entries.length) return;
    replies.push({
      messageId: message.id,
      entries,
      hash: hashOf(entries),
      note: noteOf(message.content),
      settled: concluded || index < lastUser,
    });
  });
  return replies;
}

const sourceKey = (chatId, messageId) => `${chatId}\u0000${messageId}`;

/** The log's live publications, by source reply: each publish replaces, each retract removes. */
export function livePublications(log) {
  const live = new Map();
  for (const record of log.records ?? []) {
    if (record.retract) live.delete(sourceKey(record.retract.chatId, record.retract.messageId));
    else live.set(sourceKey(record.chatId, record.messageId), record);
  }
  return live;
}

/**
 * The records one session adds to the log, so the log matches that session's replies:
 * - a settled reply not yet published is published;
 * - a published reply that is gone, or whose entries changed, is retracted (and republished once settled);
 * - a published reply that is unchanged stays, even if it is no longer settled (its next player message
 *   was deleted), so deleting your own message never churns the log.
 */
export function reconcileSession(log, { playerId, chatId, replies }) {
  const live = livePublications(log);
  const byId = new Map(replies.map((reply) => [reply.messageId, reply]));
  const added = [];
  for (const [key, record] of live) {
    if (record.playerId !== playerId || record.chatId !== chatId) continue;
    const reply = byId.get(record.messageId);
    if (reply && reply.hash === record.hash) {
      byId.delete(record.messageId);
      continue;
    }
    added.push({ playerId, retract: { chatId, messageId: record.messageId } });
    live.delete(key);
  }
  for (const reply of byId.values()) {
    if (!reply.settled) continue;
    added.push({
      playerId,
      chatId,
      messageId: reply.messageId,
      hash: reply.hash,
      entries: reply.entries,
      note: reply.note,
    });
  }
  return added;
}

/** Append records with the log's next seqs. Returns a new log. */
export function appendRecords(log, records, at = new Date().toISOString()) {
  let nextSeq = log.nextSeq ?? 1;
  const stamped = records.map((record) => ({ seq: nextSeq++, at, ...record }));
  return { ...log, nextSeq, records: [...(log.records ?? []), ...stamped] };
}

/** What a later entry of the same thing overrides: the place or group a deed is done to, or a fact's name. */
function targetOf(entry) {
  const name = entry.deed ? (entry.place ?? entry.group) : entry.fact ? entry.name : null;
  return name ? `${entry.deed ? "deed" : entry.fact}:${name.toLowerCase()}` : null;
}

/**
 * Every other party's live entries, in log order, each marked with who did it. A foreign entry about a place,
 * group or fact this party has published something newer about is dropped: across sessions, the later seq holds.
 */
export function foreignLedger(log, playerId) {
  const names = new Map((log.players ?? []).map((player) => [player.id, player.name]));
  const live = [...livePublications(log).values()].sort((a, b) => a.seq - b.seq);
  const ownLatest = new Map();
  for (const record of live) {
    if (record.playerId !== playerId) continue;
    for (const entry of record.entries) {
      const target = targetOf(entry);
      if (target) ownLatest.set(target, record.seq);
    }
  }
  const ledger = [];
  for (const record of live) {
    if (record.playerId === playerId) continue;
    const by = names.get(record.playerId) || "Another party";
    for (const entry of record.entries) {
      const target = targetOf(entry);
      if (target && (ownLatest.get(target) ?? 0) > record.seq) continue;
      ledger.push({ ...entry, by });
    }
  }
  return ledger;
}

/** The shared calendar: the game's start day, plus real days since it started times the ratio. */
export function calendarDay(log, now = Date.now()) {
  const started = Date.parse(log.startedAt);
  const ratio = Number(log.ratio) > 0 ? Number(log.ratio) : 1;
  const elapsed = Number.isFinite(started) ? Math.max(0, now - started) / DAY_MS : 0;
  return Math.max(0, Math.floor(Number(log.startDay) || 0) + Math.floor(elapsed * ratio));
}

/** A new, empty shared game. */
export function newGame({ name, ratio = 1, startDay = 0, now = new Date().toISOString() }) {
  return { name, ratio, startDay, startedAt: now, players: [], nextSeq: 1, records: [] };
}
