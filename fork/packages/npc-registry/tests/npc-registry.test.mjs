// node --test fork/packages/npc-registry/tests
import assert from "node:assert/strict";
import test from "node:test";
import { activeSwipes, applyOps, emptyGraph, inheritGraph, nameCollision, resolve } from "../graph.mjs";
import { createStore, finalize, lookup, prepare, rosterContext } from "../server.mjs";

const msgs = (...pairs) => pairs.map(([id, w]) => ({ id, role: "assistant", content: id, activeSwipeIndex: w }));
const names = (graph, messages) => [...resolve(graph, activeSwipes(messages)).npcs.values()].map((e) => e.name);

test("set supersedes; swipes hide and restore facts; deleted messages drop NPCs", () => {
  const graph = emptyGraph();
  let messages = msgs(["m1", 0]);
  applyOps(
    graph,
    [{ op: "create", ref: "x", name: "Captain Vos", gender: "he" }],
    { m: "m1", w: 0 },
    activeSwipes(messages),
  );
  messages = msgs(["m1", 0], ["m2", 0]);
  const id = Object.keys(graph.nodes)[0];
  applyOps(graph, [{ op: "set", npc: id, field: "gender", value: "she" }], { m: "m2", w: 0 }, activeSwipes(messages));
  assert.equal(resolve(graph, activeSwipes(messages)).npcs.get(id).gender, "she");

  // Regenerate m2 (swipe 1): its fact disappears and the old one is live again.
  messages = msgs(["m1", 0], ["m2", 1]);
  assert.equal(resolve(graph, activeSwipes(messages)).npcs.get(id).gender, "he");
  // Swipe back.
  messages = msgs(["m1", 0], ["m2", 0]);
  assert.equal(resolve(graph, activeSwipes(messages)).npcs.get(id).gender, "she");
  // Delete m1: the NPC's own name assertion is gone, so the NPC is gone.
  assert.deepEqual(names(graph, msgs(["m2", 0])), []);
});

test("a backfilled older message does not override a later message's value", () => {
  const graph = emptyGraph();
  const messages = msgs(["m1", 0], ["m2", 0]);
  applyOps(graph, [{ op: "create", name: "Captain Vos", gender: "he" }], { m: "m2", w: 0 }, activeSwipes(messages));
  const id = Object.keys(graph.nodes)[0];
  applyOps(graph, [{ op: "set", npc: id, field: "gender", value: "she" }], { m: "m1", w: 0 }, activeSwipes(messages));
  assert.equal(resolve(graph, activeSwipes(messages)).npcs.get(id).gender, "he");
});

test("a manual (unanchored) fact is never overridden by the extractor", () => {
  const graph = emptyGraph();
  const swipes = activeSwipes(msgs(["m1", 0], ["m2", 0]));
  applyOps(graph, [{ op: "create", name: "Old Pruett", gender: "he" }], { m: "m1", w: 0 }, swipes);
  const id = Object.keys(graph.nodes)[0];
  const sup = graph.assertions.filter((a) => a.p === "gender").map((a) => a.id);
  graph.assertions.push({ id: "pin", s: id, p: "gender", o: "he", sup });
  applyOps(graph, [{ op: "set", npc: id, field: "gender", value: "she" }], { m: "m2", w: 0 }, swipes);
  assert.equal(resolve(graph, swipes).npcs.get(id).gender, "he");
});

test("create of a known name or alias updates the same NPC", () => {
  const graph = emptyGraph();
  const swipes = activeSwipes(msgs(["m1", 0], ["m2", 0]));
  applyOps(graph, [{ op: "create", name: "Iris Vale" }], { m: "m1", w: 0 }, swipes);
  applyOps(graph, [{ op: "create", name: "iris  vale", gender: "she" }], { m: "m2", w: 0 }, swipes);
  const all = [...resolve(graph, swipes).npcs.values()];
  assert.equal(all.length, 1);
  assert.equal(all[0].gender, "she");
});

test("excluded names (cast, persona) are never recorded", () => {
  const graph = emptyGraph();
  const swipes = activeSwipes(msgs(["m1", 0]));
  const counts = applyOps(graph, [{ op: "create", name: "Main Hero" }], { m: "m1", w: 0 }, swipes, {
    exclude: ["Main Hero"],
  });
  assert.equal(counts.applied, 0);
});

test("merge, alias and retraction; legacy trait facts are ignored", () => {
  const graph = emptyGraph();
  const swipes = activeSwipes(msgs(["m1", 0], ["m2", 0]));
  applyOps(
    graph,
    [
      { op: "create", name: "The Stranger" },
      { op: "create", name: "Doran Pike" },
    ],
    { m: "m1", w: 0 },
    swipes,
  );
  const [stranger, doran] = Object.keys(graph.nodes);
  graph.assertions.push({ id: "old", s: doran, p: "trait", o: "limps", a: { m: "m1", w: 0 } });
  applyOps(
    graph,
    [
      { op: "merge", npc: stranger, into: doran },
      { op: "add", npc: doran, field: "alias", value: "Pike" },
      { op: "retract", npc: doran, field: "alias", value: "Pike" },
    ],
    { m: "m2", w: 0 },
    swipes,
  );
  const resolved = resolve(graph, swipes);
  assert.equal(resolved.npcs.size, 1);
  assert.deepEqual(resolved.npcs.get(doran), {
    id: doran,
    name: "Doran Pike",
    aliases: ["The Stranger"],
    merged: [stranger],
  });
});

test("name collisions", () => {
  assert.equal(nameCollision("Captain Vos", "vos"), "same name");
  assert.equal(nameCollision("Elspeth", "Elsbeth"), "near-identical spelling");
  assert.match(nameCollision("Garrick Stone", "Garrick Hale"), /garrick/);
  assert.equal(nameCollision("Tomas", "Wren"), null);
});

test("branch inherits graph with anchors remapped by position", () => {
  const graph = emptyGraph();
  const parent = msgs(["p1", 0], ["p2", 0]);
  applyOps(graph, [{ op: "create", name: "Early" }], { m: "p1", w: 0 }, activeSwipes(parent));
  applyOps(graph, [{ op: "create", name: "Late" }], { m: "p2", w: 0 }, activeSwipes(parent));
  const branch = msgs(["b1", 0]); // branched after p1
  const inherited = inheritGraph(graph, parent, branch);
  assert.deepEqual(names(inherited, branch), ["Early"]);
});

function fakeRuntime(chat, messages) {
  const docs = new Map();
  return {
    json: { parseJsonish: JSON.parse },
    persistence: {
      getChat: async (id) => (id === chat.id ? chat : null),
      listMessages: async () => messages,
      documents: {
        getById: async (_p, id) => docs.get(id) ?? null,
        create: async (input) => {
          if (docs.has(input.id)) throw new Error("exists");
          const doc = { ...structuredClone(input), revision: 1 };
          docs.set(input.id, doc);
          return doc;
        },
        update: async (input) => {
          const doc = docs.get(input.id);
          if (!doc || doc.revision !== input.expectedRevision) return null; // mirrors the host
          const next = { ...doc, data: structuredClone(input.data), revision: doc.revision + 1 };
          docs.set(input.id, next);
          return next;
        },
      },
    },
  };
}

test("extractor -> store -> lookup tool and roster, end to end", async () => {
  const meta = { enableAgents: true, activeAgentIds: ["npc-registry"] };
  const chat = { id: "c1", mode: "roleplay", metadata: JSON.stringify(meta), branch: null };
  const messages = [
    { id: "u1", role: "user", content: "hi", activeSwipeIndex: 0 },
    { id: "a1", role: "assistant", content: "Old Hessa the ferrywoman nods.", activeSwipeIndex: 0 },
  ];
  const runtime = fakeRuntime(chat, messages);
  const store = createStore(runtime);
  const context = {
    chatId: "c1",
    chatMode: "roleplay",
    mainResponse: messages[1].content,
    characters: [{ name: "Hero" }],
  };
  const prepared = await prepare(store, context);
  assert.deepEqual(prepared.notNpcs, ["Hero"]);
  const ops = {
    ops: [
      { op: "create", name: "Hessa", gender: "she" },
      { op: "create", name: "Hero" },
    ],
  };
  const result = await finalize(runtime, store, {
    context,
    preparedContext: prepared,
    result: { success: true, type: "context_injection", data: { text: JSON.stringify(ops) } },
  });
  assert.equal(result.data.text, "");
  assert.equal(result.data.diagnostics.applied, 2); // Hessa name + gender; cast member skipped
  const found = await lookup(runtime, store, "c1", { name: "hessa" });
  assert.equal(found.verdict, "established");
  assert.equal(found.matches[0].gender, "she");
  const conflict = await lookup(runtime, store, "c1", { name: "Hesta" });
  assert.equal(conflict.verdict, "conflict");
  assert.equal(conflict.matches[0].name, "Hessa");
  assert.equal((await lookup(runtime, store, "c1", { name: "Bram" })).verdict, "clear");
  const roster = await rosterContext(store)({ chatId: "c1", chatMeta: meta, mode: "roleplay" });
  assert.match(roster, /Established NPCs: Hessa \(she\)$/);
  chat.metadata = "{}";
  assert.equal((await lookup(runtime, store, "c1", { name: "Hessa" })).enabled, false);
});

test("a concurrent revision bump is retried, not silently dropped", async () => {
  const meta = { enableAgents: true, activeAgentIds: ["npc-registry"] };
  const chat = { id: "c1", mode: "roleplay", metadata: meta, branch: null };
  const messages = [{ id: "a1", role: "assistant", content: "x", activeSwipeIndex: 0 }];
  const runtime = fakeRuntime(chat, messages);
  const store = createStore(runtime);
  const context = { chatId: "c1", chatMode: "roleplay", mainResponse: "x" };
  const run = (name) =>
    finalize(runtime, store, {
      context,
      preparedContext: null,
      result: {
        success: true,
        type: "context_injection",
        data: { text: JSON.stringify({ ops: [{ op: "create", name }] }) },
      },
    });
  await run("First");
  // Interleave: a second writer saves between this run's load and save.
  const { documents } = runtime.persistence;
  const realUpdate = documents.update;
  let raced = false;
  documents.update = async (input) => {
    if (!raced) {
      raced = true;
      const doc = await documents.getById("npc-registry", input.id);
      await realUpdate({ ...input, data: doc.data, expectedRevision: doc.revision });
    }
    return realUpdate(input);
  };
  await run("Second");
  const roster = await rosterContext(store)({ chatId: "c1", chatMeta: meta, mode: "roleplay" });
  assert.match(roster, /First, Second$/);
});
