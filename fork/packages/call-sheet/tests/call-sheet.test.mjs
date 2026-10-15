// node --test fork/packages/call-sheet/tests/*.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { cleanOutcomes, cleanPlan, emptySheet, idsBefore, sceneMessages, sheetContext } from "../sheet.mjs";
import { acceptScene, createStore, endScene, promptContributor, propose } from "../server.mjs";

function fakeRuntime(replies) {
  const docs = new Map();
  const messages = [];
  const calls = [];
  const persistence = {
    async getChat(id) {
      return { id, mode: "roleplay", characterIds: ["c1"], personaId: "p1", connectionId: "main" };
    },
    async listMessages() {
      return messages.map((m) => ({ ...m }));
    },
    withChatLock: (_id, work) => work(),
    documents: {
      async getById(_pkg, id) {
        return docs.get(id) ?? null;
      },
      async create(input) {
        const doc = { ...structuredClone(input), revision: 1 };
        docs.set(input.id, doc);
        return doc;
      },
      async update(input) {
        const doc = docs.get(input.id);
        if (!doc || doc.revision !== input.expectedRevision) return null;
        const next = { ...doc, data: structuredClone(input.data), revision: doc.revision + 1 };
        docs.set(input.id, next);
        return next;
      },
    },
  };
  const model = (name) => ({
    async chatComplete(prompt) {
      calls.push({ name, prompt });
      return { content: JSON.stringify(replies.shift()) };
    },
  });
  const runtime = {
    persistence,
    resources: {
      listCharacters: async () => [{ id: "c1", data: { name: "Keeper", description: "Runs the inn." } }],
      listPersonas: async () => [{ id: "p1", data: { name: "Traveler" } }],
    },
    languageModels: { resolve: async () => model("main"), resolveForRequest: async () => model("agent") },
    getAgentConfig: async () => null,
    json: { parseJsonish: (raw) => JSON.parse(raw) },
    logger: {},
  };
  return { runtime, messages, calls };
}

const meta = { enableAgents: true, activeAgentIds: ["call-sheet"] };

test("a scene runs from proposal to frozen summary, and its messages leave the prompt", async () => {
  const plan1 = { title: "Arrival", location: "The inn", cast: ["Keeper"], goals: ["Get a room", "Learn the rumor"] };
  const plan2 = { title: "Night", location: "Upstairs", cast: ["Keeper"], goals: ["Survive the night"] };
  const { runtime, messages, calls } = fakeRuntime([
    plan1,
    { summary: "The traveler took a room and heard of the wolf.", goals: [{ goal: "reworded", status: "met" }] },
    plan2,
  ]);
  const store = createStore(runtime.persistence);
  const context = promptContributor(store);
  messages.push({ id: "m0", role: "assistant", characterId: "c1", content: "Welcome." });

  let sheet = await propose(runtime, store, "chat", "They arrive at dusk");
  assert.equal(sheet.proposal.plans.length, 1);
  assert.equal(calls[0].name, "main");
  assert.match(calls[0].prompt[1].content, /They arrive at dusk/u);
  assert.match(calls[0].prompt[1].content, /Keeper: Runs the inn\./u);

  const accepted = await acceptScene(runtime, store, "chat", sheet.proposal.plans[0]);
  assert.deepEqual(accepted.hideMessageIds, ["m0"], "the greeting before the first scene leaves the prompt");
  assert.equal(accepted.sheet.proposal, null);

  const turnText = await context({ chatId: "chat", chatMeta: meta, mode: "roleplay" });
  assert.match(turnText, /## Current scene: Arrival/u);
  assert.equal(await context({ chatId: "chat", chatMeta: meta, mode: "roleplay" }), turnText, "stable between turns");
  assert.equal(await context({ chatId: "chat", chatMeta: {}, mode: "roleplay" }), null, "off unless the agent is on");

  messages.push(
    { id: "m1", role: "user", characterId: null, content: "A room, please." },
    { id: "m2", role: "assistant", characterId: "c1", content: "Mind the wolf." },
  );
  sheet = await endScene(runtime, store, "chat");
  assert.equal(calls[1].name, "agent");
  assert.match(calls[1].prompt[1].content, /Traveler: A room, please\./u);
  assert.doesNotMatch(calls[1].prompt[1].content, /Welcome\./u, "only the scene's own messages are summarized");
  assert.equal(sheet.scenes[0].endMessageId, "m2");
  assert.deepEqual(sheet.scenes[0].outcomes, [
    { goal: "Get a room", status: "met" },
    { goal: "Learn the rumor", status: "open" },
  ]);
  assert.equal(await context({ chatId: "chat", chatMeta: meta, mode: "roleplay" }), null, "no scene in play");

  sheet = await propose(runtime, store, "chat", "");
  const next = await acceptScene(runtime, store, "chat", sheet.proposal.plans[0]);
  assert.deepEqual(next.hideMessageIds, ["m0", "m1", "m2"]);
  const later = await context({ chatId: "chat", chatMeta: meta, mode: "roleplay" });
  assert.match(later, /### Scene 1: Arrival\nThe traveler took a room/u);
  assert.match(later, /## Current scene: Night/u);
});

test("a second scene cannot start while one is in play, and rerolls keep earlier proposals", async () => {
  const { runtime } = fakeRuntime([{ title: "A" }, { title: "B" }, { title: "C" }]);
  const store = createStore(runtime.persistence);
  await propose(runtime, store, "chat", "x");
  const sheet = await propose(runtime, store, "chat", "x");
  assert.deepEqual(
    sheet.proposal.plans.map((p) => p.title),
    ["A", "B"],
  );
  await acceptScene(runtime, store, "chat", sheet.proposal.plans[1]);
  await assert.rejects(acceptScene(runtime, store, "chat", { title: "D" }), /End the current scene/u);
});

test("plans are cleaned and scene ranges survive a deleted anchor", () => {
  assert.deepEqual(cleanPlan({ title: " ", cast: "A\nB", evil: 1 }), {
    title: "Untitled scene",
    location: "",
    cast: ["A", "B"],
    goals: [],
    facts: [],
    opening: "",
  });
  const msgs = ["a", "b", "c"].map((id) => ({ id }));
  assert.deepEqual(
    sceneMessages({ startAfterMessageId: "a", endMessageId: null }, msgs).map((m) => m.id),
    ["b", "c"],
  );
  assert.deepEqual(sceneMessages({ startAfterMessageId: "gone", endMessageId: null }, msgs).length, 3);
  assert.deepEqual(idsBefore(msgs, "b"), ["a", "b"]);
  assert.deepEqual(cleanOutcomes([{ goal: "x", status: "bogus" }], ["x"]), [{ goal: "x", status: "open" }]);
  assert.equal(sheetContext(emptySheet()), null);
});
