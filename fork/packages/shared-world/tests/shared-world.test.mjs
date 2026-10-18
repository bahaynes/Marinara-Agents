// node --test fork/packages/shared-world/tests/*.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { activate, createStore, syncGame } from "../server.mjs";

function fakeDocuments() {
  const docs = new Map();
  const store = {
    docs,
    updates: 0,
    async list(packageId, kind) {
      return [...docs.values()].filter((doc) => doc.packageId === packageId && doc.kind === kind);
    },
    async getById(_packageId, id) {
      return structuredClone(docs.get(id) ?? null);
    },
    async create(doc) {
      const stored = { ...structuredClone(doc), revision: 1 };
      docs.set(doc.id, stored);
      return stored;
    },
    async remove(_packageId, id, expectedRevision) {
      if (docs.get(id)?.revision !== expectedRevision) return false;
      return docs.delete(id);
    },
    async update({ id, expectedRevision, ...fields }) {
      const current = docs.get(id);
      if (!current || current.revision !== expectedRevision) return null;
      store.updates += 1;
      const stored = { ...current, ...structuredClone(fields), revision: current.revision + 1 };
      docs.set(id, stored);
      return stored;
    },
  };
  return store;
}

function fakeRuntime() {
  const chats = new Map();
  const messages = new Map();
  let created = 0;
  const persistence = {
    documents: fakeDocuments(),
    metadataWrites: 0,
    async listChats() {
      return [...chats.values()].map((chat) => ({ ...chat, metadata: JSON.stringify(chat.metadata) }));
    },
    async getChat(id) {
      const chat = chats.get(id);
      return chat ? { ...chat, metadata: JSON.stringify(chat.metadata) } : null;
    },
    async listMessages(chatId) {
      return messages.get(chatId) ?? [];
    },
    async updateChatMetadata({ chatId, metadata }) {
      persistence.metadataWrites += 1;
      chats.get(chatId).metadata = structuredClone(metadata);
    },
    withChatLock: (_chatId, op) => op(),
  };
  return {
    runtime: { persistence, logger: {} },
    persistence,
    meta: (chatId) => chats.get(chatId).metadata,
    /** An Engine write: the whole metadata, as the Engine holds it. */
    engineWrite(chatId, change) {
      const chat = chats.get(chatId);
      chat.metadata = change(structuredClone(chat.metadata));
    },
    addChat(id, metadata = {}, groupId = id) {
      created += 1;
      chats.set(id, {
        id,
        name: id,
        mode: "game",
        groupId,
        createdAt: `2026-10-0${created}T00:00:00Z`,
        metadata: structuredClone(metadata),
      });
      messages.set(id, []);
    },
    say(chatId, id, role, content = "") {
      messages.get(chatId).push({ id, chatId, role, content, createdAt: new Date(Date.now() + 1000).toISOString() });
    },
    /** A message written before now (the reply that existed before a Peek Prompt). */
    said(chatId, id, role, content = "") {
      messages.get(chatId).push({ id, chatId, role, content, createdAt: "2026-01-01T00:00:00Z" });
    },
  };
}

const npc = (id, name, extra = {}) => ({
  id,
  name,
  emoji: "🙂",
  description: `${name} of the Mojave`,
  location: "Goodsprings",
  reputation: 0,
  notes: [],
  ...extra,
});

function aliceWorld() {
  const map = {
    type: "node",
    id: "mojave",
    name: "Mojave",
    description: "The wasteland",
    nodes: [
      { id: "goodsprings", emoji: "🏘️", label: "Goodsprings", x: 10, y: 10, discovered: true },
      { id: "primm", emoji: "🎰", label: "Primm", x: 30, y: 40, discovered: false },
    ],
    edges: [{ from: "goodsprings", to: "primm" }],
    partyPosition: "goodsprings",
  };
  return {
    gameNpcs: [
      npc("benny", "Benny"),
      npc("victor", "Victor", {
        reputation: 30,
        notes: ["Rolls on one wheel", "[helped] reputation +30 → 30 (Friendly)"],
      }),
    ],
    gameMap: map,
    gameMaps: [map],
    activeGameMapId: "mojave",
    gameInventedItems: [{ id: "platinum-chip", name: "Platinum Chip", summary: "A poker chip", item: {} }],
    gameWorldOverview: "The Mojave after the war.",
    gameStoryArc: "Alice's arc",
  };
}

function bobWorld() {
  const map = {
    type: "node",
    id: "region_1",
    name: "Somewhere",
    nodes: [{ id: "region_1", label: "Shack", x: 0, y: 0, discovered: true }],
    edges: [],
    partyPosition: "region_1",
  };
  return {
    gameNpcs: [npc("joe", "Old Joe")],
    gameMap: map,
    gameMaps: [map],
    activeGameMapId: "region_1",
    gameStoryArc: "Bob's arc",
  };
}

async function setup() {
  const world = fakeRuntime();
  let contributor;
  const routes = new Map();
  const release = await activate({
    api: {
      runtime: world.runtime,
      registerPromptContext: (fn) => ((contributor = fn), () => {}),
      registerPrivilegedRoutes: async (register) => {
        const add = (method) => (path, handler) => routes.set(`${method} ${path}`, handler);
        await register({ get: add("GET"), post: add("POST"), put: add("PUT"), delete: add("DELETE") });
        return () => {};
      },
    },
  });
  const reply = { status: () => reply, send: (body) => body };
  const route = (key, body = {}, params = {}) => routes.get(key)({ params, body }, reply);
  const store = createStore(world.persistence.documents);
  const game = await route("POST /games", { name: "Mojave" });
  const alice = await route("POST /games/:gameId/players", { name: "Alice" }, { gameId: game.id });
  const bob = await route("POST /games/:gameId/players", { name: "Bob" }, { gameId: game.id });
  world.addChat("a1", aliceWorld());
  world.addChat("b1", bobWorld());
  const link = (chatId, player) => route("POST /link", { chatId, gameId: game.id, playerId: player.id });
  const sync = () => syncGame(world.runtime, store, game.id);
  const load = async () => (await store.load(game.id)).game;
  const news = (chatId) => contributor({ chatId, mode: "game", chatMeta: world.meta(chatId) });
  await release();
  return { world, route, game, alice, bob, link, sync, load, news, contributor };
}

const byId = (list, id) => list.find((entry) => entry.id === id);

async function linkedPair() {
  const ctx = await setup();
  assert.deepEqual(await ctx.link("a1", ctx.alice), { ok: true });
  assert.deepEqual(await ctx.link("b1", ctx.bob), { ok: true });
  return ctx;
}

test("the first chat seeds the world and a later one joins it: its cast and map become the shared ones", async () => {
  const { world, load } = await linkedPair();
  const b = world.meta("b1");
  assert.deepEqual(
    b.gameNpcs.map((entry) => entry.id),
    ["benny", "victor"],
  );
  const victor = byId(b.gameNpcs, "victor");
  assert.equal(victor.reputation, 0);
  assert.deepEqual(victor.notes, ["Rolls on one wheel"]);
  assert.equal(b.activeGameMapId, "mojave");
  assert.equal(b.gameMap.id, "mojave");
  assert.equal(b.gameMap.partyPosition, "goodsprings");
  assert.equal(b.lastMapPosition, "goodsprings");
  assert.deepEqual(b.gameMaps.map((map) => map.id), ["mojave"]);
  assert.deepEqual(b.gameMap.edges, [{ from: "goodsprings", to: "primm" }]);
  assert.equal(b.gameWorldOverview, "The Mojave after the war.");
  assert.deepEqual(b.gameInventedItems.map((item) => item.id), ["platinum-chip"]);
  assert.equal(b.gameStoryArc, "Bob's arc");
  // Alice keeps her own reputation and history.
  const aliceVictor = byId(world.meta("a1").gameNpcs, "victor");
  assert.equal(aliceVictor.reputation, 30);
  assert.equal(aliceVictor.notes.length, 2);
  const hub = (await load()).hub;
  assert.equal(hub.world["npc:joe"], undefined);
  assert.deepEqual(hub.world["npc:victor"].fields.notes.v, ["Rolls on one wheel"]);
  assert.equal(hub.world["npc:victor"].fields.reputation, undefined);
});

test("a second sync with nothing new writes nothing", async () => {
  const { world, sync } = await linkedPair();
  await sync();
  const writes = world.persistence.metadataWrites;
  const updates = world.persistence.documents.updates;
  assert.equal((await sync()).written, 0);
  assert.equal(world.persistence.metadataWrites, writes);
  assert.equal(world.persistence.documents.updates, updates);
});

test("each chat's changes merge field by field, and reputation and the reputation log stay the party's", async () => {
  const { world, sync, load } = await linkedPair();
  world.engineWrite("a1", (meta) => {
    byId(meta.gameNpcs, "benny").location = "The Tops";
    return meta;
  });
  world.engineWrite("b1", (meta) => {
    const victor = byId(meta.gameNpcs, "victor");
    victor.description = "A Securitron with a cowboy face";
    victor.reputation = -10;
    victor.notes.push("[insulted] reputation -10 → -10 (Unfriendly)", "Works for House");
    return meta;
  });
  await sync();
  for (const chatId of ["a1", "b1"]) {
    const npcs = world.meta(chatId).gameNpcs;
    assert.equal(byId(npcs, "benny").location, "The Tops", chatId);
    assert.equal(byId(npcs, "victor").description, "A Securitron with a cowboy face", chatId);
    assert.ok(byId(npcs, "victor").notes.includes("Works for House"), chatId);
  }
  assert.equal(byId(world.meta("a1").gameNpcs, "victor").reputation, 30);
  assert.equal(byId(world.meta("b1").gameNpcs, "victor").reputation, -10);
  assert.ok(!byId(world.meta("a1").gameNpcs, "victor").notes.some((note) => note.includes("insulted")));
  assert.ok(!(await load()).hub.world["npc:victor"].fields.notes.v.some((note) => note.includes("insulted")));
});

test("a record a chat lost comes back, and a stale write-back is undone rather than shared", async () => {
  const { world, sync, load } = await linkedPair();
  world.engineWrite("b1", (meta) => {
    byId(meta.gameNpcs, "benny").location = "Primm";
    return meta;
  });
  await sync();
  assert.equal(byId(world.meta("a1").gameNpcs, "benny").location, "Primm");
  const seq = (await load()).hub.seq;
  // The Engine finishes a turn from the copy it read before the sync: Benny is back in Goodsprings and Victor
  // is gone.
  world.engineWrite("a1", (meta) => {
    byId(meta.gameNpcs, "benny").location = "Goodsprings";
    meta.gameNpcs = meta.gameNpcs.filter((entry) => entry.id !== "victor");
    return meta;
  });
  await sync();
  const npcs = world.meta("a1").gameNpcs;
  assert.equal(byId(npcs, "benny").location, "Primm");
  assert.equal(byId(npcs, "victor").description, "Victor of the Mojave", "the lost record comes back from the hub");
  assert.equal((await load()).hub.seq, seq);
  assert.equal(byId(world.meta("b1").gameNpcs, "benny").location, "Primm");
});

test("a discovered place stays discovered, and new places and paths reach the other map", async () => {
  const { world, sync } = await linkedPair();
  world.engineWrite("b1", (meta) => {
    meta.gameMap.nodes.find((node) => node.id === "primm").discovered = true;
    meta.gameMap.nodes.push({ id: "nipton", label: "Nipton", x: 50, y: 60, discovered: true });
    meta.gameMap.edges.push({ from: "nipton", to: "primm" });
    meta.gameMaps = [meta.gameMap];
    return meta;
  });
  await sync();
  world.engineWrite("a1", (meta) => {
    meta.gameMap.nodes.find((node) => node.id === "primm").discovered = false;
    meta.gameMaps = [meta.gameMap];
    return meta;
  });
  await sync();
  const map = world.meta("a1").gameMap;
  assert.equal(map.nodes.find((node) => node.id === "primm").discovered, true);
  assert.ok(map.nodes.some((node) => node.id === "nipton"));
  assert.ok(map.edges.some((edge) => edge.from === "nipton" && edge.to === "primm"));
  assert.equal(map.partyPosition, "goodsprings");
  assert.deepEqual(world.meta("a1").gameMaps[0], map);
});

test("a character both Game Masters made between syncs, under different ids, is one shared character", async () => {
  const { world, sync, load } = await linkedPair();
  world.engineWrite("a1", (meta) => {
    meta.gameNpcs.push(npc("cass", "Cass", { description: "A caravaneer" }));
    return meta;
  });
  world.engineWrite("b1", (meta) => {
    meta.gameNpcs.push(npc("cass_2", "cass", { description: "Drinks whiskey" }));
    return meta;
  });
  await sync();
  const hub = (await load()).hub;
  assert.equal(Object.keys(hub.world).filter((key) => key.startsWith("npc:")).length, 3);
  assert.ok(world.meta("b1").gameNpcs.some((entry) => entry.id === "cass_2"));
  assert.ok(!world.meta("b1").gameNpcs.some((entry) => entry.id === "cass"));
  assert.ok(!world.meta("a1").gameNpcs.some((entry) => entry.id === "cass_2"));
  // Later changes go through the alias.
  world.engineWrite("b1", (meta) => {
    byId(meta.gameNpcs, "cass_2").location = "Novac";
    return meta;
  });
  await sync();
  assert.equal(byId(world.meta("a1").gameNpcs, "cass").location, "Novac");
  assert.equal(byId(world.meta("b1").gameNpcs, "cass_2").location, "Novac");
});

test("the same place id on two maps keeps to its own map", async () => {
  const { world, sync } = await linkedPair();
  const cave = (id, name) => ({
    type: "node",
    id,
    name,
    nodes: [{ id: "entrance", label: "Entrance", x: 1, y: 1, discovered: true }],
    edges: [],
    partyPosition: "entrance",
  });
  world.engineWrite("a1", (meta) => {
    meta.gameMaps = [...meta.gameMaps, cave("vault-19", "Vault 19"), cave("vault-22", "Vault 22")];
    return meta;
  });
  await sync();
  world.engineWrite("b1", (meta) => {
    for (const map of meta.gameMaps) if (map.id === "vault-22") map.nodes[0].description = "Overgrown";
    return meta;
  });
  await sync();
  const maps = world.meta("a1").gameMaps;
  assert.equal(byId(maps, "vault-22").nodes[0].description, "Overgrown");
  assert.equal(byId(maps, "vault-19").nodes[0].description, undefined);
});

test("Next Session keeps syncing from the same base: the new session chat is the one that syncs", async () => {
  const { world, sync, load } = await linkedPair();
  const carried = structuredClone(world.meta("a1"));
  world.addChat("a2", { ...carried, gameSessionStatus: "ready" }, "a1");
  world.engineWrite("a2", (meta) => {
    meta.gameNpcs.push(npc("cass", "Cass"));
    return meta;
  });
  await sync();
  assert.ok(world.meta("b1").gameNpcs.some((entry) => entry.id === "cass"));
  assert.equal(byId(world.meta("a2").gameNpcs, "victor").reputation, 30);
  assert.deepEqual(Object.keys((await load()).bases).sort(), ["a1", "b1"]);
});

test("news reaches the other party's Game Master, survives a swipe, and clears on their next message", async () => {
  const { world, sync, news, contributor } = await linkedPair();
  assert.equal(await contributor({ chatId: "a1", mode: "roleplay", chatMeta: world.meta("a1") }), null);
  world.say("a1", "u1", "user", "Look around.");
  world.engineWrite("b1", (meta) => {
    meta.gameNpcs.push(npc("cass", "Cass", { description: "A caravaneer" }));
    byId(meta.gameNpcs, "benny").location = "The Tops";
    return meta;
  });
  await sync();
  const first = await news("a1");
  assert.match(first, /New character: Cass \(A caravaneer\) \(Bob\)/);
  assert.match(first, /Benny is now at The Tops \(Bob\)/);
  assert.equal(await news("b1"), null, "Bob's own changes are not news to him");
  assert.equal(await news("a1"), first, "a swipe of the same turn sees it again");
  world.say("a1", "g1", "assistant", "You see Cass.");
  world.say("a1", "u2", "user", "Talk to Cass.");
  assert.equal(await news("a1"), null);
});

test("a chat must be a set-up Game chat, and unlinking keeps its world", async () => {
  const { world, route, game, alice, link } = await linkedPair();
  world.addChat("c1", {});
  assert.match((await link("c1", alice)).error, /Finish the game's setup/);
  const other = await route("POST /games", { name: "Other" });
  assert.match((await route("POST /link", { chatId: "a1", gameId: other.id, playerId: alice.id })).error, /Pick a player/);
  const carol = await route("POST /games/:gameId/players", { name: "Carol" }, { gameId: other.id });
  assert.match((await route("POST /link", { chatId: "a1", gameId: other.id, playerId: carol.id })).error, /Unlink/);
  world.engineWrite("a1", (meta) => ({ ...meta, gameLedgerForeign: [], gameWorldDayFloor: 3 }));
  await route("POST /unlink", { chatId: "a1" });
  const meta = world.meta("a1");
  assert.equal(meta.sharedWorld, undefined);
  assert.equal(meta.gameLedgerForeign, undefined);
  assert.equal(meta.gameWorldDayFloor, undefined);
  assert.equal(meta.gameNpcs.length, 2);
  world.engineWrite("b1", (meta) => {
    byId(meta.gameNpcs, "benny").location = "The Tops";
    return meta;
  });
  await route("POST /games/:gameId/sync", {}, { gameId: game.id });
  const view = await route("GET /games/:gameId", {}, { gameId: game.id });
  assert.equal(view.feed[0].text, "Benny is now at The Tops");
  assert.equal(view.feed[0].player, "Bob");
  assert.ok(view.feed.some((item) => item.text === "New character: Benny (Benny of the Mojave)"));
});

test("a chat linked without a base (an old v0.1 link) is left alone until it is relinked", async () => {
  const { world, game, bob, sync, load } = await linkedPair();
  world.addChat("c1", { ...bobWorld(), sharedWorld: { gameId: game.id, playerId: bob.id } });
  const before = structuredClone(world.meta("c1"));
  const writes = world.persistence.metadataWrites;
  await sync();
  assert.deepEqual(world.meta("c1"), before);
  assert.equal(world.persistence.metadataWrites, writes);
  assert.equal((await load()).hub.world["npc:joe"], undefined);
});

test("deleting a game unlinks its chats, which keep their world", async () => {
  const { world, route, game } = await linkedPair();
  assert.deepEqual(await route("DELETE /games/:gameId", {}, { gameId: game.id }), { ok: true });
  assert.deepEqual(await route("GET /games"), []);
  for (const chatId of ["a1", "b1"]) {
    assert.equal(world.meta(chatId).sharedWorld, undefined, chatId);
    assert.equal(world.meta(chatId).gameNpcs.length, 2, chatId);
  }
  assert.match((await route("GET /games/:gameId", {}, { gameId: game.id })).error, /not found/);
});

test("Peek Prompt before the next message does not use up the news", async () => {
  const { world, sync, news } = await linkedPair();
  world.said("a1", "u1", "user", "Look around.");
  world.said("a1", "g1", "assistant", "Dust.");
  world.engineWrite("b1", (meta) => {
    meta.gameNpcs.push(npc("cass", "Cass"));
    return meta;
  });
  await sync();
  assert.match(await news("a1"), /Cass/, "the peek sees it");
  world.say("a1", "u2", "user", "Walk on.");
  assert.match(await news("a1"), /Cass/, "the real turn still gets it");
  world.say("a1", "g2", "assistant", "You meet Cass.");
  world.say("a1", "u3", "user", "Talk to her.");
  assert.equal(await news("a1"), null);
});
