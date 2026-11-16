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
- **Guided builder**: a class pick sets its level, saves, skill choices, hit die and weapon training; class features arrive by level; Subclass is one pick per class at 3rd level; a Feats step asks for a general feat at each feat level, and every feat applies its +1 (the ASI feat its +2 or +1/+1); species and lineages set size, speed, darkvision and their cantrips; backgrounds give their +2/+1, skills, origin feat and tools; spells are offered from each class's own list, with a wizard spellbook. Each class lists its ability priority for a suggested build.
- **Builder limits**: feat prerequisites are not enforced; an origin feat chosen through a species or background adds its row, not its own grants; a background's +1 may land on its +2's ability; prepared-spell counts follow the 2014 formulas except the Artificer's. Warlock invocations and pact boons, metamagic, mystic arcanum, spell mastery and signature spells, starting equipment and weapon masteries beyond the fixed rows are not built.
- **2024 Conditions & Mechanics**: 2024 Exhaustion (`-2 × level` to d20 tests, `-5 ft × level` speed), 2024 Alert (`+PB` to initiative), Level 7 Reliable Talent, Eloquence Bard Silver Tongue check floor (`face: 10`), and bonus-action potions.
- **Campaign Layers**: Built-in runtime toggles for *2024 Core Only*, *No Setting-Specific Options*, and *Low Magic*.

