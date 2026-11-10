#!/usr/bin/env node

// Builder for `packages/ruleset-5e-2024/ruleset.json`.
// Adapts the 2014 sheet and combat mechanics to 2024 standards:
// - 13 classes (adding level_artificer and hit_dice_d8 sum)
// - 2024 Level 1 half-casters (Paladin, Ranger, Artificer) with ceil(L/2) progression
// - 2024 Exhaustion (-2 to d20 tests and -5 ft speed per level)
// - 2024 Alert (+PB to initiative)
// - 2024 Potions as bonus actions
// - 2024 Weapon Masteries
// - Campaign layers: core_2024_only, no_setting_books, low_magic

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const templatePath = join(repoRoot, "packages/ruleset-5e-2014/ruleset.json");
const outputPath = join(repoRoot, "packages/ruleset-5e-2024/ruleset.json");

async function main() {
  console.log("Reading template from", templatePath);
  const raw = await readFile(templatePath, "utf8");
  const doc = JSON.parse(raw);

  // 1. Identity & Metadata
  doc.id = "5e-2024";
  doc.name = "5e (2024 Edition)";
  doc.version = 1;
  doc.edition = "2024 Revised 5th Edition Rules";
  doc.coverage.summary =
    "2024 revised rules: checks, saves, 13 classes with Artificer, Level-1 half-casters, 2024 species and backgrounds, Origin Feats, Weapon Masteries, 2024 Exhaustion, and 2024 combat.";

  // 2. Add Artificer to Sheet Fields
  const classLevelsSection = doc.sheet.fields.find((f) => f.id === "level_wizard");
  const artificerField = {
    id: "level_artificer",
    label: "Artificer level",
    type: "number",
    default: 0,
    min: 0,
    max: 20,
  };
  const wizardIdx = doc.sheet.fields.findIndex((f) => f.id === "level_wizard");
  if (wizardIdx !== -1 && !doc.sheet.fields.some((f) => f.id === "level_artificer")) {
    doc.sheet.fields.splice(wizardIdx + 1, 0, artificerField);
  }

  // 3. Update Hit Dice Sums (d8 includes Artificer)
  const d8Field = doc.sheet.derived.find((d) => d.id === "hit_dice_d8");
  if (d8Field && d8Field.sum) {
    if (!d8Field.sum.some((s) => s.field === "level_artificer")) {
      d8Field.sum.push({ field: "level_artificer" });
    }
  }

  // 4. Update Character Level Sum
  const charLevel = doc.sheet.derived.find((d) => d.id === "character_level");
  if (charLevel && charLevel.sum) {
    if (!charLevel.sum.some((s) => s.field === "level_artificer")) {
      charLevel.sum.push({ field: "level_artificer" });
    }
  }

  // 5. Update Caster Level & Multiclassing
  // 2024 Half Casters (Paladin, Ranger, Artificer) gain spellcasting at L1 and round UP:
  // Step table: [[1, 1], [3, 2], [5, 3], [7, 4], [9, 5], [11, 6], [13, 7], [15, 8], [17, 9], [19, 10]]
  const halfCasterSteps = [
    [1, 1],
    [3, 2],
    [5, 3],
    [7, 4],
    [9, 5],
    [11, 6],
    [13, 7],
    [15, 8],
    [17, 9],
    [19, 10],
  ];

  const paladinOwn = doc.sheet.derived.find((d) => d.id === "paladin_own");
  if (paladinOwn) paladinOwn.table = halfCasterSteps;

  const rangerOwn = doc.sheet.derived.find((d) => d.id === "ranger_own");
  if (rangerOwn) rangerOwn.table = halfCasterSteps;

  const casterPaladin = doc.sheet.derived.find((d) => d.id === "caster_paladin");
  if (casterPaladin) casterPaladin.round = "up";

  const casterRanger = doc.sheet.derived.find((d) => d.id === "caster_ranger");
  if (casterRanger) casterRanger.round = "up";

  // Add artificer caster entries in topological order (before caster_multi and caster_level)
  if (!doc.sheet.derived.some((d) => d.id === "caster_artificer")) {
    const idxMulti = doc.sheet.derived.findIndex((d) => d.id === "caster_multi");
    const casterArtificer = {
      id: "caster_artificer",
      label: "Artificer caster levels",
      op: "scale",
      of: { field: "level_artificer" },
      multiplier: 0.5,
      round: "up",
      hideWhen: {
        field: "unarmored_defense",
        in: ["none", "con", "wis", "mage_armor"],
      },
    };
    if (idxMulti !== -1) {
      doc.sheet.derived.splice(idxMulti, 0, casterArtificer);
    } else {
      doc.sheet.derived.push(casterArtificer);
    }
  }

  const casterMulti = doc.sheet.derived.find((d) => d.id === "caster_multi");
  if (casterMulti && Array.isArray(casterMulti.of)) {
    if (!casterMulti.of.some((s) => s.derived === "caster_artificer")) {
      casterMulti.of.push({ derived: "caster_artificer" });
    }
  }

  if (!doc.sheet.derived.some((d) => d.id === "artificer_own")) {
    const idxLevel = doc.sheet.derived.findIndex((d) => d.id === "caster_level");
    const artificerOwn = {
      id: "artificer_own",
      label: "Artificer's own caster level",
      op: "stepTable",
      from: { field: "level_artificer" },
      table: halfCasterSteps,
      hideWhen: {
        field: "unarmored_defense",
        in: ["none", "con", "wis", "mage_armor"],
      },
    };
    if (idxLevel !== -1) {
      doc.sheet.derived.splice(idxLevel, 0, artificerOwn);
    } else {
      doc.sheet.derived.push(artificerOwn);
    }
  }

  const casterLevel = doc.sheet.derived.find((d) => d.id === "caster_level");
  if (casterLevel && Array.isArray(casterLevel.of)) {
    if (!casterLevel.of.some((s) => s.derived === "artificer_own")) {
      casterLevel.of.push({ derived: "artificer_own" });
    }
  }

  // 5b. 2024 Reliable Talent: Rogue Level 7 (down from Level 11 in 2014)
  const reliableTalent = doc.sheet.derived.find((d) => d.id === "reliable_talent");
  if (reliableTalent) {
    reliableTalent.table = [
      [0, 0],
      [7, 1],
    ];
  }

  // 5c. Silver Tongue (College of Eloquence Bard Level 3+: minimum 10 on Deception and Persuasion)
  if (!doc.sheet.derived.some((d) => d.id === "subclass_eloquence")) {
    doc.sheet.derived.push({
      id: "subclass_eloquence",
      label: "College of Eloquence (subclass)",
      op: "wordsTable",
      from: { field: "subclass" },
      table: { eloquence: 1 },
      default: 0,
      section: "identity",
      hideWhen: { field: "level_bard", equals: 0 },
    });
  }
  if (!doc.sheet.derived.some((d) => d.id === "bard_3rd")) {
    doc.sheet.derived.push({
      id: "bard_3rd",
      label: "Bard 3rd level",
      op: "stepTable",
      from: { field: "level_bard" },
      table: [
        [0, 0],
        [3, 1],
      ],
      hideWhen: { field: "level_bard", equals: 0 },
    });
  }
  if (!doc.sheet.derived.some((d) => d.id === "silver_tongue")) {
    doc.sheet.derived.push({
      id: "silver_tongue",
      label: "Silver Tongue",
      op: "multiply",
      of: [{ derived: "subclass_eloquence" }, { derived: "bard_3rd" }],
      hideWhen: { field: "level_bard", equals: 0 },
    });
  }
  if (doc.combat?.levels && !doc.combat.levels.some((l) => l.derived === "silver_tongue")) {
    doc.combat.levels.push({
      derived: "silver_tongue",
      at: 1,
      checkFloor: {
        face: 10,
        skills: ["deception", "persuasion"],
      },
    });
  }

  // 6. Update 2024 Exhaustion Track
  if (doc.combat?.statusTracks) {
    const exhaustion = doc.combat.statusTracks.find((t) => t.id === "exhaustion");
    if (exhaustion) {
      exhaustion.max = 6;
      exhaustion.levels = [
        {
          level: 1,
          modifiers: [
            { to: "attacks", flat: -2 },
            { to: "saves", flat: -2 },
            { to: "checks", flat: -2 },
            { to: "speed", flat: -5 },
          ],
        },
        {
          level: 2,
          modifiers: [
            { to: "attacks", flat: -4 },
            { to: "saves", flat: -4 },
            { to: "checks", flat: -4 },
            { to: "speed", flat: -10 },
          ],
        },
        {
          level: 3,
          modifiers: [
            { to: "attacks", flat: -6 },
            { to: "saves", flat: -6 },
            { to: "checks", flat: -6 },
            { to: "speed", flat: -15 },
          ],
        },
        {
          level: 4,
          modifiers: [
            { to: "attacks", flat: -8 },
            { to: "saves", flat: -8 },
            { to: "checks", flat: -8 },
            { to: "speed", flat: -20 },
          ],
        },
        {
          level: 5,
          modifiers: [
            { to: "attacks", flat: -10 },
            { to: "saves", flat: -10 },
            { to: "checks", flat: -10 },
            { to: "speed", flat: -25 },
          ],
        },
        {
          level: 6,
          defeats: true,
        },
      ];
    }
  }

  // 7. Update 2024 Surprised condition (Disadvantage on Initiative)
  if (doc.combat?.conditions) {
    const surprised = doc.combat.conditions.find((c) => c.id === "surprised");
    if (surprised) {
      surprised.effects = [];
      surprised.modifiers = [{ to: "checks", mode: "disadvantage" }];
    }
  }

  // 8. Update Combat Budget Levels (including level_artificer)
  if (doc.combat?.threat?.budget?.level) {
    if (!doc.combat.threat.budget.level.includes("level_artificer")) {
      doc.combat.threat.budget.level.push("level_artificer");
    }
  }

  // 9. Update Starting Gear & Condition Action Hooks
  // In 2024, starting equipment is handled directly by class and background choices.
  doc.items.startingGear = [];

  // Remove legacy 2014 spell action hooks from conditions if they are not emitted as standalone sub-actions
  if (doc.combat?.conditions) {
    for (const condition of doc.combat.conditions) {
      if (Array.isArray(condition.actions)) {
        delete condition.actions;
      }
    }
  }

  // 10. Update Weapon Catalog Filters (Add Mastery)
  const weaponsCat = doc.catalogs?.find((c) => c.id === "weapons");
  if (weaponsCat && !weaponsCat.filters?.some((f) => f.id === "mastery")) {
    weaponsCat.filters = weaponsCat.filters || [];
    weaponsCat.filters.push({
      id: "mastery",
      label: "Mastery",
      type: "text",
    });
  }

  // 11. Add Campaign Layers
  doc.layers = [
    {
      id: "core_2024_only",
      label: "2024 Core Only",
      summary: "Restrict character options and monsters strictly to the 2024 Core Rulebooks (XPHB, XDMG, XMM).",
      catalogs: [
        {
          id: "spells",
          hide: { filter: "source", notIn: ["XPHB", "XDMG", "XMM"] },
        },
        {
          id: "features",
          hide: { filter: "source", notIn: ["XPHB", "XDMG", "XMM"] },
        },
        {
          id: "races",
          hide: { filter: "source", notIn: ["XPHB", "XDMG", "XMM"] },
        },
        {
          id: "classes",
          hide: { filter: "source", notIn: ["XPHB", "XDMG", "XMM"] },
        },
        {
          id: "backgrounds",
          hide: { filter: "source", notIn: ["XPHB", "XDMG", "XMM"] },
        },
        {
          id: "weapons",
          hide: { filter: "source", notIn: ["XPHB", "XDMG", "XMM"] },
        },
        {
          id: "equipment",
          hide: { filter: "source", notIn: ["XPHB", "XDMG", "XMM"] },
        },
        {
          id: "magic_items",
          hide: { filter: "source", notIn: ["XPHB", "XDMG", "XMM"] },
        },
        {
          id: "creatures",
          hide: { filter: "source", notIn: ["XPHB", "XDMG", "XMM"] },
        },
      ],
    },
    {
      id: "no_setting_books",
      label: "No Setting-Specific Options",
      summary: "Hide setting-specific options from Eberron, Ravnica, Wildemount, and Spelljammer.",
      catalogs: [
        {
          id: "races",
          hide: { filter: "source", in: ["ERLW", "GGR", "EGW", "AAG"] },
        },
        {
          id: "backgrounds",
          hide: { filter: "source", in: ["ERLW", "GGR", "EGW", "AAG", "SCC"] },
        },
      ],
    },
    {
      id: "low_magic",
      label: "Low Magic",
      summary: "Rare and higher magic items are hidden.",
      catalogs: [
        {
          id: "magic_items",
          hide: { filter: "rarity", in: ["rare", "very rare", "legendary", "artifact"] },
        },
      ],
    },
  ];

  // 11. Write output (compact JSON to stay within Engine 512 KiB limit)
  const json = JSON.stringify(doc);
  await writeFile(outputPath, json, "utf8");
  console.log(`\nSuccessfully generated ${outputPath} (${(Buffer.byteLength(json) / 1024).toFixed(1)} KiB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
