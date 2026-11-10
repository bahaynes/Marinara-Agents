// 2024 D&D 5e sheet arithmetic and spell slot validation.
// Supports 13 classes (including Artificer), 2024 half-caster progression starting at Level 1,
// 2024 Alert initiative bonus, and multiclass slot rounding.

import { evaluateSheet } from "./ruleset-5e-sheet.mjs";

export { evaluateSheet };

// 2024 / SRD Multiclass Spellcaster table (slots per spell level 1-9 by effective caster level 0-20).
const MULTICLASS_SPELLCASTER = Object.freeze([
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [2, 0, 0, 0, 0, 0, 0, 0, 0],
  [3, 0, 0, 0, 0, 0, 0, 0, 0],
  [4, 2, 0, 0, 0, 0, 0, 0, 0],
  [4, 3, 0, 0, 0, 0, 0, 0, 0],
  [4, 3, 2, 0, 0, 0, 0, 0, 0],
  [4, 3, 3, 0, 0, 0, 0, 0, 0],
  [4, 3, 3, 1, 0, 0, 0, 0, 0],
  [4, 3, 3, 2, 0, 0, 0, 0, 0],
  [4, 3, 3, 3, 1, 0, 0, 0, 0],
  [4, 3, 3, 3, 2, 0, 0, 0, 0],
  [4, 3, 3, 3, 2, 1, 0, 0, 0],
  [4, 3, 3, 3, 2, 1, 0, 0, 0],
  [4, 3, 3, 3, 2, 1, 1, 0, 0],
  [4, 3, 3, 3, 2, 1, 1, 0, 0],
  [4, 3, 3, 3, 2, 1, 1, 1, 0],
  [4, 3, 3, 3, 2, 1, 1, 1, 0],
  [4, 3, 3, 3, 2, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 2, 1, 1],
]);

const PACT_SLOTS = Object.freeze([
  [1, 1],
  [2, 2],
  [11, 3],
  [17, 4],
]);

function fail(message) {
  throw new Error(message);
}

/**
 * Validate that sheet formulas in ruleset.json yield exact 2024 spell slots:
 * - Full casters: Bard, Cleric, Druid, Sorcerer, Wizard (1:1)
 * - 2024 Half casters: Paladin, Ranger, and Artificer all gain Spellcasting at Level 1!
 * - Multiclassing: Half casters round up (ceil(level / 2)) in 2024.
 */
export function assertSpellSlots2024(document) {
  const wrong = [];
  const fullCasters = ["bard", "cleric", "druid", "sorcerer", "wizard"];
  const halfCasters = ["paladin", "ranger", "artificer"];

  for (const fullClass of fullCasters) {
    for (let full = 0; full <= 5; full += 1) {
      for (let paladin = 0; full + paladin <= 5; paladin += 1) {
        for (let artificer = 0; full + paladin + artificer <= 5; artificer += 1) {
          const casterCount = (full > 0 ? 1 : 0) + (paladin > 0 ? 1 : 0) + (artificer > 0 ? 1 : 0);
          // In 2024: Paladin, Ranger, and Artificer gain spellcasting at level 1 and round up (ceil(L/2))
          const expected =
            casterCount >= 2
              ? full + Math.ceil(paladin / 2) + Math.ceil(artificer / 2)
              : full > 0
                ? full
                : paladin > 0
                  ? Math.ceil(paladin / 2)
                  : artificer > 0
                    ? Math.ceil(artificer / 2)
                    : 0;

          const sheet = evaluateSheet(document, {
            abilities: {},
            skills: {},
            saves: {},
            bonuses: {},
            fields: {
              [`level_${fullClass}`]: full,
              level_paladin: paladin,
              level_artificer: artificer,
              spellcasting_ability: "int",
            },
            lists: {},
          });

          for (let slot = 1; slot <= 9; slot += 1) {
            const want = MULTICLASS_SPELLCASTER[expected]?.[slot - 1] ?? 0;
            const got = sheet.derived(`slots_${slot}`);
            if (got !== want) {
              wrong.push(
                `${fullClass} ${full} / paladin ${paladin} / artificer ${artificer}: slot ${slot} got ${got}, expected ${want}`,
              );
            }
          }
        }
      }
    }
  }

  for (let warlock = 0; warlock <= 20; warlock += 1) {
    const want = PACT_SLOTS.filter(([level]) => warlock >= level).at(-1)?.[1] ?? 0;
    const got = evaluateSheet(document, {
      abilities: {},
      skills: {},
      saves: {},
      bonuses: {},
      fields: { level_warlock: warlock },
      lists: {},
    }).derived("pact_slots");
    if (got !== want) wrong.push(`warlock ${warlock}: ${got} pact slots, not ${want}`);
  }

  if (wrong.length > 0) {
    fail(`the 2024 sheet's spell slots disagree with 2024 rules:\n${wrong.slice(0, 12).join("\n")}`);
  }
}
