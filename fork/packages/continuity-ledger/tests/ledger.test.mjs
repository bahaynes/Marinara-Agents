// node --test fork/packages/continuity-ledger/tests/*.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { applyOps, blockShown, emptyLedger, inScene, render, resolve } from "../ledger.mjs";
import { anchorFor, createStore, finalize, ledgerContext } from "../server.mjs";

const msg = (id, role, content, w = 0) => ({ id, role, content, activeSwipeIndex: w });

test("milestones and secrets follow their swipe; tell and end apply; filters drop junk", () => {
  const ledger = emptyLedger();
  const messages = [msg("m1", "user", "Ana kisses Ben."), msg("m2", "assistant", "They confess.")];
  const counts = applyOps(
    ledger,
    [
      { op: "milestone", who: ["Ana", "Ben"], text: "became lovers" },
      { op: "secret", who: ["Ana"], text: "Ana is the heir" },
      { op: "secret", who: [], text: "nobody knows" },
      { op: "tell", item: "e9", who: ["Ben"] },
      { op: "nonsense" },
    ],
    { m: "m2", w: 0 },
    messages,
  );
  assert.deepEqual(counts, { applied: 2, skipped: 3 });
  applyOps(ledger, [{ op: "tell", item: "[e2] heir", who: ["Ben", "Ana"] }], { m: "m2", w: 0 }, messages);
  const items = resolve(ledger, messages);
  assert.equal(items.length, 2);
  assert.deepEqual(items.find((i) => i.kind === "secret").who, ["Ana", "Ben"]);
  assert.equal(items[0].since, 2);
  // Swiping m2 hides everything it added; swiping back restores it.
  assert.equal(resolve(ledger, [messages[0], { ...messages[1], activeSwipeIndex: 1 }]).length, 0);
  assert.equal(resolve(ledger, messages).length, 2);
  applyOps(ledger, [{ op: "end", item: "e1" }], { m: "m2", w: 0 }, messages);
  assert.deepEqual(
    resolve(ledger, messages).map((i) => i.id),
    ["e2"],
  );
});

test("in scene by name mention; rendered with age; deterministic arm", () => {
  const items = [
    { id: "e1", kind: "milestone", text: "became lovers", who: ["Ana", "Ben"], since: 10 },
    { id: "e2", kind: "secret", text: "Cara stole the key", who: ["Cara"], since: 4 },
  ];
  const messages = [msg("a", "user", "Ana waits."), msg("b", "assistant", "Ben arrives.")];
  const scene = inScene(items, messages);
  assert.deepEqual(
    scene.map((i) => i.id),
    ["e1"],
  );
  const full = [
    { ...items[1], who: ["Cara Vale"] },
    { ...items[0], id: "e3", who: ["Ana"] },
  ];
  const town = [msg("c", "assistant", "Cara waits. A banana rots.")];
  assert.deepEqual(
    inScene(full, town).map((i) => i.id),
    ["e2"],
  );
  const commas = emptyLedger();
  applyOps(commas, [{ op: "secret", who: ["Ana, Ben"], text: "x" }], { m: "a", w: 0 }, messages);
  assert.deepEqual(commas.entries[0].who, ["Ana", "Ben"]);
  const block = render(scene, 40);
  assert.match(block, /Since M10, 30 messages ago: Ana, Ben: became lovers\. Before that, this was not so\./);
  assert.equal(render([], 40), null);
  assert.equal(blockShown("c", "b", 0.5), blockShown("c", "b", 0.5));
  assert.equal(blockShown("c", "b", 0), false);
  assert.equal(blockShown("c", "b", 1), true);
});

function fakeRuntime(messages) {
  const docs = new Map();
  const runtime = {
    answer: "no",
    asked: 0,
    getAgentConfig: async () => ({ connectionId: "local", settings: {} }),
    languageModels: {
      resolve: async () => ({ chatComplete: async () => ((runtime.asked += 1), { content: runtime.answer }) }),
    },
    json: { parseJsonish: (text) => JSON.parse(text) },
    persistence: {
      listMessages: async () => messages,
      documents: {
        getById: async (_p, id) => docs.get(id) ?? null,
        create: async (doc) => (docs.set(doc.id, { ...doc, revision: 1 }), docs.get(doc.id)),
        update: async (doc) => {
          const old = docs.get(doc.id);
          if (!old || old.revision !== doc.expectedRevision) return null;
          docs.set(doc.id, { ...doc, revision: old.revision + 1 });
          return docs.get(doc.id);
        },
      },
    },
    docs,
  };
  return runtime;
}

test("finalize logs the arm and contradictions the narrator faced, then applies ops once", async () => {
  const messages = [msg("u1", "user", "Ana and Ben."), msg("a1", "assistant", "They confess their love.")];
  const runtime = fakeRuntime(messages);
  const store = createStore(runtime);
  const context = { chatId: "c1", chatMode: "roleplay", mainResponse: "They confess their love." };
  const result = (ops, contradicts = []) => ({ success: true, data: { text: JSON.stringify({ ops, contradicts }) } });

  await finalize(runtime, store, {
    context,
    result: result([{ op: "milestone", who: ["Ana", "Ben"], text: "became lovers" }]),
  });
  const repeat = await finalize(runtime, store, {
    context,
    result: result([{ op: "milestone", who: ["X"], text: "y" }]),
  });
  assert.equal(repeat.data.diagnostics.repeat, true);

  messages.push(msg("u2", "user", "Ana smiles at Ben."), msg("a2", "assistant", "Ben recalls their years together."));
  runtime.answer = "Yes.";
  await finalize(runtime, store, {
    context: { ...context, mainResponse: "Ben recalls their years together." },
    result: result([]),
  });
  const { ledger } = await store.load("c1");
  assert.equal(ledger.entries.length, 1);
  assert.equal(ledger.log.length, 1);
  const row = ledger.log[0];
  assert.equal(row.m, "a2");
  assert.deepEqual(row.items, ["e1"]);
  assert.deepEqual(row.contradicted, ["e1"]);
  assert.equal(row.arm, blockShown("c1", "u2", 0.5) ? "on" : "off");
});

test("prompt contributor is gated on the agent and agrees with the logged arm", async () => {
  const messages = [msg("u1", "user", "Ana and Ben."), msg("a1", "assistant", "They confess.")];
  const runtime = fakeRuntime(messages);
  const store = createStore(runtime);
  await finalize(runtime, store, {
    context: { chatId: "c2", chatMode: "roleplay", mainResponse: "They confess." },
    result: {
      success: true,
      data: { text: '{"ops":[{"op":"milestone","who":["Ana","Ben"],"text":"became lovers"}]}' },
    },
  });
  const contribute = ledgerContext(runtime, store);
  const on = { enableAgents: true, activeAgentIds: ["continuity-ledger"] };
  const text = await contribute({ chatId: "c2", chatMeta: on, mode: "roleplay" });
  assert.equal(text !== null, blockShown("c2", "a1", 0.5));
  if (text) assert.match(text, /<story_ledger>/);
  assert.equal(await contribute({ chatId: "c2", chatMeta: { ...on, activeAgentIds: [] }, mode: "roleplay" }), null);
});

test("anchor: impersonated persona message counts; falls back to the last assistant", () => {
  const messages = [msg("a1", "assistant", "Hi."), msg("u1", "user", "I whisper to Ben.")];
  assert.equal(anchorFor(messages, "I whisper to Ben.").anchor.m, "u1");
  assert.equal(anchorFor(messages, "").anchor.m, "a1");
});

test("player turn: impersonated messages without their own run; same before and after the reply is saved", async () => {
  const { playerTurn } = await import("../ledger.mjs");
  const before = [msg("a1", "assistant", "Hi."), msg("u1", "user", "I confess."), msg("u2", "user", "I kiss him.")];
  const after = [...before, msg("a2", "assistant", "He kisses back.")];
  assert.deepEqual(playerTurn(after, "He kisses back.", { m: "a1", w: 0 }), ["I confess.", "I kiss him."]);
  assert.deepEqual(playerTurn(before, null, { m: "a1", w: 0 }), ["I confess.", "I kiss him."]);
  // Agents not blocked: u2 had its own run, so only what follows it counts.
  assert.deepEqual(playerTurn(after, "He kisses back.", { m: "u2", w: 0 }), []);
  // The run on an impersonated message itself: the message is the reply, not the player turn.
  assert.deepEqual(playerTurn(before, "I kiss him.", { m: "u1", w: 0 }), []);
});

test("judge questions: two wordings per milestone, one per secret; yes parsing", async () => {
  const { judgeQuestions, isYes } = await import("../ledger.mjs");
  const milestone = { id: "e1", kind: "milestone", text: "became lovers", who: ["Ana", "Ben"], since: 10 };
  const qs = judgeQuestions(milestone, 30);
  assert.equal(qs.length, 2);
  assert.match(qs[0], /20 messages ago/);
  assert.equal(judgeQuestions({ ...milestone, kind: "secret", who: ["Ana"] }, 30).length, 1);
  assert.equal(isYes("Yes."), true);
  assert.equal(isYes("no"), false);
  assert.equal(isYes("yesterday"), false);
});
