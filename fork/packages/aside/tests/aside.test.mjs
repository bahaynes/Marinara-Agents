// node --test fork/packages/aside/tests/*.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { addNote, asideUserMessage, changeNote, cleanSettings, changeTurn, newNote, reorderNotes, sortNotes } from "../aside.mjs";
import { createNote, createStore, deleteTurn, editTurn, prepare, recordExchange } from "../server.mjs";

const settings = cleanSettings({});

test("aside message: instruction first, pinned notes only, earlier asides, question last", () => {
  const text = asideUserMessage({
    notes: [{ text: "pinned", pinned: true }, { text: "loose", pinned: false }],
    thread: [{ role: "user", text: "q1" }, { role: "assistant", text: "a1" }],
    question: "q2",
    settings,
  });
  assert.match(text, /^\[OUT OF CHARACTER ASIDE\]/);
  assert.match(text, /- pinned/);
  assert.doesNotMatch(text, /loose/);
  assert.ok(text.indexOf("<player_notes>") < text.indexOf("<earlier_asides>"));
  assert.match(text, /Player asked: q1\n\nYou answered: a1/);
  const q = text.indexOf("The player's question: q2");
  assert.ok(q > 0 && text.indexOf("Rules for this reply only") > q, "the rules come after the question");
  assert.match(text, /not even one line/);
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
  assert.match((await prepare(store, "c", { question: "and?" })).userMessage, /You answered: because/);
});

test("empty question or answer is rejected", async () => {
  const store = createStore(fakeDocuments());
  await assert.rejects(() => prepare(store, "c", { question: " " }), /Ask something/);
  await assert.rejects(() => recordExchange(store, "c", { question: "q", answer: "" }), /Nothing to record/);
});

test("reorderNotes follows ids, keeps unnamed notes after, ignores unknown and duplicate ids", () => {
  const notes = ["a", "b", "c", "d"].map((id) => ({ id }));
  assert.deepEqual(reorderNotes(notes, ["c", "a"]).map((n) => n.id), ["c", "a", "b", "d"]);
  assert.deepEqual(reorderNotes(notes, ["x", "b", "b"]).map((n) => n.id), ["b", "a", "c", "d"]);
  assert.deepEqual(reorderNotes(notes, undefined).map((n) => n.id), ["a", "b", "c", "d"]);
});

test("sortNotes orders once by the chosen mode; pinned-first is stable", () => {
  const notes = [
    { id: "a", text: "banana", pinned: false, createdAt: "2026-01-02" },
    { id: "b", text: "Apple", pinned: true, createdAt: "2026-01-01" },
    { id: "c", text: "cherry", pinned: true, createdAt: "2026-01-03" },
  ];
  const ids = (mode) => sortNotes(notes, mode).map((n) => n.id);
  assert.deepEqual(ids("newest"), ["c", "a", "b"]);
  assert.deepEqual(ids("oldest"), ["b", "a", "c"]);
  assert.deepEqual(ids("alpha"), ["b", "a", "c"]);
  assert.deepEqual(ids("pinned"), ["b", "c", "a"]);
  assert.deepEqual(ids("bogus"), ["a", "b", "c"]);
});

test("side-thread messages can be edited and deleted", async () => {
  assert.equal(changeTurn([{ id: "t", text: "x" }], "t", "  "), null);
  const store = createStore(fakeDocuments());
  const { thread } = await recordExchange(store, "c", { question: "q", answer: "a" });
  const edited = await editTurn(store, "c", thread[1].id, { text: "fixed" });
  assert.deepEqual(edited.thread.map((t) => t.text), ["q", "fixed"]);
  await assert.rejects(() => editTurn(store, "c", "missing", { text: "x" }), /not found/);
  const left = await deleteTurn(store, "c", thread[0].id);
  assert.deepEqual(left.thread.map((t) => t.text), ["fixed"]);
  assert.match((await prepare(store, "c", { question: "next" })).userMessage, /You answered: fixed/);
});
