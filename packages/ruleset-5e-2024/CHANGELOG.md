# 5e (2024 Edition)

## 1.0.3 - 2026-11-09

- Aligned all 12 catalog assets with strict engine catalog schemas (filters, mechanics, text limits, rarities, and challenge numbers).
- Integrated verified 2014 SRD combat mechanics onto 2024 spell catalog entries.

## 1.0.2 - 2026-11-09

- Aligned starting gear, condition behavior, and catalog layer schema with engine requirements.

## 1.0.1 - 2026-11-09

- Compact ruleset envelope encoding to adhere to Engine 512 KiB asset limit.
- Enriched 147 subclasses, 839 subclass features, and spell class filters from 5etools lookup data.

## 1.0.0 - 2026-11-08

- Initial release of the 2024 D&D 5e Ruleset (`5e-2024`), built from a local 5etools dump with owned-book filtering (`fork/config/5e-2024-sources.json`).
- 13 classes with first-class Artificer (`level_artificer`) and half-caster slot progression starting at 1st level (`ceil(level / 2)`).
- 2024 Half-Casters: Paladin and Ranger gain Spellcasting at 1st level and round up for multiclassing.
- 2024 Progression: Subclasses standardized to 3rd level; Backgrounds grant Ability Score Increases and Origin Feats.
- 2024 Exhaustion track with -2 per level penalty to all d20 tests and -5 ft speed reduction per level; Level 6 causes death.
- 2024 Alert feat adds Proficiency Bonus to Initiative.
- 2024 Monk martial arts die starting at 1d6 and Focus Points.
- Potions usable as a Bonus Action.
- All 8 2024 Weapon Masteries integrated into weapon properties and catalog filters.
- Runtime campaign layers: `core_2024_only`, `no_setting_books`, and `low_magic`.
