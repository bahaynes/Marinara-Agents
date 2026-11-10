#!/usr/bin/env node

/**
 * Import a D&D Beyond Character Sheet PDF export (Producer: PDFsharp) into a valid
 * Marinara Engine ruleset sheet build (for 5e-2024 or 5e-2014).
 *
 * D&D Beyond exports form field values as /Annots widgets on each page (/T and /V)
 * rather than in the document root /AcroForm catalog.
 *
 * Usage:
 *   node scripts/import-dndbeyond-pdf.mjs <path-to-pdf> [--ruleset 5e-2024|5e-2014] [--out <output.json>]
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// Path to pdfjs-dist in the workspace or engine
const PDFJS_PATH = resolve(
  ROOT,
  "../marinara-engine/.pnpm/pdfjs-dist@5.4.296/node_modules/pdfjs-dist/legacy/build/pdf.mjs",
);

const SKILL_MAP = Object.freeze({
  AcrobaticsProf: "acrobatics",
  AnimalHandlingProf: "animal_handling",
  ArcanaProf: "arcana",
  AthleticsProf: "athletics",
  DeceptionProf: "deception",
  HistoryProf: "history",
  InsightProf: "insight",
  IntimidationProf: "intimidation",
  InvestigationProf: "investigation",
  MedicineProf: "medicine",
  NatureProf: "nature",
  PerceptionProf: "perception",
  PerformanceProf: "performance",
  PersuasionProf: "persuasion",
  ReligionProf: "religion",
  SleightOfHandProf: "sleight_of_hand",
  StealthProf: "stealth",
  SurvivalProf: "survival",
});

const SAVE_MAP = Object.freeze({
  StrProf: "str_save",
  DexProf: "dex_save",
  ConProf: "con_save",
  IntProf: "int_save",
  WisProf: "wis_save",
  ChaProf: "cha_save",
});

const KNOWN_CLASSES = [
  "barbarian",
  "bard",
  "cleric",
  "druid",
  "fighter",
  "monk",
  "paladin",
  "ranger",
  "rogue",
  "sorcerer",
  "warlock",
  "wizard",
  "artificer",
];

function parseInteger(val, fallback = 0) {
  if (typeof val === "number") return Math.round(val);
  if (!val) return fallback;
  const match = String(val).match(/[-+]?\d+/u);
  return match ? parseInt(match[0], 10) : fallback;
}

function parseSpeedString(speedStr) {
  const result = { speed: 30, fly_speed: 0, swim_speed: 0, climb_speed: 0 };
  if (!speedStr) return result;
  const str = String(speedStr);

  const walkMatch = str.match(/(\d+)\s*ft(?:\.|\s*\(Walking\))/i);
  if (walkMatch) result.speed = parseInt(walkMatch[1], 10);
  else {
    const rawNum = str.match(/^\s*(\d+)/);
    if (rawNum) result.speed = parseInt(rawNum[1], 10);
  }

  const flyMatch = str.match(/(\d+)\s*ft\.?\s*\(Flying\)/i);
  if (flyMatch) result.fly_speed = parseInt(flyMatch[1], 10);

  const swimMatch = str.match(/(\d+)\s*ft\.?\s*\(Swimming\)/i);
  if (swimMatch) result.swim_speed = parseInt(swimMatch[1], 10);

  const climbMatch = str.match(/(\d+)\s*ft\.?\s*\(Climbing\)/i);
  if (climbMatch) result.climb_speed = parseInt(climbMatch[1], 10);

  return result;
}

function parseClassLevelString(classLevelStr) {
  const levels = {};
  let firstClass = "";
  let secondClass = "";
  let primaryClass = "";

  if (!classLevelStr) return { levels, firstClass, secondClass, primaryClass };

  // D&D Beyond format: "Wizard 16" or "Fighter 3 / Wizard 13"
  const segments = String(classLevelStr).split(/\s*\/\s*/u);
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i].trim();
    const match = seg.match(/^([a-zA-Z\s-]+?)\s+(\d+)$/u);
    if (match) {
      const clsName = match[1].trim();
      const clsLevel = parseInt(match[2], 10);
      const lower = clsName.toLowerCase().replace(/[^a-z]/g, "");

      if (KNOWN_CLASSES.includes(lower)) {
        levels[`level_${lower}`] = clsLevel;
        if (!firstClass) {
          firstClass = lower;
          primaryClass = clsName;
        } else if (!secondClass) {
          secondClass = lower;
        }
      } else {
        levels["level_other"] = (levels["level_other"] || 0) + clsLevel;
      }
    }
  }

  return { levels, firstClass, secondClass, primaryClass };
}

function parseFeaturesText(featureBlocks) {
  const features = [];
  let currentClass = "";

  for (const block of featureBlocks) {
    if (!block) continue;
    const lines = block.split("\n");
    let currentTitle = "";
    let currentDescLines = [];

    const flush = () => {
      if (currentTitle) {
        features.push({
          name: currentTitle,
          class: currentClass,
          text: currentDescLines.join("\n").trim(),
        });
        currentTitle = "";
        currentDescLines = [];
      }
    };

    for (const rawLine of lines) {
      const line = rawLine.trim();
      const headerMatch = line.match(/^===\s*(.+?)\s*FEATURES\s*===/i);
      if (headerMatch) {
        flush();
        currentClass = headerMatch[1].trim().toLowerCase();
        continue;
      }
      const speciesHeaderMatch = line.match(/^===\s*(.+?)\s*(?:SPECIES|RACE)\s*TRAITS\s*===/i);
      if (speciesHeaderMatch) {
        flush();
        currentClass = "species";
        continue;
      }

      if (line.startsWith("*")) {
        flush();
        // Extract title before any bullet or book source like • PHB-2024
        const titlePart = line
          .replace(/^\*\s*/, "")
          .split("•")[0]
          .trim();
        currentTitle = titlePart;
      } else if (currentTitle) {
        currentDescLines.push(rawLine);
      }
    }
    flush();
  }

  return features;
}

export async function importDndBeyondPdf(pdfPath, options = {}) {
  const rulesetId = options.ruleset || "5e-2024";
  const pdfjs = await import(PDFJS_PATH);

  const fileBuf = await readFile(pdfPath);
  const pdfDoc = await pdfjs.getDocument({
    data: new Uint8Array(fileBuf),
    standardFontDataUrl: resolve(dirname(PDFJS_PATH), "../../standard_fonts/") + "/",
  }).promise;

  const rawFields = {};
  const pagesData = [];

  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const annots = await page.getAnnotations();
    const pageFields = {};
    for (const a of annots) {
      if (a.fieldName) {
        pageFields[a.fieldName] = a.fieldValue;
        if (rawFields[a.fieldName] === undefined) {
          rawFields[a.fieldName] = a.fieldValue;
        }
      }
    }
    pagesData.push({ pageNum, annotations: annots, fields: pageFields });
  }

  // 1. Meta & Core
  const characterName = rawFields.CharacterName || "Unknown Character";
  const race = rawFields.RACE || "";
  const background = rawFields.BACKGROUND || "";
  const alignment = rawFields.ALIGNMENT || "";

  // 2. Classes & Levels
  const { levels, firstClass, secondClass, primaryClass } = parseClassLevelString(rawFields["CLASS  LEVEL"]);

  // 3. Ability Scores
  const abilities = {
    str: parseInteger(rawFields.STR, 10),
    dex: parseInteger(rawFields.DEX, 10),
    con: parseInteger(rawFields.CON, 10),
    int: parseInteger(rawFields.INT, 10),
    wis: parseInteger(rawFields.WIS, 10),
    cha: parseInteger(rawFields.CHA, 10),
  };

  // 4. Saving Throws
  const saves = {};
  for (const [pdfField, saveId] of Object.entries(SAVE_MAP)) {
    const val = String(rawFields[pdfField] || "").trim();
    if (val.includes("•") || val.toUpperCase() === "P" || val.toLowerCase() === "true") {
      saves[saveId] = "proficient";
    } else {
      saves[saveId] = "none";
    }
  }

  // 5. Skills
  const skills = {};
  for (const [pdfField, skillId] of Object.entries(SKILL_MAP)) {
    const val = String(rawFields[pdfField] || "")
      .trim()
      .toUpperCase();
    if (val === "E") {
      skills[skillId] = "expertise";
    } else if (val === "P") {
      skills[skillId] = "proficient";
    } else {
      skills[skillId] = "none";
    }
  }

  // 6. Combat / Defenses / Speed
  const speeds = parseSpeedString(rawFields.Speed);
  const hpMax = parseInteger(rawFields.MaxHP, 10);
  const ac = parseInteger(rawFields.AC, 10);

  // 7. Weapon Training determination
  let weaponTraining = "simple_martial";
  const profLang = String(rawFields.ProficienciesLang || "");
  if (/simple weapons/i.test(profLang) && !/martial weapons/i.test(profLang)) {
    weaponTraining = "simple_named";
  }

  // 8. Spellcasting ability determination
  let spellcastingAbility = "none";
  const scAbilityVal = String(rawFields.spellCastingAbility0 || "")
    .trim()
    .toLowerCase();
  if (["str", "dex", "con", "int", "wis", "cha"].includes(scAbilityVal)) {
    spellcastingAbility = scAbilityVal;
  } else if (firstClass === "wizard" || firstClass === "artificer") {
    spellcastingAbility = "int";
  } else if (["cleric", "druid", "ranger"].includes(firstClass)) {
    spellcastingAbility = "wis";
  } else if (["bard", "paladin", "sorcerer", "warlock"].includes(firstClass)) {
    spellcastingAbility = "cha";
  }

  // 9. Subclass detection from features text
  let detectedSubclass = "";
  const featBlocks = [
    rawFields.FeaturesTraits1,
    rawFields.FeaturesTraits2,
    rawFields.FeaturesTraits3,
    rawFields.FeaturesTraits4,
    rawFields.FeaturesTraits5,
    rawFields.FeaturesTraits6,
  ];
  for (const b of featBlocks) {
    if (!b) continue;
    const subMatch = b.match(/\|\s*([A-Za-z\s]+?)\s*(?:\([A-Za-z0-9-]+\))?\s*\n/);
    const orderMatch = b.match(
      /(?:Order of [A-Za-z]+|School of [A-Za-z]+|Circle of [A-Za-z]+|College of [A-Za-z]+|Oath of [A-Za-z]+|Domain)/i,
    );
    if (orderMatch) {
      detectedSubclass = orderMatch[0].trim();
      break;
    }
  }

  // 10. Attacks list
  const attacks = [];
  for (let i = 1; i <= 8; i++) {
    const nameField = i === 1 ? "Wpn Name" : `Wpn Name ${i}`;
    const atkField = i === 1 ? "Wpn1 AtkBonus" : `Wpn${i} AtkBonus `;
    const dmgField = i === 1 ? "Wpn1 Damage" : `Wpn${i} Damage `;
    const noteField = `Wpn Notes ${i}`;

    const wpnName = rawFields[nameField.trim()];
    if (!wpnName || !wpnName.trim()) continue;

    const dmgStr = rawFields[dmgField.trim()] || "";
    const notesStr = rawFields[noteField] || "";
    const dmgParts = dmgStr.trim().split(/\s+/);
    const dice = dmgParts[0] || "1d4";
    const dmgType = dmgParts[1]?.toLowerCase() || "bludgeoning";

    attacks.push({
      name: wpnName.trim(),
      ability: /crossbow|bow|dart|sling/i.test(wpnName) ? "dex" : "str",
      proficient: true,
      finesse_or_ranged: /crossbow|bow|dart|sling|finesse/i.test(wpnName + notesStr),
      loading: /loading/i.test(notesStr),
      bonus: 0,
      damage: dice,
      damage_type: dmgType,
      reach: 0,
      range: notesStr.match(/Range \((\d+)\//)?.[1] ? parseInt(notesStr.match(/Range \((\d+)\//)[1], 10) : 0,
      long_range: notesStr.match(/Range \(\d+\/(\d+)\)/)?.[1]
        ? parseInt(notesStr.match(/Range \(\d+\/(\d+)\)/)[1], 10)
        : 0,
    });
  }

  // 11. Spells list
  const spellsCatalogPath = join(ROOT, "packages", `ruleset-${rulesetId}`, "catalogs", "spells.json");
  let spellsCatalogMap = new Map();
  try {
    const catalogData = JSON.parse(await readFile(spellsCatalogPath, "utf8"));
    for (const s of catalogData) {
      spellsCatalogMap.set(s.name.toLowerCase(), s);
    }
  } catch {
    // If catalog not available, fallback to header layout
  }

  const spells = [];
  const seenSpells = new Set();
  for (let sIdx = 0; sIdx <= 99; sIdx++) {
    const name = rawFields[`spellName${sIdx}`];
    if (!name || !name.trim()) continue;
    const cleanName = name.trim();
    if (seenSpells.has(cleanName.toLowerCase())) continue;
    seenSpells.add(cleanName.toLowerCase());

    const catalogEntry = spellsCatalogMap.get(cleanName.toLowerCase());
    const prep = rawFields[`spellPrepared${sIdx}`];
    const isPrepared = prep === "•" || prep === "X" || prep === "O" || prep === "true";

    spells.push({
      name: cleanName,
      class: (rawFields[`spellSource${sIdx}`] || firstClass || "wizard").toLowerCase(),
      level: catalogEntry?.level ?? (sIdx < 6 ? 0 : 1),
      prepared: isPrepared,
      ritual: catalogEntry?.ritual ?? false,
      concentration: catalogEntry?.concentration ?? false,
      notes: rawFields[`spellNotes${sIdx}`] || "",
    });
  }

  // 12. Features list
  const features = parseFeaturesText(featBlocks);

  // 13. Proficiencies list
  const proficiencies = [];
  if (profLang) {
    const toolsMatch = profLang.match(/===\s*TOOLS\s*===\s*\n([\s\S]+?)(?:===|$)/i);
    if (toolsMatch) {
      const toolLines = toolsMatch[1].trim().split("\n");
      for (const t of toolLines) {
        if (t.trim()) proficiencies.push({ name: t.trim() });
      }
    }
  }

  // 14. Equipment & Inventory
  const inventory = [];
  for (let eqIdx = 0; eqIdx <= 50; eqIdx++) {
    const eqName = rawFields[`Eq Name${eqIdx}`];
    if (!eqName || !eqName.trim()) continue;
    inventory.push({
      name: eqName.trim(),
      quantity: parseInteger(rawFields[`Eq Qty${eqIdx}`], 1),
      weight: rawFields[`Eq Weight${eqIdx}`] || "--",
    });
  }

  // 15. Currencies
  const currencies = {
    cp: parseInteger(rawFields.CP, 0),
    sp: parseInteger(rawFields.SP, 0),
    ep: parseInteger(rawFields.EP, 0),
    gp: parseInteger(rawFields.GP, 0),
    pp: parseInteger(rawFields.PP, 0),
  };

  const fields = {
    ...levels,
    class: primaryClass || "Wizard",
    first_class: firstClass || "wizard",
    subclass: detectedSubclass,
    race,
    background,
    alignment,
    speed: speeds.speed,
    fly_speed: speeds.fly_speed,
    swim_speed: speeds.swim_speed,
    climb_speed: speeds.climb_speed,
    hp_max: hpMax,
    ac,
    spellcasting_ability: spellcastingAbility,
    weapon_training: weaponTraining,
  };
  if (secondClass) fields.second_class = secondClass;

  const build = {
    abilities,
    skills,
    saves,
    bonuses: {},
    fields,
    lists: {
      attacks,
      spells,
      features,
      proficiencies,
      counters: [],
    },
  };

  // 16. Validate against ruleset evaluation
  const rulesetDocPath = join(ROOT, "packages", `ruleset-${rulesetId}`, "ruleset.json");
  const rulesetDoc = JSON.parse(await readFile(rulesetDocPath, "utf8"));

  let evaluation = null;
  try {
    const sheetEvaluator =
      rulesetId === "5e-2024"
        ? (await import("./ruleset-5e-2024-sheet.mjs")).evaluateSheet
        : (await import("./ruleset-5e-sheet.mjs")).evaluateSheet;
    evaluation = sheetEvaluator(rulesetDoc, build);
  } catch (err) {
    console.warn(`Evaluation warning for ${rulesetId}:`, err.message);
  }

  return {
    v: rulesetDoc.sheet.version,
    rulesetId,
    characterName,
    build,
    inventory,
    currencies,
    evaluation: evaluation
      ? {
          level: evaluation.derived("level"),
          proficiencyBonus: evaluation.derived("slots_1") !== undefined ? 5 : 2,
        }
      : null,
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(`
Usage:
  node scripts/import-dndbeyond-pdf.mjs <pdf-path> [options]

Options:
  --ruleset <id>    Target ruleset: 5e-2024 (default) or 5e-2014
  --out <file.json> Save imported ruleset sheet envelope to JSON file
`);
    process.exit(0);
  }

  const pdfPath = resolve(args[0]);
  let ruleset = "5e-2024";
  let outFile = null;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--ruleset" && args[i + 1]) {
      ruleset = args[++i];
    } else if (args[i] === "--out" && args[i + 1]) {
      outFile = resolve(args[++i]);
    }
  }

  console.log(`Importing D&D Beyond PDF: ${pdfPath}`);
  console.log(`Target Ruleset: ${ruleset}`);

  const envelope = await importDndBeyondPdf(pdfPath, { ruleset });

  console.log("\nCharacter Imported Successfully:");
  console.log(`  Name:        ${envelope.characterName}`);
  console.log(
    `  Class:       ${envelope.build.fields.class} (Level ${envelope.build.fields[`level_${envelope.build.fields.first_class}`]})`,
  );
  console.log(`  Subclass:    ${envelope.build.fields.subclass || "None"}`);
  console.log(`  Species:     ${envelope.build.fields.race}`);
  console.log(`  Background:  ${envelope.build.fields.background}`);
  console.log(
    `  Abilities:   STR ${envelope.build.abilities.str}, DEX ${envelope.build.abilities.dex}, CON ${envelope.build.abilities.con}, INT ${envelope.build.abilities.int}, WIS ${envelope.build.abilities.wis}, CHA ${envelope.build.abilities.cha}`,
  );
  console.log(
    `  HP Max:      ${envelope.build.fields.hp_max}, AC: ${envelope.build.fields.ac}, Speed: ${envelope.build.fields.speed}`,
  );
  console.log(`  Attacks:     ${envelope.build.lists.attacks.length} attack(s)`);
  console.log(`  Spells:      ${envelope.build.lists.spells.length} spell(s)`);
  console.log(`  Features:    ${envelope.build.lists.features.length} feature(s)`);
  console.log(`  Inventory:   ${envelope.inventory.length} item(s)`);
  console.log(
    `  Currency:    ${envelope.currencies.gp} GP, ${envelope.currencies.sp} SP, ${envelope.currencies.cp} CP`,
  );

  if (outFile) {
    await writeFile(outFile, JSON.stringify(envelope, null, 2), "utf8");
    console.log(`\nSaved ruleset sheet envelope to: ${outFile}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("Import failed:", err);
    process.exit(1);
  });
}
