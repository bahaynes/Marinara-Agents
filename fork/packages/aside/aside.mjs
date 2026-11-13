// Aside: pure helpers. Notes, the side thread, and the temporary message for an out-of-band question to the narrator.
// Nothing here touches the host, so it can be tested directly.

// Defaults for settings the player can change; none of these is a design limit.
export const DEFAULT_SETTINGS = Object.freeze({
  threadTurns: 20, // side-thread turns kept and sent
  connectionId: null, // null = the chat's own connection
});
const MAX_NOTES = 500;
const MAX_NOTE_CHARS = 4000;
const int = (value, fallback, min, max) =>
  Number.isInteger(value) && value >= min && value <= max ? value : fallback;

export function cleanSettings(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  return {
    threadTurns: int(s.threadTurns, DEFAULT_SETTINGS.threadTurns, 2, 200),
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

/** Put notes in the order of `ids`; notes not named keep their relative order after the named ones. */
export function reorderNotes(notes, ids) {
  const byId = new Map(notes.map((n) => [n.id, n]));
  const named = [...new Set(Array.isArray(ids) ? ids : [])].filter((id) => byId.has(id)).map((id) => byId.get(id));
  const rest = notes.filter((n) => !named.includes(n));
  return [...named, ...rest];
}

/** One-shot orderings for the sort menu. The result becomes the stored order; nothing keeps sorting afterwards. */
export const SORTS = Object.freeze({
  newest: (x, y) => String(y.createdAt).localeCompare(String(x.createdAt)),
  oldest: (x, y) => String(x.createdAt).localeCompare(String(y.createdAt)),
  alpha: (x, y) => x.text.localeCompare(y.text, undefined, { sensitivity: "base" }),
  pinned: (x, y) => Number(y.pinned) - Number(x.pinned), // stable: keeps the current order within each group
});

export const sortNotes = (notes, mode) => (SORTS[mode] ? [...notes].sort(SORTS[mode]) : notes);

export const addNote = (notes, note) => [note, ...notes].slice(0, MAX_NOTES);

export function newTurn(role, text) {
  return { id: newId(), role: role === "assistant" ? "assistant" : "user", text: String(text ?? ""), createdAt: new Date().toISOString() };
}

const INSTRUCTION = [
  "Out-of-character aside from the player. It is not part of the story and will not be kept in it.",
  "Answer the question below directly and briefly, as the narrator who knows this story. Do not narrate, continue the scene, or write the player character's actions. Use only what the story shows; say so when something has not been established.",
].join("\n");

/**
 * The one temporary user message sent with the Engine's real chat prompt (dryRun), so the prompt prefix stays the
 * chat's own and only this last message changes between asides.
 */
export function asideUserMessage({ notes, thread, question, settings }) {
  const parts = [INSTRUCTION];
  const pinned = notes.filter((n) => n.pinned).map((n) => `- ${n.text}`);
  if (pinned.length) parts.push(`<player_notes>\n${pinned.join("\n")}\n</player_notes>`);
  const earlier = thread.slice(-settings.threadTurns).map((t) => `${t.role === "user" ? "Player" : "Narrator"}: ${t.text}`);
  if (earlier.length) parts.push(`<earlier_asides>\n${earlier.join("\n\n")}\n</earlier_asides>`);
  parts.push(`Question: ${String(question)}`);
  return parts.join("\n\n");
}
