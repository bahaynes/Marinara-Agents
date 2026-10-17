// Shared World: Game mode chats linked to one shared game publish their settled world deeds to that game's
// log, and read every other party's deeds back as `gameLedgerForeign`, plus the shared calendar as
// `gameWorldDayFloor`. The Engine's world ledger does the rest (see the fork's shared-world seam).
//
// Sync runs in the background when a linked chat generates, and on demand from the page. It never blocks
// a generation: what it writes lands for the next turn.

import { randomUUID } from "node:crypto";
import {
  appendRecords,
  calendarDay,
  foreignLedger,
  livePublications,
  newGame,
  parseMeta,
  reconcileSession,
  sessionReplies,
  sharedLink,
} from "./world.mjs";

export const PACKAGE_ID = "shared-world";
const GAME_KIND = "game";
const WRITE_RETRIES = 5;
const FEED_LIMIT = 50;

const gameDocId = (gameId) => `${PACKAGE_ID}:game:${gameId}`;

export class WorldError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function createStore(documents) {
  async function load(gameId) {
    const doc = await documents.getById(PACKAGE_ID, gameDocId(gameId));
    if (!doc) throw new WorldError(404, "Shared game not found.");
    return { game: { ...doc.data, id: gameId }, revision: doc.revision };
  }

  return {
    load,
    async list() {
      const docs = await documents.list(PACKAGE_ID, GAME_KIND);
      return docs.map((doc) => doc.data);
    },
    async create(fields) {
      const id = randomUUID();
      const game = { id, ...newGame(fields) };
      const now = new Date().toISOString();
      await documents.create({
        id: gameDocId(id),
        packageId: PACKAGE_ID,
        kind: GAME_KIND,
        name: game.name,
        description: "",
        data: game,
        createdAt: now,
        updatedAt: now,
      });
      return game;
    },
    /** Read, change and write a game, retrying when another write landed first. */
    async update(gameId, change) {
      for (let attempt = 0; attempt < WRITE_RETRIES; attempt += 1) {
        const { game, revision } = await load(gameId);
        const next = await change(game);
        if (!next || next === game) return game;
        const updated = await documents.update({
          id: gameDocId(gameId),
          packageId: PACKAGE_ID,
          expectedRevision: revision,
          name: next.name,
          description: "",
          data: next,
          updatedAt: new Date().toISOString(),
        });
        if (updated) return next;
      }
      throw new WorldError(409, "The shared game kept changing. Try again.");
    },
  };
}

// ── Chats ──

const isGameChat = (chat) => chat?.mode === "game";
const gameIdOf = (chat, meta) => chat.groupId || meta.gameId || chat.id;

/** Every chat linked to this shared game, with its parsed metadata. */
async function linkedChats(persistence, gameId) {
  const chats = await persistence.listChats();
  return chats
    .filter(isGameChat)
    .map((chat) => ({ chat, meta: parseMeta(chat.metadata) }))
    .filter(({ meta }) => sharedLink(meta)?.gameId === gameId);
}

/** Write the shared keys into one chat, under the Engine's own metadata lock, only when they changed. */
async function writeShared(persistence, chatId, change) {
  return persistence.withChatLock(chatId, async () => {
    const chat = await persistence.getChat(chatId);
    if (!chat) return false;
    const meta = parseMeta(chat.metadata);
    const next = change({ ...meta });
    const keys = ["sharedWorld", "gameLedgerForeign", "gameWorldDayFloor"];
    if (keys.every((key) => JSON.stringify(next[key]) === JSON.stringify(meta[key]))) return false;
    for (const key of keys) if (next[key] === undefined) delete next[key];
    await persistence.updateChatMetadata({ chatId, metadata: next, updatedAt: new Date().toISOString() });
    return true;
  });
}

/** The keys one player's chat should carry now. The floor never moves back. */
function readerKeys(game, playerId, meta, now) {
  const floor = Math.max(calendarDay(game, now), Number(meta.gameWorldDayFloor) || 0);
  return { gameLedgerForeign: foreignLedger(game, playerId), gameWorldDayFloor: floor };
}

/**
 * Publish every linked session's settled replies, then refresh every linked chat's foreign ledger and floor.
 * Idempotent: a second run with nothing new writes nothing.
 */
export async function syncGame(runtime, store, gameId, now = Date.now()) {
  const persistence = runtime.persistence;
  const chats = await linkedChats(persistence, gameId);
  const sessions = [];
  for (const { chat, meta } of chats) {
    const messages = await persistence.listMessages(chat.id);
    sessions.push({ chatId: chat.id, playerId: sharedLink(meta).playerId, replies: sessionReplies(messages, meta) });
  }
  const game = await store.update(gameId, (current) => {
    const players = new Set((current.players ?? []).map((player) => player.id));
    const records = sessions
      .filter((session) => players.has(session.playerId))
      .flatMap((session) => {
        const added = reconcileSession(current, session);
        return added;
      });
    return records.length ? appendRecords(current, records, new Date(now).toISOString()) : current;
  });
  let written = 0;
  for (const { chat } of chats) {
    const changed = await writeShared(persistence, chat.id, (meta) => {
      const link = sharedLink(meta);
      return link?.gameId === gameId ? { ...meta, ...readerKeys(game, link.playerId, meta, now) } : meta;
    });
    if (changed) written += 1;
  }
  return { game, written };
}

/** One sync per game at a time; a call that arrives mid-run asks for one more run after it. */
function createSyncQueue(run) {
  const state = new Map();
  return (gameId) => {
    const current = state.get(gameId);
    if (current) {
      current.again = true;
      return current.promise;
    }
    const entry = { again: false, promise: null };
    entry.promise = (async () => {
      try {
        do {
          entry.again = false;
          await run(gameId);
        } while (entry.again);
      } finally {
        state.delete(gameId);
      }
    })();
    state.set(gameId, entry);
    return entry.promise;
  };
}

// ── Routes ──

const cleanName = (value, fallback) => String(value ?? "").trim().slice(0, 80) || fallback;

function gameSummary(game, now) {
  return {
    id: game.id,
    name: game.name,
    ratio: game.ratio,
    startDay: game.startDay,
    startedAt: game.startedAt,
    day: calendarDay(game, now),
    players: game.players ?? [],
    published: livePublications(game).size,
  };
}

function gameView(game, now) {
  const names = new Map((game.players ?? []).map((player) => [player.id, player.name]));
  const feed = [...livePublications(game).values()]
    .sort((a, b) => b.seq - a.seq)
    .slice(0, FEED_LIMIT)
    .map((record) => ({
      seq: record.seq,
      at: record.at,
      player: names.get(record.playerId) || "Another party",
      note: record.note,
      entries: record.entries,
    }));
  return { ...gameSummary(game, now), feed };
}

async function chatList(runtime) {
  const chats = await runtime.persistence.listChats();
  return chats.filter(isGameChat).map((chat) => {
    const meta = parseMeta(chat.metadata);
    return {
      id: chat.id,
      name: chat.name,
      gameId: gameIdOf(chat, meta),
      status: meta.gameSessionStatus ?? null,
      updatedAt: chat.lastMessageAt ?? chat.updatedAt,
      link: sharedLink(meta),
    };
  });
}

async function linkChat(runtime, store, body) {
  const { game } = await store.load(String(body.gameId ?? ""));
  const playerId = String(body.playerId ?? "");
  if (!(game.players ?? []).some((player) => player.id === playerId)) throw new WorldError(400, "Pick a player.");
  const chatId = String(body.chatId ?? "");
  const chat = await runtime.persistence.getChat(chatId);
  if (!isGameChat(chat)) throw new WorldError(400, "Only Game mode chats can join a shared world.");
  await writeShared(runtime.persistence, chatId, (meta) => ({ ...meta, sharedWorld: { gameId: game.id, playerId } }));
  return syncGame(runtime, store, game.id).then(() => ({ ok: true }));
}

/** Unlinking drops the shared deeds but keeps the day floor, so the chat's calendar never runs backwards. */
async function unlinkChat(runtime, body) {
  const chatId = String(body.chatId ?? "");
  await writeShared(runtime.persistence, chatId, (meta) => ({
    ...meta,
    sharedWorld: undefined,
    gameLedgerForeign: undefined,
  }));
  return { ok: true };
}

export async function activate(context) {
  const runtime = context.api.runtime;
  const store = createStore(runtime.persistence.documents);
  const sync = createSyncQueue((gameId) => syncGame(runtime, store, gameId));
  const background = (gameId) =>
    void sync(gameId).catch((error) => runtime.logger?.warn?.(error, "Shared World sync failed"));

  const releaseContext = await context.api.registerPromptContext(async ({ mode, chatMeta }) => {
    if (mode !== "game") return null;
    const link = sharedLink(parseMeta(chatMeta));
    if (link) background(link.gameId);
    return null;
  });

  const handle = (work) => async (request, reply) => {
    try {
      return reply.send(await work(request.params ?? {}, request.body ?? {}));
    } catch (error) {
      const status = error instanceof WorldError ? error.statusCode : 500;
      if (status >= 500) runtime.logger?.error?.(error, "Shared World request failed");
      return reply
        .status(status)
        .send({ error: error instanceof WorldError ? error.message : "Shared World request failed." });
    }
  };

  const releaseRoutes = await context.api.registerPrivilegedRoutes(
    async (routes) => {
      routes.get(
        "/games",
        handle(async () => (await store.list()).map((game) => gameSummary(game, Date.now()))),
      );
      routes.post(
        "/games",
        handle(async (_p, body) => {
          const ratio = Number(body.ratio) > 0 ? Math.min(Number(body.ratio), 30) : 1;
          const game = await store.create({ name: cleanName(body.name, "Shared world"), ratio });
          return gameSummary(game, Date.now());
        }),
      );
      routes.get(
        "/games/:gameId",
        handle(async ({ gameId }) => gameView((await store.load(gameId)).game, Date.now())),
      );
      routes.post(
        "/games/:gameId/players",
        handle(async ({ gameId }, body) => {
          const player = { id: randomUUID(), name: cleanName(body.name, "Player") };
          await store.update(gameId, (game) => ({ ...game, players: [...(game.players ?? []), player] }));
          return player;
        }),
      );
      routes.post(
        "/games/:gameId/sync",
        handle(async ({ gameId }) => {
          await sync(gameId);
          return gameView((await store.load(gameId)).game, Date.now());
        }),
      );
      routes.get(
        "/chats",
        handle(() => chatList(runtime)),
      );
      routes.post(
        "/link",
        handle((_p, body) => linkChat(runtime, store, body)),
      );
      routes.post(
        "/unlink",
        handle((_p, body) => unlinkChat(runtime, body)),
      );
    },
    { prefix: `/api/${PACKAGE_ID}/v1` },
  );

  return async () => {
    await releaseRoutes?.();
    await releaseContext?.();
  };
}
