// Shared World: Classic Game mode chats linked to one shared game keep one world between them (its NPCs,
// maps, invented items and world overview) while each plays its own story at its own pace. The game's
// document holds the shared copy (the hub) and, per linked game, what Shared World last wrote into it
// (the base); merge.mjs does the merging.
//
// Sync runs in the background when a linked chat generates, every minute, and on demand from the page. It
// never blocks a generation: what it writes lands for the next turn. What other parties changed reaches the
// Game Master as news, held until the player's next message so a swipe sees it too.

import { randomUUID } from "node:crypto";
import { changesSince, emptyHub, newsBlock, parseMeta, partiesTogether, presenceBlock, sharedLink, syncWorld } from "./merge.mjs";

export const PACKAGE_ID = "shared-world";
const GAME_KIND = "game";
const WRITE_RETRIES = 5;
const FEED_LIMIT = 50;
const SYNC_INTERVAL_MS = 60_000;
/** Fields of a v0.1 game document, dropped on its next write. */
const RETIRED_GAME_FIELDS = ["records", "nextSeq", "ratio", "startDay", "startedAt"];
/** Chat metadata keys v0.1 wrote. */
const RETIRED_CHAT_KEYS = ["gameLedgerForeign", "gameWorldDayFloor"];

const gameDocId = (gameId) => `${PACKAGE_ID}:game:${gameId}`;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

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
    async create({ name }) {
      const id = randomUUID();
      const game = { id, name, players: [], hub: emptyHub(), bases: {} };
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
    async remove(gameId) {
      for (let attempt = 0; attempt < WRITE_RETRIES; attempt += 1) {
        const { revision } = await load(gameId);
        if (await documents.remove(PACKAGE_ID, gameDocId(gameId), revision)) return;
      }
      throw new WorldError(409, "The shared game kept changing. Try again.");
    },
    /** Read, change and write a game, retrying when another write landed first. */
    async update(gameId, change) {
      for (let attempt = 0; attempt < WRITE_RETRIES; attempt += 1) {
        const { game, revision } = await load(gameId);
        const next = await change(game);
        if (!next || next === game) return game;
        const data = { ...next };
        for (const field of RETIRED_GAME_FIELDS) delete data[field];
        const updated = await documents.update({
          id: gameDocId(gameId),
          packageId: PACKAGE_ID,
          expectedRevision: revision,
          name: data.name,
          description: "",
          data,
          updatedAt: new Date().toISOString(),
        });
        if (updated) return data;
      }
      throw new WorldError(409, "The shared game kept changing. Try again.");
    },
  };
}

// ── Chats ──

const isGameChat = (chat) => chat?.mode === "game";
/** The chat's own game: its sessions share it, so Next Session keeps the base. */
const gameIdOf = (chat, meta) => chat.groupId || meta.gameId || chat.id;
/** Setup is done once the Game Master has made the cast or the map. */
const setUp = (meta) => Array.isArray(meta.gameNpcs) || Boolean(meta.gameMap);
const hasPlayer = (game, playerId) => (game.players ?? []).some((player) => player.id === playerId);

/** Every chat linked to this shared game, with its parsed metadata. */
async function linkedChats(persistence, gameId) {
  const chats = await persistence.listChats();
  return chats
    .filter(isGameChat)
    .map((chat) => ({ chat, meta: parseMeta(chat.metadata) }))
    .filter(({ meta }) => sharedLink(meta)?.gameId === gameId);
}

/**
 * Sync one chat with the hub, under the Engine's own metadata lock so no Engine write lands in between. The
 * chat's metadata is written whole (the capability API has no patch), so it is re-read inside the lock and
 * only the shared keys change. Writes nothing when nothing changed.
 */
async function syncChat(persistence, store, gameId, chatId, { join = false } = {}) {
  return persistence.withChatLock(chatId, async () => {
    const chat = await persistence.getChat(chatId);
    if (!isGameChat(chat)) return false;
    const meta = parseMeta(chat.metadata);
    const link = sharedLink(meta);
    if (link?.gameId !== gameId) return false;
    const localGameId = gameIdOf(chat, meta);
    let written = null;
    await store.update(gameId, (game) => {
      written = null;
      if (!hasPlayer(game, link.playerId)) return game;
      const base = game.bases?.[localGameId];
      // Only linking creates a base. A linked chat without one (an old v0.1 link, lost storage) waits for a
      // relink rather than merging an in-progress world into the hub unasked.
      if (!base && !join) return game;
      const result = syncWorld({
        meta,
        hub: game.hub,
        base,
        player: link.playerId,
        at: new Date().toISOString(),
        join: join && !base,
      });
      written = result.meta;
      const nextBase = { ...result.base, playerId: link.playerId };
      const retired = RETIRED_GAME_FIELDS.some((field) => field in game);
      if (!retired && same(result.hub, game.hub) && same(nextBase, base)) return game;
      return { ...game, hub: result.hub, bases: { ...game.bases, [localGameId]: nextBase } };
    });
    if (!written) return false;
    for (const key of RETIRED_CHAT_KEYS) delete written[key];
    if (same(written, meta)) return false;
    await persistence.updateChatMetadata({ chatId, metadata: written, updatedAt: new Date().toISOString() });
    return true;
  });
}

/**
 * Sync every linked game's latest session. With more than one, a second pass carries what the later ones
 * pushed back into the earlier ones. Idempotent: a run with nothing new writes nothing.
 */
export async function syncGame(runtime, store, gameId) {
  const persistence = runtime.persistence;
  const latest = new Map();
  for (const entry of await linkedChats(persistence, gameId)) {
    const key = gameIdOf(entry.chat, entry.meta);
    const held = latest.get(key);
    if (!held || String(entry.chat.createdAt ?? "") > String(held.chat.createdAt ?? "")) latest.set(key, entry);
  }
  const passes = latest.size > 1 ? 2 : 1;
  let written = 0;
  for (let pass = 0; pass < passes; pass += 1) {
    for (const { chat } of latest.values()) {
      if (await syncChat(persistence, store, gameId, chat.id)) written += 1;
    }
  }
  return { game: (await store.load(gameId)).game, written };
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

/**
 * The news for this chat's Game Master, or null. News stays held for the player's whole turn (a swipe or a
 * second prompt in the same turn gets it again) and is dropped once they send their next message.
 */
/** Whether an assistant message after the user message `turnId` was created after `since`. */
function repliedSince(messages, turnId, since) {
  const start = messages.findIndex((message) => message.id === turnId);
  if (start < 0 || !since) return true;
  return messages.slice(start + 1).some((message) => message.role === "assistant" && String(message.createdAt ?? "") > since);
}

export async function deliverNews(persistence, store, gameId, chatId) {
  const chat = await persistence.getChat(chatId);
  if (!isGameChat(chat)) return null;
  const localGameId = gameIdOf(chat, parseMeta(chat.metadata));
  const messages = await persistence.listMessages(chatId);
  const turn = messages.findLast((message) => message.role === "user")?.id ?? null;
  let shown = [];
  const game = await store.update(gameId, (current) => {
    const base = current.bases?.[localGameId];
    if (!base) {
      shown = [];
      return current;
    }
    // Delivered news is dropped once the Game Master has replied after it went out. Peek Prompt runs this
    // too, so a delivery for an earlier turn that nothing answered yet still counts as unread.
    const sameTurn = base.deliveredFor === turn;
    const answered = !sameTurn && repliedSince(messages, base.deliveredFor, base.deliveredAt);
    const held = answered ? (base.news ?? []).filter((item) => !item.delivered) : (base.news ?? []);
    shown = held;
    const news = held.map((item) => (item.delivered ? item : { ...item, delivered: true }));
    if (sameTurn && same(news, base.news)) return current;
    // A swipe keeps the first delivery time, so its reply (the same message row) still counts as an answer.
    const deliveredAt = sameTurn && base.deliveredAt ? base.deliveredAt : new Date().toISOString();
    return {
      ...current,
      bases: { ...current.bases, [localGameId]: { ...base, news, deliveredFor: turn, deliveredAt } },
    };
  });
  const names = new Map((game.players ?? []).map((player) => [player.id, player.name]));
  const presence = presenceBlock(partiesTogether(game.hub ?? emptyHub(), game.bases), localGameId, names);
  return [newsBlock(shown, names), presence].filter(Boolean).join("\n\n") || null;
}

// ── Routes ──

const cleanName = (value, fallback) => String(value ?? "").trim().slice(0, 80) || fallback;

function gameSummary(game) {
  return {
    id: game.id,
    name: game.name,
    players: game.players ?? [],
    records: Object.keys(game.hub?.world ?? {}).length,
  };
}

function gameView(game) {
  const names = new Map((game.players ?? []).map((player) => [player.id, player.name]));
  const feed = changesSince(game.hub ?? emptyHub(), 0)
    .reverse()
    .slice(0, FEED_LIMIT)
    .map((item) => ({ seq: item.seq, at: item.at, player: names.get(item.by) || "Another party", text: item.text }));
  const together = partiesTogether(game.hub ?? emptyHub(), game.bases).map((entry) => ({
    place: entry.place,
    players: [...new Set(entry.members.map((member) => names.get(member.playerId) || "Another party"))],
  }));
  return { ...gameSummary(game), feed, together };
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
      setUp: setUp(meta),
      link: sharedLink(meta),
    };
  });
}

/** Write or clear the link in one chat, under the Engine's metadata lock. */
async function writeLink(persistence, chatId, change) {
  return persistence.withChatLock(chatId, async () => {
    const chat = await persistence.getChat(chatId);
    if (!chat) return false;
    const meta = parseMeta(chat.metadata);
    const next = change({ ...meta });
    for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
    if (same(next, meta)) return false;
    await persistence.updateChatMetadata({ chatId, metadata: next, updatedAt: new Date().toISOString() });
    return true;
  });
}

/**
 * Link a chat. The first chat seeds the world from its own; a later one joins: its cast, maps and invented
 * items become the shared world's, and its party starts where the first party started.
 */
async function linkChat(runtime, store, body) {
  const { game } = await store.load(String(body.gameId ?? ""));
  const playerId = String(body.playerId ?? "");
  if (!hasPlayer(game, playerId)) throw new WorldError(400, "Pick a player.");
  const chatId = String(body.chatId ?? "");
  const chat = await runtime.persistence.getChat(chatId);
  if (!isGameChat(chat)) throw new WorldError(400, "Only Game mode chats can join a shared world.");
  const meta = parseMeta(chat.metadata);
  if (!setUp(meta)) throw new WorldError(400, "Finish the game's setup first, then link it.");
  const link = sharedLink(meta);
  if (link && link.gameId !== game.id) throw new WorldError(400, "Unlink this chat from its other shared world first.");
  await writeLink(runtime.persistence, chatId, (current) => ({
    ...current,
    sharedWorld: { gameId: game.id, playerId },
  }));
  await syncChat(runtime.persistence, store, game.id, chatId, { join: true });
  await syncGame(runtime, store, game.id);
  return { ok: true };
}

/** Unlinking keeps the world as it is in the chat and the game's base, so a relink picks up where it left. */
async function unlinkChat(runtime, body) {
  const chatId = String(body.chatId ?? "");
  await writeLink(runtime.persistence, chatId, (meta) => {
    const next = { ...meta, sharedWorld: undefined };
    for (const key of RETIRED_CHAT_KEYS) next[key] = undefined;
    return next;
  });
  return { ok: true };
}

/** Deleting a game unlinks its chats first; each keeps the world as it is. */
async function deleteGame(runtime, store, gameId) {
  await store.load(gameId);
  for (const { chat } of await linkedChats(runtime.persistence, gameId)) await unlinkChat(runtime, { chatId: chat.id });
  await store.remove(gameId);
  return { ok: true };
}

export async function activate(context) {
  const runtime = context.api.runtime;
  const store = createStore(runtime.persistence.documents);
  const sync = createSyncQueue((gameId) => syncGame(runtime, store, gameId));
  const background = (gameId) =>
    void sync(gameId).catch((error) => runtime.logger?.warn?.(error, "Shared World sync failed"));

  const releaseContext = await context.api.registerPromptContext(async ({ chatId, mode, chatMeta }) => {
    if (mode !== "game") return null;
    const link = sharedLink(parseMeta(chatMeta));
    if (!link) return null;
    try {
      return await deliverNews(runtime.persistence, store, link.gameId, chatId);
    } catch (error) {
      runtime.logger?.warn?.(error, "Shared World news failed");
      return null;
    } finally {
      background(link.gameId);
    }
  });

  const timer = setInterval(() => {
    void store
      .list()
      .then((games) => games.forEach((game) => background(game.id)))
      .catch((error) => runtime.logger?.warn?.(error, "Shared World sync failed"));
  }, SYNC_INTERVAL_MS);
  timer.unref?.();

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
        handle(async () => (await store.list()).map(gameSummary)),
      );
      routes.post(
        "/games",
        handle(async (_p, body) => gameSummary(await store.create({ name: cleanName(body.name, "Shared world") }))),
      );
      routes.get(
        "/games/:gameId",
        handle(async ({ gameId }) => gameView((await store.load(gameId)).game)),
      );
      routes.delete(
        "/games/:gameId",
        handle(({ gameId }) => sync(gameId).then(() => deleteGame(runtime, store, gameId))),
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
          return gameView((await store.load(gameId)).game);
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
    clearInterval(timer);
    await releaseRoutes?.();
    await releaseContext?.();
  };
}
