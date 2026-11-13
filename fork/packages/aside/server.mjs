// Aside: per-chat Notes and a read-only side chat with the narrator. The page asks the Engine's own
// /api/generate/dryRun (the chat's real prompt, nothing persisted) with the aside as a temporary last user
// message; this server keeps the notes and the side thread and builds that message.

import {
  addNote,
  asideUserMessage,
  changeNote,
  cleanSettings,
  emptyChat,
  newNote,
  newTurn,
} from "./aside.mjs";

export const PACKAGE_ID = "aside";
const CHAT_KIND = "aside-chat";
const SETTINGS_ID = `${PACKAGE_ID}:settings`;
const chatDocId = (chatId) => `${PACKAGE_ID}:chat:${chatId}`;

export class AsideError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

/** One write at a time per chat. */
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
  const stamp = () => new Date().toISOString();

  async function write(id, kind, name, data, revision) {
    const base = { id, packageId: PACKAGE_ID, name, description: "", data };
    if (revision) {
      const updated = await documents.update({ ...base, expectedRevision: revision, updatedAt: stamp() });
      if (!updated) throw new AsideError(409, "This chat's notes changed in another window. Reload and try again.");
      return updated;
    }
    return documents.create({ ...base, kind, createdAt: stamp(), updatedAt: stamp() });
  }

  return {
    async load(chatId) {
      const doc = await documents.getById(PACKAGE_ID, chatDocId(chatId));
      return { data: { ...emptyChat(), ...(doc?.data ?? {}) }, revision: doc?.revision ?? 0 };
    },
    /** Read, change and write one chat's notes and thread under its lock. */
    update(chatId, change) {
      return lock(chatId, async () => {
        const { data, revision } = await this.load(chatId);
        const result = await change(data);
        await write(chatDocId(chatId), CHAT_KIND, `Aside ${chatId}`, data, revision);
        return result ?? data;
      });
    },
    async loadSettings() {
      return cleanSettings((await documents.getById(PACKAGE_ID, SETTINGS_ID))?.data);
    },
    saveSettings(raw) {
      return lock("settings", async () => {
        const doc = await documents.getById(PACKAGE_ID, SETTINGS_ID);
        const settings = cleanSettings(raw);
        await write(SETTINGS_ID, "aside-settings", "Aside settings", settings, doc?.revision ?? 0);
        return settings;
      });
    },
  };
}

export async function chatView(store, chatId) {
  const [{ data }, settings] = await Promise.all([store.load(chatId), store.loadSettings()]);
  return { notes: data.notes, thread: data.thread, settings };
}

/** What the page sends with the chat's real prompt (dryRun): the aside message and the connection override. */
export async function prepare(store, chatId, body) {
  const question = String(body?.question ?? "").trim().slice(0, 4000);
  if (!question) throw new AsideError(400, "Ask something first.");
  const [{ data }, settings] = await Promise.all([store.load(chatId), store.loadSettings()]);
  return { userMessage: asideUserMessage({ notes: data.notes, thread: data.thread, question, settings }), connectionId: settings.connectionId };
}

/** Keep a finished exchange in the side thread. The main chat is never written. */
export async function recordExchange(store, chatId, body) {
  const question = String(body?.question ?? "").trim();
  const answer = String(body?.answer ?? "").trim();
  if (!question || !answer) throw new AsideError(400, "Nothing to record.");
  const { threadTurns } = await store.loadSettings();
  return store.update(chatId, (data) => {
    data.thread = [...data.thread, newTurn("user", question), newTurn("assistant", answer)].slice(-threadTurns);
  });
}

export const clearThread = (store, chatId) =>
  store.update(chatId, (data) => {
    data.thread = [];
  });

export const createNote = (store, chatId, body) =>
  store.update(chatId, (data) => {
    const note = newNote(body?.text, body?.source);
    if (!note) throw new AsideError(400, "A note needs some text.");
    data.notes = addNote(data.notes, note);
  });

export const editNote = (store, chatId, noteId, body) =>
  store.update(chatId, (data) => {
    if (!changeNote(data.notes, noteId, body ?? {})) throw new AsideError(404, "Note not found.");
  });

export const deleteNote = (store, chatId, noteId) =>
  store.update(chatId, (data) => {
    data.notes = data.notes.filter((n) => n.id !== noteId);
  });

export async function activate(context) {
  const runtime = context.api.runtime;
  const store = createStore(runtime.persistence.documents);
  const handle = (work) => async (request, reply) => {
    try {
      return reply.send(await work(request.params ?? {}, request.body ?? {}));
    } catch (error) {
      const status = error instanceof AsideError ? error.statusCode : 500;
      if (status >= 500) runtime.logger?.error?.(error, "Aside request failed");
      return reply.status(status).send({ error: error instanceof AsideError ? error.message : "Aside request failed." });
    }
  };
  const release = await context.api.registerPrivilegedRoutes(
    async (routes) => {
      routes.get("/chats/:chatId", handle(({ chatId }) => chatView(store, chatId)));
      routes.post("/chats/:chatId/notes", handle(({ chatId }, body) => createNote(store, chatId, body)));
      routes.put("/chats/:chatId/notes/:noteId", handle(({ chatId, noteId }, body) => editNote(store, chatId, noteId, body)));
      routes.delete("/chats/:chatId/notes/:noteId", handle(({ chatId, noteId }) => deleteNote(store, chatId, noteId)));
      routes.post("/chats/:chatId/prepare", handle(({ chatId }, body) => prepare(store, chatId, body)));
      routes.post("/chats/:chatId/exchange", handle(({ chatId }, body) => recordExchange(store, chatId, body)));
      routes.delete("/chats/:chatId/thread", handle(({ chatId }) => clearThread(store, chatId)));
      routes.put("/settings", handle((_p, body) => store.saveSettings(body)));
    },
    { prefix: `/api/${PACKAGE_ID}` },
  );
  return async () => {
    await release();
  };
}
