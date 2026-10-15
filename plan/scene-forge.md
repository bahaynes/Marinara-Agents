# Scene Forge: cache-first scene-graph story play

## Status

Fork-only concept, drafted 2026-10-15 on `custom-mods`. Not yet approved for implementation.
"Scene Forge" is a working name.

## Goals

1. **Story play that is cheap to cache by construction.** Cache hits come first and model memory
   second. Every request is laid out so that most of it was already sent, unchanged, on the
   previous request.
2. **A smaller fork.** Behavior that the `custom-mods` Engine fork carries today moves into this
   package, so less Engine code has to be rebased onto upstream. A fork commit is only dropped once
   nothing still uses its old path (see [Fork reduction](#fork-reduction)).

Non-goal: replacing Roleplay or Game mode upstream. This is a separate mode, shipped as a package
like Gacha Forge.

## Why

Evidence gathered on 2026-10-15 on the `marinara` instance:

- **Every chat is configured differently.** 25 Roleplay and Game chats active since mid-September
  used 7 different memory combinations (Advanced Memory, plain recall, Long-Term Memory, automatic
  summaries, Lorebook Keeper, knowledge agents). Several overlap and can record conflicting facts.
- **Caching cost more than it saved.** An individual-mode group chat with Advanced Memory cost about
  180k token-equivalents over 8 turns with the 1-hour cache, against about 140k with no caching
  (writes cost 2x, reads 0.1x). Each character in individual mode gets its own prompt, and
  per-character memory and automatic visibility make every responder's prefix different.
- **Game mode missed too.** A Fallout session cached 0% of 1.17M prompt tokens with replies 5 to 15
  minutes apart: newly triggered lorebook entries were placed in the system prompt. Fixed in the
  fork on 2026-10-14 (`gameLoreInTail`), not yet measured in play.
- **Facts are re-guessed by separate models.** One unexplained character arrival traced to four
  independent guesses about who was present: a scene summary that named the wrong person, an
  automatic visibility decision, a speaker picker with no presence information, and a prompt whose
  newest knowledge was that wrong summary. Tracker presence, quest logs and Long-Term Memory fail
  the same way: a model decides freely what matters, every turn.

The pattern behind all of it: the facts that matter (who is here, where, what is true, what the
scene is for) should be data the package owns and checks, decided once, not re-derived each turn.

## Play loop

```
spine ──► scene proposal ──► review (edit / reroll / accept) ──► turns ──► scene end
  ▲                                                                           │
  └──────────── summary + next proposal (spine revised only if needed) ◄──────┘
```

1. **Spine.** At story start a strong model plans a light spine: the premise, soft goals, open
   threads and secrets. Goals are targets, not an ordered list of gates. The spine is revised only
   when a scene ends somewhere it did not foresee.
2. **Scene proposal.** A strong model proposes the next scene: location, cast present, the scene's
   goal, the facts in play, and exit gates.
3. **Review.** The proposal is shown before play. The player can edit any field, reroll it, or
   accept it. An edited proposal becomes the scene plan as written.
4. **Turns.** The scene is played in either input mode (below). After each reply, the gate checker
   reports which exit gates passed.
5. **Scene end.** A scene ends when an exit gate passes, or when the player ends it. Ending
   "wrong" is not a failure: it is just the input to the next proposal. There are no rails to leave
   because the plan is only ever one scene deep.
6. **Summary.** The finished scene is summarized once and frozen. It is never edited again.

## Input modes

Both are first class.

- **Persona mode.** The player writes the persona's turn, as in Roleplay mode.
- **Intent mode.** The player writes a short intent, such as "pushes the clerk on the register,
  suspects he is covering for someone". The intent expander writes it as the persona's prose in the
  persona's voice, then the scene continues. Reviewing the expansion before it is committed is a
  per-story toggle, because it costs a round trip.

The intent line is stored with the turn, not discarded. It is the clearest record of what the
player meant, so the gate checker and the scene summarizer read it before the prose.

## Data model

Stored by the package. Field names are illustrative.

- **Story**: id, persona, connection settings per job, cache TTL, the spine.
- **Spine**: premise, goals (each `open | met | abandoned`), threads, secrets with who knows each.
  Versioned: a revision is a new row, so a scene can always show the spine it was planned against.
- **Scene plan**: location; cast present, with planned entrances and exits; the goal; facts in play;
  secrets in play with who knows them; exit gates; optional checks (a skill and a difficulty).
  Rerolls keep earlier proposals until one is accepted.
- **Turn**: speaker, input mode, intent line (intent mode), prose, gate results with the quoted line
  that passed each gate, check results.
- **Scene summary**: the frozen text, the scene it covers, written once.

Presence is a field of the scene plan, not a tracker guess. A character joins or leaves only by an
explicit event recorded on a turn. The speaker picker, the illustrator and the prompt all read the
same cast list.

Turns, summaries and plans are tied to their scene, so deleting or rerolling a turn rewinds
everything derived from it. Nothing is stored as a single unversioned value per story.

## Agents

Jobs that can be agents are agents, following the Marinara paradigm.

| Agent            | Job                                                          | Model             | Runs                              |
| ---------------- | ------------------------------------------------------------ | ----------------- | --------------------------------- |
| Spine planner    | Plan and revise the spine                                    | strong            | story start; rarely after a scene |
| Scene planner    | Propose the next scene; reroll on request                    | strong            | scene end                         |
| Narrator         | Write the non-player turns                                   | main              | each turn                         |
| Intent expander  | Turn an intent line into persona prose                       | main              | each intent-mode turn             |
| Gate checker     | Report passed gates, quoting the line                        | cheap             | after each reply                  |
| Scene summarizer | Write the frozen scene summary                               | cheap             | scene end                         |
| Rules referee    | Resolve checks; later, combat                                | code, not a model | when a check is called            |
| Illustrator      | Existing agent, given the plan's cast, location and clothing | existing          | as configured                     |

The narrator, intent expander, gate checker, summarizer and scene planner all send the same prompt
prefix with a different final instruction (see the next section), so each reads the cache the
previous call wrote.

## Prompt and cache layout

Blocks, in order, with when each one changes:

| #   | Block                                                                | Changes when                                                 |
| --- | -------------------------------------------------------------------- | ------------------------------------------------------------ |
| 1   | Fixed head: rules, world, the whole cast's cards, persona, the spine | story start; a spine revision                                |
| 2   | Frozen scene summaries                                               | one is appended at each scene end; earlier ones never change |
| 3   | Current scene plan                                                   | once per scene (accepted proposal)                           |
| 4   | Current scene history                                                | one turn is appended per reply                               |
| 5   | Tail: the job's instruction, plus anything that changes every turn   | every request                                                |

Every job is the same blocks 1 to 4 with a different block 5:

| Job                 | Block 5                                                         |
| ------------------- | --------------------------------------------------------------- |
| Narrator turn       | "Write the next turn for <character>"                           |
| Intent expansion    | "Write <persona>'s turn from this intent: …"                    |
| Gate check          | "Which of these gates did the last reply pass? Quote the line." |
| Scene summary       | "Summarize this scene."                                         |
| Next scene proposal | "Propose the next scene."                                       |

**Within a scene,** each request rewrites only the newest turn and the tail.

**At a scene change,** the new summary is appended to block 2, and the finished scene's history
(block 4) is dropped. Blocks 1 and every earlier summary are unchanged, so they stay cached. The
writes are the new summary, the new plan and the first turn. The summary and the proposal are both
generated as tails on the finished scene's full prefix, so they read the cache the last turn wrote.

**Review is cheap.** A reroll is another tail on the same prefix. Editing a proposal changes only
block 3, which has not been sent for the new scene yet.

**One prompt for every character.** The narrator writes all non-player characters from one prompt.
What a character does not know is stated as a note in the tail ("Hermione did not see the last
scene"), not by filtering history per character. Knowledge is less strictly enforced; in exchange
every reply reuses the same cache.

**TTL.** Replies in practice arrive about 10 minutes apart, plus up to 3 minutes of post-processing,
so the default is the 1-hour cache. The layout keeps prompt-change misses rare; a longer TTL cannot
fix those, but it does cover the gaps.

**Measuring it.** The target per turn is close to the best case: `0.1 x (blocks 1-4 except the
newest turn) + 2 x (newest turn + tail)` on the 1-hour cache. Use the fork's
`fix-caching-issues` skill and `chat_cache_report.py` to compare measured cost with that.

## Engine dependencies

The package needs one Engine change before the cache layout can work, and it must go upstream.
A fork-only API would only trade old fork commits for new ones.

- **Cache control for package model calls.** `CapabilityLanguageModelCompletionOptions`
  (`packages/shared/src/types/capability-runtime.ts`) has temperature, max tokens, reasoning effort,
  verbosity, signal and response format, but no cache breakpoints and no TTL. The Claude
  subscription path matches cached content in whole blocks, not arbitrary prefixes, so the package
  must be able to mark the ends of blocks 1 to 4 and choose the TTL. Proposed: an optional
  per-message cache mark and an optional `promptCacheTtl` (`"5m" | "1h"`), ignored by providers
  without caching.
- **Usage reporting.** Completions already return usage; confirm it includes cache reads and writes
  for every provider the package targets, so the package can show its own cache report.
- **Later, for combat:** whatever UI and state hooks a ported combat map needs. Gacha Forge already
  runs its own battle simulation and screens inside its package, so a package-owned combat UI is
  feasible; the exact hooks are decided when combat is ported.

## Fork reduction

The `custom-mods` Engine fork carries 75 commits over upstream `staging` (`140bb7f16`), touching
15,648 lines of Engine code (excluding regression tests and locales). By destination:

| Bucket                                                                                       | Commits | Engine lines | Destination                                       |
| -------------------------------------------------------------------------------------------- | ------: | -----------: | ------------------------------------------------- |
| Mechanics: 5.5e combat, Triage, skill systems, Inspiration, dice, rulesets                   |      18 |       10,881 | Port into this package                            |
| Story and memory: Advanced Memory tweaks, `gameLoreInTail`, shared group cache, history hold |      16 |        1,137 | Drop at cut-over                                  |
| Agent-side: image references, sprites, Lorebook Keeper, Illustrator 2, agent prefill         |       9 |        1,185 | Agents fork where the capability API allows       |
| Infrastructure: Claude subscription, quota, embeddings, client fixes, `mari`                 |      22 |        2,398 | Upstream as PRs where they apply; otherwise stays |
| Fork tooling: build, deploy, skills, test alignment                                          |      10 |           47 | Stays                                             |

About 70% of the fork's Engine churn is game mechanics. Moving that into the package is the main
reduction.

Rules for dropping a commit:

- A commit is dropped only when nothing still in use depends on it. While Roleplay mode is still
  played with Advanced Memory, its fork tweaks stay.
- The story and memory commits drop together at the cut-over: when new stories start in Scene Forge
  instead of Roleplay mode.
- A mechanics commit drops when the package's port reaches parity for the games still played with
  it, including Game mode sessions that are not migrated.

The commit-by-commit map is in the [appendix](#appendix-fork-commit-map).

## Delivery order

1. **This document**, then approval.
2. **Engine API change upstream**: cache marks and TTL for package model calls.
3. **Scene Forge v1** (scope below), using the package's own d20 checks.
4. **Cut-over**: new stories start in Scene Forge; drop the story and memory commits.
5. **Port mechanics**: combat and skill systems into the package; drop those commits as each
   reaches parity.
6. **Upstream infrastructure fixes** as PRs, independently of the above.

## v1 scope

In:

- Spine planner, scene planner with the review step (edit, reroll, accept), exit gates and the gate
  checker.
- Both input modes, with stored intents.
- Frozen scene summaries and the cache layout above, with a per-story cache report.
- Explicit cast entrances and exits.
- d20 skill checks as one kind of gate, resolved by the rules referee.
- Connections per job (strong, main, cheap), like Gacha Forge.

Out, for later rounds:

- Combat. v1 stories avoid it or resolve it as a check.
- Illustrator integration beyond passing the plan's cast and location.
- Trackers beyond what the scene plan already holds (presence, location, goals).
- Importing existing Roleplay or Game chats.

## Open questions

1. **Who decides a scene is over** when no exit gate fires but the conversation has clearly moved
   on? The player, the gate checker suggesting it, or both?
2. **How large can block 4 grow** in one long scene before it needs a mid-scene cut, and where does
   that cut go so it costs one rewrite rather than one per turn?
3. **Secrets in one shared prompt.** Is a tail note ("Hermione does not know X") strict enough, or do
   some stories need a separate prompt for a character with a secret, at a cache cost?
4. **Multiple characters per turn.** Does the narrator write one character per reply, or a whole
   beat with several speakers? One beat per reply halves the requests.
5. **Lorebooks.** Which world lore belongs in the fixed head, and is keyword-triggered lore needed at
   all once the scene plan names the facts in play?

## Appendix: fork commit map

Generated from `git log upstream/staging..custom-mods` on 2026-10-15. "Engine lines" is lines added
plus removed under `packages/`, excluding regression tests and locales.

| Commit      | Subject                                                                                                   | Engine lines | Bucket           | Destination                                             |
| ----------- | --------------------------------------------------------------------------------------------------------- | -----------: | ---------------- | ------------------------------------------------------- |
| `9052b4d0a` | fix(advanced-memory): impersonation keeps history auto-hidden from an offstage character                  |           20 | Story and memory | Drop at cut-over (replaced by the scene design)         |
| `b9a66869e` | fix(mari): keep dynamic turn context and timestamps out of cached system prompt                           |          131 | Infrastructure   | Upstream as a PR where it applies; otherwise stays      |
| `0d985c6a0` | fix(build): resolve type, JSX syntax, and locale issues after upstream rebase                             |           33 | Fork tooling     | Stays (fork maintenance; no runtime code)               |
| `8684fb049` | feat(game): default cache-friendly prompt layout (gameLoreInTail) to on                                   |           22 | Story and memory | Drop at cut-over (replaced by the scene design)         |
| `c3cd4eff2` | fix(mari): keep `mari` CLI review cards out of Professor Mari's chats                                     |            3 | Infrastructure   | Upstream as a PR where it applies; otherwise stays      |
| `953efdb21` | fix(skills): let skill systems be turned off, and keep them out of ruleset games                          |           20 | Mechanics        | Port into the package (rules referee and combat)        |
| `7f0988634` | chore(fork): Wasteland SPECIAL ruleset moved to the agents fork                                           |            0 | Fork tooling     | Stays (fork maintenance; no runtime code)               |
| `0262e071b` | fix(mari): accept Illustrator's manual-only runInterval 0 in validation                                   |            4 | Infrastructure   | Upstream as a PR where it applies; otherwise stays      |
| `911c3c38d` | feat(rulesets): Wasteland SPECIAL v4 on a 5e difficulty scale                                             |            0 | Mechanics        | Port into the package (rules referee and combat)        |
| `de7205f4e` | fix(game): build the one-request branch example from the active ruleset                                   |           15 | Mechanics        | Port into the package (rules referee and combat)        |
| `abe4b433c` | feat(rulesets): let a skill or save answer to alias names                                                 |           14 | Mechanics        | Port into the package (rules referee and combat)        |
| `7ac12ce8a` | fix(llm): do not retry exhausted provider quotas as rate limits                                           |           17 | Infrastructure   | Upstream as a PR where it applies; otherwise stays      |
| `5317b3359` | chore(fork): Illustrator 2 definition moved to the agents fork                                            |            0 | Fork tooling     | Stays (fork maintenance; no runtime code)               |
| `c8b03afcc` | feat(keeper): list existing entries least-recently-edited first                                           |            8 | Agent-side       | Move to the agents fork where the capability API allows |
| `cf51669c0` | docs(custom-mods): record Lorebook Keeper cadence/prompt decision                                         |            0 | Fork tooling     | Stays (fork maintenance; no runtime code)               |
| `ce3c87877` | feat(agents): speculatively prefill local post-processing agent prompts                                   |          214 | Agent-side       | Move to the agents fork where the capability API allows |
| `9fa681201` | feat(tooling): fix-caching-issues skill with a stored-prompt differ                                       |            0 | Fork tooling     | Stays (fork maintenance; no runtime code)               |
| `2d988b861` | feat(rulesets): Wasteland SPECIAL, a d20 Fallout ruleset with tactical combat                             |            0 | Mechanics        | Port into the package (rules referee and combat)        |
| `81db7dbfe` | fix(client): send the stored admin secret on same-origin API fetches                                      |           13 | Infrastructure   | Upstream as a PR where it applies; otherwise stays      |
| `f7473516c` | feat(tooling): let agy load the fork's .claude/skills                                                     |            0 | Fork tooling     | Stays (fork maintenance; no runtime code)               |
| `ba513e9a4` | feat(tooling): containerized Playwright skill for UI troubleshooting                                      |            0 | Fork tooling     | Stays (fork maintenance; no runtime code)               |
| `af21c7c2c` | fix(multiplayer): map raw characters to wizard display models                                             |           23 | Infrastructure   | Upstream as a PR where it applies; otherwise stays      |
| `a2abef000` | fix(client): hold the iOS app still while selecting or pasting in a text field                            |           65 | Infrastructure   | Upstream as a PR where it applies; otherwise stays      |
| `b269511b0` | fix(advanced-memory): rolling scenes also govern the oversized-request reset                              |           11 | Story and memory | Drop at cut-over (replaced by the scene design)         |
| `af566d4f7` | feat(advanced-memory): hard-close scenes after chosen messages                                            |           70 | Story and memory | Drop at cut-over (replaced by the scene design)         |
| `7bd2deb26` | feat(roleplay): scene titles from the story model drive Advanced Memory scenes                            |           90 | Story and memory | Drop at cut-over (replaced by the scene design)         |
| `ae10f8c2b` | feat(advanced-memory): opt-in scene splits inside a message, with location hints                          |           44 | Story and memory | Drop at cut-over (replaced by the scene design)         |
| `a24f101f7` | feat(advanced-memory): opt-in rollover that keeps the last two scenes                                     |           23 | Story and memory | Drop at cut-over (replaced by the scene design)         |
| `ecb408da4` | feat(roleplay-dice): show the roll formula breakdown and parse looser roll commands                       |          260 | Mechanics        | Port into the package (rules referee and combat)        |
| `a97e9f8a8` | feat(advanced-memory): hold the open-scene cut while the prompt cache is warm                             |           62 | Story and memory | Drop at cut-over (replaced by the scene design)         |
| `d94f45d58` | fix(illustrator): keep characters the latest response names when the tracker misses them                  |           12 | Story and memory | Drop at cut-over (replaced by the scene design)         |
| `4089088e3` | test(regressions): align open-issues CYOA assertion with custom-mods requirement                          |            0 | Fork tooling     | Stays (fork maintenance; no runtime code)               |
| `a886bb47f` | feat(group): shared prompt cache for individual roleplay groups                                           |          155 | Story and memory | Drop at cut-over (replaced by the scene design)         |
| `6e9ef23e1` | fix(claude-subscription): refresh the login before resumed requests                                       |          108 | Infrastructure   | Upstream as a PR where it applies; otherwise stays      |
| `f27f7fc66` | feat(sprites): support dynamic ephemeral visual novel sprites via ComfyUI                                 |          420 | Agent-side       | Move to the agents fork where the capability API allows |
| `08a0fa173` | feat(game): add Event CG illustration card to Game Mode surface                                           |          404 | Mechanics        | Port into the package (rules referee and combat)        |
| `9edca5e8a` | fix(embeddings): cap agent package embeddings like built-in ones                                          |            9 | Infrastructure   | Upstream as a PR where it applies; otherwise stays      |
| `04720c3dd` | fix(lorebook-keeper): split comma-joined keys                                                             |           28 | Agent-side       | Move to the agents fork where the capability API allows |
| `41249a218` | fix(lorebook-keeper): embed new entries, not only updated ones                                            |           10 | Agent-side       | Move to the agents fork where the capability API allows |
| `58b8870af` | fix(embeddings): cap each input and per-request size for configured sources                               |           21 | Infrastructure   | Upstream as a PR where it applies; otherwise stays      |
| `bcf92161e` | feat(roleplay): hold the history start for prompt caching                                                 |           43 | Story and memory | Drop at cut-over (replaced by the scene design)         |
| `d24e2d0bf` | fix(advanced-memory): stop the stale failure toast after memory is switched off                           |           10 | Story and memory | Drop at cut-over (replaced by the scene design)         |
| `185239fc8` | fix(chat): do not auto-generate assistant reply after CYOA impersonate choice                             |            5 | Story and memory | Drop at cut-over (replaced by the scene design)         |
| `1042e5392` | fix(client): no "no tracker changes" warning after image agent runs                                       |            8 | Agent-side       | Move to the agents fork where the capability API allows |
| `64b1d0f21` | fix(claude-subscription): treat CLI aliases and dated ids as known models                                 |           16 | Infrastructure   | Upstream as a PR where it applies; otherwise stays      |
| `8ae9b7a99` | fix(client): keep Send blocked while the server is generating for this chat                               |           26 | Infrastructure   | Upstream as a PR where it applies; otherwise stays      |
| `774e4e6a5` | feat(game): optional gameLoreInTail to keep keyword lore out of the cached system prompt                  |          188 | Story and memory | Drop at cut-over (replaced by the scene design)         |
| `c89f14c87` | fix(claude-subscription): send promptCacheTtl for both toggle states                                      |            4 | Infrastructure   | Upstream as a PR where it applies; otherwise stays      |
| `ce1afde91` | feat(agents): Illustrator 2 custom agent definition                                                       |           44 | Agent-side       | Move to the agents fork where the capability API allows |
| `94eb62699` | feat(image): reference tokens, workflow variables and present-character gating for image agents           |          426 | Agent-side       | Move to the agents fork where the capability API allows |
| `a31b0925c` | feat(image): ComfyUI reference slot flags and count placeholders                                          |           27 | Agent-side       | Move to the agents fork where the capability API allows |
| `ee879eae5` | perf(roleplay): drop ability suffixes from the RP skill list                                              |            2 | Mechanics        | Port into the package (rules referee and combat)        |
| `6fd8b2230` | feat(roleplay): Inspiration awards and rerolls in Roleplay mode                                           |          457 | Mechanics        | Port into the package (rules referee and combat)        |
| `92ed53deb` | fix(roleplay): add skill proficiency to RP skill rolls                                                    |           11 | Mechanics        | Port into the package (rules referee and combat)        |
| `7aa9f966a` | feat(skills): store skill proficiencies structured in rpgStats                                            |          188 | Mechanics        | Port into the package (rules referee and combat)        |
| `29722d95f` | fix(mari): stop the completion-claim guard from eating conversational answers                             |           26 | Infrastructure   | Upstream as a PR where it applies; otherwise stays      |
| `9bf29da2c` | fix(mari): keep cache reads and writes in a reply's usage total                                           |           44 | Infrastructure   | Upstream as a PR where it applies; otherwise stays      |
| `b81fc0582` | perf(mari): shorten earlier command results within a reply                                                |          117 | Infrastructure   | Upstream as a PR where it applies; otherwise stays      |
| `ef445d19b` | perf(mari): move per-turn values to the end of Professor Mari's prompt                                    |           15 | Infrastructure   | Upstream as a PR where it applies; otherwise stays      |
| `99819a709` | feat(mari): batch lorebook edits and paged lorebook reads                                                 |          381 | Infrastructure   | Upstream as a PR where it applies; otherwise stays      |
| `903a48303` | test: align merged upstream regressions with custom-mods behavior                                         |            0 | Fork tooling     | Stays (fork maintenance; no runtime code)               |
| `139c8369d` | fix(tools): stop offering update_game_state outside Game Mode                                             |           11 | Mechanics        | Port into the package (rules referee and combat)        |
| `9d7e8936c` | feat(connections): per-connection switch to disable native tool calls                                     |          126 | Infrastructure   | Upstream as a PR where it applies; otherwise stays      |
| `6abc90ed4` | fix(advanced-memory): leave room for tool rounds instead of failing them                                  |           77 | Story and memory | Drop at cut-over (replaced by the scene design)         |
| `518266c27` | fix(advanced-memory): anchor scene timeframes to World State tracker instead of regex                     |          305 | Story and memory | Drop at cut-over (replaced by the scene design)         |
| `c58b43be4` | fix(client): smooth mobile keyboard viewport transitions without a scroll feedback loop                   |           90 | Infrastructure   | Upstream as a PR where it applies; otherwise stays      |
| `f967154dc` | feat(game): add game skill systems, persona rpgStats resolution, and settings glossary for Game Mode      |         1649 | Mechanics        | Port into the package (rules referee and combat)        |
| `fff49e7ad` | feat(dice): enable animated dice cards for roll_skill_check results                                       |            6 | Mechanics        | Port into the package (rules referee and combat)        |
| `35afe1734` | feat(tools): inject characterRpgStats and personaRpgStats into custom tool context                        |            5 | Mechanics        | Port into the package (rules referee and combat)        |
| `c751813a1` | feat(combat): add Triage combat style — ER trauma triage on the tactical grid engine                      |         2641 | Mechanics        | Port into the package (rules referee and combat)        |
| `0adb48939` | chore(fork): custom-mods build, deploy and maintenance tooling                                            |           14 | Fork tooling     | Stays (fork maintenance; no runtime code)               |
| `45e53296b` | feat(quota): live connection quota polling, HUD telemetry, and Claude proxy usage tracking                |         1087 | Infrastructure   | Upstream as a PR where it applies; otherwise stays      |
| `51e686903` | fix(generation): GLM 5.x thinking parameters, parameter inheritance, and remove maximum reasoning default |           72 | Infrastructure   | Upstream as a PR where it applies; otherwise stays      |
| `3336fb556` | feat(game): session summary sliding window, context depth UI, and jsonish auto-repair                     |          223 | Mechanics        | Port into the package (rules referee and combat)        |
| `11559be9a` | feat(combat): D&D 5.5e tabletop combat engine, tactical battlemap, weapons, and polymorphic AoE templates |         4975 | Mechanics        | Port into the package (rules referee and combat)        |
