# 5e (2024 Edition) Ruleset

First-party support for the 2024 revised 5th Edition rules, built from local 5etools dumps with configurable owned-book filtering.

See [`fork/docs/ruleset-5e-2024.md`](file:///home/bah/git/marinara-agents/fork/docs/ruleset-5e-2024.md) for full architecture, catalog reference, pipeline commands, and PDF importer guide.

### Features
- **13 Classes with Artificer**: Barbarian, Bard, Cleric, Druid, Fighter, Monk, Paladin, Ranger, Rogue, Sorcerer, Warlock, Wizard, and **Artificer**.
- **147 Subclasses & 839 Features**: Complete subclass cards and abilities for all classes across 2024 PHB and active supplements.
- **541 Spells with Class Filtering**: Full class associations (`filters.classes`, `filters.class_ids`), schools, and ritual/concentration flags.
- **2024 Half-Casters**: Paladin, Ranger, and Artificer all gain Spellcasting at 1st level and round up for multiclassing (`ceil(level / 2)`).
- **Weapon Masteries**: Integrated support for Cleave, Graze, Nick, Push, Sap, Slow, Topple, and Vex across weapons, feature cards, and catalog filters.
- **2024 Progression & Builders**: Subclass selection standardized to 3rd level; Backgrounds grant Ability Score Increases and Origin Feats.
- **2024 Conditions & Mechanics**: 2024 Exhaustion (`-2 × level` to d20 tests, `-5 ft × level` speed), 2024 Alert (`+PB` to initiative), Level 7 Reliable Talent, Eloquence Bard Silver Tongue check floor (`face: 10`), and bonus-action potions.
- **Campaign Layers**: Built-in runtime toggles for *2024 Core Only*, *No Setting-Specific Options*, and *Low Magic*.

