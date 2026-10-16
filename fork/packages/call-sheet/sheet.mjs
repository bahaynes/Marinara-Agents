// Call Sheet's pure logic: the story sheet (spine, scenes, pending proposal), the prompts for every job,
// and the cache layout they share. No host calls here, so the tests can run it directly.
//
// Every main-model job is the same prompt with a different ending:
//   system:  1 fixed head (rules, cast cards, persona, story)  2 frozen scene summaries  3 current scene
//   then:    4 the current scene's turns
//   last:    5 the job's own instruction
// Blocks 1-3 change only at a scene boundary and block 4 only grows, so each request repeats the last one.

export const SHEET_VERSION = 2;
const MAX_FIELD = 4000;
const MAX_LIST = 12;
const CARD_FIELD_LIMIT = 3000;

export function emptySheet() {
  return { version: SHEET_VERSION, spine: { premise: "", goals: "" }, scenes: [], proposal: null };
}

const text = (value, limit = MAX_FIELD) =>
  String(value ?? "")
    .trim()
    .slice(0, limit);
const list = (value) =>
  (Array.isArray(value) ? value : String(value ?? "").split(/\n|;/u))
    .map((item) => text(item, 400))
    .filter(Boolean)
    .slice(0, MAX_LIST);

/** Keep only the plan fields the sheet knows, so a model or a client can never store anything else. */
export function cleanPlan(raw) {
  const plan = raw && typeof raw === "object" ? raw : {};
  return {
    title: text(plan.title, 120) || "Untitled scene",
    location: text(plan.location, 400),
    cast: list(plan.cast),
    goals: list(plan.goals),
    facts: list(plan.facts),
    opening: text(plan.opening, 1200),
  };
}

/** How long a turn may run: the model's token budget, and the matching line in the narrator's rules. */
export const REPLY_LENGTHS = Object.freeze({
  short: { tokens: 700, hint: "Keep each turn short: one or two paragraphs." },
  medium: { tokens: 1200, hint: "Keep each turn to about three or four paragraphs." },
  long: { tokens: 2000, hint: "A turn may run long when the moment calls for it." },
});

/** A story's settings, with defaults for anything missing or unknown. */
export function cleanSettings(raw) {
  const settings = raw && typeof raw === "object" ? raw : {};
  return {
    replyLength: Object.hasOwn(REPLY_LENGTHS, settings.replyLength) ? settings.replyLength : "medium",
    reviewTurns: settings.reviewTurns === true,
  };
}

export function cleanSpine(raw) {
  const spine = raw && typeof raw === "object" ? raw : {};
  return { premise: text(spine.premise), goals: text(spine.goals) };
}

/** The scene being played: the newest one that has not been summarized yet. */
export function openScene(sheet) {
  const last = sheet.scenes[sheet.scenes.length - 1];
  return last && last.summary === null ? last : null;
}

/** One outcome per planned goal, matched by text, else by position (models reword goals). */
export function cleanOutcomes(raw, goals) {
  const marks = (Array.isArray(raw) ? raw : []).map((o) => ({
    goal: text(o?.goal, 400),
    status: ["met", "failed"].includes(o?.status) ? o.status : "open",
  }));
  return goals.map((goal, i) => ({
    goal,
    status: (marks.find((m) => m.goal === goal) ?? marks[i])?.status ?? "open",
  }));
}

// ── Turns ──

export const turnText = (turn) => turn.swipes[turn.active] ?? "";

export function newTurn(speaker, content, extra = {}) {
  return {
    id: `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    speaker,
    kind: extra.kind ?? null,
    instruction: extra.instruction ?? "",
    swipes: [content],
    // One entry per version: the main-model call that wrote it (null for a turn the player wrote).
    usage: [extra.usage ?? null],
    active: 0,
    createdAt: new Date().toISOString(),
  };
}

/** A provider's usage, reduced to the counts the cache measure needs. */
export function cleanUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  const n = (value) => (Number.isFinite(value) ? value : 0);
  return {
    input: n(usage.promptTokens),
    read: n(usage.cachedPromptTokens),
    write: n(usage.cacheWritePromptTokens),
    output: n(usage.completionTokens),
  };
}

/**
 * KPI 1 for a scene: every recorded call, every version included (rerolls cost too). Token-equivalents
 * follow the plan: uncached input 1x, cache reads 0.1x, cache writes 2x.
 * ponytail: assumes Anthropic-style counts, where input excludes cache reads and writes. Providers that
 * count cached tokens inside input overstate the uncached share; per-provider normalization fixes that.
 */
export function cacheStats(turns) {
  const total = { calls: 0, input: 0, read: 0, write: 0, output: 0 };
  for (const turn of turns) {
    for (const usage of turn.usage ?? []) {
      if (!usage) continue;
      total.calls += 1;
      for (const key of ["input", "read", "write", "output"]) total[key] += usage[key];
    }
  }
  const prompt = total.input + total.read + total.write;
  return {
    ...total,
    readShare: prompt ? total.read / prompt : 0,
    equivalents: Math.round(total.input + total.read * 0.1 + total.write * 2),
  };
}

// ── Cast ──

const field = (value) => text(value, CARD_FIELD_LIMIT);

/** A character card from the Engine library, reduced to what a story prompt needs. */
export function castCard(data) {
  const card = data && typeof data === "object" ? data : {};
  const name = text(card.name, 120);
  if (!name) return null;
  return {
    name,
    description: field(card.description),
    personality: field(card.personality),
    scenario: field(card.scenario),
  };
}

function cardText(card) {
  return [
    `### ${card.name}`,
    card.description,
    card.personality && `Personality: ${card.personality}`,
    card.scenario && `Background: ${card.scenario}`,
  ]
    .filter(Boolean)
    .join("\n");
}

// ── Prompt blocks ──

const bullets = (items) => items.map((item) => `- ${item}`).join("\n");

function planLines(plan) {
  const lines = [];
  if (plan.location) lines.push(`Location: ${plan.location}`);
  if (plan.cast.length) lines.push(`Present:\n${bullets(plan.cast)}`);
  if (plan.goals.length) lines.push(`What this scene is for:\n${bullets(plan.goals)}`);
  if (plan.facts.length) lines.push(`Facts in play:\n${bullets(plan.facts)}`);
  if (plan.opening) lines.push(`Opening: ${plan.opening}`);
  return lines;
}

/** Block 1. Changes only when the story itself is edited. */
export function headBlock({ sheet, cast, persona, settings }) {
  return [
    "You are the narrator of an interactive story played one scene at a time. " +
      `The player plays ${persona.name}. You write everything else: the world, and every other character's ` +
      `actions and words. Never write ${persona.name}'s words, actions, thoughts or decisions unless you are ` +
      `explicitly asked to write ${persona.name}'s turn. Write vivid, grounded prose in the third person and ` +
      "past tense. Wrap each character's spoken lines in speaker tags, inline with the narration: " +
      '<speaker="Name">"Spoken words,"</speaker> followed by the action beat. ' +
      "End each turn at a point where the player can respond. " +
      REPLY_LENGTHS[cleanSettings(settings).replyLength].hint,
    sheet.spine.premise && `## Story\n${sheet.spine.premise}`,
    sheet.spine.goals && `## Story goals\n${sheet.spine.goals}`,
    cast.length && `## Characters\n${cast.map(cardText).join("\n\n")}`,
    `## The player character\n${cardText(persona)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Block 2. One summary is appended per finished scene; earlier ones never change. */
export function summaryBlock(sheet) {
  const done = sheet.scenes.filter((s) => s.summary !== null);
  if (!done.length) return "";
  return "## Earlier scenes\n" + done.map((s, i) => `### Scene ${i + 1}: ${s.plan.title}\n${s.summary}`).join("\n\n");
}

/** Block 3. Fixed for the length of a scene. */
export function sceneBlock(scene, index) {
  return (
    `## Current scene (${index + 1}): ${scene.plan.title}\n${planLines(scene.plan).join("\n")}\n\n` +
    "Scene rules:\n" +
    "- Play only this scene. Only the characters listed as present act or speak, unless the player brings someone in.\n" +
    "- Work toward what the scene is for, but let the player's choices lead.\n" +
    "- Never end the scene, cut away or skip time on your own. The player decides when the scene ends."
  );
}

const SCENE_START = "(The scene begins.)";

/**
 * Block 4: the scene's turns as alternating user (persona) and assistant (narrator) messages. A leading
 * user message keeps the order valid for providers that require one; consecutive turns by the same
 * speaker are joined, which only ever changes the newest message.
 */
export function historyMessages(turns, persona) {
  const messages = [{ role: "user", content: SCENE_START }];
  for (const turn of turns) {
    const role = turn.speaker === "persona" ? "user" : "assistant";
    const content = role === "user" ? `${persona.name}: ${turnText(turn)}` : turnText(turn);
    const last = messages[messages.length - 1];
    if (last.role === role) last.content += `\n\n${content}`;
    else messages.push({ role, content });
  }
  return messages;
}

/** Blocks 1 to 4, shared by every job in a scene. */
export function scenePrefix({ sheet, cast, persona, turns, settings }) {
  const scene = openScene(sheet);
  if (!scene) throw new Error("There is no scene in play.");
  const system = [
    headBlock({ sheet, cast, persona, settings }),
    summaryBlock(sheet),
    sceneBlock(scene, sheet.scenes.length - 1),
  ]
    .filter(Boolean)
    .join("\n\n");
  return [{ role: "system", content: system }, ...historyMessages(turns, persona)];
}

/** Narrator turn: the newest persona turn is already the last message; otherwise ask to continue. */
export function narratorPrompt(args) {
  const messages = scenePrefix(args);
  if (messages[messages.length - 1].role === "assistant") {
    messages.push({ role: "user", content: "(Continue the scene.)" });
  }
  return messages;
}

/** Impersonate: write the persona's turn from the player's instruction. */
export function impersonatePrompt({ instruction, ...args }) {
  const messages = scenePrefix(args);
  const name = args.persona.name;
  const ask =
    `(Write ${name}'s next turn from the player's instruction: ${instruction.trim()}\n` +
    `Write only what ${name} says and does, in ${name}'s voice and the story's style. ` +
    "Do not write anyone else's reaction. Reply with the turn only.)";
  const last = messages[messages.length - 1];
  if (last.role === "user") last.content += `\n\n${ask}`;
  else messages.push({ role: "user", content: ask });
  return messages;
}

/**
 * Plain transcript for the planner and summarizer. With `maxChars`, the oldest turns are dropped until
 * the rest fits, so a long scene still fits a small model's context.
 */
export function transcript(turns, persona, maxChars = Infinity) {
  const lines = turns.map((t) => `${t.speaker === "persona" ? persona.name : "Narrator"}: ${turnText(t).trim()}`);
  let size = lines.reduce((sum, line) => sum + line.length + 2, 0);
  let dropped = 0;
  while (size > maxChars && dropped < lines.length - 1) size -= lines[dropped++].length + 2;
  const kept = lines.slice(dropped).join("\n\n");
  return dropped ? `[The first ${dropped} turns of this scene are left out for length.]\n\n${kept}` : kept;
}

// ponytail: about 3 characters per token, with room for the instructions and the answer. Good enough to
// stay under a context window; a tokenizer from the host would be exact.
export const transcriptBudget = (maxContext, answerTokens) =>
  maxContext ? Math.max(4000, (maxContext - answerTokens - 1500) * 3) : Infinity;

const PLAN_SHAPE =
  '{"title": "short scene title", "location": "where it happens", "cast": ["name — why they are here"], ' +
  '"goals": ["what this scene is for, as something that can happen or fail"], ' +
  '"facts": ["what is true and matters here"], "opening": "one or two sentences: the situation as the scene opens"}';

/** Messages for the scene planner (main model). */
export function proposalPrompt({ sheet, cast, persona, lastScene, instruction }) {
  const done = sheet.scenes.filter((s) => s.summary !== null);
  const sections = [
    `Player character: ${persona.name}`,
    `Cast:\n${cast.map((c) => `- ${c.name}: ${c.description.slice(0, 300)}`).join("\n") || "(none listed)"}`,
    sheet.spine.premise ? `Story: ${sheet.spine.premise}` : "",
    sheet.spine.goals ? `Story goals: ${sheet.spine.goals}` : "",
    done.length ? "Scenes so far:\n" + done.map((s, i) => `${i + 1}. ${s.plan.title}: ${s.summary}`).join("\n") : "",
    lastScene ? `End of the last scene:\n${lastScene}` : "",
    instruction ? `The player's direction for the next scene: ${instruction}` : "",
  ].filter(Boolean);
  return [
    {
      role: "system",
      content:
        "You plan the next scene of an interactive story. A scene is one place, one stretch of time and one purpose. " +
        "Follow the player's direction when there is one; it overrides your own ideas. Otherwise pick up the most " +
        "interesting open thread. Keep the cast to who would really be there. Plan only this one scene, not what " +
        `follows it. Return ONLY one JSON object, no markdown: ${PLAN_SHAPE}`,
    },
    { role: "user", content: sections.join("\n\n") },
  ];
}

/** Messages for the scene summarizer (agent model). */
export function summaryPrompt({ plan, sceneText }) {
  return [
    {
      role: "system",
      content:
        "You write the permanent record of one finished scene of an interactive story. It replaces the scene in the " +
        "story's memory, so keep every fact a later scene could need: who was there, what was decided, what changed, " +
        "what was learned, and any promise, debt, injury or secret. Past tense, plain prose, at most 200 words. Then " +
        'mark each scene goal. Return ONLY one JSON object: {"summary": "...", "goals": [{"goal": "...", ' +
        '"status": "met|failed|open"}]}',
    },
    {
      role: "user",
      content: `Scene: ${plan.title}\nGoals:\n${bullets(plan.goals) || "(none)"}\n\nTranscript:\n${sceneText}`,
    },
  ];
}
