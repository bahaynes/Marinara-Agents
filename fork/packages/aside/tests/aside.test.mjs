// node --test fork/packages/aside/tests/*.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { addNote, asideUserMessage, changeNote, cleanSettings, newNote } from "../aside.mjs";
import { createNote, createStore, prepare, recordExchange } from "../server.mjs";

const settings = cleanSettings({});

test("aside message: instruction first, pinned notes only, earlier asides, question last", () => {
  const text = asideUserMessage({
    notes: [{ text: "pinned", pinned: true }, { text: "loose", pinned: false }],
    thread: [{ role: "user", text: "q1" }, { role: "assistant", text: "a1" }],
    question: "q2",
    settings,
  });
  assert.match(text, /^Out-of-character aside/);
  assert.match(text, /- pinned/);
  assert.doesNotMatch(text, /loose/);
  assert.ok(text.indexOf("<player_notes>") < text.indexOf("<earlier_asides>"));
  assert.match(text, /Player: q1\n\nNarrator: a1/);
  assert.ok(text.endsWith("Question: q2"));
});

test("threadTurns caps the earlier asides sent", () => {
  const thread = Array.from({ length: 6 }, (_, i) => ({ role: "user", text: `t${i}` }));
  const text = asideUserMessage({ notes: [], thread, question: "q", settings: { ...settings, threadTurns: 2 } });
  assert.doesNotMatch(text, /t3/);
  assert.match(text, /t4/);
});

test("notes: add, edit, pin, empty text rejected", () => {
  assert.equal(newNote("  "), null);
  const note = newNote("hello");
  const notes = addNote([], note);
  changeNote(notes, note.id, { text: "changed", pinned: true });
  assert.deepEqual([notes[0].text, notes[0].pinned], ["changed", true]);
  assert.equal(changeNote(notes, "missing", {}), null);
});

function fakeDocuments() {
  const docs = new Map();
  return {
    async getById(_p, id) { return docs.get(id) ?? null; },
    async create(doc) { const d = { ...doc, revision: 1 }; docs.set(doc.id, d); return d; },
    async update(doc) { const d = { ...doc, revision: docs.get(doc.id).revision + 1 }; docs.set(doc.id, d); return d; },
  };
}

test("prepare builds the message from stored notes and thread; recordExchange keeps the exchange", async () => {
  const store = createStore(fakeDocuments());
  await createNote(store, "c", { text: "n" });
  await store.update("c", (d) => { d.notes[0].pinned = true; });
  const first = await prepare(store, "c", { question: "why?" });
  assert.match(first.userMessage, /- n/);
  assert.equal(first.connectionId, null);
  const view = await recordExchange(store, "c", { question: "why?", answer: "because" });
  assert.deepEqual(view.thread.map((t) => t.text), ["why?", "because"]);
  assert.match((await prepare(store, "c", { question: "and?" })).userMessage, /Narrator: because/);
});

test("empty question or answer is rejected", async () => {
  const store = createStore(fakeDocuments());
  await assert.rejects(() => prepare(store, "c", { question: " " }), /Ask something/);
  await assert.rejects(() => recordExchange(store, "c", { question: "q", answer: "" }), /Nothing to record/);
});
