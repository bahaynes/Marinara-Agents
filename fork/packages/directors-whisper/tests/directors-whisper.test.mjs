import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PACKAGE_ID,
  isEnabled,
  encodeShardKey,
  formatWhisperDirective,
  createWhisperContributor,
} from "../server.mjs";

test("directors-whisper: isEnabled checks mode, enableAgents, and activeAgentIds", () => {
  assert.equal(isEnabled(null, "roleplay"), false);
  assert.equal(isEnabled({ enableAgents: false, activeAgentIds: [PACKAGE_ID] }, "roleplay"), false);
  assert.equal(isEnabled({ enableAgents: true, activeAgentIds: ["other-agent"] }, "roleplay"), false);
  assert.equal(isEnabled({ enableAgents: true, activeAgentIds: [PACKAGE_ID] }, "conversation"), false);

  assert.equal(isEnabled({ enableAgents: true, activeAgentIds: [PACKAGE_ID] }, "roleplay"), true);
  assert.equal(isEnabled({ enableAgents: true, activeAgentIds: [PACKAGE_ID] }, "game"), true);
});

test("directors-whisper: encodeShardKey encodes case-safe filenames matching engine", () => {
  assert.equal(encodeShardKey(""), "orphaned-rows");
  assert.equal(encodeShardKey("abc-123"), "abc-123");
  // Uppercase letters are percent-encoded
  assert.equal(encodeShardKey("XFpgKvCy7hn5RfM8T7qHN"), "%58%46pg%4Bv%43y7hn5%52f%4D8%547q%48%4E");
});

test("directors-whisper: formatWhisperDirective returns null for empty or non-ready seeds", () => {
  assert.equal(formatWhisperDirective([]), null);
  assert.equal(formatWhisperDirective(null), null);
  assert.equal(
    formatWhisperDirective([
      { id: "seed1", concept: "Brass key", status: "dormant", payoffPrompt: "Use in study" },
      { id: "seed2", concept: "Old letter", status: "dud", payoffPrompt: "Discard" },
    ]),
    null,
  );
});

test("directors-whisper: formatWhisperDirective formats single ready seed", () => {
  const seeds = [
    { id: "seed1", concept: "Brass key", status: "dormant", payoffPrompt: "Use in study" },
    {
      id: "seed2",
      concept: "Tarnished locket",
      status: "ready",
      payoffPrompt: "The guard recognizes the serpent insignia on the locket and lowers his rifle.",
    },
  ];

  const directive = formatWhisperDirective(seeds);
  assert.ok(directive);
  assert.match(directive, /\[DIRECTOR'S NOTE — FORESHADOWING PAYOFF\]/);
  assert.match(directive, /- Tarnished locket: The guard recognizes the serpent insignia/);
  assert.doesNotMatch(directive, /Brass key/);
});

test("directors-whisper: formatWhisperDirective formats multiple ready seeds", () => {
  const seeds = [
    { id: "seed1", concept: "Brass key", status: "ready", payoffPrompt: "Matches the locked study desk." },
    { id: "seed2", concept: "Strange humming", status: "ready", payoffPrompt: "The floorboards vibrate beneath them." },
  ];

  const directive = formatWhisperDirective(seeds);
  assert.ok(directive);
  assert.match(directive, /- Brass key: Matches the locked study desk\./);
  assert.match(directive, /- Strange humming: The floorboards vibrate beneath them\./);
});

test("directors-whisper: contributor returns null when disabled or when seeds dormant", async () => {
  const contributor = createWhisperContributor({
    getSeeds: async () => [
      { id: "seed1", concept: "Brass key", status: "dormant", payoffPrompt: "Use in study" },
    ],
  });

  // Disabled in chatMeta
  const disabledResult = await contributor({
    chatId: "chat1",
    chatMeta: { enableAgents: true, activeAgentIds: [] },
    mode: "roleplay",
  });
  assert.equal(disabledResult, null);

  // Enabled, but dormant
  const dormantResult = await contributor({
    chatId: "chat1",
    chatMeta: { enableAgents: true, activeAgentIds: [PACKAGE_ID] },
    mode: "roleplay",
  });
  assert.equal(dormantResult, null);
});

test("directors-whisper: contributor returns directive when a seed is ready", async () => {
  const contributor = createWhisperContributor({
    getSeeds: async () => [
      { id: "seed1", concept: "Brass key", status: "ready", payoffPrompt: "Fits the wardrobe keyhole." },
    ],
  });

  const result = await contributor({
    chatId: "chat1",
    chatMeta: { enableAgents: true, activeAgentIds: [PACKAGE_ID] },
    mode: "roleplay",
  });

  assert.ok(result);
  assert.match(result, /- Brass key: Fits the wardrobe keyhole\./);
});
