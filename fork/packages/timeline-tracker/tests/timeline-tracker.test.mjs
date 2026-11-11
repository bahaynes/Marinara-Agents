// node --test fork/packages/timeline-tracker/tests
import assert from "node:assert/strict";
import test from "node:test";
import { createStore, finalize, formatDuration, inherit, prepare, resolve, timelineContext } from "../server.mjs";

const msgs = (...pairs) =>
  pairs.map(([id, w = 0, role = "assistant"]) => ({ id, role, content: id, activeSwipeIndex: w }));

test("durations read the way a story would say them", () => {
  assert.equal(formatDuration(40), "40 minutes");
  assert.equal(formatDuration(300), "5 hours");
  assert.equal(formatDuration(1440 + 180), "1 day, 3 hours");
  assert.equal(formatDuration(1440 * 5), "5 days");
  assert.equal(formatDuration(1440 * 21), "3 weeks");
  assert.equal(formatDuration(1440 * 120), "4 months");
});

test("the clock sums active turns; swipes, deletes and regenerations drop their report", () => {
  const doc = {
    turns: [
      { m: "a1", w: 0, d: 0, total: 1440, start: [{ k: "SK", who: "Mira", what: "archery lessons" }] },
      { m: "a2", w: 0, d: 600 },
      { m: "a2", w: 1, d: 30 },
      { m: "a3", w: 0, d: 60, end: ["a1.0"] },
    ],
  };
  let state = resolve(doc, msgs(["a1"], ["a2"], ["a3"]));
  assert.equal(state.elapsed, 1440 + 600 + 60);
  assert.equal(state.milestones.size, 0);

  // Swipe a2 to its other version and drop a3: the lesson is open again, 30 minutes in.
  state = resolve(doc, msgs(["a1"], ["a2", 1]));
  assert.equal(state.elapsed, 1470);
  assert.equal(state.milestones.get("a1.0").at, 1440);

  // Regenerating a2: its own report is left out.
  assert.equal(resolve(doc, msgs(["a1"], ["a2"]), "a2").elapsed, 1440);
});

test("a branch keeps its parent's turns on the copied messages", () => {
  const doc = {
    turns: [
      { m: "p1", w: 0, d: 10, start: [{ k: "EV", who: "", what: "fire" }] },
      { m: "p2", w: 0, d: 5, end: ["p1.0"] },
    ],
  };
  const branch = inherit(doc, msgs(["p1"], ["p2"], ["p3"]), msgs(["b1"], ["b2"]));
  assert.deepEqual(
    branch.turns.map((t) => t.m),
    ["b1", "b2"],
  );
  assert.deepEqual(branch.turns[1].end, ["b1.0"]);
});

function fakeRuntime(messages, world = null) {
  const docs = new Map();
  let revision = 0;
  return {
    json: { parseJsonish: JSON.parse },
    logger: { info() {} },
    persistence: {
      getChat: async () => ({ id: "c" }),
      listMessages: async () => messages,
      getGameState: async () => world,
      documents: {
        getById: async (_pkg, id) => docs.get(id) ?? null,
        create: async (doc) => (docs.set(doc.id, { ...doc, revision: ++revision }), docs.get(doc.id)),
        update: async (doc) => (docs.set(doc.id, { ...doc, revision: ++revision }), docs.get(doc.id)),
      },
    },
  };
}

test("finalize stores the turn and the prompt block computes the durations", async () => {
  const messages = msgs(["u1", 0, "user"], ["a1"]);
  const runtime = fakeRuntime(messages, { date: "Tuesday, October 15", time: "2:30 PM" });
  const store = createStore(runtime);
  const context = { chatId: "c", chatMode: "roleplay", mainResponse: "a1" };

  const prepared = await prepare(runtime, store, context);
  assert.equal(prepared.firstRun, true);

  const report = {
    minutesPassed: 20,
    stated: null,
    totalElapsedMin: 1440,
    start: [{ kind: "SK", who: "Mira", what: "archery lessons" }],
  };
  const result = await finalize(runtime, store, {
    context,
    result: { success: true, data: { text: JSON.stringify(report) } },
  });
  assert.equal(result.data.text, "");
  assert.equal(result.data.diagnostics.totalMin, 1440);

  // Next turn: two more hours pass; a second report for the same message replaces the first.
  messages.push(...msgs(["u2", 0, "user"], ["a2"]));
  const second = { ...context, mainResponse: "a2" };
  await finalize(runtime, store, {
    context: second,
    result: { success: true, data: { text: '{"minutesPassed":120,"totalElapsedMin":99999}' } },
  });
  await finalize(runtime, store, {
    context: second,
    result: { success: true, data: { text: '{"minutesPassed":180}' } },
  });

  messages.push(...msgs(["u3", 0, "user"]));
  const block = await timelineContext(
    runtime,
    store,
  )({
    chatId: "c",
    mode: "roleplay",
    chatMeta: { enableAgents: true, activeAgentIds: ["timeline-tracker", "world-state"] },
  });
  assert.match(block, /Now: Tuesday, October 15, 2:30 PM\. Time since the story began: 1 day, 3 hours\./);
  assert.match(block, /Mira: archery lessons \(skill\/practice, began 3 hours ago\)/);
  assert.match(block, /lasted longer than 1 day, 3 hours/);
});

test("bad extractor output is recorded as a diagnostic, not an error", async () => {
  const runtime = fakeRuntime(msgs(["a1"]));
  const store = createStore(runtime);
  const context = { chatId: "c", chatMode: "roleplay", mainResponse: "a1" };
  const result = await finalize(runtime, store, { context, result: { success: true, data: { text: "not json" } } });
  assert.equal(result.success, true);
  assert.match(result.data.diagnostics.error, /not JSON/);
});

test("an old World State date is ignored once World State is off", async () => {
  const messages = msgs(["a1"], ["u2", 0, "user"]);
  const runtime = fakeRuntime(messages, { date: "Thursday, October 05, 1899", time: "11:13 AM" });
  const store = createStore(runtime);
  const context = { chatId: "c", chatMode: "roleplay", mainResponse: "a1" };
  await finalize(runtime, store, {
    context,
    result: { success: true, data: { text: '{"minutesPassed":5,"stated":"noon","totalElapsedMin":60}' } },
  });
  const block = await timelineContext(
    runtime,
    store,
  )({
    chatId: "c",
    mode: "roleplay",
    chatMeta: { enableAgents: true, activeAgentIds: ["timeline-tracker"] },
  });
  assert.match(block, /Now: noon\./);
  assert.equal((await prepare(runtime, store, { ...context, mainResponse: "zz" })).worldStateTime, null);
});
