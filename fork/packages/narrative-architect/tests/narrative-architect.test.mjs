// node --test fork/packages/narrative-architect/tests
import assert from "node:assert/strict";
import test from "node:test";
import {
  PACKAGE_ID,
  docId,
  isEnabled,
  createStore,
  isSceneBreak,
  buildArchitectPrompt,
  formatContribution,
  architectContext,
} from "../server.mjs";

test("isEnabled checks mode and agent activation", () => {
  assert.equal(
    isEnabled({ enableAgents: true, activeAgentIds: [PACKAGE_ID] }, "roleplay"),
    true,
  );
  assert.equal(
    isEnabled({ enableAgents: true, activeAgentIds: [PACKAGE_ID] }, "game"),
    true,
  );
  assert.equal(
    isEnabled({ enableAgents: true, activeAgentIds: [PACKAGE_ID] }, "conversation"),
    false,
  );
  assert.equal(
    isEnabled({ enableAgents: false, activeAgentIds: [PACKAGE_ID] }, "roleplay"),
    false,
  );
  assert.equal(
    isEnabled({ enableAgents: true, activeAgentIds: ["other-agent"] }, "roleplay"),
    false,
  );
});

test("isSceneBreak uses runtime.decisions when available", async () => {
  const messages = [
    { role: "user", content: "Let's leave the tavern and head to the castle." },
    { role: "assistant", content: "They arrive at the castle gates." },
  ];

  let decisionCalled = false;
  const runtimeYes = {
    decisions: {
      async evaluate() {
        decisionCalled = true;
        return { answers: { scene_break: 0.9 }, threshold: 0.5 };
      },
    },
  };

  assert.equal(await isSceneBreak(runtimeYes, messages), true);
  assert.equal(decisionCalled, true);

  const runtimeNo = {
    decisions: {
      async evaluate() {
        return { answers: { scene_break: 0.2 }, threshold: 0.5 };
      },
    },
  };
  assert.equal(await isSceneBreak(runtimeNo, messages), false);
});

test("isSceneBreak falls back to regex or turn interval when decision model is missing", async () => {
  const regularMsg = [{ role: "assistant", content: "He smiled and nodded." }];
  // 1 message elapsed, interval 5 -> false
  assert.equal(await isSceneBreak({}, regularMsg, { lastMessageCount: 0 }, { fallbackInterval: 5 }), false);

  // 5 messages elapsed, interval 5 -> true (triggers cadence refresh)
  const fiveMsgs = Array.from({ length: 5 }, (_, i) => ({ role: "assistant", content: `Turn ${i}` }));
  assert.equal(await isSceneBreak({}, fiveMsgs, { lastMessageCount: 0 }, { fallbackInterval: 5 }), true);

  // Explicit divider regex -> true immediately
  const dividerMsg = [{ role: "assistant", content: "He left the room.\n\n***\n\nThree hours later..." }];
  assert.equal(await isSceneBreak({}, dividerMsg, { lastMessageCount: 0 }), true);
});

test("createStore saves and loads state", async () => {
  const docs = new Map();
  const runtime = {
    persistence: {
      documents: {
        async getById(pkgId, id) {
          return docs.get(`${pkgId}:${id}`) ?? null;
        },
        async create(entry) {
          docs.set(`${entry.packageId}:${entry.id}`, { data: entry.data, revision: 1 });
        },
        async update(entry, rev) {
          docs.set(`${entry.packageId}:${entry.id}`, { data: entry.data, revision: rev + 1 });
        },
      },
    },
  };

  const store = createStore(runtime);
  const initial = await store.load("chat-1");
  assert.equal(initial.state, null);
  assert.equal(initial.revision, 0);

  await store.save("chat-1", { beatSheet: "Beat 1 -> Beat 2", sceneIndex: 1 }, 0);
  const loaded = await store.load("chat-1");
  assert.equal(loaded.state.beatSheet, "Beat 1 -> Beat 2");
  assert.equal(loaded.state.sceneIndex, 1);
  assert.equal(loaded.revision, 1);
});

test("architectContext reuses cached beat sheet on same scene (zero cloud model calls)", async () => {
  const docs = new Map();
  docs.set(`${PACKAGE_ID}:${docId("chat-1")}`, {
    data: { beatSheet: "Existing cached beat sheet", sceneIndex: 1 },
    revision: 1,
  });

  let llmCalled = false;
  const runtime = {
    persistence: {
      documents: {
        async getById(pkgId, id) {
          return docs.get(`${pkgId}:${id}`) ?? null;
        },
      },
      async listMessages() {
        return [{ id: "m1", role: "assistant", content: "Just regular conversation." }];
      },
    },
    decisions: {
      async evaluate() {
        return { answers: { scene_break: 0.1 }, threshold: 0.5 };
      },
    },
    languageModels: {
      async resolveForRequest() {
        llmCalled = true;
        return {
          async chatComplete() {
            return { content: "Should not be called!" };
          },
        };
      },
    },
  };

  const store = createStore(runtime);
  const contributor = architectContext(store, runtime);

  const result = await contributor({
    chatId: "chat-1",
    mode: "roleplay",
    chatMeta: { enableAgents: true, activeAgentIds: [PACKAGE_ID] },
  });

  assert.equal(llmCalled, false, "LLM must NOT be called when scene did not break");
  assert.match(result, /Existing cached beat sheet/u);
});

test("architectContext calls thinking model when scene break occurs", async () => {
  const docs = new Map();
  docs.set(`${PACKAGE_ID}:${docId("chat-1")}`, {
    data: { beatSheet: "Old beat sheet", sceneIndex: 1 },
    revision: 1,
  });

  let llmCalled = false;
  const runtime = {
    persistence: {
      documents: {
        async getById(pkgId, id) {
          return docs.get(`${pkgId}:${id}`) ?? null;
        },
        async update(entry, rev) {
          docs.set(`${entry.packageId}:${entry.id}`, { data: entry.data, revision: rev + 1 });
        },
      },
      async listMessages() {
        return [{ id: "m1", role: "assistant", content: "We moved to a new city." }];
      },
    },
    decisions: {
      async evaluate() {
        return { answers: { scene_break: 0.95 }, threshold: 0.5 };
      },
    },
    languageModels: {
      async resolveForRequest() {
        llmCalled = true;
        return {
          async chatComplete() {
            return { content: "New scene architecture: Beat A, Beat B, Twist" };
          },
        };
      },
    },
  };

  const store = createStore(runtime);
  const contributor = architectContext(store, runtime);

  const result = await contributor({
    chatId: "chat-1",
    mode: "roleplay",
    chatMeta: { enableAgents: true, activeAgentIds: [PACKAGE_ID] },
  });

  assert.equal(llmCalled, true, "LLM must be called when scene break is detected");
  assert.match(result, /New scene architecture/u);

  const updated = await store.load("chat-1");
  assert.equal(updated.state.beatSheet, "New scene architecture: Beat A, Beat B, Twist");
  assert.equal(updated.state.sceneIndex, 2);
});
