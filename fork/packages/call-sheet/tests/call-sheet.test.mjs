// node --test fork/packages/call-sheet/tests/*.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import {
  cacheStats,
  cleanOutcomes,
  cleanPlan,
  cleanUsage,
  historyMessages,
  newTurn,
  transcript,
  transcriptBudget,
} from "../sheet.mjs";
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
  rateScene,
  rerollTurn,
  storyView,
  updateSettings,
} from "../server.mjs";

/** A fake host. `replies` is a queue: an object is returned as JSON, a string as text, an Error is thrown. */
function fakeRuntime(replies, { agentFails = false } = {}) {
  const docs = new Map();
  const calls = [];
  const resolved = [];
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
    async chatComplete(messages, options = {}) {
      calls.push({
        name,
        messages: structuredClone(messages),
        cache: options.promptCache,
        maxTokens: options.maxTokens,
        signal: options.signal,
      });
      if (options.signal?.aborted) throw new Error("Request aborted");
      if (name === "agent" && agentFails) throw new Error("agent timed out");
      const next = replies.shift();
      if (typeof next === "function") return next(messages, options);
      if (next instanceof Error) throw next;
      const content = typeof next === "string" ? next : JSON.stringify(next);
      if (options.onToken) {
        for (const word of content.split(/(?<= )/u)) {
          if (options.signal?.aborted) throw new Error("Request aborted");
          await options.onToken(word);
        }
      }
      return {
        content,
        usage: { promptTokens: 100, cachedPromptTokens: 900, cacheWritePromptTokens: 0, completionTokens: 50 },
      };
    },
  });
  const runtime = {
    persistence: { documents },
    resources: {
      listCharacters: async () => [
        {
          id: "c1",
          data: {
            name: "Keeper",
            description: "Runs the inn.",
            personality: "Gruff.",
            extensions: { nameColor: "#aa0000", dialogueColor: "#ffcc00" },
          },
        },
      ],
      listPersonas: async () => [
        {
          id: "p1",
          data: { name: "Traveler", description: "A tired courier.", avatarPath: "/api/avatars/file/p1.webp" },
        },
      ],
    },
    languageModels: {
      resolve: async (id) => (resolved.push(id), model("main")),
      resolveForRequest: async () => model("agent"),
    },
    getAgentConfig: async () => null,
    json: { parseJsonish: (raw) => JSON.parse(raw) },
    logger: {},
  };
  return { runtime, calls, resolved, store: createStore(documents) };
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

test("a story runs on the connection chosen for it, else the default", async () => {
  const { runtime, store, resolved } = fakeRuntime([{ title: "A" }, { title: "B" }]);
  const story = await createStory(runtime, store, { title: "T", mainConnectionId: "claude-sub" });
  await propose(runtime, store, story.id, "");
  const plain = await createStory(runtime, store, { title: "U", mainConnectionId: " " });
  await propose(runtime, store, plain.id, "");
  assert.deepEqual(resolved, ["claude-sub", null]);
});

test("library lists the Engine's characters and personas by name with avatar paths", async () => {
  const { runtime } = fakeRuntime([]);
  assert.deepEqual(await library(runtime), {
    characters: [
      {
        id: "c1",
        name: "Keeper",
        nameColor: "#aa0000",
        dialogueColor: "#ffcc00",
        avatarPath: "/api/characters/c1/avatar",
      },
    ],
    personas: [
      { id: "p1", name: "Traveler", nameColor: "", dialogueColor: "", avatarPath: "/api/avatars/file/p1.webp" },
    ],
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
  const events = [];
  const { turns } = await playTurn(runtime, store, storyId, { kind: "instruction", text: "asks for a room" }, (e) =>
    events.push(e),
  );
  assert.deepEqual(
    events.filter((e) => e.type === "start").map((e) => e.speaker),
    ["persona", "narrator"],
  );
  assert.equal(
    events
      .filter((e) => e.type === "token")
      .map((e) => e.text)
      .join(""),
    "Traveler asks for a room.The keeper hands over a key.",
    "both turns stream",
  );
  assert.deepEqual(calls.at(-1).cache, { ttl: "1h", depth: 1 }, "scene turns ask for the long cache");
  assert.deepEqual(turns[1].usage, [{ input: 100, read: 900, write: 0, output: 50 }], "each call's usage is kept");
  const { stats } = await storyView(store, storyId);
  assert.deepEqual(Object.values(stats)[0], {
    calls: 3,
    input: 300,
    read: 2700,
    write: 0,
    output: 150,
    readShare: 0.9,
    equivalents: 570,
    warming: false,
  });
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

test("a finished scene leaves the prompt; its frozen summary stands in and can be rated", async () => {
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

  const rated = await rateScene(store, storyId, ended.sheet.scenes[0].id, 5);
  assert.equal(rated.sheet.scenes[0].rating, 5);
  assert.throws(() => rateScene(store, storyId, ended.sheet.scenes[0].id, 6), /integer from 1 to 5/u);

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
  assert.equal(result.turns[0].usage.length, 2, "a reroll's cost is counted too");
  assert.equal(result.stats.calls, 2);
  assert.equal(result.turns[0].active, 1);
  result = await editTurn(runtime, store, storyId, id, { active: 0 });
  assert.equal(result.turns[0].active, 0);
  result = await editTurn(runtime, store, storyId, id, { text: "One, edited." });
  assert.deepEqual(result.turns[0].swipes, ["One, edited.", "Two."]);
  result = await deleteTurn(runtime, store, storyId, id);
  assert.deepEqual(result.turns, []);
});

test("failures and aborts never lose work and never trap a scene", async () => {
  const ac = new AbortController();
  const { runtime, store, storyId } = await startedStory([
    "Hello.",
    "Traveler steps forward.",
    async (_messages, options) => {
      ac.abort();
      if (options.signal?.aborted) throw new Error("Aborted by user");
      return { content: "Never reached" };
    },
  ]);
  await playTurn(runtime, store, storyId, { kind: "continue" });
  await assert.rejects(
    playTurn(runtime, store, storyId, { kind: "instruction", text: "steps forward" }, undefined, ac.signal),
    /Aborted by user/u,
  );
  const { turns } = await storyView(store, storyId);
  assert.deepEqual(
    Object.values(turns)[0].map((t) => [t.speaker, t.swipes[0]]),
    [
      ["narrator", "Hello."],
      ["persona", "Traveler steps forward."],
    ],
    "when aborted during narrator reply, the impersonated persona turn stays saved",
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

test("plans, outcomes and cache usage are cleaned; history alternates; long transcripts are trimmed", () => {
  assert.deepEqual(cleanPlan({ title: " ", cast: "A\nB", evil: 1 }), {
    title: "Untitled scene",
    location: "",
    cast: ["A", "B"],
    goals: [],
    facts: [],
    opening: "",
  });
  assert.deepEqual(cleanOutcomes([{ goal: "x", status: "bogus" }], ["x"]), [{ goal: "x", status: "open" }]);

  assert.deepEqual(
    cleanUsage({
      promptTokens: 1000,
      cachedPromptTokens: 800,
      cacheWritePromptTokens: 50,
      completionTokens: 40,
      promptTokensIncludesCache: true,
    }),
    { input: 150, read: 800, write: 50, output: 40 },
  );
  const warmingStats = cacheStats([{ usage: [{ input: 450, read: 0, write: 0, output: 80 }] }]);
  assert.equal(warmingStats.warming, true);

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

test("settings: turn length shapes the prompt and budget; review stops after the player's turn", async () => {
  const { runtime, store, calls, storyId } = await startedStory(["Your turn, written.", "The reply."]);
  const updated = await updateSettings(store, storyId, { replyLength: "short", reviewTurns: true, title: "Renamed" });
  assert.equal(updated.title, "Renamed");
  assert.deepEqual(updated.settings, { replyLength: "short", reviewTurns: true });
  const kept = await updateSettings(store, storyId, { mainConnectionId: "claude-sub" });
  assert.deepEqual(kept.settings, { replyLength: "short", reviewTurns: true }, "other settings are kept");

  const reviewed = await playTurn(runtime, store, storyId, { kind: "instruction", text: "waves" });
  assert.deepEqual(
    reviewed.turns.map((t) => t.speaker),
    ["persona"],
    "with review on, only the player's turn is written",
  );
  assert.equal(calls.at(-1).maxTokens, 700);
  assert.match(calls.at(-1).messages[0].content, /Keep each turn short: one or two paragraphs\./u);
  const answered = await playTurn(runtime, store, storyId, { kind: "continue" });
  assert.deepEqual(
    answered.turns.map((t) => t.speaker),
    ["persona", "narrator"],
  );
});

test("client helpers: extractSpeakers, storyText dialogue coloring, and BUSY_ALLOWED_ACTIONS guardrails", async () => {
  globalThis.HTMLElement = class {};
  await import("../client.js");
  const { extractSpeakers, storyText, BUSY_ALLOWED_ACTIONS } = globalThis.__callSheetHelpers;

  assert.ok(BUSY_ALLOWED_ACTIONS.has("stop"), "Stop button must stay enabled while busy/streaming");
  assert.ok(BUSY_ALLOWED_ACTIONS.has("toggle-drawer"), "Scene Sheet drawer toggle must stay enabled while busy");

  const sample =
    'Rain falls. <speaker="Keeper">"Rooms are two silver,"</speaker> he says. ' +
    '<speaker="Mira">"Too steep,"</speaker> Mira replies. <speaker="keeper">"Take it or leave it."</speaker>';
  assert.deepEqual(extractSpeakers(sample), ["Keeper", "Mira"], "speakers are deduplicated case-insensitively");

  const colors = new Map([
    ["keeper", "#ffcc00"],
    ["mira", "#66ccff"],
  ]);
  const prefs = { fontSize: 16, fontColor: "", boldDialogue: true, defaultDialogueColor: "#f5c542" };
  const html = storyText(sample, colors, prefs);
  assert.match(html, /<strong style="color:#ffcc00">&quot;Rooms are two silver,&quot;<\/strong>/u);
  assert.match(html, /<strong style="color:#66ccff">&quot;Too steep,&quot;<\/strong>/u);
  assert.doesNotMatch(html, /<speaker/u, "speaker tags are stripped from rendered HTML");
});


