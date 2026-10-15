// Call Sheet's pure logic: the per-chat sheet (spine, scenes, pending proposal), the prompt block the
// Engine adds to every turn, and the model prompts for the scene planner and summarizer. No host calls
// here, so the tests can run it directly.

export const SHEET_VERSION = 1;
const MAX_FIELD = 4000;
const MAX_LIST = 12;

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

export function cleanSpine(raw) {
  const spine = raw && typeof raw === "object" ? raw : {};
  return { premise: text(spine.premise), goals: text(spine.goals) };
}

/** The scene being played: the newest one that has not been summarized yet. */
export function openScene(sheet) {
  const last = sheet.scenes[sheet.scenes.length - 1];
  return last && last.summary === null ? last : null;
}

/**
 * Messages that belong to a scene: everything after the message that was newest when the scene was
 * accepted, up to its end (or the chat's end while it is open). A missing anchor (the message was
 * deleted) falls back to the whole chat rather than to nothing.
 */
export function sceneMessages(scene, messages) {
  const startIndex = scene.startAfterMessageId ? messages.findIndex((m) => m.id === scene.startAfterMessageId) + 1 : 0;
  const endIndex = scene.endMessageId ? messages.findIndex((m) => m.id === scene.endMessageId) : -1;
  return messages.slice(startIndex, endIndex >= 0 ? endIndex + 1 : messages.length);
}

/** Ids to take out of the prompt when a new scene starts: every message up to and including the anchor. */
export function idsBefore(messages, anchorId) {
  const index = messages.findIndex((m) => m.id === anchorId);
  return index < 0 ? [] : messages.slice(0, index + 1).map((m) => m.id);
}

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

/**
 * The block the Engine appends to the system prompt on every turn. It changes only when a scene starts
 * or ends, so it must be byte-identical between turns: no clocks, no ids, fixed order.
 */
export function sheetContext(sheet) {
  const scene = openScene(sheet);
  if (!scene) return null;
  const parts = ["<call_sheet>"];
  if (sheet.spine.premise) parts.push(`## Story\n${sheet.spine.premise}`);
  if (sheet.spine.goals) parts.push(`## Story goals\n${sheet.spine.goals}`);
  const done = sheet.scenes.filter((s) => s.summary !== null);
  if (done.length) {
    parts.push(
      "## Earlier scenes\n" + done.map((s, i) => `### Scene ${i + 1}: ${s.plan.title}\n${s.summary}`).join("\n\n"),
    );
  }
  parts.push(`## Current scene: ${scene.plan.title}\n` + planLines(scene.plan).join("\n"));
  parts.push(
    "## Scene rules\n" +
      "- Play only this scene. Only the characters listed as present act or speak, unless the player's turn brings someone in.\n" +
      "- Work toward what the scene is for, but let the player's choices lead.\n" +
      "- Never end the scene, cut away or skip time on your own. The player decides when the scene ends.",
  );
  parts.push("</call_sheet>");
  return parts.join("\n\n");
}

/** Plain transcript lines for the planner and summarizer. */
export function transcript(messages, names) {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "narrator")
    .map((m) => {
      const who = m.role === "user" ? names.persona : names.characters.get(m.characterId) || "Narrator";
      return `${who}: ${String(m.agentContent ?? m.content ?? "").trim()}`;
    })
    .join("\n\n");
}

const PLAN_SHAPE =
  '{"title": "short scene title", "location": "where it happens", "cast": ["name — why they are here"], ' +
  '"goals": ["what this scene is for, as something that can happen or fail"], ' +
  '"facts": ["what is true and matters here"], "opening": "one or two sentences: the situation as the scene opens"}';

/** Messages for the scene planner (main model). */
export function proposalPrompt({ sheet, cast, persona, lastScene, instruction }) {
  const done = sheet.scenes.filter((s) => s.summary !== null);
  const sections = [
    `Player character: ${persona}`,
    `Cast:\n${cast || "(none listed)"}`,
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
