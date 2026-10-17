// node --test fork/packages/shared-world/tests/*.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { activate, createStore, syncGame } from "../server.mjs";
import { calendarDay, foreignLedger, readWorldEntries, sessionReplies } from "../world.mjs";

const DAY = 86_400_000;
const START = Date.parse("2026-10-01T00:00:00Z");

function fakeDocuments() {
  const docs = new Map();
  return {
    docs,
    async list(packageId, kind) {
      return [...docs.values()].filter((doc) => doc.packageId === packageId && doc.kind === kind);
    },
    async getById(_packageId, id) {
      return docs.get(id) ?? null;
    },
    async create(doc) {
      const stored = { ...structuredClone(doc), revision: 1 };
      docs.set(doc.id, stored);
      return stored;
    },
    async update({ id, expectedRevision, ...fields }) {
      const current = docs.get(id);
      if (!current || current.revision !== expectedRevision) return null;
      const stored = { ...current, ...structuredClone(fields), revision: current.revision + 1 };
      docs.set(id, stored);
      return stored;
    },
  };
}

function fakeRuntime() {
  const chats = new Map();
  const messages = new Map();
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
    chats,
    messages,
    meta: (chatId) => chats.get(chatId).metadata,
    addChat(id, metadata = {}, groupId = id) {
      chats.set(id, { id, name: id, mode: "game", groupId, metadata });
      messages.set(id, []);
    },
    say(chatId, id, role, content) {
      messages.get(chatId).push({ id, chatId, role, content });
    },
  };
}

const HOLD = '[world: deed="hold-taken" place="Goodsprings" days="2" result="ok"]';
const ANGER = '[world: deed="angered" group="Powder Gangers" result="ok"]';

async function setup() {
  const world = fakeRuntime();
  const store = createStore(world.runtime.persistence.documents);
  const game = await store.create({ name: "Mojave", now: new Date(START).toISOString() });
  const alice = { id: "p-alice", name: "Alice" };
  const bob = { id: "p-bob", name: "Bob" };
  await store.update(game.id, (current) => ({ ...current, players: [alice, bob] }));
  world.addChat("a1", { sharedWorld: { gameId: game.id, playerId: alice.id } });
  world.addChat("b1", { sharedWorld: { gameId: game.id, playerId: bob.id } });
  const sync = (now = START + DAY / 2) => syncGame(world.runtime, store, game.id, now);
  const log = async () => (await store.load(game.id)).game;
  return { world, store, game, sync, log };
}

test("tags parse like the Engine's ledger: only answered world tags, without time or holds", () => {
  const entries = readWorldEntries(
    `They take the town. ${HOLD} [place: name="Primm" result="ok"] [world: fact="weather" value="dust storm"]` +
      ` [world: event="Caravan   burns" at="dusk" result = ok] [world: deed= place="Primm" result="ok"]`,
  );
  assert.deepEqual(entries, [
    { deed: "hold-taken", place: "Goodsprings" },
    { event: "Caravan burns" },
  ]);
});

test("a reply publishes once it is answered, and a second sync writes nothing", async () => {
  const { world, sync, log } = await setup();
  world.say("a1", "u1", "user", "We go to Goodsprings.");
  world.say("a1", "g1", "assistant", `You drive them out. ${HOLD}`);
  await sync();
  assert.equal((await log()).records.length, 0, "the latest reply can still be swiped");
  assert.deepEqual(world.meta("b1").gameLedgerForeign, []);

  world.say("a1", "u2", "user", "We rest.");
  await sync();
  assert.equal((await log()).records.length, 1);
  assert.deepEqual(world.meta("b1").gameLedgerForeign, [{ deed: "hold-taken", place: "Goodsprings", by: "Alice" }]);
  assert.deepEqual(world.meta("a1").gameLedgerForeign, [], "your own deeds stay in your own ledger");

  const writes = world.runtime.persistence.metadataWrites;
  const before = await log();
  await sync();
  assert.deepEqual(await log(), before);
  assert.equal(world.runtime.persistence.metadataWrites, writes);
});

test("a swiped or edited reply is retracted, and its replacement publishes once answered", async () => {
  const { world, sync, log } = await setup();
  world.say("a1", "u1", "user", "Go.");
  world.say("a1", "g1", "assistant", HOLD);
  world.say("a1", "u2", "user", "Next.");
  await sync();

  // Delete the last player message, then swipe the reply into a different outcome.
  world.messages.get("a1").pop();
  await sync();
  assert.equal((await log()).records.length, 1, "deleting your own message does not churn the log");
  world.messages.get("a1")[1].content = ANGER;
  await sync();
  assert.deepEqual(world.meta("b1").gameLedgerForeign, [], "the swiped deed is retracted");
  assert.deepEqual(
    (await log()).records.map((record) => Boolean(record.retract)),
    [false, true],
  );

  world.say("a1", "u3", "user", "Run.");
  await sync();
  assert.deepEqual(world.meta("b1").gameLedgerForeign, [{ deed: "angered", group: "Powder Gangers", by: "Alice" }]);

  // A deleted reply is retracted too.
  world.messages.get("a1").splice(1, 1);
  await sync();
  assert.deepEqual(world.meta("b1").gameLedgerForeign, []);
});

test("a concluded session publishes its last reply; replies before the world start never publish", async () => {
  const { world, sync } = await setup();
  world.say("a1", "g0", "assistant", `Setup notes. ${ANGER}`);
  world.say("a1", "u1", "user", "Start.");
  world.say("a1", "g1", "assistant", HOLD);
  world.chats.get("a1").metadata.gameWorldStartsAfter = "g0";
  await sync();
  assert.deepEqual(world.meta("b1").gameLedgerForeign, []);
  world.chats.get("a1").metadata.gameSessionStatus = "concluded";
  await sync();
  assert.deepEqual(world.meta("b1").gameLedgerForeign, [{ deed: "hold-taken", place: "Goodsprings", by: "Alice" }]);
});

test("a party's own newer deed on the same place supersedes the other party's older one", async () => {
  const { world, sync } = await setup();
  world.say("b1", "bu1", "user", "Take Goodsprings.");
  world.say("b1", "bg1", "assistant", HOLD);
  world.say("b1", "bu2", "user", "Hold it.");
  await sync();
  assert.equal(world.meta("a1").gameLedgerForeign.length, 1);
  world.say("a1", "au1", "user", "Retake Goodsprings.");
  world.say("a1", "ag1", "assistant", '[world: deed="hold-lost" place="goodsprings" result="ok"]');
  world.say("a1", "au2", "user", "Onward.");
  await sync();
  assert.deepEqual(world.meta("a1").gameLedgerForeign, [], "Alice's later deed holds for Alice");
  assert.deepEqual(world.meta("b1").gameLedgerForeign, [{ deed: "hold-lost", place: "goodsprings", by: "Alice" }]);
});

test("the shared calendar floor follows real days and never moves back", async () => {
  const { world, sync, game } = await setup();
  assert.equal(calendarDay(game, START + 3.5 * DAY), 3);
  assert.equal(calendarDay({ ...game, ratio: 2 }, START + 3.5 * DAY), 7);
  await sync(START + 3.5 * DAY);
  assert.equal(world.meta("a1").gameWorldDayFloor, 3);
  world.chats.get("a1").metadata.gameWorldDayFloor = 10;
  await sync(START + 4 * DAY);
  assert.equal(world.meta("a1").gameWorldDayFloor, 10);
});

test("a player outside the game, or an unlinked chat, never publishes or reads", async () => {
  const { world, sync, game, log } = await setup();
  world.addChat("x1", { sharedWorld: { gameId: game.id, playerId: "p-stranger" } });
  world.addChat("n1", {});
  for (const chat of ["x1", "n1"]) {
    world.say(chat, "u1", "user", "Go.");
    world.say(chat, "g1", "assistant", HOLD);
    world.say(chat, "u2", "user", "Next.");
  }
  world.say("a1", "u1", "user", "Go.");
  world.say("a1", "g1", "assistant", HOLD);
  world.say("a1", "u2", "user", "Next.");
  await sync();
  assert.equal((await log()).records.length, 1, "only Alice publishes");
  assert.equal(world.meta("n1").gameLedgerForeign, undefined);
  assert.equal(world.meta("x1").gameLedgerForeign, undefined, "a stranger reads nothing");
});

test("a chat linked in progress shares only what comes after the link, and a relink retracts nothing", async () => {
  const { world, sync, log, game } = await setup();
  world.say("a1", "u0", "user", "Before.");
  world.say("a1", "g0", "assistant", ANGER);
  world.say("a1", "u1", "user", "Link here.");
  world.chats.get("a1").metadata.sharedWorld.since = "u1";
  world.say("a1", "g1", "assistant", HOLD);
  world.say("a1", "u2", "user", "Next.");
  await sync();
  assert.deepEqual(world.meta("b1").gameLedgerForeign, [{ deed: "hold-taken", place: "Goodsprings", by: "Alice" }]);
  world.chats.get("a1").metadata.sharedWorld = { gameId: game.id, playerId: "p-alice", since: "u2" };
  await sync();
  assert.equal((await log()).records.length, 1);
});

test("an Engine write-back from a copy read before the sync is healed by the next sync", async () => {
  const { world, sync } = await setup();
  const stale = structuredClone(world.meta("b1"));
  world.say("a1", "u1", "user", "Go.");
  world.say("a1", "g1", "assistant", HOLD);
  world.say("a1", "u2", "user", "Next.");
  await sync();
  world.chats.get("b1").metadata = { ...stale, gameMap: "moved" };
  await sync();
  assert.equal(world.meta("b1").gameLedgerForeign.length, 1);
  assert.equal(world.meta("b1").gameMap, "moved", "the Engine's own write is kept");
});

test("party turns and replies without answered tags publish nothing", () => {
  const replies = sessionReplies([
    { id: "g1", role: "assistant", content: `[party-turn] ${HOLD}` },
    { id: "g2", role: "assistant", content: "Quiet night." },
    { id: "u1", role: "user", content: "ok" },
  ]);
  assert.deepEqual(replies, []);
  assert.deepEqual(foreignLedger({ records: [], players: [] }, "p"), []);
});

test("the prompt contributor only starts a background sync for linked Game chats", async () => {
  const { world, game, log } = await setup();
  world.say("a1", "u1", "user", "Go.");
  world.say("a1", "g1", "assistant", HOLD);
  world.say("a1", "u2", "user", "Next.");
  let contributor;
  const routes = new Map();
  await activate({
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
  assert.equal(await contributor({ mode: "roleplay", chatMeta: world.meta("a1") }), null);
  assert.equal(await contributor({ mode: "game", chatMeta: {} }), null);
  assert.equal(await contributor({ mode: "game", chatMeta: world.meta("a1") }), null);
  // The sync it started runs behind the generation; the route waits on the same queue.
  const reply = { status: () => reply, send: (body) => body };
  const view = await routes.get("POST /games/:gameId/sync")({ params: { gameId: game.id }, body: {} }, reply);
  assert.equal(view.feed.length, 1);
  assert.equal((await log()).records.length, 1);
  assert.ok(routes.has("POST /link") && routes.has("POST /unlink") && routes.has("GET /chats"));
});
