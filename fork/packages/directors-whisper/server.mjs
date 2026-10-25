// The Director's Whisper: zero-cost pre-generation prompt contributor.
// Deterministically inspects Foreshadow Vault seeds in the game state tracker.
// Injects payoff directives ONLY when one or more seeds have status == "ready",
// returning null (zero injection, zero LLM overhead) when dormant or empty.

import { promises as fs, existsSync } from "node:fs";
import { join } from "node:path";

export const PACKAGE_ID = "directors-whisper";
const MODES = new Set(["roleplay", "game"]);

export const isEnabled = (meta, mode) =>
  MODES.has(mode) &&
  meta?.enableAgents === true &&
  Array.isArray(meta.activeAgentIds) &&
  meta.activeAgentIds.includes(PACKAGE_ID);

/**
 * Encodes a raw string key into a case-safe shard filename base,
 * matching the engine's file-backed storage encoding (file-backed-store.ts).
 */
export function encodeShardKey(rawKey) {
  if (!rawKey) return "orphaned-rows";
  let encoded = "";
  for (const byte of Buffer.from(rawKey, "utf8")) {
    const char = String.fromCharCode(byte);
    encoded += /[a-z0-9-]/.test(char) ? char : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return encoded;
}

/**
 * Returns candidate directories where game_state_snapshots shards are stored.
 */
export function getCandidateStorageDirs() {
  const candidates = [];
  if (process.env.DATA_DIR) {
    candidates.push(join(process.env.DATA_DIR, "storage", "tables", "game_state_snapshots"));
  }
  candidates.push(
    "/mnt/faststorage/marinara/data/storage/tables/game_state_snapshots",
    join(process.cwd(), "data", "storage", "tables", "game_state_snapshots"),
    join(process.cwd(), "packages", "server", "data", "storage", "tables", "game_state_snapshots"),
  );
  return candidates;
}

/**
 * Reads Foreshadow Vault seeds from the latest snapshot of a chat.
 */
export async function readForeshadowSeeds(chatId, candidateDirs = getCandidateStorageDirs()) {
  if (!chatId) return [];
  const encodedName = `${encodeShardKey(chatId)}.json`;

  for (const dir of candidateDirs) {
    try {
      if (!existsSync(dir)) continue;
      const filePath = join(dir, encodedName);
      if (!existsSync(filePath)) continue;

      const raw = await fs.readFile(filePath, "utf8");
      const list = JSON.parse(raw);
      if (!Array.isArray(list) || list.length === 0) continue;

      const latest = list
        .slice()
        .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0];
      if (!latest || !latest.playerStats) continue;

      const ps = typeof latest.playerStats === "string" ? JSON.parse(latest.playerStats) : latest.playerStats;
      const customFields = Array.isArray(ps?.customTrackerFields) ? ps.customTrackerFields : [];
      const vaultField = customFields.find((f) => f && f.name === "Foreshadow Vault");
      if (!vaultField || !vaultField.value) continue;

      const seeds = typeof vaultField.value === "string" ? JSON.parse(vaultField.value) : vaultField.value;
      if (Array.isArray(seeds)) return seeds;
    } catch {
      // Ignore read/parse errors and try next candidate or return empty
    }
  }

  return [];
}

/**
 * Formats payoff directive for any seeds with status == "ready".
 * Returns null if no seeds are ready.
 */
export function formatWhisperDirective(seeds) {
  if (!Array.isArray(seeds) || seeds.length === 0) return null;

  const readySeeds = seeds.filter((s) => s && typeof s === "object" && s.status === "ready");
  if (readySeeds.length === 0) return null;

  const lines = readySeeds.map((s) => {
    const concept = s.concept || s.id || "Foreshadowed event";
    const prompt = s.payoffPrompt || s.condition || concept;
    return `- ${concept}: ${prompt}`;
  });

  return (
    "[DIRECTOR'S NOTE — FORESHADOWING PAYOFF]\n" +
    "Bring this foreshadowed element into the scene:\n" +
    lines.join("\n") +
    "\nIntegrate this naturally into the ongoing action without forcing it awkwardly."
  );
}

/**
 * Creates the prompt-context contributor.
 */
export function createWhisperContributor(options = {}) {
  return async function whisperContributor(request) {
    if (!request || !isEnabled(request.chatMeta, request.mode)) return null;

    let seeds = null;
    if (typeof options.getSeeds === "function") {
      seeds = await options.getSeeds(request.chatId);
    } else {
      seeds = await readForeshadowSeeds(request.chatId, options.candidateDirs);
    }

    return formatWhisperDirective(seeds);
  };
}

/**
 * Capability package activation entrypoint.
 */
export async function activate(context) {
  const contributor = createWhisperContributor();
  const release = context.api.registerPromptContext(contributor);
  return () => {
    if (typeof release === "function") release();
  };
}
