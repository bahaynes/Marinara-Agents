// Aside: per-chat Notes and a read-only side chat with the narrator. It reads the chat through the host's
// persistence and answers with the chat's own connection, but never writes to the chat itself.

import {
  addNote,
  asideMessages,
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
const silent = () => {};

export class AsideError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

const parseRecord = (value) => {
  if (value && typeof value === "object") return value;
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
};
const parseList = (value) => {
  const list = typeof value === "string" ? parseRecord(`{"v":${value}}`).v : value;
  return Array.isArray(list) ? list.map(String) : [];
};

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

async function chatContext(runtime, chatId) {
  const { persistence, resources } = runtime;
  const chat = await persistence.getChat(chatId);
  if (!chat) throw new AsideError(404, "Chat not found.");
  const characterIds = parseList(chat.characterIds);
  const [messages, personas, characters] = await Promise.all([
    persistence.listMessages(chatId),
    chat.personaId && resources ? resources.listPersonas([chat.personaId]) : [],
    characterIds.length && resources ? resources.listCharacters(characterIds) : [],
  ]);
  const nameOf = (record) => String(parseRecord(record?.data).name ?? "").trim();
  return {
    chat,
    messages,
    persona: nameOf(personas[0]),
    characters: characters.map(nameOf).filter(Boolean),
  };
}

/**
 * Answer one aside. The question and answer go into the side thread only; the main chat is read, never written.
 * `emit` gets `{type: "start"}` and then each streamed chunk as `{type: "token", text}`.
 */
export function ask(runtime, store, chatId, body, emit = silent, signal) {
  const question = String(body?.question ?? "").trim().slice(0, 4000);
  if (!question) return Promise.reject(new AsideError(400, "Ask something first."));
  return (async () => {
    const [ctx, settings, { data }] = await Promise.all([chatContext(runtime, chatId), store.loadSettings(), store.load(chatId)]);
    const model = await runtime.languageModels.resolveForRequest(
      settings.connectionId || ctx.chat.connectionId
        ? { connectionId: settings.connectionId ?? ctx.chat.connectionId }
        : { chatConnectionId: null },
    );
    const messages = asideMessages({
      persona: ctx.persona,
      characters: ctx.characters,
      messages: ctx.messages,
      notes: data.notes,
      thread: data.thread,
      question,
      settings,
    });
    const fitted = model.fitContext ? model.fitContext(messages, { maxTokens: settings.maxTokens }).messages : messages;
    emit({ type: "start" });
    const result = await model.chatComplete(fitted, {
      maxTokens: settings.maxTokens,
      // Asides repeat the same story prefix minutes apart, so ask for the long cache.
      promptCache: { ttl: "1h", depth: 1 },
      onToken: (text) => emit({ type: "token", text }),
      ...(signal ? { signal } : {}),
    });
    const answer = String(result.content ?? "").trim();
    if (!answer) throw new AsideError(502, "The model returned an empty reply.");
    return store.update(chatId, (chatData) => {
      chatData.thread = [...chatData.thread, newTurn("user", question), newTurn("assistant", answer)].slice(-settings.threadTurns);
    });
  })();
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
  // The ask route streams server-sent events when asked: start/token events, then one done or error event.
  const stream = (work) => async (request, reply) => {
    if (!String(request.headers?.accept ?? "").includes("text/event-stream")) {
      return handle((params, body) => work(params, body, silent, undefined))(request, reply);
    }
    reply.hijack();
    reply.raw.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" });
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
        if (!(error instanceof AsideError)) runtime.logger?.error?.(error, "Aside ask failed");
        send({ type: "error", error: error instanceof AsideError ? error.message : "Aside request failed." });
      }
    } finally {
      request.raw?.off?.("close", onClose);
      reply.raw?.off?.("close", onClose);
    }
    if (!reply.raw.writableEnded) reply.raw.end();
  };
  const release = await context.api.registerPrivilegedRoutes(
    async (routes) => {
      routes.get("/chats/:chatId", handle(({ chatId }) => chatView(store, chatId)));
      routes.post("/chats/:chatId/notes", handle(({ chatId }, body) => createNote(store, chatId, body)));
      routes.put("/chats/:chatId/notes/:noteId", handle(({ chatId, noteId }, body) => editNote(store, chatId, noteId, body)));
      routes.delete("/chats/:chatId/notes/:noteId", handle(({ chatId, noteId }) => deleteNote(store, chatId, noteId)));
      routes.post("/chats/:chatId/ask", stream(({ chatId }, body, emit, signal) => ask(runtime, store, chatId, body, emit, signal)));
      routes.delete("/chats/:chatId/thread", handle(({ chatId }) => clearThread(store, chatId)));
      routes.put("/settings", handle((_p, body) => store.saveSettings(body)));
    },
    { prefix: `/api/${PACKAGE_ID}` },
  );
  return async () => {
    await release();
  };
}
