# Railroader: scenario packs for chats with a destination

Status: **draft for review, nothing built.** Written 2026-10-27. Grew out of `coherent-narrative.md` §12.3 (Story Architect) and a discussion of act vs scene planning.

## 1. Idea

Railroader is opt-in, for the chats you want to *go somewhere*. It is not for every chat.

- **Truth / destination** is fixed up front (who did it, where the story ends up).
- **Phases** are pacing gates with exit conditions, not scripted acts.
- **Scenarios** are portable pieces of story pressure, keyed on *conditions*, not *places*. They fire wherever the player goes. If every place you visit has the same threat in it, that is because the story needs you to deal with that threat (Apocalypse World "Fronts", Alexandrian "proactive nodes", Blades clocks).
- **The narrator is need-to-know.** It never holds the whole truth. It gets the scenario and clue text for the current moment, so it cannot leak a conclusion it was never given, and it does not invent a culprit because the clue text it plants is concrete.

**Library vs instance.** A library pack holds *shapes* (archetypes such as a hero's journey are not stale; generic ones are). A **fit pass** turns a library pack into a per-chat instance with this world's people, places and open threads. Specificity comes from the fit, not the library.

## 2. Minimum-code shape: a lorebook plus a Mari skill

Everything below uses existing Engine features; the only new artifact is a Mari skill. It can be a user custom skill added from Mari's Skills panel (`docs/home/professor-mari.md` § Custom Skills), not a new file in the Engine's built-in `assets/mari-skills/`, so the fork carries nothing extra through rebases.

| Layer | Implemented as |
| --- | --- |
| Spine (destination, current phase, finale gate) | One **Constant** entry. Phase blocks inside it are latched `{{#if decision:"…" until:"…"}}` conditionals. |
| Scenario | One entry per scenario (fields below). |
| "Pick one eligible scenario" | Entries share a `group`; one weighted winner per scan by `groupWeight`. |
| Fit pass | Mari skill: reads the chat's card, persona, active lorebooks, NPC Registry and Keeper entries, then writes a per-chat copy of the pack scoped to that chat. |
| Library | A template lorebook, scope `disabled`, never active in chats itself. |

### Scenario entry convention

| Field | Use |
| --- | --- |
| `decisionMode: trigger` + `decisionStatement` | The fit check: "the current scene can be interrupted / the party is somewhere this can happen". |
| `keys` | An ordinary activation route as well, since the docs say not to depend on Decision alone. |
| `sticky: N` | Stays in for the scenario's beats once it has fired: the firing turn plus N more (the count is set on firing and ticks once per later scan). |
| `cooldown` (very large) | Fires once per chat. Cooldown starts only after sticky runs out (`keyword-scanner.ts:300-305`), so the scenario holds for N turns and then rests for the rest of the chat. Cooldown is per entry; it does not rest the pool. |
| `delay` | Not before N scans after the entry first appears in one (`keyword-scanner.ts:290`), so a fit-pass instance created at message 200 waits N turns from its creation, not from the start of the chat. |
| no `ephemeral` | Do not combine it with `sticky`. On the first firing ephemeral counts down to 0 and the chat marks the entry disabled (`services/lorebook/index.ts:1665-1671`); later scans drop disabled entries before the sticky check (`index.ts:1352-1358`), so the scenario gets one turn. |
| `group` / `groupWeight` | Scenario pool; weight = how much the story wants it now. While one member is sticky, the group pick considers only sticky members (`keyword-scanner.ts:418-419`), so a firing scenario blocks the rest of its pool while it lasts. There is no gap between one scenario ending and the next starting (see §5.6). |
| `content` | 2–4 loose beats, role slots already bound by the fit pass, clue payload as plain description ("describe it; do not interpret it"). |
| `position` | Below the cache markers. Position `0`/`1` are before/after *character*, not chat: where they land depends on where the preset puts its lorebook marker (`marker-expander.ts` `world_info_before/after`). Check the preset; a lorebook marker injected at depth 0 puts every entry after the history. Not `2` (@Depth): that moves every turn. |

The spine changes only at phase changes, so it can sit early in the prompt; each phase change still costs one full cache rebuild.

The finale stays in the Constant spine behind its latch, so the story's destination never depends on a Require gate.

## 3. Fit pass (Mari skill outline)

Precedent: Game setup bakes selected lorebook canon into world generation (`gm-prompts.ts` `lorebookContext`: "Selected constant lorebook canon that MUST be treated as true for this world"), and world maps pass lorebooks in at creation.

1. Read the library pack and the chat: card, persona, active lorebooks, Keeper/NPC Registry entries, latest summary.
2. For each scenario: bind role slots to an existing NPC or place only when nothing known contradicts the role; otherwise create a fresh minor NPC. Reword decision statements and keys in this world's terms. Drop scenarios that do not fit, and say why.
3. Write the instance: `lorebook.create` with `scope: {"mode":"specific","chatIds":[…]}`, the spine plus the surviving scenarios.
4. Verify with `lorebook.testScan` on that chat; report blocked entries and their `fix`.
5. Re-fit on request (new arc, the world moved on), never silently.

Skill text rules: no story, character or franchise names anywhere, including examples ([[no-story-names-in-prompts]]).

## 4. Findings from the Engine (2026-10-27)

Verified in code or docs:

- Lorebook entries already have `decisionStatement`/`decisionMode` (`off|require|trigger`), `sticky`, `cooldown`, `delay`, `ephemeral`, `group`/`groupWeight`, `activationConditions`, `schedule` (`packages/shared/src/types/lorebook.ts`).
- Sticky, cooldown, delay and ephemeral state is **per chat** (chat metadata; `services/lorebook/index.ts` `entryStateOverrides` and per-chat timing state). A shared pack does not leak state between chats.
- Group = one weighted winner per scan. The `stableLorebookGroupPicks` feature flag seeds the pick by chat id for cache stability: the same winner every turn while the candidate set is unchanged.
- Latches: `until:`/`while:` keep a block on across turns; swipes do not advance timers (`docs/prompts/conditional-prompts.md`, Until and while).
- Mari can write the Decision fields (`services/mari-db/mari-db.service.ts`) even though `assets/mari-skills/lorebook.md` does not list them; the decisions skill covers the wording. She can scope a book to one chat.
- Mari can call package actions (`package_service` → `capability-mari-actions.service.ts`, permission `mari-actions`; Slurp2 uses it). That is the upgrade path if a package is ever needed.

## 5. Gaps (these decide whether it stays config-only)

1. **No permanent flag.** A latch turns off at its `until` and then re-arms. Nothing records "scenario A has happened" for B to depend on. Phase order (3 only after 2) is not enforced; a phase starts when its start statement is true of the recent chat. **Solved config-only (2026-10-27):** a constant entry can keep the phase in a chat variable, `{{#if var:rr_phase == 2 && decision:"…"}}{{setvar::rr_phase::3}}{{/if}}`; it persists per chat and shows in Chat Variables for a manual refit. Cost: a statement inside a variable-gated block is still asked every turn (the docs: variables can change mid-build), so each phase check is one statement per turn. Earlier options were: (a) accept it, since a transition is a moment the recent chat shows; (b) a long-lived latch with an `until` that never comes true (costs one statement per turn per flag); (c) an upstream change so `activationConditions` can read world-state custom fields by name (today `evaluateConditions` reads only top-level `gameState[field]`, so a custom field such as `phase` reads as `""`; `keyword-scanner.ts`). Decide after the prototype.
2. **Conditions fail open without game state.** `evaluateConditions` and `evaluateSchedule` pass when there is no game state (no world-state tracker in the chat). Do not use them as gates in RP chats without a tracker.
3. **Decision is not for story-critical gates.** The docs say use Require to filter optional lore, never to gate what the story depends on; with no Decision answer, Require admits nothing. Hence: the spine is Constant, and scenarios are optional by design.
4. **Cost and models.** Every scenario that is past its `delay`, not on cooldown, passes its `probability` roll and whose keys miss costs one statement per turn, **including while another scenario holds the group**: statements are asked per entry in the scan (`keyword-scanner.ts:637-638`), and the group pick runs afterwards (`:787`), so those answers cannot change anything. A fired scenario stops costing (its huge cooldown gates it out before the question). Levers, cheapest first: keep the pool small, stagger `delay` so only 2–3 scenarios are eligible at once, and use `probability` to thin the per-turn asks (rolled before the statement). The allowance defaults to 32, with lorebook statements using what the prompt leaves. Needs a Decision model: local only (quota). `marinara-wife` has none configured.
5. Decision activation reads as "no" in Game setup and in agents' own lorebook scans, so the pack only acts on chat turns.
6. **No rest between scenarios.** Cooldown is per entry; nothing rests a whole group. If the pool needs a gap after a scenario ends, that is a spine-latch job or a code change.
7. **Regenerating ticks the counters.** Every real chat-turn scan saves the new sticky/cooldown/delay state, with no regenerate check (`generate.routes.ts` `persistLorebookRuntimeState` calls; `keyword-scanner.ts` `updateTimingStatesForScan` decrements once per scan). Regenerating twice inside a `sticky: 3` scenario cuts its hold by two. A regenerate of the firing turn does not re-fire it; it eats a sticky turn. Agent scans and Peek Prompt pass no timing state or run `previewOnly`, so they do not tick. Mitigation: set `sticky` one or two above the beats you need. A fix would be an upstream change that skips saving timing state on regenerate.

## 6. Zero-code prototype

1. Hand-write (or ask Mari for) one small pack for one chat: a spine with a destination and 2–3 phase latches, plus 6–8 scenarios in one group, 2–3 of them carrying clues.
2. Play ~30 turns on the local Decision model.
3. Count: scenarios that fired out of fit (felt bolted on), scenarios that never fired, the narrator stating a conclusion it was not given, an invented culprit or destination, phase transitions that fired early or never, a scenario held fewer turns than its `sticky` value. Rolls (stored in each message's `roleplayCommandActivity`): DCs set from the player's prose instead of the situation, clever approaches without a modifier, failures that cost the character's dignity instead of the situation.
4. Use Peek Prompt to check that the prompt prefix stays byte-stable between scenario firings.
5. Note regenerates during a scenario; a short hold with regenerates is §5.7, not a bug.

The prototype on a live instance needs Ben's go-ahead first (and Erin's for `marinara-wife`).

## 7. Open questions

1. Is the truth fixed at setup (fair play), or locked late once the evidence commits? Recommendation: fixed, with a GM-only refit option (the default for now).
2. Library format: a plain lorebook export with slot placeholders, or a small manifest Mari reads? Start with the lorebook.
3. Where sealed truth lives for mysteries you do not author yourself (lorebooks are user-visible). Only this needs a package, generating the truth itself and returning handles to Mari, never content.

## 8. Prototype instance (2026-10-27)

`marinara`, chat `EchDFmLpLKYKcOnWdmWvU` (Tora, persona Bryn, Caldera lorebook). Pack lorebook `5pIwd8WDVCqNh7NQL1V1G` "Railroader: Caldera Ordeal", scoped to that chat: a constant spine with `rr_phase` 1–4 (finale = the Ordeal), plus 8 pressure scenarios in group `rr-pressure` (`trigger`, `sticky 4`, `cooldown 9999`, `probability 60`, `delay` staggered 1–14). Decision model: Gemma 4 (Decision) connection, selected instance-wide. The preset's lorebook marker is at depth 0, so the whole pack sits after the history.

First-session finding (2026-10-27): the narrator set a DC from the player's own dramatic prose and narrated a failed save as the persona bleeding and kneeling while the world lost almost nothing. That rewards the player for writing "he does it easily". Fixed by config: the DC comes from the situation, a clever approach earns +2..+5, failure costs the situation, and the agency rule no longer lets the narrator write the persona's physical reactions.

## 9. Authoring rules for the pack builder (prototype evidence, 2026-10-27)

The prototype exists to find what the builder's instructions must say. Each rule below cites what broke without it. Hand-tuning the prototype chat is not the deliverable.

**Layering: the builder writes story pressure only.**
1. A pack is destination + scenarios + finale. Adjudication rules (when to roll, how DCs are set, what failure costs, who writes the persona) are not pack content. They are reusable across chats and belong in the preset or the card's post-history. The prototype carries the roll rules in its spine only temporarily. Evidence: the roll problems came from the narrator's handling of dice, not from the story.
2. Before building, audit the chat's inputs; do not patch around them. Report defects to the user, and never rewrite silently:
   - a greeting or scenario that makes the player recite invented content (a quiz loop): Tora's "describe the stabilization node";
   - persona or card text with concrete noun lists, which the model fixates on: boilers and camshafts, the floating disk;
   - world lore that contradicts the intended arc: "no outsider can cast natively", a tech-extraction motive the user never wanted;
   - an agency rule that lets the narrator write the persona's body, which produced the nosebleed spectacle.
3. Never invent premises, world rules, names or honorifics. Ask the user for the premise, and change only the lines that contradict it.

**Spine.**
4. State the destination neutrally: what the story builds toward, never whether the persona succeeds. Evidence: "passes it in his own way" told the narrator the ending and invited plot armour.
5. Do not gate intermediate phases on events. One good scene satisfies "worked some of the court's art": `rr_phase` reached 2 within four turns, and the next gate was already true of the same scene. Gate only the finale, on time (the date text) or a clearly terminal event. Pacing between start and finale belongs to the scenarios' delays.
6. Phrase rules positively. Never name the unwanted behaviour ("never quizzes" keeps quizzes in view).
7. Never repeat a rule the card's post-history already states.
8. Budget: about 300 words for the spine. Every line must have a check that can run against stored messages.

**Scenarios.**
9. A scenario's keys must not appear in the greeting, card or lore text. Evidence: "carter's trick" was a key and also in the greeting.
10. Example situations inside a scenario must not repeat the greeting's situation.
10a. If the destination has a deadline, the greeting must state unambiguously when the countdown starts. World State seeds the date from the greeting: it read "three days after the audience" as Day 3, and "in fifteen days" does not say from when.

**Mechanics the builder must handle.**
11. A pack is bound to one chat ID. A recreated chat needs re-scoping. Check scope and the ruleset pin, because a new chat starts without either.
12. Verify with a live `/api/lorebooks/scan/:chatId` after writing. `mari` CLI writes take a few seconds to reach the scan.
13. Chat variables: delete them with `macroVariables: {name: null}`; patches merge, so `{}` changes nothing.

**Open (needs data, not theory):** do the roll rules work (DC source, modifiers, failure cost; check `roleplayCommandActivity`), and does World State keep counting `Day N of 15` correctly? It started at Day 3, read correctly from the greeting, and held the format for 10 turns. Branch-style rolls for Roleplay (both outcomes written before the roll, as Game mode's `gameOneRequestDice` does) is a candidate upstream issue, not a fork change.

## 10. Architecture decision (2026-10-27): one Engine-owned "scene", logic in code

The prototype was built config-only, so pacing, gating and state were written as prompt text and Decision questions. That was the wrong layer. Gating, counting and state transitions are logic and belong in code. An LLM should answer only narrow classification questions.

- **Scene = Advanced Memory's scene records** (`advanced_memory_records`, `kind: scene`, `status`, `startMessageId`). Gemma already classifies the boundaries; do not add a second detector. In the prototype chat it correctly holds the whole first night (19 messages) as one open scene. Under scene-gating no scenario would have fired, which is the pacing the user wants.
- **Lorebook timing unit: messages (today) or scenes.** With scenes: sticky = until the scene ends; cooldown = N scenes; delay = not before scene N; the group pick happens once per scene, so at most one scenario per scene. Keying state on the scene ID makes it idempotent: a second scan or a regenerate inside the same scene cannot advance it. That fixes both observed counter bugs (about 2 ticks per reply with no regenerates, and regenerate ticks) by construction.
- **Expose the scene index** to macros and conditions (e.g. `{{scene.index}}`), so the finale and any phases gate on Engine state, not on Decision questions.
- **Dependencies:** Advanced Memory must be on (fall back to messages without it). Boundaries are known up to `sceneCheckInterval` messages late (default 5; configurable per chat).
- **Ownership:** Engine (lorebooks and Advanced Memory). General value: anyone pacing lorebook entries in Roleplay. Candidate upstream feature; a fork prototype is not a small diff.
- **Next:** measure Advanced Memory boundary quality on the user's existing long chats before building on it.

Pacing finding that motivated this: turn-delayed scenarios fired mid-scene (the "Tora's wager" scenario fired during the walk back up on the same night) and asked the player for world facts never shown ("something to say to the Council that they cannot answer"). Builder rule: ask the player for choices, actions or values, never for world facts; when knowledge is needed, the world shows it first.

**Play-test note (2026-10-27, user):** the rewritten character cards are doing visible work and made play much more fun. The scenarios' effect is not visible; the suspicion is that Opus papers over their sharp edges (mis-timed fires, unearned asks). Before investing in scene-gating, separate the two: compare turns with and without a scenario active, so card quality is not credited to the scenarios. Scenarios stay on in the prototype chat meanwhile.

**Pace note (2026-10-27, user):** about 20 messages in, play is still in the first scene. Plot moves slower than an author expects, partly because of the player's conversational pace. A message-count timer assumes a pace the player doesn't keep, but a scene count follows the player's actual pace. That is another argument for scene units. Size packs for few scenes per session: a 15-day arc with many scenarios is likely more content than a campaign reaches.
