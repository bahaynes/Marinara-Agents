# Call Sheet: cache-first, scene-by-scene story play

## Status

Fork-only concept, drafted 2026-10-15 on `custom-mods`, revised the same day with the maintainer's
answers to the pre-implementation questions, then again after both players agreed that scenes end
manually and that play is driven by instructions. Not yet approved for implementation.

The name comes from film: a call sheet says which scene is shot, where, which cast is called, and
what the scene is for. That is the scene plan, and the plan's core idea is that those facts are
decided once, not guessed each turn. (Earlier working name: Scene Forge, dropped because it reads
as a Gacha Forge sequel.)

## Goals

1. **Story play that is cheap to cache by construction.** Cache hits come first and model memory
   second. Every request is laid out so that most of it was already sent, unchanged, on the
   previous request.
2. **A smaller fork.** Behavior that the `custom-mods` Engine fork carries today moves into this
   package. One small, general Engine commit (see [Engine dependencies](#engine-dependencies))
   replaces many specific ones. A fork commit is only dropped once nothing still uses its old path
   (see [Fork reduction](#fork-reduction)).

Non-goal: replacing Roleplay or Game mode. This is a separate mode, shipped as a package like Gacha
Forge.

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

## Models

There are two tiers, and they are independent connections:

- **Main**: the user's default main model. Often Claude, and the only tier that costs money, so
  the cache layout below is tuned for it.
- **Agent**: the user's default agent model. Here that is Gemma 4 12B on the local llama-server,
  which is free. Its cost is latency, so its calls reuse the same prefix too: llama-server keeps the
  processed prompt and only processes what changed.

There is no separate "strong" tier. Planning runs on main.

Prompt caches belong to one model, so main and agent calls never read each other's cache. That is
fine: agent calls are free, and every main-model call shares one prefix.

## Play loop

```
spine ──► scene proposal ──► review (edit / reroll / accept) ──► turns ──► scene end
  ▲                                                                           │
  └──────────── summary + next proposal (spine revised only if needed) ◄──────┘
```

1. **Spine.** At story start the main model plans a light spine: the premise, soft goals, open
   threads and secrets. Goals are targets, not an ordered list of checkpoints. The spine is revised
   only when a scene ends somewhere it did not foresee.
2. **Scene proposal.** The main model proposes the next scene: location, cast present, the scene's
   goals, and the facts in play.
3. **Review.** The proposal is shown before play. The player can edit any field, reroll it, or
   accept it. An edited proposal becomes the scene plan as written.
4. **Turns.** The player gives instructions (see [Instructions](#instructions)). Each one is
   written up as the persona's turn, and the scene continues.
5. **Scene end.** The player ends the scene with a scene instruction. See
   [How a scene ends](#how-a-scene-ends). Ending "wrong" is not a failure: it is just the input to
   the next proposal. There are no rails to leave because the plan is only ever one scene deep.
6. **Summary.** The finished scene is summarized once and frozen. It is never edited again. The
   summary also records each scene goal as `met`, `failed` or `open`, which feeds the spine and the
   next proposal.

## How a scene ends

### What ends scenes today

From the `marinara` instance on 2026-10-15: 11 Roleplay chats with 339 stored Advanced Memory
scenes (190 unique boundaries after removing rerolls and repeat detections), and all 4,141 player
messages in Roleplay and Game chats.

- **Advanced Memory found boundaries after the fact.** A model read back over the transcript for a
  location change, a time skip, a move into combat, or a resolved episode. All 339 stored scenes
  are titled "Scene", so scene names were never kept as a signal.
- **What happened at each boundary** (rough pattern matching, so the counts are loose): the player
  wrote an explicit cue (37), the persona left, followed someone or arrived somewhere (38), the
  narration opened at a new time (17), unclear (98). Many unclear ones look like false cuts in the
  middle of a conversation, in the same room.
- **The player ends scenes, and usually says what comes next.** 113 player messages carry a
  bracketed scene cue. The best read like a scene plan:
  - "Next scene: a few hours later, Chandra, T'Sha, Medli, Marianne, and Hera all together to
    debrief, plan over food, and gossip." (time, cast, purpose)
  - "Next scene, feel free to jump to the statement. We can assume Lena and Kara had a beautiful
    domestic morning." (skip to the goal)
  - "Next scene of the story. Come up with a cohesive set of beats leading up to the wedding."
    (a request for a plan)
- **Scenes end a beat after their point is reached, on a transition.** Game mode choices show the
  shape: "Slip out clean and bring the slate numbers to Rennika tonight", "Stay the night in her
  narrow bed…". The goal is reached, then there is a wind-down or a departure.
- **Goal completion has never been recorded.** The 30 Game chats have 0 quests in their journals,
  and their story arcs are prose.
- **Scene length:** a median of 15 messages, 90% at 62 or fewer, the longest 112.

### The rule

Scenes end manually. Both players agreed (2026-10-15) that this is fine and probably preferred, and
the data above shows they already do it.

1. **A scene ends only on a scene instruction** from the player. No model decides that a scene is
   over, so there is no per-turn goal checker and nothing to get wrong between turns.
2. **The scene instruction goes to the scene planner,** not the narrator. "A few hours later,
   Chandra, T'Sha, Medli, Marianne and Hera debrief over food" becomes the starting point for the
   next proposal, so most of the review step is already done. An empty scene instruction means
   "propose what comes next".
3. **Scene goals are direction, not exits.** They tell the narrator what the scene is for. The
   summarizer marks them `met`, `failed` or `open` once, at scene end.

## Instructions

Every player input is an instruction, and where it goes is the player's explicit choice, never a
model's guess:

- **Turn instruction** (the main flow). A short note on what the persona does, such as "pushes the
  clerk on the register, suspects he is covering for someone". The persona's turn is written from
  it in the persona's voice (an impersonate), then the scene continues. Reviewing the written turn
  before it is committed is a per-story toggle, because it costs a round trip.
- **Scene instruction.** Sent with a separate control (a "Next scene" button, or a `Next scene:`
  prefix matched in code). It ends the scene and goes to the scene planner (see
  [The rule](#the-rule)).
- **Written turn.** The player can still write the persona's prose directly, as in Roleplay mode.
  It is a fallback, not the main path.

The instruction is stored with the turn, not discarded. It is the clearest record of what the player
meant, so the scene summarizer reads it before the prose.

## Where it lives

Call Sheet is its own page: a Home tab, like Gacha Forge. It does not run inside an Engine chat.

- **No Engine chat settings apply.** Presets, memory agents, lorebook triggers and per-chat options
  never touch a Call Sheet prompt. That removes the "every chat is configured differently" problem
  instead of working around it.
- **The package builds every prompt itself,** in the block order below, and calls the main and agent
  models through the Engine's package model API. The cache layout is enforced by code, not hoped for.
- **The package stores its own stories:** the sheet (spine, scene plans, summaries) and each scene's
  turns, as package documents. The Engine's character and persona library is reused read-only for
  the cast and the player character.
- **Presentation is package code:** the transcript, the scene panel and the review step now, and
  dice cards and combat later. That is what lets the fork's mechanics commits move out of the Engine.
- **The cost:** chat features are rebuilt as needed (reroll, edit and delete first; the Illustrator
  and TTS later), and replies arrive whole until the Engine can stream package model calls.

0.1.1 tried the other route (the Engine writes replies; Call Sheet adds a prompt block and hides
finished scenes). It works without Engine changes, but presets and chat settings still shape every
prompt and the mechanics stay Engine code, so it misses both goals. It was replaced on 2026-10-15.

## Data model

Stored by the package. Field names are illustrative.

- **Story**: id, title, persona id and cast character ids (from the Engine library), cache TTL, the
  spine.
- **Spine**: premise, goals (each `open | met | abandoned`), threads, secrets with who knows each.
  Versioned: a revision is a new row, so a scene can always show the spine it was planned against.
- **Scene plan**: location; cast present, with planned entrances and exits; goals; facts in play;
  secrets in play with who knows them; optional checks (a skill and a difficulty); the scene
  instruction that started it, if any. Rerolls keep earlier proposals until one is accepted.
- **Turn**: id, speaker (persona or narrator), the text with its rerolls, input kind (turn
  instruction or written turn), the instruction, check results.
- **Scene summary**: the frozen text, the scene it covers, each goal's outcome, written once.

Presence is a field of the scene plan, not a tracker guess. A character joins or leaves only by an
explicit event recorded on a turn. The speaker picker, the illustrator and the prompt all read the
same cast list.

Nothing is stored as a single unversioned value per story.

## Agents

Jobs that can be agents are agents, following the Marinara paradigm.

| Agent            | Job                                                          | Model             | Runs                              |
| ---------------- | ------------------------------------------------------------ | ----------------- | --------------------------------- |
| Spine planner    | Plan and revise the spine                                    | main              | story start; rarely after a scene |
| Scene planner    | Propose the next scene from the scene instruction; reroll    | main              | scene end                         |
| Narrator         | Write the non-player turns                                   | main              | each turn                         |
| Impersonator     | Write the persona's turn from a turn instruction             | main              | each turn instruction             |
| Scene summarizer | Write the frozen scene summary and mark the goals            | agent             | scene end                         |
| Rules referee    | Resolve checks; later, combat                                | code, not a model | when a check is called            |
| Illustrator      | Existing agent, given the plan's cast, location and clothing | existing          | as configured                     |

All jobs send the same blocks 1 to 4 with a different block 5 (see the next section). On main,
each call reads the cache the previous main call wrote; on the agent model, llama-server reuses the
processed prefix.

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

| Job                 | Block 5                                                        |
| ------------------- | -------------------------------------------------------------- |
| Narrator turn       | "Write the next turn for <character>"                          |
| Impersonate         | "Write <persona>'s turn from this instruction: …"              |
| Scene summary       | "Summarize this scene and mark each goal met, failed or open." |
| Next scene proposal | "Propose the next scene from this instruction: …" (or no text) |

**Within a scene,** each request rewrites only the newest turn and the tail.

**At a scene change,** the new summary is appended to block 2, and the finished scene's history
(block 4) is dropped. Block 1 and every earlier summary are unchanged, so they stay cached. The
writes are the new summary, the new plan and the first turn. The proposal is generated as a tail on
the finished scene's full prefix, so it reads the cache the last turn wrote.

**Review is cheap.** A reroll is another tail on the same prefix. Editing a proposal changes only
block 3, which has not been sent for the new scene yet.

**One prompt for every character.** The narrator writes all non-player characters from one prompt.
What a character does not know is stated as a note in the tail ("Hermione did not see the last
scene"), not by filtering history per character. Knowledge is less strictly enforced; in exchange
every reply reuses the same cache.

**Long scenes.** 90% of scenes run 62 messages or fewer, so v1 does not cut mid-scene. The
agent model's context window is the real limit, because the summarizer reads the whole scene once
at its end.

**TTL.** Replies in practice arrive about 10 minutes apart, plus up to 3 minutes of post-processing,
so the default is the 1-hour cache. The layout keeps prompt-change misses rare; a longer TTL cannot
fix those, but it does cover the gaps.

## Success measures

Cut-over (new stories start in Call Sheet) happens when both hold over at least three stories:

1. **Cache (KPI 1).** On main-model calls, the share of prompt tokens read from cache, and the cost
   per turn measured against the best case: `0.1 x (blocks 1-4 except the newest turn) + 2 x
(newest turn + tail)` on the 1-hour cache. The baselines to beat are about 180k token-equivalents
   over 8 turns with caching and 140k without. Use the fork's `fix-caching-issues` skill and
   `chat_cache_report.py` alongside the package's own cache report.
2. **Play quality (KPI 2).** Subjective, so measured with proxies that already have a Roleplay
   baseline (`marinara`, 2026-10-15):
   - **Reroll rate:** 10% of Roleplay AI replies are rerolled (367 of 3,526). Game mode shows
     almost none, likely because it stores rerolls differently, so only the Roleplay figure is a
     baseline.
   - **OOC corrections:** 0.7% of Roleplay player turns (23 of 3,136). One example is the narrator
     admitting it "re-ran a scene you'd already played and contradicted things already
     established", the failure this design targets.
   - **Scene rating:** a one-tap 1 to 5 rating at scene end, asked during the review step.

   The bar: reroll and OOC rates no worse than Roleplay, and an average scene rating of at least 4.

## Engine dependencies

These go straight into `custom-mods`, which is this project's base, as one small commit. They are
general, so they also stand a chance upstream, but nothing waits on that. Because the page builds the
whole prompt, cache control is required, not optional: without it the layout is right but nothing
marks the blocks for the cache.

- **Cache control for package model calls.** The providers already do prompt caching
  (`enableCaching`, a 1-hour TTL, a breakpoint `cachingAtDepth` from the newest message, and the
  system prompt's end), and the Claude Subscription path places its own breakpoints through the CLI
  and only needs the TTL. So the package API needs no per-message marks: a
  `promptCache: { ttl, depth }` option maps onto those. With blocks 1 to 3 in the system prompt and
  block 4 as messages, the system breakpoint covers blocks 1 to 3 and a depth-1 breakpoint covers
  block 4 up to the newest turn. A scene change re-writes the system prompt once per scene.
- **Streaming for package model calls.** An `onToken` option on `chatComplete`, mapped onto the
  providers' existing token callback.
- **Cache usage reporting.** Providers already report cache reads and writes; the package API's
  usage type names them (`cachedPromptTokens`, `cacheWritePromptTokens`).

Done locally on `custom-mods` on 2026-10-15 ("prompt caching and streaming for package model
calls"); Call Sheet 0.3.0 uses it and still works without it.

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
- The story and memory commits drop together at the cut-over: when new stories start in Call Sheet
  instead of Roleplay mode (see [Success measures](#success-measures)).
- A mechanics commit drops when the package's port reaches parity for the games still played with
  it, including Game mode sessions that are not migrated.

The commit-by-commit map is in the [appendix](#appendix-fork-commit-map).

## Delivery order

1. **This document**, then approval.
2. **Call Sheet page, v0.2** (`fork/packages/call-sheet`): stories, the scene loop, turns with
   reroll, edit and delete, on the package model API as it is (replies arrive whole).
3. **Engine change in `custom-mods`**, in parallel: streaming, cache marks, TTL and cache usage for
   package model calls. Then the page adopts them and the cache is measured.
4. **Call Sheet v1** (scope below), using the package's own d20 checks.
5. **Cut-over** once the success measures hold: new stories start in Call Sheet; drop the story
   and memory commits.
6. **Port mechanics**: combat and skill systems into the package; drop those commits as each
   reaches parity.
7. **Upstream infrastructure fixes** as PRs, independently of the above.

## v1 scope

In:

- Spine planner, scene planner with the review step (edit, reroll, accept), and scene goals marked
  at scene end.
- Turn instructions (impersonate) and scene instructions as separate controls, with stored
  instructions; written turns as a fallback.
- Frozen scene summaries and the cache layout above, with a per-story cache report and the scene
  rating.
- Explicit cast entrances and exits.
- d20 skill checks, resolved by the rules referee.
- Main and agent connections per job, defaulting to the user's defaults.
- The page itself: a story list, the transcript with reroll, edit and delete, and streamed replies.

Out, for later rounds:

- Combat. v1 stories avoid it or resolve it as a check.
- The Illustrator and TTS on the page.
- Dice cards and other presentation beyond plain prose.
- Trackers beyond what the scene plan already holds (presence, location, goals).
- Importing existing Roleplay or Game chats.
- Mid-scene cuts for very long scenes.

## Open questions

1. **Secrets in one shared prompt.** Is a tail note ("Hermione does not know X") strict enough, or do
   some stories need a separate prompt for a character with a secret, at a cache cost?
2. **Multiple characters per turn.** Does the narrator write one character per reply, or a whole
   beat with several speakers? One beat per reply halves the requests.
3. **One call or two per instruction.** With review off, can one main-model call write the
   persona's turn and the narrator's reply together? That halves the requests again, but the
   persona's turn is then not a separate message the player can reroll on its own.
4. **Lorebooks.** Which world lore belongs in the fixed head, and is keyword-triggered lore needed at
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
