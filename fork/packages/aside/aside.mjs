// Aside: pure helpers. Notes, the side thread, and the prompt for an out-of-band question to the narrator.
// Nothing here touches the host, so it can be tested directly.

// Defaults for settings the player can change; none of these is a design limit.
export const DEFAULT_SETTINGS = Object.freeze({
  recentMessages: 20, // main-chat messages shown to the narrator
  threadTurns: 20, // side-thread turns kept and sent
  maxTokens: 1024,
  connectionId: null, // null = the chat's own connection
});
const MAX_NOTES = 500;
const MAX_NOTE_CHARS = 4000;
const int = (value, fallback, min, max) =>
  Number.isInteger(value) && value >= min && value <= max ? value : fallback;

export function cleanSettings(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  return {
    recentMessages: int(s.recentMessages, DEFAULT_SETTINGS.recentMessages, 1, 200),
    threadTurns: int(s.threadTurns, DEFAULT_SETTINGS.threadTurns, 2, 200),
    maxTokens: int(s.maxTokens, DEFAULT_SETTINGS.maxTokens, 64, 16000),
    connectionId: typeof s.connectionId === "string" && s.connectionId.trim() ? s.connectionId.trim().slice(0, 120) : null,
  };
}

export const emptyChat = () => ({ notes: [], thread: [] });

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export function newNote(text, source = "user") {
  const clean = String(text ?? "").trim().slice(0, MAX_NOTE_CHARS);
  if (!clean) return null;
  return { id: newId(), text: clean, pinned: false, source: source === "aside" ? "aside" : "user", createdAt: new Date().toISOString() };
}

/** Apply `{text?, pinned?}` to a note; returns the notes list. Null when the note does not exist. */
export function changeNote(notes, id, patch) {
  const note = notes.find((n) => n.id === id);
  if (!note) return null;
  if (typeof patch.text === "string" && patch.text.trim()) note.text = patch.text.trim().slice(0, MAX_NOTE_CHARS);
  if (typeof patch.pinned === "boolean") note.pinned = patch.pinned;
  return notes;
}

export const addNote = (notes, note) => [note, ...notes].slice(0, MAX_NOTES);

export function newTurn(role, text) {
  return { id: newId(), role: role === "assistant" ? "assistant" : "user", text: String(text ?? ""), createdAt: new Date().toISOString() };
}

/** The Engine's stored role decides the label, so an impersonate turn (a user message written as a character) stays the player's. */
export function transcriptLines(messages, { persona, limit }) {
  return messages
    .filter((m) => (m.role === "user" || m.role === "assistant") && String(m.content ?? "").trim())
    .slice(-limit)
    .map((m) => `${m.role === "user" ? persona : "Narrator"}: ${String(m.content).trim()}`);
}

const SYSTEM = [
  "You are the narrator of an ongoing story, answering a private out-of-character aside from the player.",
  "The aside is not part of the story: do not narrate, do not continue the scene, and do not write the player's character's actions. Answer the question directly and briefly, as the narrator who knows this story.",
  "Use only what the story context below shows; say so when something has not been established.",
].join("\n");

/**
 * Messages for one aside. Order keeps the cache prefix stable: the role text, then the story so far, then
 * the notes, then the side thread; only the newest question changes between asides.
 */
export function asideMessages({ persona, characters, messages, notes, thread, question, settings }) {
  const parts = [SYSTEM];
  const who = [persona && `Player character: ${persona}`, characters.length && `Characters: ${characters.join(", ")}`].filter(Boolean);
  if (who.length) parts.push(who.join("\n"));
  const lines = transcriptLines(messages, { persona: persona || "Player", limit: settings.recentMessages });
  parts.push(`<story_so_far>\n${lines.join("\n\n") || "(nothing yet)"}\n</story_so_far>`);
  const pinned = notes.filter((n) => n.pinned).map((n) => `- ${n.text}`);
  if (pinned.length) parts.push(`<player_notes>\n${pinned.join("\n")}\n</player_notes>`);
  const history = thread.slice(-settings.threadTurns).map((t) => ({ role: t.role, content: t.text }));
  return [{ role: "system", content: parts.join("\n\n") }, ...history, { role: "user", content: String(question) }];
}
