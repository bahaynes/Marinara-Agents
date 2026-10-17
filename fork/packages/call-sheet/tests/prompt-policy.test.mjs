import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzePromptPolicy,
  optimizePresetForCaching,
  containsVolatileMacro,
  getVolatileMacroRegex,
} from "../prompt-policy.mjs";

test("volatile macro regex identifies temporal and dynamic macros", () => {
  const volatileSamples = [
    "{{date}}",
    "{{time}}",
    "{{datetime}}",
    "{{isotime}}",
    "{{weekday}}",
    "{{idle_duration}}",
    "{{random}}",
    "{{random:1:100}}",
    "{{random::A::B}}",
    "{{roll:2d6}}",
    "{{input}}",
    "{{agent::memory}}",
    "{{getvar::mood}}",
    "{{setvar::mood::happy}}",
  ];

  for (const sample of volatileSamples) {
    assert.ok(containsVolatileMacro(sample), `Expected containsVolatileMacro(${sample}) to be true`);
    assert.match(sample, getVolatileMacroRegex(), `Expected ${sample} to match fresh volatile macro regex`);
  }

  const safeSamples = [
    "{{user}}",
    "{{char}}",
    "{{persona}}",
    "{{description}}",
    "{{personality}}",
    "{{scenario}}",
  ];

  for (const sample of safeSamples) {
    assert.ok(!containsVolatileMacro(sample), `Expected containsVolatileMacro(${sample}) to be false`);
    assert.doesNotMatch(sample, getVolatileMacroRegex(), `Expected ${sample} NOT to match volatile macro regex`);
  }
});

test("analyzePromptPolicy flags volatile macros in static sections with critical status", () => {
  const badPreset = {
    id: "preset-bad-clock",
    name: "Noir with Clock",
    sectionOrder: ["system_main", "character_marker", "chat_history"],
    sections: [
      {
        id: "system_main",
        name: "Main Prompt",
        role: "system",
        enabled: true,
        content: "You are a hardboiled narrator.\nCurrent time is {{time}} on {{date}}.\nAlways maintain a cynical tone.",
      },
      {
        id: "character_marker",
        identifier: "character",
        name: "Character Roster",
        isMarker: true,
        markerConfig: { type: "character" },
        enabled: true,
      },
      {
        id: "chat_history",
        identifier: "chat_history",
        name: "Chat History",
        isMarker: true,
        markerConfig: { type: "chat_history" },
        enabled: true,
      },
    ],
  };

  const analysis = analyzePromptPolicy(badPreset, { provider: "anthropic" });

  assert.equal(analysis.status, "critical");
  assert.ok(analysis.score < 60, `Score should be heavily penalized, was ${analysis.score}`);
  assert.ok(analysis.canAutoOptimize, "Should be eligible for auto-optimization");

  const macroIssue = analysis.issues.find((i) => i.rule === "volatile-macro-in-static-prefix");
  assert.ok(macroIssue, "Expected volatile macro issue to be reported");
  assert.deepEqual(macroIssue.macros.sort(), ["{{date}}", "{{time}}"]);
});

test("analyzePromptPolicy flags section order inversion (chat history before character definition)", () => {
  const invertedPreset = {
    id: "preset-inverted",
    name: "Inverted Order",
    sectionOrder: ["system_main", "chat_history", "character_marker"],
    sections: [
      {
        id: "system_main",
        name: "Main Prompt",
        role: "system",
        enabled: true,
        content: "Static rules and instructions that are sufficiently long to test ordering.",
      },
      {
        id: "chat_history",
        identifier: "chat_history",
        name: "Chat History",
        isMarker: true,
        markerConfig: { type: "chat_history" },
        enabled: true,
      },
      {
        id: "character_marker",
        identifier: "character",
        name: "Character Card",
        isMarker: true,
        markerConfig: { type: "character" },
        enabled: true,
      },
    ],
  };

  const analysis = analyzePromptPolicy(invertedPreset);

  const orderIssue = analysis.issues.find((i) => i.rule === "section-order-inversion");
  assert.ok(orderIssue, "Expected section order inversion issue");
  assert.match(orderIssue.message, /placed after volatile/i);
});

test("optimizePresetForCaching fixes macro contamination and section order inversion", () => {
  const messyPreset = {
    id: "preset-messy",
    name: "Messy Preset",
    sectionOrder: ["system_main", "chat_history", "character_marker"],
    sections: [
      {
        id: "system_main",
        name: "Main Prompt",
        role: "system",
        enabled: true,
        content: "You are a master storyteller.\nCurrent time is {{time}}.\nKeep replies dramatic.",
      },
      {
        id: "chat_history",
        identifier: "chat_history",
        name: "Chat History",
        isMarker: true,
        markerConfig: { type: "chat_history" },
        enabled: true,
      },
      {
        id: "character_marker",
        identifier: "character",
        name: "Character Card",
        isMarker: true,
        markerConfig: { type: "character" },
        enabled: true,
      },
    ],
  };

  const optimized = optimizePresetForCaching(messyPreset);

  assert.equal(optimized.name, "Messy Preset (Cache-Optimized)");

  // 1. Character marker must now come BEFORE chat_history in sectionOrder
  const charIdx = optimized.sectionOrder.indexOf("character_marker");
  const histIdx = optimized.sectionOrder.indexOf("chat_history");
  assert.ok(charIdx !== -1 && histIdx !== -1);
  assert.ok(charIdx < histIdx, "Character marker must precede chat history");

  // 2. The volatile line with {{time}} must have been extracted from system_main
  const mainSec = optimized.sections.find((s) => s.id === "system_main");
  assert.doesNotMatch(mainSec.content, /\{\{time\}\}/, "Volatile macro must be removed from system_main");
  assert.match(mainSec.content, /You are a master storyteller/, "Static lines must be preserved");

  // 3. A new dynamic context section must have been appended before history
  const dynamicSec = optimized.sections.find((s) => s.identifier === "dynamic_context");
  assert.ok(dynamicSec, "Expected dynamic_context section to be created");
  assert.match(dynamicSec.content, /\{\{time\}\}/, "Extracted line must be in dynamic context");

  // 4. Re-analyzing the optimized preset should resolve the critical issues
  const reanalysis = analyzePromptPolicy(optimized, { provider: "anthropic" });
  assert.ok(
    !reanalysis.issues.some((i) => i.rule === "section-order-inversion"),
    "Section order inversion should be resolved"
  );
  assert.ok(
    !reanalysis.issues.some((i) => i.rule === "volatile-macro-in-static-prefix"),
    "Volatile macro in static prefix should be resolved"
  );
});
