// node --test fork/packages/call-sheet/tests/*.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { cleanOutcomes, cleanPlan, historyMessages, newTurn, transcript, transcriptBudget } from "../sheet.mjs";
import {
  acceptScene,
  createStore,
  createStory,
  deleteTurn,
  editTurn,
  endScene,
  library,
  playTurn,
  propose,
  rerollTurn,
  storyView,
} from "../server.mjs";

/** A fake host. `replies` is a queue: an object is returned as JSON, a string as text, an Error is thrown. */
function fakeRuntime(replies, { agentFails = false } = {}) {
  const docs = new Map();
  const calls = [];
  const documents = {
    async list(_pkg, kind) {
      return [...docs.values()].filter((d) => d.kind === kind);
    },
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
      const next = {
        ...doc,
        data: structuredClone(input.data),
        updatedAt: input.updatedAt,
        revision: doc.revision + 1,
      };
      docs.set(input.id, next);
      return next;
    },
    async remove(_pkg, id, revision) {
      if (docs.get(id)?.revision !== revision) return false;
      return docs.delete(id);
    },
  };
  const model = (name) => ({
    maxContext: null,
    fitContext: (messages) => ({ messages }),
    async chatComplete(messages) {
      calls.push({ name, messages: structuredClone(messages) });
      if (name === "agent" && agentFails) throw new Error("agent timed out");
      const next = replies.shift();
      if (next instanceof Error) throw next;
      return { content: typeof next === "string" ? next : JSON.stringify(next) };
    },
  });
  const runtime = {
    persistence: { documents },
    resources: {
      listCharacters: async () => [
        { id: "c1", data: { name: "Keeper", description: "Runs the inn.", personality: "Gruff." } },
      ],
      listPersonas: async () => [{ id: "p1", data: { name: "Traveler", description: "A tired courier." } }],
    },
    languageModels: { resolve: async () => model("main"), resolveForRequest: async () => model("agent") },
    getAgentConfig: async () => null,
    json: { parseJsonish: (raw) => JSON.parse(raw) },
    logger: {},
  };
  return { runtime, calls, store: createStore(documents) };
}

async function startedStory(replies, options) {
  const host = fakeRuntime(
    [{ title: "Arrival", location: "The inn", cast: ["Keeper"], goals: ["Get a room"] }, ...replies],
    options,
  );
  const story = await createStory(host.runtime, host.store, {
    title: "Test",
    personaId: "p1",
    characterIds: ["c1"],
    premise: "A courier reaches an inn.",
  });
  const proposed = await propose(host.runtime, host.store, story.id, "They arrive at dusk");
  await acceptScene(host.store, story.id, proposed.sheet.proposal.plans[0]);
  return { ...host, storyId: story.id };
}

test("library lists the Engine's characters and personas by name", async () => {
  const { runtime } = fakeRuntime([]);
  assert.deepEqual(await library(runtime), {
    characters: [{ id: "c1", name: "Keeper" }],
    personas: [{ id: "p1", name: "Traveler" }],
  });
});

test("every job in a scene shares one prefix; the player's instruction becomes the persona's turn", async () => {
  const { runtime, store, calls, storyId } = await startedStory([
    "The inn is warm.",
    "Traveler asks for a room.",
    "The keeper hands over a key.",
  ]);
  assert.match(calls[0].messages[1].content, /They arrive at dusk/u, "the planner gets the direction");

  await playTurn(runtime, store, storyId, { kind: "continue" });
  const { turns } = await playTurn(runtime, store, storyId, { kind: "instruction", text: "asks for a room" });
  assert.deepEqual(
    turns.map((t) => [t.speaker, t.swipes[0]]),
    [
      ["narrator", "The inn is warm."],
      ["persona", "Traveler asks for a room."],
      ["narrator", "The keeper hands over a key."],
    ],
  );
  assert.equal(turns[1].instruction, "asks for a room");

  const [opening, impersonate, reply] = calls.slice(1).map((c) => c.messages);
  const system = opening[0].content;
  assert.match(system, /The player plays Traveler/u);
  assert.match(system, /### Keeper\nRuns the inn\.\nPersonality: Gruff\./u);
  assert.match(system, /A courier reaches an inn\./u);
  assert.match(system, /## Current scene \(1\): Arrival/u);
  assert.equal(impersonate[0].content, system, "the system block is identical across a scene's jobs");
  assert.equal(reply[0].content, system);
  assert.match(
    impersonate.at(-1).content,
    /Write Traveler's next turn from the player's instruction: asks for a room/u,
  );
  // The reply's prompt repeats the impersonate prompt up to the newest turn: only the tail differs.
  assert.deepEqual(reply.slice(0, 3), impersonate.slice(0, 3));
  assert.deepEqual(reply.at(-1), { role: "user", content: "Traveler: Traveler asks for a room." });
});

test("a finished scene leaves the prompt; its frozen summary stands in", async () => {
  const { runtime, store, calls, storyId } = await startedStory([
    "The inn is warm.",
    { summary: "The courier took a room.", goals: [{ goal: "reworded", status: "met" }] },
    { title: "Night", location: "Upstairs", cast: ["Keeper"] },
    "Night falls.",
  ]);
  await playTurn(runtime, store, storyId, { kind: "continue" });
  const ended = await endScene(runtime, store, storyId);
  assert.equal(calls.at(-1).name, "agent");
  assert.deepEqual(ended.sheet.scenes[0].outcomes, [{ goal: "Get a room", status: "met" }]);

  const next = await propose(runtime, store, storyId, "");
  assert.match(calls.at(-1).messages[1].content, /End of the last scene:\nNarrator: The inn is warm\./u);
  await acceptScene(store, storyId, next.sheet.proposal.plans[0]);
  await playTurn(runtime, store, storyId, { kind: "continue" });
  const prompt = calls.at(-1).messages;
  assert.match(prompt[0].content, /### Scene 1: Arrival\nThe courier took a room\./u);
  assert.match(prompt[0].content, /## Current scene \(2\): Night/u);
  assert.doesNotMatch(JSON.stringify(prompt), /The inn is warm/u, "the old scene's turns are gone");

  const view = await storyView(store, storyId);
  assert.equal(view.story.sheet.scenes.length, 2);
  assert.equal(Object.values(view.turns).flat().length, 2);
});

test("reroll keeps earlier versions; edit, version pick and delete rewrite the open scene", async () => {
  const { runtime, store, storyId } = await startedStory(["One.", "Two."]);
  const first = await playTurn(runtime, store, storyId, { kind: "continue" });
  const id = first.turns[0].id;
  let result = await rerollTurn(runtime, store, storyId, id);
  assert.deepEqual(result.turns[0].swipes, ["One.", "Two."]);
  assert.equal(result.turns[0].active, 1);
  result = await editTurn(runtime, store, storyId, id, { active: 0 });
  assert.equal(result.turns[0].active, 0);
  result = await editTurn(runtime, store, storyId, id, { text: "One, edited." });
  assert.deepEqual(result.turns[0].swipes, ["One, edited.", "Two."]);
  result = await deleteTurn(runtime, store, storyId, id);
  assert.deepEqual(result.turns, []);
});

test("failures never lose work and never trap a scene", async () => {
  const { runtime, store, storyId } = await startedStory(["Hello.", new Error("provider down")]);
  await playTurn(runtime, store, storyId, { kind: "continue" });
  await assert.rejects(playTurn(runtime, store, storyId, { kind: "written", text: "I sit down." }), /provider down/u);
  const { turns } = await storyView(store, storyId);
  assert.deepEqual(
    Object.values(turns)[0].map((t) => t.swipes[0]),
    ["Hello.", "I sit down."],
    "the player's turn was saved before the reply failed",
  );

  const fallback = await startedStory(["Hello.", { summary: "Done.", goals: [] }], { agentFails: true });
  await playTurn(fallback.runtime, fallback.store, fallback.storyId, { kind: "continue" });
  const ended = await endScene(fallback.runtime, fallback.store, fallback.storyId);
  assert.deepEqual(
    fallback.calls.slice(-2).map((c) => c.name),
    ["agent", "main"],
  );
  assert.equal(ended.sheet.scenes[0].summary, "Done.");
  await assert.rejects(
    acceptScene(fallback.store, fallback.storyId, { title: "X" }).then(() =>
      acceptScene(fallback.store, fallback.storyId, { title: "Y" }),
    ),
    /End the current scene/u,
  );
});

test("plans and outcomes are cleaned; history alternates; long transcripts are trimmed", () => {
  assert.deepEqual(cleanPlan({ title: " ", cast: "A\nB", evil: 1 }), {
    title: "Untitled scene",
    location: "",
    cast: ["A", "B"],
    goals: [],
    facts: [],
    opening: "",
  });
  assert.deepEqual(cleanOutcomes([{ goal: "x", status: "bogus" }], ["x"]), [{ goal: "x", status: "open" }]);

  const persona = { name: "P" };
  const history = historyMessages(
    [newTurn("narrator", "a"), newTurn("narrator", "b"), newTurn("persona", "c")],
    persona,
  );
  assert.deepEqual(
    history.map((m) => [m.role, m.content]),
    [
      ["user", "(The scene begins.)"],
      ["assistant", "a\n\nb"],
      ["user", "P: c"],
    ],
  );

  const long = Array.from({ length: 10 }, (_, i) => newTurn("persona", `turn ${i} ${"x".repeat(90)}`));
  const cut = transcript(long, persona, 500);
  assert.ok(cut.length < 700);
  assert.match(cut, /^\[The first \d+ turns of this scene are left out for length\.\]/u);
  assert.match(cut, /turn 9/u, "the newest turns are kept");
  assert.equal(transcriptBudget(null, 1500), Infinity);
});
