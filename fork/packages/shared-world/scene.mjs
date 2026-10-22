// Shared World's synchronous scene: parties standing at the same place play one round together. Each player
// submits an action for their own character; once every member has, one neutral narration covers them all and
// goes into every member's chat. Pure state and prompt text; storage, the model call and chat writes are in
// server.mjs. Design: plan/shared-world-scene.md.
//
// ponytail: a round has no timeout (it waits for everyone). The upgrade is a "play my character" button.

export class SceneError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

const ACTION_LIMIT = 1200;
const LOG_LIMIT = 40;
const RECAP_ROUNDS = 3;

/** A new scene for the members `[{ playerId, chatId, name, companions? }]` standing at `place`. */
export function startScene({ id, members, place, at }) {
  if (members.length < 2) throw new SceneError(409, "A scene needs two parties at the same place.");
  return { id, status: "open", round: 1, place, members, actions: {}, log: [], resolving: false, startedAt: at };
}

const memberOf = (scene, playerId) => scene.members.find((member) => member.playerId === playerId);

/** Record one member's action for the round. Returns the scene and whether every member has now acted. */
export function submitAction(scene, playerId, text) {
  if (scene?.status !== "open") throw new SceneError(409, "There is no open scene.");
  if (!memberOf(scene, playerId)) throw new SceneError(403, "That player is not in this scene.");
  if (scene.resolving) throw new SceneError(409, "The round is being narrated.");
  if (scene.actions[playerId]) throw new SceneError(409, "You already acted this round.");
  const action = String(text ?? "").trim().slice(0, ACTION_LIMIT);
  if (!action) throw new SceneError(400, "Write what your character does.");
  const actions = { ...scene.actions, [playerId]: action };
  const everyone = scene.members.every((member) => actions[member.playerId]);
  return { scene: { ...scene, actions, resolving: everyone }, everyone };
}

/** Claim a round whose narration failed: every member has acted and nobody is narrating it. */
export function claimRound(scene) {
  if (scene?.status !== "open") throw new SceneError(409, "There is no open scene.");
  if (scene.resolving || !scene.members.every((member) => scene.actions[member.playerId])) {
    throw new SceneError(409, "Nothing to retry.");
  }
  return { ...scene, resolving: true };
}

/** One line per party: the character a player controls, and who travels with them. */
const partyLine = (member) =>
  `- ${member.name}, a player character${member.companions?.length ? `, travelling with ${member.companions.join(", ")}` : ""}`;

const actionsOf = (scene) => scene.members.map((member) => ({ name: member.name, text: scene.actions[member.playerId] }));

/** The chat messages for the narration model. */
export function narrationMessages(scene, overview) {
  const recap = scene.log.slice(-RECAP_ROUNDS).map((entry) => entry.narration);
  const lines = actionsOf(scene).map((entry) => `${entry.name}: ${entry.text}`);
  return [
    {
      role: "system",
      content: [
        "You narrate one round of a scene that several players share in a text adventure, as a neutral narrator.",
        "Each player controls only their own character and privately wrote one action for this round. The players never see each other's wording, and nobody's wording is shown afterwards: your narration is the only record.",
        "Narrate what happens because of all the actions together, in vivid prose of about 120 to 250 words. Work every character's action into the story in your own words, including anything they say, so each player sees their character addressed. Do not quote the actions as a list and do not mention rounds, players or these instructions.",
        "Do not invent new actions or decisions for the player characters beyond what they wrote. You may voice other people in the scene.",
        overview ? `The world: ${overview}` : "",
        `Where they are: ${scene.place}.`,
        `The parties here, each led by a different player's character:\n${scene.members.map(partyLine).join("\n")}`,
        "An action may refer to another player's character loosely (for example \"the stranger\"). Prefer one of the parties above before inventing a new person.",
      ]
        .filter(Boolean)
        .join("\n"),
    },
    {
      role: "user",
      content: [
        recap.length ? `What happened so far in this scene:\n${recap.join("\n\n")}\n` : "",
        `This round's actions:\n${lines.join("\n")}`,
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];
}

/** The text appended to every member's chat. The players' own wording stays private: only the narration is shown. */
export const transcript = (_scene, narration) => narration.trim();

/** The scene after a round resolved. */
export function endRound(scene, narration, at) {
  const entry = { round: scene.round, at, narration: narration.trim() };
  return { ...scene, round: scene.round + 1, actions: {}, resolving: false, log: [...scene.log, entry].slice(-LOG_LIMIT) };
}

/** A resolving claim that failed gives the round back: actions are kept, the narration can be retried. */
export const reopenRound = (scene) => ({ ...scene, resolving: false });

/** What one viewer may see: everyone's resolved rounds, who has acted, and only their own pending action. */
export function sceneView(scene, viewerId) {
  if (scene?.status !== "open") return null;
  return {
    id: scene.id,
    round: scene.round,
    place: scene.place,
    resolving: scene.resolving,
    members: scene.members.map((member) => ({ playerId: member.playerId, name: member.name, acted: Boolean(scene.actions[member.playerId]) })),
    mine: scene.actions[viewerId] ?? null,
    log: scene.log,
  };
}
