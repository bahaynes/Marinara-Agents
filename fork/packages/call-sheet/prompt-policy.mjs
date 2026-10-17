// ──────────────────────────────────────────────
// Prompt Caching Policy & Health Analyzer
// Inspects presets, sections, and macro volatility to enforce provider-agnostic
// prompt caching best practices. Provides 1-click optimization.
// ──────────────────────────────────────────────

/**
 * Regex matching macros that change values between turns, minutes, or requests.
 * Placing these in a static prompt prefix destroys the LLM prompt cache.
 */
export const VOLATILE_MACRO_SOURCE =
  "\\{\\{(?:date|time|datetime|isotime|weekday|timezone|idle_duration|random(?:[:a-zA-Z0-9_.@]*)?|roll:[^}]+|input|lastGenerationType|agent::[^}]+|getvar::[^}]+|setvar::[^}]+|addvar::[^}]+|addnumvar::[^}]+|incvar::[^}]+|decvar::[^}]+)\\}\\}";

/** Create a fresh RegExp instance to avoid RegExp.lastIndex state mutation issues. */
export function getVolatileMacroRegex(flags = "gi") {
  return new RegExp(VOLATILE_MACRO_SOURCE, flags);
}

/** Check if a string contains any volatile macro. */
export function containsVolatileMacro(text) {
  if (typeof text !== "string") return false;
  return new RegExp(VOLATILE_MACRO_SOURCE, "i").test(text);
}

/** Sections and markers that are inherently static or semi-static (safe for caching). */
export const STATIC_MARKERS = new Set([
  "character",
  "persona",
  "lorebook",
  "dialogue_examples",
  "id_macro_cards",
  "world_info_before",
  "world_info_after",
]);

/** Sections and markers that are dynamic or expand on every turn. */
export const DYNAMIC_MARKERS = new Set([
  "chat_history",
  "current_scene_summary",
  "recalled_scenes",
  "recalled_messages",
  "agent_data",
  "dynamic_context",
  "temporal_context",
]);

/** Minimum token threshold for Anthropic Claude prompt caching. */
export const ANTHROPIC_MIN_CACHE_TOKENS = 1024;

/**
 * Analyze a prompt preset or prompt structure against caching policy rules.
 *
 * @param {object} preset - The preset to analyze ({ id, name, sectionOrder, sections, ... })
 * @param {object} [options] - Optional settings ({ provider, charCountEstimateRatio })
 * @returns {object} Analysis result with score (0-100), status, issues, and suggestions
 */
export function analyzePromptPolicy(preset, options = {}) {
  const provider = options.provider || "anthropic";
  const issues = [];
  const suggestions = [];

  if (!preset || typeof preset !== "object") {
    return {
      score: 0,
      status: "critical",
      issues: [{ level: "critical", message: "Invalid or missing preset definition" }],
      suggestions: ["Select or provide a valid prompt preset."],
    };
  }

  const sections = Array.isArray(preset.sections) ? preset.sections : [];
  const sectionOrder = Array.isArray(preset.sectionOrder)
    ? preset.sectionOrder
    : sections.map((s) => s.id || s.identifier);

  // Map sections by id or identifier
  const sectionMap = new Map();
  for (const sec of sections) {
    if (sec.id) sectionMap.set(sec.id, sec);
    if (sec.identifier) sectionMap.set(sec.identifier, sec);
  }

  // 1. Analyze Section Ordering
  let foundDynamicMarker = false;
  let dynamicMarkerName = "";
  let orderPenalty = 0;

  for (const secId of sectionOrder) {
    const sec = sectionMap.get(secId);
    const markerType = sec?.markerConfig?.type || sec?.identifier;

    if (DYNAMIC_MARKERS.has(markerType)) {
      foundDynamicMarker = true;
      dynamicMarkerName = markerType;
    } else if (STATIC_MARKERS.has(markerType) && foundDynamicMarker) {
      // A static marker appears AFTER a dynamic marker!
      orderPenalty += 35;
      issues.push({
        level: "critical",
        rule: "section-order-inversion",
        section: secId,
        message: `Static section "${sec?.name || secId}" is placed after volatile "${dynamicMarkerName}". Expanding chat history will shift its byte offset and bust prompt cache.`,
      });
      suggestions.push(
        `Move static block "${sec?.name || secId}" above "${dynamicMarkerName}" in section order.`
      );
    }
  }

  // 2. Analyze Volatile Macro Contamination in Static Sections
  let macroPenalty = 0;
  let estimatedStaticChars = 0;

  for (const secId of sectionOrder) {
    const sec = sectionMap.get(secId);
    if (!sec || sec.enabled === false) continue;

    const markerType = sec?.markerConfig?.type || sec?.identifier;
    const isDynamic = DYNAMIC_MARKERS.has(markerType);

    // Stop counting static prefix once we hit dynamic chat history
    if (isDynamic) break;

    const content = typeof sec.content === "string" ? sec.content : "";
    estimatedStaticChars += content.length;

    // Check for volatile macros in static sections
    const matches = content.match(getVolatileMacroRegex());
    if (matches && matches.length > 0) {
      const uniqueMacros = [...new Set(matches.map((m) => m.toLowerCase()))];
      macroPenalty += Math.min(45, uniqueMacros.length * 20);
      issues.push({
        level: "critical",
        rule: "volatile-macro-in-static-prefix",
        section: sec.name || secId,
        macros: uniqueMacros,
        message: `Section "${sec.name || secId}" contains volatile macro(s): ${uniqueMacros.join(", ")}. Values change on every turn, causing a 0% prompt cache hit rate.`,
      });
      suggestions.push(
        `Move dynamic macros (${uniqueMacros.join(", ")}) out of "${sec.name || secId}" or relocate them after the cache anchor.`
      );
    }
  }

  // 3. Prefix Length / Minimum Cache Threshold (Anthropic rule: >= 1024 tokens)
  // Standard rough heuristic: ~4 characters per token
  const estimatedStaticTokens = Math.round(estimatedStaticChars / 4);
  let thresholdPenalty = 0;

  if (provider === "anthropic" && estimatedStaticTokens > 0 && estimatedStaticTokens < ANTHROPIC_MIN_CACHE_TOKENS) {
    thresholdPenalty = 15;
    issues.push({
      level: "warning",
      rule: "sub-threshold-prefix-length",
      tokens: estimatedStaticTokens,
      required: ANTHROPIC_MIN_CACHE_TOKENS,
      message: `Static prefix is ~${estimatedStaticTokens} tokens (minimum for Anthropic prompt caching is ${ANTHROPIC_MIN_CACHE_TOKENS} tokens). Small chats will not receive cached pricing until context expands.`,
    });
    suggestions.push(
      `Add base world guidelines, character voice instructions, or formatting rules to the system prompt to reach the 1,024-token cache threshold.`
    );
  }

  // Compute final score
  const totalPenalty = Math.min(100, orderPenalty + macroPenalty + thresholdPenalty);
  const score = Math.max(0, 100 - totalPenalty);

  const status = score >= 85 ? "optimal" : score >= 60 ? "warning" : "critical";

  return {
    score,
    status,
    estimatedStaticTokens,
    issues,
    suggestions: [...new Set(suggestions)],
    canAutoOptimize: issues.some((i) => i.rule === "section-order-inversion" || i.rule === "volatile-macro-in-static-prefix"),
  };
}

/**
 * Automatically creates a cache-optimized clone of a preset by:
 * 1. Reordering sectionOrder to ensure static blocks precede dynamic blocks.
 * 2. Isolating volatile macro lines from static system sections into a separate post-cache dynamic context block.
 *
 * @param {object} preset - The preset to optimize
 * @returns {object} The optimized preset clone
 */
export function optimizePresetForCaching(preset) {
  if (!preset || typeof preset !== "object") return preset;

  const optimized = JSON.parse(JSON.stringify(preset));
  optimized.name = `${preset.name || "Preset"} (Cache-Optimized)`;
  optimized.updatedAt = new Date().toISOString();

  const sections = Array.isArray(optimized.sections) ? optimized.sections : [];
  const sectionMap = new Map();
  for (const sec of sections) {
    if (sec.id) sectionMap.set(sec.id, sec);
    if (sec.identifier) sectionMap.set(sec.identifier, sec);
  }

  // Separate sections into static, dynamic context, and history
  const staticIds = [];
  const dynamicIds = [];
  const historyIds = [];

  const originalOrder = Array.isArray(optimized.sectionOrder)
    ? optimized.sectionOrder
    : sections.map((s) => s.id || s.identifier);

  for (const secId of originalOrder) {
    const sec = sectionMap.get(secId);
    const markerType = sec?.markerConfig?.type || sec?.identifier;

    if (markerType === "chat_history" || markerType === "input") {
      historyIds.push(secId);
    } else if (DYNAMIC_MARKERS.has(markerType)) {
      dynamicIds.push(secId);
    } else {
      staticIds.push(secId);
    }
  }

  // Check if any static section contains volatile macros
  // If so, split the volatile lines out into a dynamic context section
  const dynamicExtractedLines = [];

  for (const secId of staticIds) {
    const sec = sectionMap.get(secId);
    if (!sec || typeof sec.content !== "string") continue;

    if (containsVolatileMacro(sec.content)) {
      const lines = sec.content.split("\n");
      const cleanLines = [];

      for (const line of lines) {
        if (containsVolatileMacro(line)) {
          dynamicExtractedLines.push(line.trim());
        } else {
          cleanLines.push(line);
        }
      }

      sec.content = cleanLines.join("\n");
    }
  }

  // If we extracted volatile lines, create a new dynamic context section
  if (dynamicExtractedLines.length > 0) {
    const dynamicSecId = `dynamic_temporal_context_${Date.now()}`;
    const dynamicSection = {
      id: dynamicSecId,
      identifier: "dynamic_context",
      name: "Dynamic Time & Context",
      content: dynamicExtractedLines.join("\n"),
      role: "system",
      enabled: true,
      isMarker: false,
      markerConfig: null,
      injectionPosition: "ordered",
      injectionDepth: 0,
      injectionOrder: 0,
    };

    sections.push(dynamicSection);
    dynamicIds.push(dynamicSecId);
  }

  // Rebuild sectionOrder in optimal caching sequence:
  // [Static System / Persona / Lore] -> [Dynamic Context / Summaries] -> [Chat History / Input]
  optimized.sectionOrder = [...staticIds, ...dynamicIds, ...historyIds];
  optimized.sections = sections;

  return optimized;
}
