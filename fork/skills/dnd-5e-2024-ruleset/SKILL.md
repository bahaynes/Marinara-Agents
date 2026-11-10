---
name: dnd-5e-2024-ruleset
description: >-
  Diagnose, fix, or add missing 5e 2024 mechanics, subclass features, spells,
  weapon masteries, or character sheet bugs in Marinara. Use when a 2024 rule or
  ability didn't work in a game session, a feature card is missing or miscalculated,
  or when hot-reloading ruleset packages into the live Marinara instance.
---

# 5e (2024 Edition) Ruleset Diagnostics & Extension Guide

This skill guides rapid debugging, content additions, and live fixes for `ruleset-5e-2024` in `marinara-agents`.

---

## 1. Quick Triage: Where Does the Feature Live?

When an ability or rule doesn't work during a game session, identify the layer:

1. **Missing or Incomplete Card in Catalog Picker (Content Layer)**:
   - **Spells**: Check `packages/ruleset-5e-2024/catalogs/spells.json`. Does it have `filters.classes` (e.g. `["Wizard"]`) and `filters.class_ids`? If not, check `scripts/build-5e-2024-catalogs.mjs` `buildSpells`.
   - **Subclasses & Subclass Features**: Check `catalogs/features.json`. Subclasses use `filters: { kind: "subclass", class: "<ClassName>", subclass: "<SubclassName>" }`. Individual features use `filters: { kind: "feature", class: "<ClassName>", subclass: "<SubclassName>", level: <N> }`.
   - **Weapon Masteries**: Weapon cards in `catalogs/weapons.json` inherit `mastery: "<Name>"` from base items; the 8 masteries are feature cards in `catalogs/features.json` under `kind: "weapon_mastery"`.

2. **Calculation / Sheet Check / Floor (Sheet Derivation Layer)**:
   - Defined in `packages/ruleset-5e-2024/ruleset.json` under `sheet.derived`.
   - **CRITICAL**: Derived values in Marinara are evaluated in strict topological order. A derived value can *never* reference a value declared after it.
   - **Examples**:
     - *Silver Tongue*: check floor of 10 on deception and persuasion (`face: 10`).
     - *Reliable Talent*: check floor of 10 for Rogue level >= 7 (`face: 10`).
     - *Exhaustion*: `-2 * level` to d20 tests, `-5 ft * level` to speed.

3. **Combat Action / Reaction / Buff (Combat Layer)**:
   - Defined in `ruleset.json` under `combat.conditions`, `combat.reactions`, or catalog `mechanics`.
   - If a combat action hook is needed (e.g. bonus-action potion, wild shape), ensure it declares valid `budget` (`action`, `bonus`, `reaction`, `free`).

---

## 2. Test Before You Commit

Never guess if a formula or sheet change works. Test directly:

```javascript
// Test sheet evaluation in node:
node -e '
const { evaluateSheet } = await import("./scripts/ruleset-5e-2024-sheet.mjs");
const rs = JSON.parse(fs.readFileSync("packages/ruleset-5e-2024/ruleset.json", "utf8"));
const res = evaluateSheet(rs, {
  abilities: { str: 10, dex: 16, con: 14, int: 10, wis: 12, cha: 16 },
  fields: { level_rogue: 7, level_bard: 3 },
  skills: { stealth: "proficient", persuasion: "proficient" }
});
console.log("Stealth:", res.values.stealth, "Persuasion:", res.values.persuasion);
'
```

---

## 3. Fast Rebuild & Live Hot-Reload

When you make a fix or add missing data:

```bash
# 1. If modifying 5etools extraction logic:
node scripts/build-5e-2024-catalogs.mjs

# 2. If modifying ruleset.json / mechanics builder:
node scripts/build-ruleset-5e-2024.mjs

# 3. Package and route artifacts:
node scripts/build-ruleset-packages.mjs

# 4. Run repository gates in one command:
bash fork/tools/check.sh

# 5. Hot-install into the running local Marinara instance:
bash fork/tools/install.sh ruleset-5e-2024
```

---

## 4. D&D Beyond PDF Importer Debugging

If an imported PDF character sheet is missing values:
- Run: `node scripts/import-dndbeyond-pdf.mjs <pdf_path> --ruleset 5e-2024`
- Inspect `scripts/import-dndbeyond-pdf.mjs` annotation widget mapping (`getAnnotationWidgetValue`).
- Remember that `pdfjs-dist` worker requires trailing slashes on standard font paths.
