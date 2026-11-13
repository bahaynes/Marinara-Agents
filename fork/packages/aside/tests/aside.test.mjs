// node --test fork/packages/aside/tests/*.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { addNote, asideMessages, changeNote, cleanSettings, newNote } from "../aside.mjs";
import { ask, createNote, createStore } from "../server.mjs";

const settings = cleanSettings({});

test("context order is stable prefix first, newest question last, labels follow the stored role", () => {
  const messages = asideMessages({
    persona: "P",
    characters: ["C"],
    messages: [
      { role: "assistant", content: "scene" },
      { role: "user", content: "written as the character" }, // impersonate: still a user message
    ],
    notes: [{ text: "pinned", pinned: true }, { text: "loose", pinned: false }],
    thread: [{ role: "user", text: "q1" }, { role: "assistant", text: "a1" }],
    question: "q2",
    settings,
  });
  assert.equal(messages[0].role, "system");
  const system = messages[0].content;
  assert.ok(system.indexOf("<story_so_far>") < system.indexOf("<player_notes>"));
  assert.match(system, /Narrator: scene/);
  assert.match(system, /P: written as the character/);
  assert.match(system, /- pinned/);
  assert.doesNotMatch(system, /loose/);
  assert.deepEqual(messages.slice(1).map((m) => m.content), ["q1", "a1", "q2"]);
});

test("recentMessages caps the story shown", () => {
  const msgs = Array.from({ length: 5 }, (_, i) => ({ role: "assistant", content: `m${i}` }));
  const out = asideMessages({ persona: "", characters: [], messages: msgs, notes: [], thread: [], question: "q", settings: { ...settings, recentMessages: 2 } });
  assert.doesNotMatch(out[0].content, /m2/);
  assert.match(out[0].content, /m3/);
});

test("notes: add, edit, pin, empty text rejected", () => {
  assert.equal(newNote("  "), null);
  const note = newNote("hello");
  const notes = addNote([], note);
  changeNote(notes, note.id, { text: "changed", pinned: true });
  assert.deepEqual([notes[0].text, notes[0].pinned], ["changed", true]);
  assert.equal(changeNote(notes, "missing", {}), null);
});

function fakeRuntime(reply) {
  const docs = new Map();
  const calls = [];
  const documents = {
    async getById(_p, id) { return docs.get(id) ?? null; },
    async create(doc) { const d = { ...doc, revision: 1 }; docs.set(doc.id, d); return d; },
    async update(doc) { const d = { ...doc, revision: docs.get(doc.id).revision + 1 }; docs.set(doc.id, d); return d; },
  };
  const written = [];
  return {
    calls, written, documents,
    runtime: {
      persistence: {
        documents,
        getChat: async () => ({ id: "c", personaId: null, connectionId: "conn-1", characterIds: "[]" }),
        listMessages: async () => [{ role: "assistant", content: "hi" }],
        createMessageWithSwipe: async (m) => written.push(m),
      },
      resources: { listPersonas: async () => [], listCharacters: async () => [] },
      languageModels: {
        resolveForRequest: async (req) => ({ chatComplete: async (msgs, opts) => (calls.push({ req, msgs, opts }), { content: reply }) }),
      },
    },
  };
}

test("ask uses the chat's connection, stores the exchange in the side thread, never writes to the chat", async () => {
  const host = fakeRuntime("an answer");
  const store = createStore(host.documents);
  const view = await ask(host.runtime, store, "c", { question: "why?" });
  assert.equal(host.calls[0].req.connectionId, "conn-1");
  assert.deepEqual(view.thread.map((t) => t.text), ["why?", "an answer"]);
  assert.equal(host.written.length, 0);
  const second = await createNote(store, "c", { text: "n" });
  assert.equal(second.notes.length, 1);
  assert.equal(second.thread.length, 2);
});

test("ask rejects an empty question", async () => {
  const host = fakeRuntime("x");
  await assert.rejects(() => ask(host.runtime, createStore(host.documents), "c", { question: " " }), /Ask something/);
});
