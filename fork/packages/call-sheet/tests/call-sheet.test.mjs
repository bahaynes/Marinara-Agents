// node --test fork/packages/call-sheet/tests/*.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanOutcomes,
  cleanPlan,
  emptySheet,
  idsSince,
  sceneMessages,
  sheetContext,
  transcript,
  transcriptBudget,
} from "../sheet.mjs";
import { acceptScene, createStore, endScene, promptContributor, propose } from "../server.mjs";

function fakeRuntime(replies, { agentFails = false } = {}) {
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
    maxContext: null,
    async chatComplete(prompt) {
      calls.push({ name, prompt });
      if (name === "agent" && agentFails) throw new Error("agent timed out");
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
const say = (id, role, content) => ({ id, role, characterId: role === "user" ? null : "c1", content });

test("a scene runs from proposal to frozen summary; only played scenes leave the prompt", async () => {
  const plan1 = { title: "Arrival", location: "The inn", cast: ["Keeper"], goals: ["Get a room", "Learn the rumor"] };
  const plan2 = { title: "Night", location: "Upstairs", cast: ["Keeper"], goals: ["Survive the night"] };
  const { runtime, messages, calls } = fakeRuntime([
    plan1,
    { summary: "The traveler took a room and heard of the wolf.", goals: [{ goal: "reworded", status: "met" }] },
    plan2,
  ]);
  const store = createStore(runtime.persistence);
  const context = promptContributor(store);
  // An ongoing chat: this history predates Call Sheet and must stay in the prompt.
  messages.push(say("old1", "assistant", "Welcome."), say("old2", "user", "Hello."));

  let sheet = await propose(runtime, store, "chat", "They arrive at dusk");
  assert.equal(sheet.proposal.plans.length, 1);
  assert.equal(calls[0].name, "main");
  assert.match(calls[0].prompt[1].content, /They arrive at dusk/u);
  assert.match(calls[0].prompt[1].content, /Keeper: Runs the inn\./u);

  const first = await acceptScene(runtime, store, "chat", sheet.proposal.plans[0]);
  assert.deepEqual(first.hideMessageIds, [], "the first scene hides nothing");
  assert.equal(first.sheet.proposal, null);

  const turnText = await context({ chatId: "chat", chatMeta: meta, mode: "roleplay" });
  assert.match(turnText, /## Current scene: Arrival/u);
  assert.equal(await context({ chatId: "chat", chatMeta: meta, mode: "roleplay" }), turnText, "stable between turns");
  assert.equal(await context({ chatId: "chat", chatMeta: {}, mode: "roleplay" }), null, "off unless the agent is on");

  messages.push(say("m1", "user", "A room, please."), say("m2", "assistant", "Mind the wolf."));
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
  const second = await acceptScene(runtime, store, "chat", sheet.proposal.plans[0]);
  assert.deepEqual(second.hideMessageIds, ["m1", "m2"], "the finished scene leaves; older history stays");
  const later = await context({ chatId: "chat", chatMeta: meta, mode: "roleplay" });
  assert.match(later, /### Scene 1: Arrival\nThe traveler took a room/u);
  assert.match(later, /## Current scene: Night/u);
});

test("a scene still ends when the agent model fails: the main model writes the summary", async () => {
  const { runtime, messages, calls } = fakeRuntime(
    [
      { title: "A", goals: ["x"] },
      { summary: "Done.", goals: [] },
    ],
    {
      agentFails: true,
    },
  );
  const store = createStore(runtime.persistence);
  const sheet = await propose(runtime, store, "chat", "");
  await acceptScene(runtime, store, "chat", sheet.proposal.plans[0]);
  messages.push(say("m1", "user", "Go."));
  const ended = await endScene(runtime, store, "chat");
  assert.deepEqual(
    calls.map((c) => c.name),
    ["main", "agent", "main"],
  );
  assert.equal(ended.scenes[0].summary, "Done.");
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

test("plans are cleaned, scene ranges survive a deleted anchor, long transcripts are trimmed", () => {
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
  assert.equal(sceneMessages({ startAfterMessageId: "gone", endMessageId: null }, msgs).length, 3);
  assert.deepEqual(idsSince(msgs, "a"), ["b", "c"]);
  assert.deepEqual(idsSince(msgs, null), ["a", "b", "c"], "a chat that started empty: every message is a scene's");
  assert.deepEqual(idsSince(msgs, "gone"), [], "a deleted anchor never hides older history");
  assert.deepEqual(cleanOutcomes([{ goal: "x", status: "bogus" }], ["x"]), [{ goal: "x", status: "open" }]);
  assert.equal(sheetContext(emptySheet()), null);

  const names = { persona: "P", characters: new Map() };
  const long = Array.from({ length: 10 }, (_, i) => ({
    id: `t${i}`,
    role: "user",
    content: `turn ${i} ${"x".repeat(90)}`,
  }));
  const cut = transcript(long, names, 500);
  assert.ok(cut.length < 700);
  assert.match(cut, /^\[The first \d+ turns of this scene are left out for length\.\]/u);
  assert.match(cut, /turn 9/u, "the newest turns are kept");
  assert.equal(transcriptBudget(null, 1500), Infinity);
});
