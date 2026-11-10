# Plan: Full `ruleset-5e-2024` Built from a 5etools Data Dump (Configurable Owned Content)

## 1. Executive Summary & Architectural Shift

The previous version of this document assumed we were restricted to the public Open5e / SRD 5.2 feed and recommended patching missing character options into `ruleset-5e-2014`. That assumption does not hold for a personal fork where the user owns most sourcebooks on D&D Beyond and can supply a local **5etools data dump**.

Instead, we will build a first-class **`packages/ruleset-5e-2024`** package (`id: "5e-2024"`, package id `ruleset-5e-2024`) from a local 5etools JSON tree, filtered and deduplicated by a **user-configured owned-content manifest** (`fork/config/5e-2024-sources.json`) plus runtime **Game-Setup `layers`** so individual campaigns can toggle sourcebooks in the UI.

### Why 5etools Is a Better Upstream Than Open5e
[`scripts/build-5e-srd-catalogs.mjs`](file:///home/bah/git/marinara-agents/scripts/build-5e-srd-catalogs.mjs#L34-L37) had to regex-parse English prose because Open5e v2's structured fields (`damage_dice`, `dc`, `saving_throw_ability`) were missing or broken. By contrast, a 5etools data dump provides:
1. **Complete 2024 Core + Legacy Supplement Coverage**: `XPHB` (2024 Player's Handbook), `XDMG` (2024 Dungeon Master's Guide), `XMM` (2025 Monster Manual), plus `TCE`, `XGE`, `MPMM`, `ERLW`/`EFA`, `FTD`, `BGG`, `BMT`, etc.
2. **Explicit Reprint Links**: Every 2014 entry superseded in 2024 carries `reprintedAs: ["...|XPHB"]` (and 2024 entries carry `_copiedFrom` or `srd52: true`), enabling deterministic **2024-first deduplication**.
3. **Structured Inline Tags & Metadata**:
   - Spells carry explicit `spellAttack` (`["M"]`, `["R"]`), `savingThrow` (`["dexterity"]`), `damageInflict`, `conditionInflict`, `scalingLevelDice`, and `miscTags`.
   - Creature actions, feats, items, and class features use deterministic tags: `{@atk mw,rw}`, `{@hit 7}`, `{@damage 2d6 + 4}`, `{@scaledamage 2d6|1-9|1d6}`, `{@dc 15}`, `{@actSave dex}`, `{@actSaveFail ...}`, `{@condition prone|XPHB}`, `{@recharge 5}`, and `mastery: ["Topple|XPHB"]`.

---

## 2. Owned-Content Configuration & 2024-First Deduplication

### 2.1 Local Data Dump Layout (Full Unfiltered 5etools `data/` Dump)
We will use a **full, unfiltered 5etools `data/` dump** rather than a pre-filtered subset:
- **Why full dump**: 5etools entries frequently use `_copy` / `_mod` cross-file inheritance (e.g., an item variant or monster in a supplement copying a base template from another book) and `data/spells/sources.json` / `data/books.json` index the entire ecosystem. A full dump guarantees `_copy` resolution never breaks and lets you toggle books on/off at any time without re-dumping.
- **Default path**: `../5etools-src/data` (or `/home/bah/git/5etools-src/data`, overridable via `FIVE_E_TOOLS_DATA_DIR`).
- Key inputs read by `scripts/build-5e-2024-catalogs.mjs`:
  - `data/books.json` (canonical list of all sourcebooks, titles, publication dates, and categories)
  - `data/spells/spells-*.json` + `data/spells/sources.json` (class/subclass spell lists)
  - `data/class/class-*.json` (classes, subclasses, classFeatures, subclassFeatures)
  - `data/races.json` + `data/fluff-races.json` (2024 Species and legacy Races/Lineages)
  - `data/backgrounds.json` (2024 Backgrounds with ability weights and Origin Feat grants)
  - `data/feats.json` (Origin, General, Fighting Style, and Epic Boon feats)
  - `data/items-base.json`, `data/items.json`, `data/magicvariants.json` (Weapons with `mastery`, Armor, Gear, Magic Items)
  - `data/bestiary/bestiary-*.json` + `data/bestiary/fluff-bestiary-*.json` (Monsters, NPCs, summons, wild shapes)
  - `data/languages.json`, `data/conditionsdiseases.json`

### 2.2 Easy "Owned on D&D Beyond" Filtering (`fork/config/5e-2024-sources.json` + Sync Helper)
Because you own *most* things on D&D Beyond, configuring ownership should not require memorizing 5etools acronyms (`XPHB`, `EFA`, `MPMM`, `BGG`). We will provide two complementary ways to manage `fork/config/5e-2024-sources.json`:

1. **Human-Readable D&D Beyond Book Checklist (Default = `owned: true` for Rulebooks/Supplements)**:
   `scripts/sync-ddb-owned-sources.mjs --init` reads `data/books.json` from the 5etools dump and generates `fork/config/5e-2024-sources.json` grouped by category (`core2024`, `supplements`, `settings`, `core2014`, `adventures`) with full **D&D Beyond book titles** and `"owned": true` pre-checked so you only have to flip `"owned": false` on the few books you *don't* own:
   ```json
   {
     "editionMode": "2024-with-legacy-supplements",
     "includeAdventureCreatures": false,
     "includeNamedNpcs": false,
     "books": {
       "XPHB": { "title": "Player's Handbook (2024)", "group": "core2024", "owned": true },
       "XDMG": { "title": "Dungeon Master's Guide (2024)", "group": "core2024", "owned": true },
       "XMM":  { "title": "Monster Manual (2025)", "group": "core2024", "owned": true },
       "EFA":  { "title": "Eberron: Forge of the Artificer", "group": "supplements", "owned": true },
       "TCE":  { "title": "Tasha's Cauldron of Everything", "group": "supplements", "owned": true },
       "XGE":  { "title": "Xanathar's Guide to Everything", "group": "supplements", "owned": true },
       "MPMM": { "title": "Mordenkainen Presents: Monsters of the Multiverse", "group": "supplements", "owned": true },
       "FTD":  { "title": "Fizban's Treasury of Dragons", "group": "supplements", "owned": true },
       "BGG":  { "title": "Bigby Presents: Glory of the Giants", "group": "supplements", "owned": true },
       "BMT":  { "title": "The Book of Many Things", "group": "supplements", "owned": true },
       "ERLW": { "title": "Eberron: Rising from the Last War", "group": "settings", "owned": true },
       "VRGR": { "title": "Van Richten's Guide to Ravenloft", "group": "settings", "owned": true },
       "AAG":  { "title": "Astral Adventurer's Guide (Spelljammer)", "group": "settings", "owned": true },
       "SCAG": { "title": "Sword Coast Adventurer's Guide", "group": "settings", "owned": true },
       "PHB":  { "title": "Player's Handbook (2014)", "group": "core2014", "owned": true },
       "DMG":  { "title": "Dungeon Master's Guide (2014)", "group": "core2014", "owned": true },
       "MM":   { "title": "Monster Manual (2014)", "group": "core2014", "owned": true }
     }
   }
   ```

2. **One-Command D&D Beyond Account Sync (Optional Browser Snippet)**:
   `scripts/sync-ddb-owned-sources.mjs` will also include a 1-line DevTools console snippet you can run while logged into `https://www.dndbeyond.com/account/marketplace` (or `https://www.dndbeyond.com/sources`). It copies your owned D&D Beyond product titles/slugs as JSON; passing that JSON to `node scripts/sync-ddb-owned-sources.mjs --from-ddb owned.json` automatically sets `"owned": true/false` for every book in `fork/config/5e-2024-sources.json`.

### 2.3 Deterministic 2024-First Resolution Rules
When building catalogs across both `core2024Sources` and `ownedSupplementSources`:
1. **2024 Supersedes 2014 (`reprintedAs` / Name+Kind Collision)**:
   - If an entry in `PHB`, `DMG`, `MM`, `TCE`, `XGE`, `MPMM`, etc. has `reprintedAs` pointing to `XPHB`, `XDMG`, or `XMM` (or shares normalized `(kind, name)` with a `core2024Sources` entry), **only the 2024 entry is emitted**.
   - Example: `Cure Wounds|XPHB` (`2d8 + mod` per slot level) replaces `Cure Wounds|PHB` (`1d8 + mod`). `Aasimar|XPHB` replaces `Aasimar|MPMM` and `Aasimar|VGM`. `Goliath|XPHB` replaces `Goliath|MPMM`.
2. **Legacy Supplements Normalizing to 2024 Rules**:
   - If an owned 2014/supplement option has **not** been reprinted in `XPHB`/`XDMG`/`XMM`, it is included and automatically adapted to 2024 sheet conventions:
     - **Legacy Species (`races`)**: Strip fixed/floating `ability` score bonuses from the species entry because 2024 **Backgrounds** grant ability score increases (`+2/+1` or `+1/+1/+1`). Retain size, speed, darkvision, resistances, natural weapons, Proficiencies, and innate spellcasting.
     - **Legacy Subclasses**: In 2024, **all classes gain their subclass at Level 3** (Cleric, Sorcerer, Warlock, and Wizard moved from Level 1/2 to Level 3). Any legacy subclass for those classes (e.g., `School of Necromancy|PHB`, `Tempest Domain|PHB`, `Hexblade|XGE`, `Bladesinging|TCE`) has its initial level-1 or level-2 features normalized to `offeredWhen: { derived: "level_<class>", atLeast: 3 }` so it slots cleanly into the 2024 class progression.
     - **Legacy Backgrounds**: If a legacy background without a 2024 reprint is enabled, automatically attach the 2024 standard `+2/+1` (or `+1/+1/+1`) ability choice and an Origin Feat choice (`grants.entries.choose` from `features` with `filter: { kind: "origin_feat" }`) so it remains legal in the 2024 character builder.
     - **Artificer (`TCE` / `EFA`)**: Added as the 13th class (`level_artificer`) with d8 hit die, INT spellcasting, CON/INT saving throws, Magical Tinkering / Infuse Item / Flash of Genius / Soul of Artifice, and subclasses including `Alchemist`, `Armorer`, `Artillerist`, `Battle Smith`, and `Cartographer`.

### 2.4 Runtime Content Filtering via Game-Setup `layers` (Capability API `1.813`)
In addition to build-time filtering, every catalog in `ruleset.json` will declare a `"source"` filter (`type: "enum"` or `"text"`, e.g. `"XPHB"`, `"TCE"`, `"XGE"`, `"MPMM"`, `"ERLW"`). Using `ruleset.json`'s top-level `layers` array (validated in [`scripts/ruleset-package-checks.mjs`](file:///home/bah/git/marinara-agents/scripts/ruleset-package-checks.mjs#L2762-L2829)), a GM creating a game in Marinara can toggle content layers at runtime without rebuilding:
- **`core_2024_only`**: Hides catalog entries where `source` is not `XPHB`, `XDMG`, or `XMM`.
- **`no_setting_books`**: Hides Eberron/Ravnica/Spelljammer/Dragonlance setting-specific entries while keeping `XPHB` + `TCE` + `XGE` + `MPMM`.
- **`low_magic`**: Hides `rare`, `very_rare`, and `legendary` magic items.

---

## 3. Engine & Validator Limits (Corrections to Previous Plan)

Inspecting [`scripts/ruleset-package-checks.mjs`](file:///home/bah/git/marinara-agents/scripts/ruleset-package-checks.mjs#L10-L24) reveals strict hard caps enforced by both the repository gate and `marinara-engine` at package install time. Any plan for a full 5etools dump **must** engineer around these limits:

| Resource / Constraint | Validator Constant / Gate | Hard Limit | `ruleset-5e-2014` Current Usage | Strategy for `ruleset-5e-2024` |
| :--- | :--- | :--- | :--- | :--- |
| **`ruleset.json` size** | `RULESET_MAX_BYTES` | **512 KiB** (`524,288 B`) | `406,542 B` (77.5%) | Keep catalog entries in `catalogs/*.json` assets; keep `ruleset.json` concise (~420 KiB). |
| **Per-catalog file size** | `RULESET_CATALOG_MAX_BYTES` | **2 MiB** (`2,097,152 B`) | `creatures.json`: 1.52 MB<br>`magic_items.json`: 1.45 MB | **Critical**: See §3.1 below for compaction + optional Engine cap raise. |
| **Per-catalog entry count** | `RULESET_CATALOG_MAX_ENTRIES` | **2,000 entries** | `magic_items.json`: 1,155<br>`features.json`: 575<br>`creatures.json`: 404 | **Critical**: Avoid generating 900 separate per-spell scroll entries; filter adventure NPCs. |
| **Catalog count** | `RULESET_CATALOGS_MAX` | **12 catalogs** | **12** (at max!) | Reuse the exact 12 catalog IDs (`spells`, `features`, `races`, `classes`, `backgrounds`, `languages`, `tools`, `fighting_styles`, `weapons`, `equipment`, `magic_items`, `creatures`). Store Feats in `features` & `fighting_styles`. |
| **Cross-package `from` on catalogs** | `validateCatalogs` (`L2560`) | **Not allowed** (`entries` xor `asset`) | N/A | **Correction to old §5B**: Catalogs *cannot* borrow from `5e-2014` via `from` (only creature art packs support `from`). `build-5e-2024-catalogs.mjs` emits all 12 `catalogs/<id>.json` files into `packages/ruleset-5e-2024/catalogs/`. |
| **Filters per catalog** | `validateCatalogs` (`L7862`) | **8 filters** | Max 4 used | Safe to add `source` (and `kind` / `mastery`) filters to every catalog. |
| **Derived values** | `RULESET_DERIVED_MAX` | **800** | 456 | Adding `level_artificer`, `artificer_own`, `caster_artificer`, and 2024 formulas adds ~35 entries (~491 total). |
| **Combat conditions** | `validateCombat` (`L6586`) | **640** | 44 | Adding 2024 Weapon Mastery & spell conditions (`sapped`, `vexed`, `slowed_mastery`, `emanation_*`) stays < 65. |
| **Builder steps** | `validateSheet` (`L7611`) | **32 steps** | 22 steps | Adding `artificer` class-feature step + `origin_feat` / `epic_boon` steps uses ~25 steps. |

### 3.1 Raising the Catalog & Ruleset Caps + Smart Compaction
In `ruleset-5e-2014`, `magic_items.json` is 1.45 MB for SRD alone because `build-5e-srd-catalogs.mjs` synthesizes a separate `Spell Scroll (<Spell Name>)` entry for every spell (436 scrolls out of 1,155 items!), and `creatures.json` is 1.52 MB for 404 SRD monsters with pretty-printed 2-space indentation.

We will do **both** of the following so we never hit artificial ceilings:
1. **Bump Limits in `marinara-engine` (`custom-mods`) and [`scripts/ruleset-package-checks.mjs`](file:///home/bah/git/marinara-agents/scripts/ruleset-package-checks.mjs#L13-L16)**:
   - `RULESET_MAX_BYTES`: `512 KiB` → **`2 MiB`** (`2 * 1024 * 1024`)
   - `RULESET_CATALOG_MAX_BYTES`: `2 MiB` → **`16 MiB`** (`16 * 1024 * 1024`)
   - `RULESET_CATALOG_MAX_ENTRIES`: `2,000` → **`10,000`**
   - `RULESET_DERIVED_MAX`: `800` → **`1,600`**
2. **Smart Compaction in `packages/ruleset-5e-2024/catalogs/*.json`** (keeps payloads fast to load over IPC/WebSockets):
   - **Spell Scrolls**: Emit the 10 tier entries (`Spell Scroll (Cantrip)` through `Spell Scroll (9th Level)`) instead of duplicating all ~650 spells inside `magic_items.json`.
   - **Magic Weapon/Armor Variants**: Emit base magic items + standard `+1/+2/+3` and core weapon/armor variants (`Flame Tongue`, `Vicious Weapon`, `Weapon of Warning`, `Armor of Resistance`, etc.) rather than exploding every permutation of 40 base weapons × 30 generic variants.
   - **Creatures**: Include all `XMM` (2025 Monster Manual) + `XPHB` summons/wild shapes + owned supplement monsters (`MPMM`, `FTD`, `BGG`, `ERLW`, `VRGR`, etc.), while keeping one-off named adventure NPCs configurable via `"includeAdventureCreatures": false`.

---

## 4. Concrete 2024 Mechanics, Sheet, Builder & Combat Design

### 4.1 13 Classes (`level_artificer`) & Level-1 Half-Casters
In [`scripts/ruleset-5e-2024-sheet.mjs`](file:///home/bah/git/marinara-agents/scripts/ruleset-5e-sheet.mjs):
1. **Add `artificer` to the Class Roster**:
   - Sheet field: `level_artificer` (`0..20`, section `identity`, layout `class_levels`).
   - Hit die: `d8` (added to `hit_dice_d8` sum alongside Bard, Cleric, Druid, Monk, Rogue, Warlock).
   - Saving throws: Constitution & Intelligence (`con_save_prof`, `int_save_prof`).
   - Spellcasting ability: Intelligence (`spell_mod_artificer`, `spell_dc_artificer`, `spell_atk_artificer`).
2. **2024 Half-Caster Progression (Paladin, Ranger, Artificer)**:
   - In 2024, **Paladin and Ranger gain `Spellcasting` at Level 1** (replacing 2014's Level-2 threshold), and **round up** when multiclassing (`ceil(level / 2)`), matching Artificer!
   - Update single-class slot tables `paladin_own`, `ranger_own`, and `artificer_own` so Level 1 maps to Effective Caster Level `1` (`[[1, 1], [3, 2], [5, 3], [7, 4], [9, 5], [11, 6], [13, 7], [15, 8], [17, 9], [19, 10]]`) with **2 first-level spell slots at class level 1**.
   - Update multiclass `caster_paladin`, `caster_ranger`, and `caster_artificer` step tables to `[[1, 1], [3, 2], [5, 3], [7, 4], [9, 5], [11, 6], [13, 7], [15, 8], [17, 9], [19, 10]]`.
   - Note: In [`scripts/ruleset-package-checks.mjs`](file:///home/bah/git/marinara-agents/scripts/ruleset-package-checks.mjs#L14011-L14132), `assertSpellSlots` runs `if (ruleset.id === "5e-2014")`. We will add a parallel `if (ruleset.id === "5e-2024")` check that verifies Level-1 Paladin/Ranger/Artificer have `[2, 0, ...]` slots!
3. **Unified Level-3 Subclass Gate**:
   - All 13 classes gate their subclass selection and initial subclass features at `atLeast: 3` (`level_cleric >= 3`, `level_sorcerer >= 3`, `level_warlock >= 3`, `level_wizard >= 3`).
   - Level-1 Clerics choose `Divine Order` (`Protector` for martial weapons + heavy armor, or `Thaumaturge` for extra cantrip + WIS bonus to Arcana/Religion).
   - Level-1 Druids choose `Primal Order` (`Magician` or `Warden`).
   - Level-1 Warlocks can take Pact Blade / Tome / Chain invocations directly at Level 1 (`Eldritch Invocations` starts at Level 1 in 2024).

### 4.2 Species, Backgrounds, and Feats (2024 Builder Flow)
1. **Species (`races` catalog, UI label `"Species"`)**:
   - Contains 2024 `XPHB` species (`Aasimar`, `Dragonborn`, `Dwarf`, `Elf`, `Gnome`, `Goliath`, `Halfling`, `Human`, `Orc`, `Tiefling`) + owned legacy species (`Warforged`, `Changeling`, `Bugbear`, `Goblin`, `Kobold`, `Tabaxi`, `Tortle`, `Harengon`, `Fairy`, `Githyanki`, `Githzerai`, etc.).
   - **No `grants.abilities`** on species entries (even for legacy species, which are normalized to 2024 rules).
   - **Human (`XPHB`)**: Grants `Resourceful` (Heroic Inspiration on Long Rest), `Skillful` (1 skill choice), and `Versatile` (1 extra Origin Feat choice via `grants.entries.choose` from `features` with `filter: { kind: "origin_feat" }`).
   - **Subspecies / Lineages**: Handled via `parent` entries (`Elf` -> `Drow`, `High Elf`, `Wood Elf`; `Goliath` -> Giant Ancestry variants; `Tiefling` -> `Abyssal`, `Chthonic`, `Infernal`; `Aasimar` -> Celestial Revelation actions).
2. **Backgrounds (`backgrounds` catalog)**:
   - 2024 `XPHB` backgrounds (`Acolyte`, `Artisan`, `Charlatan`, `Criminal`, `Entertainer`, `Farmer`, `Guard`, `Guide`, `Hermit`, `Merchant`, `Noble`, `Sage`, `Sailor`, `Scribe`, `Soldier`, `Wayfarer`) + normalized legacy backgrounds.
   - Each 2024 background lists 3 allowed abilities (e.g. `Sage`: CON, INT, WIS) and grants:
     - **Ability Score Increases**: Handled cleanly via the `abilities` builder step (point-buy / standard array / manual) plus background ability bonus grants (`+2/+1` or `+1/+1/+1`).
     - **Origin Feat**: Automatically adds the background's designated Origin Feat (`grants.entries.add`, e.g. `Magic Initiate (Wizard)` for `Sage`, `Alert` for `Criminal`, `Tough` for `Farmer`, `Lucky` for `Wayfarer`, `Musician` for `Entertainer`, `Healer` for `Hermit`, `Skilled` for `Noble`/`Scribe`, `Savage Attacker` for `Soldier`, `Tavern Brawler` for `Sailor`).
     - **Proficiencies & Starting Equipment**: 2 skills, 1 tool, and 2024 starting gear package.
3. **Feats in `features.json` and `fighting_styles.json`**:
   - Because `RULESET_CATALOGS_MAX` is 12, Feats live inside `features.json` with `filters.kind` set to:
     - `"origin_feat"` (`Alert`, `Crafter`, `Healer`, `Lucky`, `Magic Initiate`, `Musician`, `Savage Attacker`, `Skilled`, `Tavern Brawler`, `Tough`)
     - `"general_feat"` (all 2024 Level 4+ feats: `War Caster`, `Great Weapon Master`, `Sharpshooter`, `Sentinel`, `Polearm Master`, `Fey Touched`, `Shadow Touched`, `Telekinetic`, `Telepathic`, `Resilient`, `Inspiring Leader`, `Mage Slayer`, `Speedy`, etc., plus un-reprinted `XGE`/`TCE` racial/general feats). Every 2024 General Feat includes its `+1` ability score increase (`grants.abilities.fixed` or `.choose`) or can be selected at ASI levels!
     - `"epic_boon"` (Level 19+ Epic Boons: `Boon of Combat Prowess`, `Boon of Dimensional Travel`, `Boon of Energy Resistance`, `Boon of Fate`, `Boon of Fortitude`, `Boon of Irresistible Offense`, `Boon of Recovery`, `Boon of Skill`, `Boon of Speed`, `Boon of Spell Recall`, `Boon of the Night Spirit`, `Boon of Truesight`).
   - Fighting Style Feats (`Archery`, `Blind Fighting`, `Defense`, `Dueling`, `Great Weapon Fighting`, `Interception`, `Protection`, `Thrown Weapon Fighting`, `Two-Weapon Fighting`, `Unarmed Fighting`) remain in `fighting_styles.json`.

### 4.3 2024 Core Combat & Sheet Mechanics
Every major 2024 rules change maps directly onto Marinara's existing Capability API `1.930`:

| 2024 Rule Change | Marinara Schema Implementation in `packages/ruleset-5e-2024/ruleset.json` |
| :--- | :--- |
| **Exhaustion (2024)**<br>Levels 1–5 give `-2 × level` to all d20 Tests (attacks, saves, checks) and `-5 ft × level` to Speed; Level 6 is death. | In `combat.statusTracks` (`id: "exhaustion"`, `max: 6`):<br>Each level `1..5` sets `modifiers: [{ to: "attacks", flat: -2 * L }, { to: "saves", flat: -2 * L }, { to: "checks", flat: -2 * L }, { to: "speed", flat: -5 * L }]`. Level 6 sets `defeats: true`. *(Note: Spell save DCs are unaffected unless we opt in, matching official 2024 XPHB rules.)* |
| **Surprise (2024)**<br>Surprised creatures have Disadvantage on Initiative instead of skipping their first turn. | In `combat.conditions` (`id: "surprised"`):<br>Remove `"incapacitated"` effect; set `modifiers: [{ to: "checks", mode: "disadvantage" }]` (or dedicated initiative note) expiring `startOfTurn`. |
| **Alert Feat (2024)**<br>Add Proficiency Bonus to Initiative (`+PB`), instead of flat `+5`. | Add numeric column `init_prof_mult` on `features` catalog. `Alert (2024)` sets `init_prof_mult: 1`. In `derived`, `initiative` sums `dex_mod + jack_of_all_trades_bonus + remarkable_athlete_bonus + (init_prof_mult * prof_bonus) + init_flat_bonus`. |
| **Heroic Inspiration** | Add `heroic_inspiration` (`max: 1`, `recoversOn: "longRest"` for Humans) to `sheet.live.pools`, plus `combat.heroicInspiration` reroll support. |
| **Potions as Bonus Action** | In `equipment.json` (`Potion of Healing`) and `magic_items.json` (`Potion of *`), set `mechanics.activation.budget: "bonus"` (instead of `"action"`). |
| **2024 Healing Spells**<br>Doubled dice (`Cure Wounds` = `2d8 + mod`, `Healing Word` = `2d4 + mod`, `Mass Healing Word` = `2d4 + mod`, `Prayer of Healing` = `2d8 + school`). | Extracted directly from `XPHB` spell entries in `data/spells/spells-xphb.json` with `upcast.perLevel: { dice: "2d8" }` / `"1d4"`. |
| **Counterspell (2024)**<br>Target makes a CON save vs caster's Spell Save DC (`onFail`: spell dissipates, slot not expended!). | Extracted from `Counterspell|XPHB`: `save: { ability: "con", dc: "spell_dc" }`. |
| **Monk (2024)**<br>Martial Arts starts at `1d6` (`1d6 -> 1d8 -> 1d10 -> 1d12`); Focus Points; `Uncanny Metabolism` refills Focus on Initiative (`level >= 2`); `Deflect Attacks` works on melee + ranged. | - `martial_arts_die`: step table `[[1, 6], [5, 8], [11, 10], [17, 12]]`.<br>- `Uncanny Metabolism`: uses Capability API `1.411` `refillsAtInitiative: { pool: "Ki Points", heal: "1d{martial_arts_die} + {level_monk}" }`.<br>- `Deflect Attacks`: reaction `reducesDamage: "1d10 + {dex_mod} + {level_monk}"` on any bludgeoning/piercing/slashing hit. |
| **Barbarian (2024)**<br>Rage lasts 10 minutes, regains 1 use on Short Rest (`Weapon Mastery`, `Primal Knowledge`, `Brutal Strike` at L9 replacing Brutal Critical). | - `rage_uses` pool adds `shortRestRecovery: 1`.<br>- `Primal Knowledge` (L3) and `Brutal Strike` (L9: `+1d10` damage + Forceful/Hamstring/Staggering/Sundering Blow riders) modeled as `features.json` entries. |
| **Paladin (2024)**<br>`Divine Smite` is now a Level-1 Bonus Action spell (1/turn free cast via `Paladin's Smite` at L2); `Lay on Hands` is a Bonus Action. | - `Lay on Hands`: `budget: "bonus"`.<br>- `Divine Smite|XPHB`, `Searing Smite|XPHB`, `Wrathful Smite|XPHB`, `Thunderous Smite|XPHB`, `Shining Smite|XPHB`: `budget: "bonus"`, no concentration on `Divine Smite` / `Thunderous Smite` / `Wrathful Smite`. |
| **Weapon Mastery (2024)**<br>8 weapon mastery properties (`Cleave`, `Graze`, `Nick`, `Push`, `Sap`, `Slow`, `Topple`, `Vex`). | Each weapon in `weapons.json` carries a `mastery` column/filter (`"Cleave"`, `"Graze"`, `"Nick"`, `"Push"`, `"Sap"`, `"Slow"`, `"Topple"`, `"Vex"`), plus mastery action/rider entries in `features.json`:<br>- **Push**: `push: 10` on hit.<br>- **Topple**: `save: { ability: "con", onFail: { conditions: ["prone"] } }` on hit.<br>- **Sap**: applies `sapped` condition (`modifiers: [{ to: "attacks", mode: "disadvantage" }]`, `expires: "startOfSourceTurn"`).<br>- **Slow**: applies `slowed_mastery` condition (`modifiers: [{ to: "speed", flat: -10 }]`, `expires: "startOfSourceTurn"`).<br>- **Vex**: applies `vexed` condition (`modifiers: [{ to: "attacksAgainst", mode: "advantage" }]`, `expires: "endOfSourceTurn"`).<br>- **Cleave**: `strikesAgain: { within: 5 }` secondary attack action.<br>- **Nick**: off-hand light weapon attack (`budget: "free"`, 1/turn).<br>- **Graze**: bonus/free action or combat reminder dealing `{ability_mod}` damage on miss. |

### 4.4 Verifying Your Party's Characters Out-of-the-Box
With `XPHB` + `EFA`/`TCE` + `XGE` + `PHB` enabled in `fork/config/5e-2024-sources.json`, all 4 characters in `/home/bah/Downloads/*-sheet.json` work as first-class 2024 sheets without hacks:
- **Angharad** (L3 Human Wizard — *School of Necromancy*): Uses `Human|XPHB`, `Wizard|XPHB` (with 2024 `Scholar` + `Memorize Spell`), and `School of Necromancy|PHB` adapted to Level 3 (`Grim Harvest`, `Necromancy Savant`), plus 2024 spells (`Mind Sliver`, `Toll the Dead`, `Tasha's Hideous Laughter`, `Misty Step`, `Ray of Sickness`, etc.).
- **Nia** (L3 Human Cleric — *Peace Domain*): Uses `Human|XPHB`, `Cleric|XPHB` (`Divine Order`, `Channel Divinity: Divine Spark`), and `Peace Domain|TCE` (`Emboldening Bond`, `Balm of Peace`) normalized to Level 3, plus 2024 `Toll the Dead` and `Alert|XPHB` (`+PB` to Initiative).
- **Trouw** (L3 Aasimar Artificer — *Cartographer*): Uses `Aasimar|XPHB` (with Celestial Revelation), first-class `Artificer|EFA` (`level_artificer: 3`, INT half-caster rounded up), and `Cartographer|EFA` (`Adventurer's Atlas`, `Mapping Magic`, `Portal Jump`, `Guiding Bolt`, `Faerie Fire`, `Healing Word`, `Mind Spike`), plus `Tough|XPHB` (`+2 HP/level`).
- **Saskia** (L3 Wood Elf Rogue — *Scout*): Uses `Elf (Wood)|XPHB` (`35 ft` speed, `Druidcraft`, `Longstrider`, `Pass without Trace`), `Rogue|XPHB` (`Steady Aim` at L3, `Weapon Mastery`), and `Scout|XGE` (`Skirmisher` reaction move half speed, `Survivalist` expertise in Nature/Survival), plus `Alert|XPHB`.

---

## 5. Phased Implementation Plan

### Phase 1: Validator/Engine Cap Bump, Owned-Content Config & 5etools Parser Library
1. **Bump Ruleset & Catalog Limits**:
   - Update [`scripts/ruleset-package-checks.mjs`](file:///home/bah/git/marinara-agents/scripts/ruleset-package-checks.mjs#L13-L16) (and matching constants in `/home/bah/git/marinara-engine`):
     - `RULESET_MAX_BYTES = 2 * 1024 * 1024` (2 MiB)
     - `RULESET_CATALOG_MAX_BYTES = 16 * 1024 * 1024` (16 MiB)
     - `RULESET_CATALOG_MAX_ENTRIES = 10000`
     - `RULESET_DERIVED_MAX = 1600`
2. **Create `scripts/sync-ddb-owned-sources.mjs` & `fork/config/5e-2024-sources.json`**:
   - Reads `data/books.json` from the 5etools dump and emits `fork/config/5e-2024-sources.json` with human-readable D&D Beyond book titles, category groupings (`core2024`, `supplements`, `settings`, `core2014`, `adventures`), and `"owned": true` by default on all core/supplement/setting books.
   - Includes a `--from-ddb <file>` mode + 1-line browser console snippet for `https://www.dndbeyond.com/account/marketplace` or `https://www.dndbeyond.com/sources` to auto-toggle `"owned": true/false` directly from your D&D Beyond account.
3. **Create `scripts/lib/5etools-loader.mjs` and `scripts/lib/5etools-tags.mjs`**:
   - Resolve 5etools `_copy` / `_mod` inheritance across files in the full dump.
   - Implement deterministic 5etools tag stripping and mechanical extraction:
     - `strip5eTags(text)` -> clean Markdown/plain text for `description` and `summary`.
     - `extract5eMechanics(entry)` -> parses `{@atk ...}`, `{@hit ...}`, `{@damage ...}`, `{@dc ...}`, `{@actSave ...}`, `{@condition ...}`, `{@recharge ...}` into Marinara `ActionMechanics` (`kind`, `budget`, `range`, `area`, `attack`, `damage`, `save`, `heal`, `conditions`, `upcast`, `pool`, `recharge`).
   - Implement **2024-first deduplication** (`resolveEntitiesWithReprints(core2024, supplements)`).

### Phase 2: 2024 Sheet, Builder & Core Rules (`ruleset.json`)
1. **Create `scripts/ruleset-5e-2024-sheet.mjs` and `scripts/ruleset-5e-2024-builder-data.mjs`**:
   - Fork from [`scripts/ruleset-5e-sheet.mjs`](file:///home/bah/git/marinara-agents/scripts/ruleset-5e-sheet.mjs) and [`scripts/ruleset-5e-builder-data.mjs`](file:///home/bah/git/marinara-agents/scripts/ruleset-5e-builder-data.mjs).
   - Add `artificer` (`level_artificer`) across class levels, hit dice (`d8`), spellcasting (`int`), half-caster progression (`ceil(level / 2)`), and builder class steps.
   - Update Paladin and Ranger to Level-1 spellcasting (`paladin_own`, `ranger_own`, `caster_paladin`, `caster_ranger`).
   - Update Monk `martial_arts_die` to start at `1d6`.
   - Update `initiative` formula to support `Alert (2024)` (`+PB`).
   - Update `combat.statusTracks.exhaustion` to 2024 `-2 per level` d20 test penalty and `-5 ft per level` speed penalty.
   - Update `combat.conditions.surprised` and add Weapon Mastery combat conditions (`sapped`, `slowed_mastery`, `vexed`).
   - Configure Game-Setup `layers` (`core_2024_only`, `no_setting_books`, `low_magic`).

### Phase 3: 5etools Catalog Builder (`scripts/build-5e-2024-catalogs.mjs`)
1. **Generate all 12 catalogs into `packages/ruleset-5e-2024/catalogs/*.json`**:
   - `spells.json`: `XPHB` spells + un-reprinted `TCE`/`XGE`/`FTD`/`AAG` spells, with class/subclass lists (`artificer` included) and full `mechanics`.
   - `classes.json`: 12 `XPHB` classes + `Artificer`, all 48 `XPHB` subclasses + owned legacy subclasses (`Cartographer`, `Scout`, `Peace Domain`, `School of Necromancy`, `Hexblade`, `Bladesinging`, etc.) normalized to Level 3.
   - `races.json`: `XPHB` Species + owned legacy Species (stripped of legacy ability bonuses).
   - `backgrounds.json`: `XPHB` Backgrounds with Origin Feat grants + normalized legacy backgrounds.
   - `features.json`: Class/subclass features + 2024 Origin Feats, General Feats, Epic Boons, and Weapon Mastery property actions.
   - `fighting_styles.json`: 2024 Fighting Style Feats.
   - `weapons.json`, `equipment.json`, `magic_items.json`: 2024 weapons (with `mastery`), armor, bonus-action potions, and magic items (compacted to stay under `RULESET_CATALOG_MAX_BYTES` / `RULESET_CATALOG_MAX_ENTRIES`).
   - `creatures.json`: `XMM` + `XPHB` + selected supplement monsters with parsed multiattack, saves, recharge abilities, and legendary/lair actions.
   - `languages.json` & `tools.json`: 2024 standard/rare languages and tool proficiencies.

### Phase 4: Package Wiring, `ddb2sheet.py` Update & Validation
1. **Register `packages/ruleset-5e-2024`**:
   - Create `packages/ruleset-5e-2024/manifest.json` (`id: "ruleset-5e-2024"`, `ruleset.json`, `catalogs/*.json`, `locales/en/package.json`, `CHANGELOG.md`, `README.md`).
   - Update [`scripts/ruleset-package-checks.mjs`](file:///home/bah/git/marinara-agents/scripts/ruleset-package-checks.mjs) so 2024-specific spell-slot assertions (`assertSpellSlots` for `5e-2024`) validate Level-1 Paladin/Ranger/Artificer half-casters.
2. **Update `ddb2sheet.py`**:
   - Default 2024 characters to `rulesetId: "5e-2024"`, map Artificer levels to `level_artificer`, and emit canonical `5e-2024` catalog entry IDs.
3. **Run Gates & Install**:
   - Run `fork/tools/check.sh` and `fork/tools/install.sh ruleset-5e-2024`.
