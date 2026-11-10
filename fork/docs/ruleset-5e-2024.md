# 5e (2024 Edition) Ruleset Guide & Reference

This document covers the architecture, content pipeline, ruleset differences, and tooling for `ruleset-5e-2024` in `marinara-agents`.

---

## 1. Overview

`ruleset-5e-2024` (`id: "5e-2024"`) is a first-party ruleset package providing native support for the 2024 revised 5th Edition rules. It compiles data from a local 5etools data dump filtered through a user-configured owned content manifest (`fork/config/5e-2024-sources.json`).

### Key 2024 System Differences Implemented

- **13 Classes with Artificer**: Full progression for all 12 core classes plus Artificer (`level_artificer`, d8 hit dice, infusion slots).
- **2024 Half-Casters**: Paladin, Ranger, and Artificer gain spellcasting at 1st level and round up for multiclassing (`ceil(level / 2)`).
- **Subclasses at Level 3**: Standardized subclass progression for all classes at 3rd level.
- **Weapon Masteries**: Integrated support for all 8 2024 Weapon Masteries (*Cleave*, *Graze*, *Nick*, *Push*, *Sap*, *Slow*, *Topple*, *Vex*) across weapon summaries, attacks, and feature cards.
- **2024 Exhaustion**: Progressive penalties of `-2 × level` to all d20 tests (attacks, saves, checks) and `-5 ft × level` to movement speed; level 6 defeats.
- **2024 Alert Feat**: Adds Proficiency Bonus (`+PB`) to Initiative instead of a static +5.
- **2024 Reliable Talent**: Activates at Rogue **Level 7** (down from Level 11 in 2014) with a check floor of 10 on proficient skills.
- **Eloquence Bard Silver Tongue**: Enforces a check floor of 10 on Deception and Persuasion checks (`face: 10`).
- **Bonus Action Potions**: Drinking potions takes a bonus action; administering to another creature takes an action.
- **Campaign Layers**: Built-in runtime campaign filters for *2024 Core Only*, *No Setting-Specific Options*, and *Low Magic*.

---

## 2. Content Catalogs

The package ships 12 complete, validated catalogs in `packages/ruleset-5e-2024/catalogs/`:

| Catalog | Entries | Description |
|---|---|---|
| `spells.json` | 541 | Spells with class tags (`filters.classes`, `filters.class_ids`), schools, and `ritual` / `concentration` flags. |
| `features.json` | 1,188 | 147 subclasses, 839 subclass features, 8 weapon masteries, and 194 feats (Origin, General, Epic Boon). |
| `weapons.json` | 152 | Simple and martial weapons with damage types, reach, range, and inherited Weapon Mastery properties. |
| `equipment.json` | 487 | Adventuring gear, armor, tools, and packs. |
| `magic_items.json` | 705 | Magic items, potions, rings, rods, and tiered spell scrolls. |
| `classes.json` | 16 | 13 core classes + 3 sidekick classes. |
| `races.json` | 70 | 2024 Species and un-reprinted legacy Lineages with walking speed, size, and traits. |
| `backgrounds.json` | 110 | 2024 Backgrounds with ability score adjustments and Origin Feat references. |
| `creatures.json` | 1,442 | Full 2024/legacy bestiary with hit points, AC, speeds, stats, CR tiers, and action blocks. |
| `fighting_styles.json` | 10 | 2024 Fighting Style feats and class choices. |
| `languages.json` | 16 | Standard and exotic languages as proficiencies. |
| `tools.json` | 37 | Artisan's tools, gaming sets, musical instruments, and kits. |

---

## 3. Data Pipeline & Builders

Content is compiled deterministically from local 5etools dumps using a 2024-first deduplication strategy (`XPHB` > `XDMG` > `XMM` > legacy supplements).

### Workflow Commands

```bash
# 1. (Optional) Sync or inspect owned sourcebook manifest
node scripts/sync-ddb-owned-sources.mjs --status

# 2. Build the 12 catalogs from local 5etools data
node scripts/build-5e-2024-catalogs.mjs

# 3. Build the core ruleset envelope (ruleset.json)
node scripts/build-ruleset-5e-2024.mjs

# 4. Package the ruleset into catalog lanes and artifacts
node scripts/build-ruleset-packages.mjs

# 5. Run all validation gates
bash fork/tools/check.sh
```

### Configuration (`fork/config/5e-2024-sources.json`)

Controls which sourcebooks are included when generating catalogs. Grouped into `core2024`, `supplements`, `settings`, `core2014`, and `adventures`. Set `"owned": true` or `"owned": false` per book.

---

## 4. D&D Beyond PDF Importer

The repository includes a direct PDF-to-ruleset converter in `scripts/import-dndbeyond-pdf.mjs`:

```bash
# Convert a D&D Beyond exported PDF sheet to a 2024 envelope:
node scripts/import-dndbeyond-pdf.mjs /path/to/character.pdf --ruleset 5e-2024 --out ./character.json
```

- **Features Parsed**: Name, class, subclass, species, background, level, ability scores, maximum hit points, Armor Class, speed, attacks, spells, features, inventory items, and currencies.
- **Widget Parsing**: Reads PDFsharp `/Annots` AcroForm fields with automatic trailing-slash font URL handling.
- **Catalog Matching**: Resolves spell levels, preparation state, and subclass features against `ruleset-5e-2024` catalogs.
