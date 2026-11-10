#!/usr/bin/env node

// Build script to generate all 12 catalogs for `packages/ruleset-5e-2024`
// from the local 5etools data dump configured in `fork/config/5e-2024-sources.json`.
//
// Usage:
//   node scripts/build-5e-2024-catalogs.mjs

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadOwnedConfig, deduplicate2024First, toCatalogId } from "./lib/5etools-loader.mjs";
import { strip5eTags, render5eEntries, extract5eMechanics } from "./lib/5etools-tags.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const configPath = join(repoRoot, "fork/config/5e-2024-sources.json");
const outputDir = join(repoRoot, "packages/ruleset-5e-2024/catalogs");

async function main() {
  console.log("Loading configuration from", configPath);
  const config = await loadOwnedConfig(configPath);
  const dataDir = process.env.FIVE_E_TOOLS_DATA_DIR || config.dataDir;

  const ownedSources = new Set(
    Object.entries(config.books)
      .filter(([, info]) => info.owned)
      .map(([code]) => code.toUpperCase()),
  );

  console.log(`Active owned sources (${ownedSources.size}):`, [...ownedSources].join(", "));
  await mkdir(outputDir, { recursive: true });

  // 1. Spells
  console.log("\nBuilding spells catalog...");
  await buildSpells(dataDir, ownedSources);

  // 2. Classes & Subclasses
  console.log("\nBuilding classes catalog...");
  await buildClasses(dataDir, ownedSources);

  // 3. Species (Races)
  console.log("\nBuilding species (races) catalog...");
  await buildSpecies(dataDir, ownedSources);

  // 4. Backgrounds
  console.log("\nBuilding backgrounds catalog...");
  await buildBackgrounds(dataDir, ownedSources);

  // 5. Features & Feats
  console.log("\nBuilding features & feats catalog...");
  await buildFeatures(dataDir, ownedSources);

  // 6. Fighting Styles
  console.log("\nBuilding fighting styles catalog...");
  await buildFightingStyles(dataDir, ownedSources);

  // 7. Weapons, Equipment & Magic Items
  console.log("\nBuilding items catalogs (weapons, equipment, magic_items)...");
  await buildItems(dataDir, ownedSources, config.options);

  // 8. Creatures (Bestiary)
  console.log("\nBuilding creatures catalog...");
  await buildCreatures(dataDir, ownedSources, config.options);

  // 9. Languages & Tools
  console.log("\nBuilding languages and tools catalogs...");
  await buildLanguagesAndTools(dataDir, ownedSources);

  console.log("\nDone! All 12 catalogs emitted to", outputDir);
}

async function writeCatalog(filename, catalogId, entries) {
  const filePath = join(outputDir, filename);
  // Sort entries alphabetically by id
  entries.sort((a, b) => a.id.localeCompare(b.id));

  const doc = {
    schemaVersion: 1,
    catalog: catalogId,
    entries,
  };

  const json = JSON.stringify(doc, null, 1);
  await writeFile(filePath, json, "utf8");
  console.log(`  -> Wrote ${filename}: ${entries.length} entries (${(Buffer.byteLength(json) / 1024).toFixed(1)} KiB)`);
}

const STANDARD_5E_CLASSES = [
  "Artificer",
  "Barbarian",
  "Bard",
  "Cleric",
  "Druid",
  "Fighter",
  "Monk",
  "Paladin",
  "Ranger",
  "Rogue",
  "Sorcerer",
  "Warlock",
  "Wizard",
];

async function buildSpells(dataDir, ownedSources) {
  const indexPath = join(dataDir, "spells/index.json");
  const index = JSON.parse(await readFile(indexPath, "utf8"));
  let allSpells = [];

  for (const [source, file] of Object.entries(index)) {
    if (!ownedSources.has(source.toUpperCase())) continue;
    try {
      const data = JSON.parse(await readFile(join(dataDir, "spells", file), "utf8"));
      if (Array.isArray(data.spell)) {
        allSpells.push(...data.spell);
      }
    } catch (e) {
      // Ignore missing optional files
    }
  }

  const spellLookupPath = join(dataDir, "generated/gendata-spell-source-lookup.json");
  let spellLookup = {};
  try {
    spellLookup = JSON.parse(await readFile(spellLookupPath, "utf8"));
  } catch (e) {
    console.warn("Could not load spell lookup:", e.message);
  }

  // Load 2014 SRD spell catalog to reuse validated combat mechanics
  const srdSpellsById = new Map();
  const srdSpellsByName = new Map();
  try {
    const srdSpellsRaw = JSON.parse(
      await readFile(join(repoRoot, "packages/ruleset-5e-2014/catalogs/spells.json"), "utf8"),
    );
    for (const s of srdSpellsRaw.entries || []) {
      if (s.mechanics) {
        srdSpellsById.set(s.id, s.mechanics);
        if (s.label) srdSpellsByName.set(s.label.toLowerCase(), s.mechanics);
      }
    }
  } catch (err) {
    console.warn("Could not load SRD spells:", err.message);
  }

  const deduped = deduplicate2024First(allSpells, ownedSources);
  const entries = [];

  for (const item of deduped.values()) {
    const level = item.level ?? 0;
    const school = item.school ? mapSpellSchool(item.school) : "Abjuration";
    const description = render5eEntries(item.entries);
    const summary = strip5eTags(item.entries?.[0] || "");
    const spellId = toCatalogId(item.name);
    const nameKey = item.name.toLowerCase();

    const mechanics = srdSpellsById.get(spellId) || srdSpellsByName.get(nameKey);

    const srcKey = item.source.toLowerCase();
    let lookup = spellLookup[srcKey]?.[nameKey];
    if (!lookup) {
      for (const src of Object.keys(spellLookup)) {
        if (spellLookup[src]?.[nameKey]) {
          lookup = spellLookup[src][nameKey];
          break;
        }
      }
    }

    const classes = new Set();
    const classIds = new Set();

    const addClass = (clsName) => {
      const match = STANDARD_5E_CLASSES.find((c) => c.toLowerCase() === clsName.toLowerCase());
      if (match) {
        classes.add(match);
        const lower = match.toLowerCase();
        classIds.add(lower);
        classIds.add(`${lower}-multiclass`);
        classIds.add(`${lower}-third-class`);
      }
    };

    const addFromMap = (m) => {
      if (!m) return;
      for (const map of Object.values(m)) {
        if (map && typeof map === "object") {
          for (const cls of Object.keys(map)) {
            addClass(cls);
          }
        }
      }
    };

    addFromMap(lookup?.class);
    addFromMap(lookup?.classVariant);
    addFromMap(lookup?.subclass);

    if (classes.size === 0 && item.classes?.fromClassList) {
      for (const c of item.classes.fromClassList) {
        if (c.name) addClass(c.name);
      }
    }

    const isRitual = Boolean(item.meta?.ritual);
    const isConcentration = Boolean(item.duration?.some((d) => d.concentration));

    const classList = Array.from(classes).sort().slice(0, 24);
    let classIdList = Array.from(classIds).sort();
    if (classIdList.length > 24) {
      classIdList = Array.from(classes)
        .map((c) => c.toLowerCase())
        .sort();
      if (classIdList.length > 24) classIdList = classIdList.slice(0, 24);
    }

    const entry = {
      id: spellId,
      label: item.name,
      summary: summary.slice(0, 300) || item.name,
      rows: [
        {
          list: "spells",
          values: {
            name: item.name,
            level: Number(level),
            prepared: true,
            ritual: isRitual,
            concentration: isConcentration,
            notes: `${school}, ${summary.slice(0, 200)}`,
          },
        },
      ],
      filters: {
        level: Number(level),
        school,
        classes: classList,
        class_ids: classIdList,
        kind: level === 0 ? "cantrip" : "spell",
      },
    };

    if (mechanics) {
      entry.mechanics = structuredClone(mechanics);
    }

    entries.push(entry);
  }

  await writeCatalog("spells.json", "spells", entries);
}

function mapSpellSchool(code) {
  const map = {
    A: "Abjuration",
    C: "Conjuration",
    D: "Divination",
    E: "Enchantment",
    V: "Evocation",
    I: "Illusion",
    N: "Necromancy",
    T: "Transmutation",
  };
  return map[code.toUpperCase()] || "Abjuration";
}

async function buildClasses(dataDir, ownedSources) {
  const indexPath = join(dataDir, "class/index.json");
  const index = JSON.parse(await readFile(indexPath, "utf8"));
  let allClasses = [];

  for (const file of Object.values(index)) {
    try {
      const data = JSON.parse(await readFile(join(dataDir, "class", file), "utf8"));
      if (Array.isArray(data.class)) {
        allClasses.push(...data.class);
      }
    } catch {
      // Ignore unreadable or missing class files
    }
  }

  const deduped = deduplicate2024First(allClasses, ownedSources);
  const entries = [];

  for (const cls of deduped.values()) {
    const name = cls.name;
    const id = toCatalogId(name);
    const hitDie = cls.hd ? `d${cls.hd.faces}` : "d8";

    entries.push({
      id,
      label: name,
      summary: `Hit die ${hitDie}. 2024 class progression.`.slice(0, 300),
      rows: [
        {
          list: "proficiencies",
          values: {
            name: `${name} Class`,
          },
        },
      ],
      filters: {
        kind: "class",
      },
    });
  }

  await writeCatalog("classes.json", "classes", entries);
}

async function buildSpecies(dataDir, ownedSources) {
  const racesPath = join(dataDir, "races.json");
  const data = JSON.parse(await readFile(racesPath, "utf8"));
  const allRaces = data.race || [];

  const deduped = deduplicate2024First(allRaces, ownedSources);
  const entries = [];

  for (const race of deduped.values()) {
    const name = race.name;
    const id = toCatalogId(name);
    const speed = typeof race.speed === "number" ? race.speed : race.speed?.walk || 30;
    const size = race.size?.[0] || "medium";
    const desc = strip5eTags(race.entries?.[0] || "");

    entries.push({
      id,
      label: name,
      summary: `Speed ${speed} ft., Size ${size}.`.slice(0, 300),
      rows: [
        {
          list: "features",
          values: {
            name: `${name} Traits`,
            text: desc.slice(0, 700),
            speed,
          },
        },
      ],
      filters: {
        race: [name],
      },
    });
  }

  await writeCatalog("races.json", "races", entries);
}

async function buildBackgrounds(dataDir, ownedSources) {
  const bgPath = join(dataDir, "backgrounds.json");
  const data = JSON.parse(await readFile(bgPath, "utf8"));
  const allBg = data.background || [];

  const deduped = deduplicate2024First(allBg, ownedSources);
  const entries = [];

  for (const bg of deduped.values()) {
    const name = bg.name;
    const id = toCatalogId(name);
    const desc = strip5eTags(bg.entries?.[0] || "");

    entries.push({
      id,
      label: name,
      summary: desc.slice(0, 300) || name,
      rows: [
        {
          list: "features",
          values: {
            name: `Background: ${name}`,
            text: desc.slice(0, 700),
          },
        },
      ],
    });
  }

  await writeCatalog("backgrounds.json", "backgrounds", entries);
}

async function buildFeatures(dataDir, ownedSources) {
  const featsPath = join(dataDir, "feats.json");
  const data = JSON.parse(await readFile(featsPath, "utf8"));
  const allFeats = data.feat || [];

  const deduped = deduplicate2024First(allFeats, ownedSources);
  const entries = [];
  const seenIds = new Set();

  for (const feat of deduped.values()) {
    const name = feat.name;
    const id = toCatalogId(name);
    if (seenIds.has(id)) continue;
    seenIds.add(id);

    const category = feat.category ? feat.category.toLowerCase() : "general";
    let kind = "general_feat";
    if (category.includes("origin")) kind = "origin_feat";
    else if (category.includes("boon")) kind = "epic_boon";
    else if (category.includes("fighting style")) kind = "fighting_style";

    const desc = strip5eTags(feat.entries?.[0] || "");

    entries.push({
      id,
      label: name,
      summary: desc.slice(0, 300) || name,
      rows: [
        {
          list: "features",
          values: {
            name,
            text: desc.slice(0, 700),
          },
        },
      ],
      filters: {
        kind,
      },
    });
  }

  // 2024 Weapon Masteries
  const masteries = [
    {
      id: "weapon-mastery-cleave",
      label: "Weapon Mastery: Cleave",
      summary: "Hit a second creature within 5 ft for weapon damage (without ability modifier).",
      text: "If you hit a creature with a melee attack roll using this weapon, you can make a melee attack roll with the weapon against a second creature within 5 feet of the first that is also within your reach. On a hit, the second creature takes the weapon's damage, but don't add your ability modifier to that damage unless that modifier is negative. You can make this extra attack only once per turn.",
    },
    {
      id: "weapon-mastery-graze",
      label: "Weapon Mastery: Graze",
      summary: "Missed melee attacks still deal damage equal to your ability modifier.",
      text: "If your melee attack roll with this weapon misses a creature, that creature still takes damage equal to the ability modifier you used to make the attack roll (minimum of 0 damage). This damage is the same type dealt by the weapon, and it can't be increased in any way.",
    },
    {
      id: "weapon-mastery-nick",
      label: "Weapon Mastery: Nick",
      summary: "Make the Light property extra attack as part of the Attack action instead of a Bonus Action.",
      text: "When you make the extra attack of the Light property, you can make it as part of the Attack action on your turn instead of as a Bonus Action. You can make this extra attack only once per turn.",
    },
    {
      id: "weapon-mastery-push",
      label: "Weapon Mastery: Push",
      summary: "Push a Large or smaller creature up to 10 feet straight away on hit.",
      text: "If you hit a creature with this weapon, you can push the creature up to 10 feet straight away from you if it is Large or smaller.",
    },
    {
      id: "weapon-mastery-sap",
      label: "Weapon Mastery: Sap",
      summary: "Target has Disadvantage on its next attack roll before start of your next turn.",
      text: "If you hit a creature with this weapon, that creature has Disadvantage on its next attack roll before the start of your next turn.",
    },
    {
      id: "weapon-mastery-slow",
      label: "Weapon Mastery: Slow",
      summary: "Reduce hit target's Speed by 10 feet until the start of your next turn.",
      text: "If you hit a creature with this weapon and deal damage to it, you can reduce the target's Speed by 10 feet until the start of your next turn. If you hit the creature more than once with this weapon on the same turn, this effect doesn't reduce its speed further.",
    },
    {
      id: "weapon-mastery-topple",
      label: "Weapon Mastery: Topple",
      summary: "Force target to make a Con save (DC 8 + Str mod + PB) or be knocked Prone.",
      text: "If you hit a creature with this weapon, you can force the creature to make a Constitution saving throw with a DC equal to 8 + your Strength modifier + your Proficiency Bonus. On a failed save, the creature has the Prone condition.",
    },
    {
      id: "weapon-mastery-vex",
      label: "Weapon Mastery: Vex",
      summary: "Gain Advantage on your next attack roll against the target before end of next turn.",
      text: "If you hit a creature with this weapon and deal damage to it, you have Advantage on your next attack roll against that creature before the end of your next turn.",
    },
  ];

  for (const m of masteries) {
    if (seenIds.has(m.id)) continue;
    seenIds.add(m.id);
    entries.push({
      id: m.id,
      label: m.label,
      summary: m.summary,
      rows: [
        {
          list: "features",
          values: {
            name: m.label,
            text: m.text,
          },
        },
      ],
      filters: {
        kind: "weapon_mastery",
      },
    });
  }

  // Subclasses & Subclass Features
  const standardClasses = [
    "artificer",
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
  ];

  for (const cls of standardClasses) {
    const classFile = join(dataDir, `class/class-${cls}.json`);
    let classData;
    try {
      classData = JSON.parse(await readFile(classFile, "utf8"));
    } catch {
      continue;
    }
    const className = classData.class?.[0]?.name || cls.charAt(0).toUpperCase() + cls.slice(1);

    // Deduplicate subclasses (2024 XPHB first)
    const scMap = new Map();
    for (const sc of classData.subclass || []) {
      if (!ownedSources.has(sc.source.toUpperCase())) continue;
      const key = sc.name.toLowerCase();
      const existing = scMap.get(key);
      if (!existing || sc.source === "XPHB") {
        scMap.set(key, sc);
      }
    }

    for (const sc of scMap.values()) {
      const subId = `subclass-${toCatalogId(`${className}-${sc.name}`)}`;
      if (!seenIds.has(subId)) {
        seenIds.add(subId);
        entries.push({
          id: subId,
          label: sc.name,
          summary: `${sc.name}: the ${className} subclass (${sc.source}).`.slice(0, 300),
          rows: [
            {
              list: "features",
              values: {
                name: `Subclass: ${sc.name}`,
                class: className,
                text: `${sc.name}: the ${className} subclass (${sc.source}), from ${className.toLowerCase()} level 3.`,
              },
            },
          ],
          filters: {
            class: className,
            class_id: [cls, `${cls}-multiclass`, `${cls}-third-class`],
            kind: "subclass",
            subclass: sc.name,
            level: 3,
          },
        });
      }

      // Subclass features
      const features = (classData.subclassFeature || []).filter(
        (f) =>
          f.subclassShortName === sc.shortName &&
          (f.subclassSource === sc.source || (!f.subclassSource && f.source === sc.source)),
      );

      for (const f of features) {
        if (f.name === sc.name || f.name.toLowerCase() === sc.name.toLowerCase()) continue;
        const fId = toCatalogId(`${className}-${sc.shortName}-${f.name}-${f.level || 3}`);
        if (seenIds.has(fId)) continue;
        seenIds.add(fId);

        const desc = render5eEntries(f.entries || []);
        const summary = extractFirstParagraph(f.entries).slice(0, 300) || f.name;

        entries.push({
          id: fId,
          label: f.name,
          summary,
          rows: [
            {
              list: "features",
              values: {
                name: f.name,
                class: className,
                text: desc.slice(0, 800),
              },
            },
          ],
          filters: {
            class: className,
            class_id: [cls, `${cls}-multiclass`, `${cls}-third-class`],
            kind: "feature",
            subclass: sc.name,
            level: f.level || 3,
          },
        });
      }
    }
  }

  // Relentless Rage & Relentless Endurance (required for combat.conditions hangsOn pools)
  entries.push({
    id: "relentless-rage",
    label: "Relentless Rage",
    summary: "Starting at 11th level, your rage can keep you fighting despite grievous wounds.".slice(0, 300),
    rows: [
      {
        list: "features",
        values: {
          name: "Relentless Rage",
          class: "Barbarian",
          text: "Starting at 11th level, your rage can keep you fighting despite grievous wounds. If you drop to 0 hit points while you’re raging and don’t die outright, you can make a DC 10 Constitution saving throw. If you succeed, you drop to 1 hit point instead. Each time you use this feature after the first, the DC increases by 5. When you finish a short or long rest, the DC resets to 10.".slice(
            0,
            800,
          ),
        },
      },
      {
        list: "counters",
        values: {
          name: "Relentless Rage",
          max: 20,
          recharge: "short",
          tally: true,
        },
      },
    ],
    filters: {
      class: "Barbarian",
      class_id: ["barbarian", "barbarian-multiclass", "barbarian-third-class"],
      kind: "feature",
      level: 11,
    },
  });

  entries.push({
    id: "relentless-endurance",
    label: "Relentless Endurance",
    summary: "When you are reduced to 0 hit points but not killed outright, you can drop to 1 hit point instead.".slice(
      0,
      300,
    ),
    rows: [
      {
        list: "features",
        values: {
          name: "Relentless Endurance",
          text: "When you are reduced to 0 hit points but not killed outright, you can drop to 1 hit point instead. You can't use this feature again until you finish a long rest.".slice(
            0,
            800,
          ),
        },
      },
      {
        list: "counters",
        values: {
          name: "Relentless Endurance",
          max: 1,
          recharge: "long",
        },
      },
    ],
    filters: {
      kind: "feature",
    },
  });

  await writeCatalog("features.json", "features", entries);
}

function extractFirstParagraph(entries) {
  if (!entries || !entries.length) return "";
  for (const e of entries) {
    if (typeof e === "string") {
      const clean = strip5eTags(e).trim();
      if (clean && !clean.toLowerCase().includes("feature*") && !clean.toLowerCase().endsWith("feature")) {
        return clean;
      }
    } else if (e && typeof e === "object" && e.entries) {
      const sub = extractFirstParagraph(e.entries);
      if (sub) return sub;
    }
  }
  return strip5eTags(entries[0] || "");
}

async function buildFightingStyles(dataDir, ownedSources) {
  const featsPath = join(dataDir, "feats.json");
  const data = JSON.parse(await readFile(featsPath, "utf8"));
  const fightingStyles = (data.feat || []).filter((f) => {
    const cat = String(f.category || "").toLowerCase();
    const name = String(f.name || "").toLowerCase();
    return (
      cat.includes("fighting style") ||
      cat === "fs" ||
      name.startsWith("fighting style:") ||
      name.startsWith("fighting style -")
    );
  });

  const deduped = deduplicate2024First(fightingStyles, ownedSources);
  const entries = [];

  for (const fs of deduped.values()) {
    const name = fs.name;
    const id = toCatalogId(name);
    const desc = strip5eTags(fs.entries?.[0] || "");

    entries.push({
      id,
      label: name,
      summary: desc.slice(0, 300) || name,
      rows: [
        {
          list: "features",
          values: {
            name,
            text: desc.slice(0, 700),
          },
        },
      ],
      filters: {
        class_ids: ["fighter", "paladin", "ranger"],
      },
    });
  }

  await writeCatalog("fighting_styles.json", "fighting_styles", entries);
}

function extractMastery(masteryVal) {
  if (!masteryVal) return undefined;
  const raw = Array.isArray(masteryVal) ? masteryVal[0] : masteryVal;
  if (typeof raw === "string") return raw.split("|")[0];
  if (raw && typeof raw === "object" && typeof raw.uid === "string") return raw.uid.split("|")[0];
  return undefined;
}

async function buildItems(dataDir, ownedSources, options) {
  const baseItems = JSON.parse(await readFile(join(dataDir, "items-base.json"), "utf8")).baseitem || [];
  const items = JSON.parse(await readFile(join(dataDir, "items.json"), "utf8")).item || [];

  const baseItemMasteryMap = new Map();
  for (const b of baseItems) {
    const m = extractMastery(b.mastery);
    if (m) {
      baseItemMasteryMap.set(b.name.toLowerCase(), m);
    }
  }

  const weapons = [];
  const equipment = [];
  const magicItems = [];

  const allItems = [...baseItems, ...items];
  const deduped = deduplicate2024First(allItems, ownedSources);

  for (const it of deduped.values()) {
    const id = toCatalogId(it.name);
    let summary = strip5eTags(it.entries?.[0] || it.name).slice(0, 300);

    // Check Weapon
    if (it.weaponCategory || it.type === "M" || it.type === "R") {
      const dmg = it.dmg1 || "1d4";
      const dmgType = it.dmgType ? mapDamageType(it.dmgType) : "slashing";
      let mastery = extractMastery(it.mastery);
      if (!mastery && it.baseItem && typeof it.baseItem === "string") {
        const baseName = it.baseItem.split("|")[0].toLowerCase();
        mastery = baseItemMasteryMap.get(baseName);
      }

      if (mastery) {
        summary = summary ? `${summary} Mastery: ${mastery}.`.slice(0, 300) : `Mastery: ${mastery}.`;
      }

      const isRanged = it.type === "R" || (it.property || []).includes("R");
      const isFinesse = (it.property || []).includes("F");

      weapons.push({
        id,
        label: it.name,
        summary: summary.slice(0, 300),
        rows: [
          {
            list: "attacks",
            values: {
              name: it.name,
              ability: isRanged ? "dex" : "str",
              proficient: true,
              finesse_or_ranged: isRanged || isFinesse,
              loading: (it.property || []).includes("LD"),
              bonus: 0,
              damage: dmg,
              damage_type: dmgType,
              reach: (it.property || []).includes("RCH") ? 10 : 5,
              range: it.range ? parseInt(it.range.split("/")[0], 10) : 0,
              long_range: it.range && it.range.includes("/") ? parseInt(it.range.split("/")[1], 10) : 0,
            },
          },
        ],
        filters: {
          category: (it.weaponCategory || "simple").toLowerCase(),
          ...(mastery ? { mastery } : {}),
        },
      });
      continue;
    }

    // Check Magic Item
    if (it.rarity && it.rarity !== "none") {
      if (options.compactScrolls && it.name.startsWith("Spell Scroll (") && !it.name.endsWith("Level)")) {
        continue;
      }
      const VALID_RARITIES = new Set(["common", "uncommon", "rare", "very_rare", "legendary", "artifact"]);
      let rarity = (it.rarity || "common")
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, "_")
        .replace(/^_+|_+$/g, "");
      if (rarity === "very_rare" || rarity === "veryrare") rarity = "very_rare";
      if (!VALID_RARITIES.has(rarity)) rarity = "common";
      magicItems.push({
        id,
        label: it.name,
        summary: summary.slice(0, 300),
        item: {
          category: it.type === "RG" ? "ring" : it.type === "W" ? "wand" : it.type === "P" ? "potion" : "gear",
          rarity,
          stats: {
            weight: it.weight || 0,
          },
        },
      });
      continue;
    }

    // General Equipment
    equipment.push({
      id,
      label: it.name,
      summary: summary.slice(0, 300),
      item: {
        category: it.armorCategory ? "armor" : "gear",
        rarity: "common",
        stats: {
          weight: it.weight || 0,
        },
      },
    });
  }

  // Ensure standard 2024 tiered Spell Scrolls exist in magic_items if compacted
  if (options.compactScrolls) {
    const scrollTiers = [
      ["Cantrip", "common"],
      ["1st Level", "common"],
      ["2nd Level", "uncommon"],
      ["3rd Level", "uncommon"],
      ["4th Level", "rare"],
      ["5th Level", "rare"],
      ["6th Level", "very_rare"],
      ["7th Level", "very_rare"],
      ["8th Level", "very_rare"],
      ["9th Level", "legendary"],
    ];
    for (const [tier, rarity] of scrollTiers) {
      const name = `Spell Scroll (${tier})`;
      magicItems.push({
        id: toCatalogId(name),
        label: name,
        summary: `A spell scroll bearing a ${tier} spell.`.slice(0, 300),
        item: {
          category: "scroll",
          rarity,
          stats: { weight: 0 },
        },
      });
    }
  }

  // Carry over spell material components from SRD equipment
  try {
    const srdEquipment =
      JSON.parse(await readFile(join(repoRoot, "packages/ruleset-5e-2014/catalogs/equipment.json"), "utf8")).entries ||
      [];
    const existingEqIds = new Set(equipment.map((e) => e.id));
    for (const eq of srdEquipment) {
      if (!existingEqIds.has(eq.id)) {
        const entry = {
          id: eq.id,
          label: eq.label,
          summary: (eq.summary || eq.label).slice(0, 300),
          item: eq.item,
        };
        equipment.push(entry);
        existingEqIds.add(eq.id);
      }
    }
  } catch (err) {
    console.warn("Could not load SRD equipment:", err.message);
  }

  // Carry over conjured/spell-created items from SRD magic items
  try {
    const srdMagicItems =
      JSON.parse(await readFile(join(repoRoot, "packages/ruleset-5e-2014/catalogs/magic_items.json"), "utf8"))
        .entries || [];
    const specialMiIds = new Set(["goodberry", "created-object"]);
    const existingMiIds = new Set(magicItems.map((e) => e.id));
    for (const mi of srdMagicItems) {
      if (specialMiIds.has(mi.id) && !existingMiIds.has(mi.id)) {
        magicItems.push(mi);
        existingMiIds.add(mi.id);
      }
    }
  } catch (err) {
    console.warn("Could not load special SRD magic items:", err.message);
  }

  await writeCatalog("weapons.json", "weapons", weapons);
  await writeCatalog("equipment.json", "equipment", equipment);
  await writeCatalog("magic_items.json", "magic_items", magicItems);
}

function mapDamageType(t) {
  const m = { S: "slashing", P: "piercing", B: "bludgeoning" };
  return m[t] || t;
}

async function buildCreatures(dataDir, ownedSources, options) {
  const indexPath = join(dataDir, "bestiary/index.json");
  const index = JSON.parse(await readFile(indexPath, "utf8"));
  let allMonsters = [];

  for (const [source, file] of Object.entries(index)) {
    if (!ownedSources.has(source.toUpperCase())) continue;
    try {
      const data = JSON.parse(await readFile(join(dataDir, "bestiary", file), "utf8"));
      if (Array.isArray(data.monster)) {
        allMonsters.push(...data.monster);
      }
    } catch {
      // Ignore unreadable or missing class files
    }
  }

  const deduped = deduplicate2024First(allMonsters, ownedSources);
  const entries = [];

  for (const m of deduped.values()) {
    // If not including adventure NPCs, skip named NPC stat blocks
    if (!options.includeNamedNpcs && m.isNpc) continue;

    const name = m.name;
    const id = toCatalogId(name);
    const cr = typeof m.cr === "string" ? m.cr : m.cr?.cr || "0";
    const tier = mapCrToTier(cr);
    const hp = m.hp?.average || 10;
    const ac = m.ac?.[0]?.ac || (typeof m.ac?.[0] === "number" ? m.ac[0] : 10);
    const speed = m.speed?.walk || 30;

    const rawType = typeof m.type === "string" ? m.type : typeof m.type?.type === "string" ? m.type.type : "humanoid";
    const creatureType = rawType.toLowerCase();

    const dexMod = Math.floor(((m.dex || 10) - 10) / 2);
    const healthDice = (m.hp?.formula || `${Math.max(1, Math.floor(hp / 5))}d8`).replace(/\s+/g, "");

    const actions = [];
    const seenActionIds = new Set();
    if (Array.isArray(m.action) && m.action.length > 0) {
      for (const act of m.action.slice(0, 16)) {
        const actName = (act.name || "Action").slice(0, 80);
        let baseActId =
          actName
            .toLowerCase()
            .replace(/[^a-z0-9_]+/g, "_")
            .replace(/^_+|_+$/g, "") || "action";
        if (!/^[a-z]/.test(baseActId)) baseActId = "a_" + baseActId;
        baseActId = baseActId.slice(0, 32);
        let actId = baseActId;
        let counter = 2;
        while (seenActionIds.has(actId)) {
          actId = `${baseActId}_${counter++}`;
        }
        seenActionIds.add(actId);

        const hitMatch = JSON.stringify(act).match(/\{@hit\s+(\d+)\}/i);
        const dmgMatch = JSON.stringify(act).match(/\{@damage\s+([1-9]\d{0,2}d[2-9]\d*(?:[+-]\d+)?)\}/i);
        actions.push({
          id: actId,
          name: actName,
          budget: "action",
          ...(hitMatch ? { toHit: parseInt(hitMatch[1], 10) } : {}),
          ...(dmgMatch ? { damage: { dice: dmgMatch[1].replace(/\s+/g, "") } } : {}),
        });
      }
    }

    if (actions.length === 0) {
      actions.push({
        id: "attack",
        name: "Attack",
        budget: "action",
        toHit: dexMod,
        damage: { dice: "1d6" },
      });
    }

    const speedVal =
      typeof m.speed === "number"
        ? m.speed
        : typeof m.speed?.walk === "number"
          ? m.speed.walk
          : typeof m.speed?.walk?.number === "number"
            ? m.speed.walk.number
            : 30;

    entries.push({
      id,
      label: name,
      summary: `${name}: CR ${cr} ${creatureType}.`.slice(0, 300),
      creature: {
        health: { dice: healthDice },
        defense: ac,
        speed: speedVal,
        initiativeModifier: dexMod,
        abilities: {
          str: m.str || 10,
          dex: m.dex || 10,
          con: m.con || 10,
          int: m.int || 10,
          wis: m.wis || 10,
          cha: m.cha || 10,
        },
        size:
          (m.size?.[0] || "M").toLowerCase() === "t"
            ? "tiny"
            : (m.size?.[0] || "M").toLowerCase() === "s"
              ? "small"
              : (m.size?.[0] || "M").toLowerCase() === "l"
                ? "large"
                : (m.size?.[0] || "M").toLowerCase() === "h"
                  ? "huge"
                  : (m.size?.[0] || "M").toLowerCase() === "g"
                    ? "gargantuan"
                    : "medium",
        type: creatureType,
        tier,
        actions,
      },
      filters: {
        challenge: parseCrNumber(cr),
        type: creatureType,
      },
    });
  }

  // Carry over synthetic spell-summoned creatures from SRD
  try {
    const srdCreatures =
      JSON.parse(await readFile(join(repoRoot, "packages/ruleset-5e-2014/catalogs/creatures.json"), "utf8")).entries ||
      [];
    const specialIds = new Set([
      "animated-object-tiny",
      "animated-object-small",
      "animated-object-medium",
      "animated-object-large",
      "animated-object-huge",
      "illusory-double",
      "phantom-steed",
      "enchanted-object",
      "arcane-hand",
      "polymorphed-object",
    ]);
    const existingIds = new Set(entries.map((e) => e.id));
    for (const c of srdCreatures) {
      if (specialIds.has(c.id) && !existingIds.has(c.id)) {
        entries.push(c);
      }
    }
  } catch (err) {
    console.warn("Could not load special SRD creatures:", err.message);
  }

  await writeCatalog("creatures.json", "creatures", entries);
}

function parseCrNumber(cr) {
  const clean = String(cr).replace(/\s+/g, "");
  if (clean === "1/8") return 0.125;
  if (clean === "1/4") return 0.25;
  if (clean === "1/2") return 0.5;
  const num = parseFloat(clean);
  return isNaN(num) ? 0 : num;
}

function mapCrToTier(cr) {
  const clean = String(cr).replace(/\s+/g, "");
  if (clean === "1/8") return "cr_1_8";
  if (clean === "1/4") return "cr_1_4";
  if (clean === "1/2") return "cr_1_2";
  const num = parseInt(clean, 10);
  if (!isNaN(num) && num >= 0 && num <= 30) {
    if (num <= 24 || num === 30) return `cr_${num}`;
  }
  return "cr_0";
}

async function buildLanguagesAndTools(dataDir, ownedSources) {
  const languages = [
    { id: "common", label: "Common", script: "Common" },
    { id: "draconic", label: "Draconic", script: "Draconic" },
    { id: "dwarvish", label: "Dwarvish", script: "Dwarvish" },
    { id: "elvish", label: "Elvish", script: "Elvish" },
    { id: "giant", label: "Giant", script: "Dwarvish" },
    { id: "gnomish", label: "Gnomish", script: "Dwarvish" },
    { id: "goblin", label: "Goblin", script: "Dwarvish" },
    { id: "halfling", label: "Halfling", script: "Common" },
    { id: "orc", label: "Orc", script: "Dwarvish" },
    { id: "abyssal", label: "Abyssal", script: "Infernal" },
    { id: "celestial", label: "Celestial", script: "Celestial" },
    { id: "deep-speech", label: "Deep Speech", script: "None" },
    { id: "infernal", label: "Infernal", script: "Infernal" },
    { id: "primordial", label: "Primordial", script: "Dwarvish" },
    { id: "sylvan", label: "Sylvan", script: "Elvish" },
    { id: "undercommon", label: "Undercommon", script: "Elvish" },
  ];

  const langEntries = languages.map((l) => ({
    id: l.id,
    label: l.label,
    rows: [
      {
        list: "proficiencies",
        values: {
          name: `Languages: ${l.label}`,
        },
      },
    ],
  }));
  await writeCatalog("languages.json", "languages", langEntries);

  const tools = [
    "Alchemist's Supplies",
    "Brewer's Supplies",
    "Calligrapher's Supplies",
    "Carpenter's Tools",
    "Cartographer's Tools",
    "Cobbler's Tools",
    "Cook's Utensils",
    "Glassblower's Tools",
    "Jeweler's Tools",
    "Leatherworker's Tools",
    "Mason's Tools",
    "Painter's Supplies",
    "Potter's Tools",
    "Smith's Tools",
    "Tinker's Tools",
    "Weaver's Tools",
    "Woodcarver's Tools",
    "Disguise Kit",
    "Forgery Kit",
    "Herbalism Kit",
    "Navigator's Tools",
    "Poisoner's Kit",
    "Thieves' Tools",
    "Dice Set",
    "Dragonchess Set",
    "Playing Card Set",
    "Three-Dragon Ante Set",
    "Bagpipes",
    "Drum",
    "Dulcimer",
    "Flute",
    "Lute",
    "Lyre",
    "Horn",
    "Pan Flute",
    "Shawm",
    "Viol",
  ];

  const toolEntries = tools.map((t) => ({
    id: toCatalogId(t),
    label: t,
    rows: [
      {
        list: "proficiencies",
        values: {
          name: `Tools: ${t}`,
        },
      },
    ],
    filters: {
      kind: "tool",
    },
  }));
  await writeCatalog("tools.json", "tools", toolEntries);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
