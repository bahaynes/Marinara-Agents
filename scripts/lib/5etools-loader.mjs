// Loader and resolver for 5etools JSON data dumps.
// Handles directory scanning, owned source filtering, 2024-first deduplication,
// and cross-entity inheritance (_copy/_mod).

import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function loadOwnedConfig(configPath) {
  const raw = await readFile(configPath, "utf8");
  return JSON.parse(raw);
}

/**
 * Filter and deduplicate a list of 5etools entities according to owned books and 2024 precedence.
 *
 * Rules:
 * 1. An entity is included if its `source` is marked `"owned": true` in config.
 * 2. 2024 entries (`XPHB`, `XDMG`, `XMM`) take priority over 2014 entries (`PHB`, `DMG`, `MM`, `TCE`, etc.)
 *    when they share the same canonical name or carry a `reprintedAs` link.
 * 3. Returns a Map of `id` -> `entity`.
 */
export function deduplicate2024First(items, ownedSources, core2024 = new Set(["XPHB", "XDMG", "XMM"])) {
  const result = new Map();
  const byName = new Map();

  // First pass: Index 2024 core items
  for (const item of items) {
    if (!item || !item.name || !item.source) continue;
    const src = item.source.toUpperCase();
    if (!ownedSources.has(src)) continue;

    if (core2024.has(src)) {
      const key = item.name.toLowerCase();
      byName.set(key, item);
      result.set(toCatalogId(item.name), item);
    }
  }

  // Second pass: Add legacy/supplement items only if not superseded in 2024
  for (const item of items) {
    if (!item || !item.name || !item.source) continue;
    const src = item.source.toUpperCase();
    if (!ownedSources.has(src)) continue;
    if (core2024.has(src)) continue; // Already added

    const key = item.name.toLowerCase();
    // Check if superseded by 2024 core
    if (byName.has(key)) {
      continue; // 2024 version wins
    }

    // Check if it has an explicit reprintedAs pointing to a 2024 core source
    if (Array.isArray(item.reprintedAs)) {
      const has2024Reprint = item.reprintedAs.some((r) => {
        const str = typeof r === "string" ? r : r?.source || r?.name || "";
        return [...core2024].some((c) => str.toUpperCase().includes(c));
      });
      if (has2024Reprint) continue;
    }

    byName.set(key, item);
    result.set(toCatalogId(item.name), item);
  }

  return result;
}

/**
 * Convert a display name (e.g. "Cure Wounds", "Mind Flayer", "Artificer") into a valid
 * Marinara catalog entry ID (`RULESET_CATALOG_ENTRY_ID_PATTERN`: /^[a-z0-9]+(?:-[a-z0-9]+)*$/).
 */
export function toCatalogId(name) {
  return name
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
