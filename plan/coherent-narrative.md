# Coherent narrative: chronology, threads, knowledge, promises, mysteries

Status: **draft for review, nothing built.** Written 2026-10-25 after reviewing the Engine and `fork/packages`.

## 1. The problem

RP chats lose plot threads, drift on chronology, and break when the story depends on timing, who-knows-what,
implicit tasks, or mysteries. The recorded causes are all the same shape: **a model is asked to do bookkeeping
(arithmetic, state tracking, consistency) that code or the authoring model should own, and the fix for each
symptom was another model re-guessing facts.** Examples already on record:

- the tracker set the clock past midnight without advancing the date;
- a minor character was shown teaching a craft with no lesson in the history;
- a character's promise was recorded as a finished deed;
- an NPC was reinvented under a new name;
- Game mode assumes a fixed 15 minutes per turn, so a long conversation burns the daylight;
- `timeline-tracker` asks a 12B-class model to maintain `t_now` in minutes; `foreshadow-vault` asks it to
  decrement `remainingTurns`. Both are arithmetic in a prompt.

**Thesis.** Split ownership by what each party is good at:

| Owner | Does | Never does |
| --- | --- | --- |
| **Code** | Calendar math, elapsed time, countdowns, lifecycle rules ("done" needs evidence), prompt assembly, audience filtering | Judge what happened |
| **Authoring model (main chat model, at the reply tail)** | Says what happened in the scene it just wrote: how long it took, what was learned, promised, resolved, revealed | Arithmetic; carrying the whole ledger in its head |
| **Scene-gap planner** | Decides intent for the next scene: beats, duration budget, which threads come due, what may be hinted | Run every turn |
| **Init model (once, user-confirmed)** | Produces the story bible: calendar config, day-part table, activity-duration table, secrets, cast knowledge | Be trusted unseen |

## 2. Decision 1: where this lives

The 2026-10-15 decision was to stop adding RP-mode knobs and build a cache-first scene-graph story app in
this repo. This plan pulls the other way if it lands in Engine settings. Options:

| Option | For | Against |
| --- | --- | --- |
| A. Engine agents on `custom-mods` | Fastest; HUD works | Big rebase surface; this is the work the fork is trying to shrink |
| B. Wait for the story app | Cleanest end state | Nothing helps current chats for a long time |
| **C. Pure modules plus package documents on a stock Engine (recommended)** | Chronology and ledger are plain code with no Engine imports, so the story app can absorb them unchanged; the packages ship value now; no new tables | Package panel instead of the stock HUD at first; needs one Engine seam (section 6) |

Recommendation: **C**, with the core written as a standalone library (`chronology`, `ledger`) that both a package
and the story app import.

## 3. What already exists: keep, merge, retire

| Piece (`fork/packages`) | What it is | Verdict |
| --- | --- | --- |
| `narrative-architect` | Pre-generation planner, scene-break gated, beats plus information asymmetry, cached per scene | **Keep and extend** into the scene-gap planner. Swap its own regex and Decision-model gate for the Engine's scene signals (below). Feed it the ledger and the duration budget. |
| `timeline-tracker` | Post-agent; LLM keeps `t_now`, elapsed time, milestones | **Retire.** Replaced by the chronology engine. Keep its milestone idea as ledger entries. |
| `timeline-anchor` | Pre-generation LLM call that renders temporal constraints | **Merge.** The same block, rendered by code from the clock and ledger, with no model call. |
| `foreshadow-vault` | Post-agent; LLM ticks countdowns in a custom tracker | **Merge into the ledger.** Seeds are ledger entries with code-evaluated triggers. |
| `directors-whisper` | Zero-cost prompt-context contributor for READY seeds | **Keep.** It becomes the renderer for ledger items that are due. |
| `npc-registry` | Names, aliases, pronouns (no facts) | **Keep as is.** Cast identity only. |
| Lorebook Keeper (stock) | NPC entries with dated log | **Keep.** Stamp the log from the chronology clock, not the tracker's text date. |
| Stock `world-state` agent | Date, time, location, weather, temperature | **Keep for now** (HUD couples to its type). Chronology owns date and time; weather and location stay model judgment. |
| Advanced Memory scenes | Scene detection, `[scene: title]` from the story model, timeframes | **Keep.** Producer of the scene-gap signal; consumer of the clock (timeframes from code, not regex or text). |

`call-sheet`, `shared-world` and `slurp2` are out of scope.

## 4. Components

### 4.1 Story bible (init, once, user-confirmed)

A strong model reads the card, lorebook, persona and opening, and fills a **constrained JSON config**. Code validates
it, round-trips test dates through it, and the user reviews and edits it in a panel before it is used. A bad bible
poisons every later turn, so confirmation and re-init are part of the design, not polish.

Contents:

- **Calendar:** epoch label, weekday names, month names and lengths, a leap rule from a small enum, era names,
  season mapping, day length in hours (default 24). The canonical instant is **story-seconds since the epoch**
  (not UTC; there may be no Earth).
- **Day-part table:** named bands (e.g. early morning, early afternoon, dusk) with an anchor time and width.
- **Activity-duration table:** typical durations per activity class (conversation, travel by each mode, meal,
  rest, tending a wound, craft work, etc.) so estimates are consistent across scenes.
- **Starting state:** date, time, season, location (flagged "inferred" when guessed).
- **Cast knowledge and secrets** (seeds for the ledger; section 4.3).

### 4.2 Chronology engine (code)

- Each message stores a **delta**, not a clock string. The current time is a fold over the selected swipe path, so
  edits, deletions and swipes recompute downstream times correctly. Package documents are keyed by
  `messageId + swipeIndex`; the Engine already keys snapshots the same way.
- **Delta vocabulary** (what the model may emit): a duration from the activity table, a number plus unit, a named
  day-part ("advance to the next early afternoon", never "set to 13:00"), a relative jump ("four years later"),
  or an absolute `set` for flashbacks and dreams (with a scene-local clock so a flashback does not corrupt later time).
- **Precedence per message:** explicit absolute `set` > the model's token > planner budget > speech-rate floor.
  The **speech-rate floor** is computed in code: words inside quotes divided by roughly 2.5 words per second, as a
  minimum for scenes that are not travel. A longer cue always beats the floor, never the reverse.
- **Precision flag** per message (exact, band, coarse). A band like "early afternoon" displays as the band; the
  stored instant is internal. Consumers (Advanced Memory timeframes, lorebook log stamps) read the flag and do
  not present a fabricated exact time.
- **Rendered by code, every turn:** current story time, elapsed since story start, daylight remaining, and the
  "elapsed since milestone" lines that `timeline-anchor` used to ask a model for.

### 4.3 Narrative ledger (code owns lifecycle; model supplies facts)

One typed list, replacing separate trackers that re-guess each other:

| Kind | Meaning | Lifecycle (enforced in code) |
| --- | --- | --- |
| `thread` | Open plot question or storyline | open, advanced, resolved, abandoned |
| `promise` | A character committed to do something | stated, scheduled, kept, broken. **"Kept" requires a completion event citing a message.** |
| `task` | Implicit obligation (wait until dawn, bring the item back) | pending, due (story-time or condition), done, lapsed |
| `skill / milestone` | A character learned or began something | `learned_at` story-seconds. **Gate:** the prompt states that no one may be shown doing it before that instant. |
| `secret` | Truth the story hides | hidden, hinted, partly revealed, revealed. Fields: the truth, **known-by list**, clues that exist, reveal condition. |
| `knowledge` | Who learned what, when | append-only |

Triggers are evaluated **in code against story-time, location, presence or flags**. No model decrements anything.

### 4.4 The tail block (authoring model, every turn)

The main model ends each reply with a compact hidden block: the duration token, plus ledger operations (opened
thread, promise kept, skill learned, clue shown, secret revealed, who learned it). It is cheap (~60 to 120 tokens)
and it is written by the party that knows what just happened. The Engine strips it from display; a handler applies
it to the chronology and ledger. A malformed or truncated tail falls back to a **post-hoc agent** reading the
message with the same vocabulary, then to the speech-rate floor, so the system degrades instead of failing.

### 4.5 Scene-gap planner

Runs only at scene boundaries (the signals Advanced Memory already produces: `[scene: ...]`, scene check, hard-close).
Input: the ledger, the clock, the last scene summary. Output, cached for the scene:

- beat sheet and information asymmetry (existing `narrative-architect` output);
- **duration budget** for the coming beat, advisory only (the tail may override; a hard budget would anchor the
  model into writing to the number);
- which threads, promises and tasks come due;
- which clues of which secrets may be hinted;
- what each present character knows.

One call per scene, not per turn. It is also a user of the tail block's data, which makes scene boundaries and the
tail one loop: the tail feeds the ledger, the ledger feeds the next plan.

### 4.6 Prompt assembly

- **Stable prefix:** bible rules, day-part and duration vocabulary, tail-block instructions, scene plan and beat sheet
  (changes once per scene).
- **Tail of the prompt (volatile):** current story time and daylight, due items, the secret-handling block.
- Never put per-turn changing text in the prefix. Verify with the `fix-caching-issues` measurement before and after.

## 5. By failure class

| Class | Owner of the fact | Written | Stored | Back into prompt | Check |
| --- | --- | --- | --- | --- | --- |
| **Chronology** | Code (fold of deltas) | Init, tail, scene gap | Package document per chat; deltas keyed by message and swipe | Tail of prompt: time, daylight, elapsed | Date advances past midnight; dialogue-heavy scene costs more than the speech floor, not a flat 15 min |
| **Plot threads** | Authoring model reports, code tracks | Tail | Ledger | Due items via `directors-whisper`; open threads in the scene plan | A thread opened in turn N is listed as open or resolved at turn N+200, never silently missing |
| **Shared knowledge** | Ledger `knowledge` and `skill` entries | Tail | Ledger | "Has not yet learned X" constraints; per-character knowledge list | No character is shown doing a thing before its `learned_at` |
| **Implicit tasks and promises** | Ledger lifecycle | Tail | Ledger | Due or overdue tasks at the tail of the prompt | A promise stays "stated" until a completion event cites a message; Keeper entries stop writing promises as done |
| **Mystery and asymmetry** | Ledger `secret` | Init and scene gap | Ledger; narrator view and character view are different renders | Narrator gets the truth, known-by list and allowed clues. Per-character prompts get only their own knowledge | Over a sample of turns, characters outside `known-by` never state the secret. Soft metric |

**Honest limit on mysteries.** In single-narrator RP the one model sees the secret, so code cannot make it keep the
secret. What code can do is tell it exactly who knows what and which clues are allowed, and filter by audience where
a turn is generated per character (the roleplay-events read path already filters by audience: public, user-only,
or a set of character ids). It reduces leaks; it does not prove none.

## 6. Engine seams

Findings from reading the Engine on 2026-10-25 (verify before relying on them):

- Packages **can** register conversation commands (`capability-command-registry.service.ts`): tags, payload
  validator, idempotent handler, stripped from output. That registry is wired into the **Conversation-mode**
  command path (`character-commands.ts`, dispatch in `generate.routes.ts`).
- Roleplay-mode commands are a **hard-coded list** (`ROLEPLAY_COMMAND_KEYS` plus `roleplay-commands.ts`). I found no
  hook letting a package register a reply block in Roleplay or Game mode.
- Packages can add prompt-context contributors, agents and durable roleplay events with an audience filter.

So the single Engine change this plan needs is a **seam**: *packages may register hidden reply blocks in Roleplay
and Game mode, the way they already can in Conversation mode.* Framed that way it is a general capability that
helps every package author, which is what the upstream-contribution rule requires; it must not be a fork-only
convenience. Requirements for it: hide a partially streamed tag, strip on settlement, hand the handler the payload
with message id and swipe index, idempotent on retry, and unaffected by the Peek Prompt dry run.

Everything before the tail ships **without** the seam: init, chronology engine, ledger, planner, prompt rendering,
and the post-hoc agent fallback. The seam only upgrades quality.

Other couplings (separate, optional): stock HUD banners, tracker window and `committed-tracker-context.ts` check the
literal agent type `"world-state"`. Making them key on result type is a small upstreamable change if package-written
date and time should appear in the stock HUD. Until then the package shows its own panel.

## 7. Storage

No new tables (a layout change triggers the `STORAGE_VERSION` and `storage-format.json` bump and the launcher
downgrade guard). Use package documents (`capability_documents`) for the bible, ledger and per-message deltas, and
existing chat metadata where a flag is enough. Chronology and ledger code lives in pure modules with their own tests
so the story app can import them.

## 8. Phasing

Each phase is shippable and measurable on its own.

0. **Baseline.** Build a replay harness over recorded long chats (the long chats on `marinara`). Measure the current
   failure rates for the checks in section 9 and the cache hit rate. Use the local model; keep cloud spend near zero.
   Nothing else starts until there is a baseline.
1. **Chronology core, no seam.** Pure module plus bible schema, validator and round-trip tests; init flow with a
   confirmation panel; speech-rate floor; code-rendered time block replacing `timeline-anchor`; a post-hoc agent
   emitting vocabulary tokens (not clock strings). Retire `timeline-tracker`.
2. **Ledger.** Lifecycle engine, countdowns in code, `directors-whisper` renders due items; fold `foreshadow-vault`
   in. Stamp Keeper log entries from the clock.
3. **Scene-gap planner.** Re-gate `narrative-architect` on the Engine's scene signals; add the ledger, budget and
   per-character knowledge to its output.
4. **Tail seam.** Upstream issue first, framed generally; then the tail block replaces the post-hoc agent where present.
5. **Retire and tidy.** Remove superseded packages; decide HUD integration.

## 9. Acceptance checks (against failures already on record)

1. A replayed clock crossing midnight increments the date. (Regression of the known tracker bug.)
2. A character is not shown using a learned craft before its `learned_at`; the constraint appears in the prompt.
3. A promise is not stored as done without a completion event citing a message.
4. A dialogue-only scene of N quoted words advances the clock by at least the speech-rate floor, not a flat 15 minutes.
5. Swipe, edit and delete recompute downstream time from the selected path.
6. Cache: the prefix is byte-stable across turns within a scene; measured hit rate is not worse than baseline.
7. Secrets: sampled turns show no leak to characters outside `known-by` (soft).
8. Degradation: with the tail removed or malformed, the clock still advances and no turn fails.
9. Name-collision check for NPCs stays covered by `npc-registry` (regression only).

## 10. Risks and open holes

- **Duration judgment is still an LLM call.** The vocabulary constrains the output and the speech floor sets a
  minimum. It does not make "how long did this take" objective. The tail author is the best available source.
- **Planner anchoring.** An advisory budget can still pull the prose toward the number.
- **False precision.** Mitigated by the precision flag, but every consumer must honor it.
- **Bible errors are persistent.** Mitigated by user confirmation and a re-init path.
- **Non-linear time** (flashback, dream, parallel POV) needs the scene-local clock from day one, not later.
- **Tail history replay.** Whether stored assistant turns keep the tail block in the prompt history decides both
  cache stability and whether the model keeps emitting it. Needs a trace of how history is rebuilt before building
  the seam. Recommendation: keep it verbatim in history (byte-stable), hidden in the UI.
- **Weather, temperature and location** remain model judgment; they get their own change vocabulary later.
- **Single-narrator secrets** cannot be enforced, only guided (section 5).
- **Quota.** The harness and any model runs use the local model; Ben's subscription is shared with Claude Code.

## 11. Decisions needed from Ben

1. Option C for the location (section 2).
2. Retire `timeline-tracker` and `timeline-anchor`, and fold `foreshadow-vault` into the ledger (section 3).
3. Tail history policy: keep verbatim in history, or strip and re-render (section 10).
4. Whether to open the upstream issue for the Roleplay and Game mode reply-block seam now, before phase 1 is built.
5. Which chats form the phase 0 baseline set.

---

## 12. Revision 2026-10-25 (late): reuse pass, live-chat evidence, Story Architect

Appended by a second session after a reinvention sweep and a dry-run read of the failing chats. Sections 1–11
stand except where this section says **supersedes**.

### 12.1 Evidence from the failing chats (Peek Prompt dry runs, 2026-10-25)

| Chat | Finding |
| --- | --- |
| Crossed Harts (`r-C_ABw2vTU8Vs6YkQ5p6`, `marinara-wife`, 625 msgs) | Preset *Freaky Frankenstein 5.4 … Agent Gating Fix* runs an in-reply Chekhov tracker whose rules say "Narrative Debt: … **Load 1-2 new Bullets per turn**" and "**Prune unlocked Bullets at age ≥ 12**", fired by d20 rolls. That manufactures new threads every turn and silently drops old ones; it directly contradicts her Author's Note ("one case comes to a satisfying end before starting the next"). Director agent also active. **Config fix first.** |
| The Cobbler (`LHJM89P0_…`, 425 msgs, Sonnet 5.5) | Narrator sees the last 17 messages, ~5.8k chars of prose summary (#200–408), and ≤3 recalled scenes. #43–169 appear only if recalled. Every summary span after Day 2 reads `story timeframe: unknown`. Preset says "Maintain absolute narrative momentum" with no thread list to follow. |
| Vampy (51 msgs, fits entirely in context) | Still reported failing, so the cause is not only memory loss: nothing tells the narrator which threads are open. |
| Chaos Royals | Advanced Memory helper is the local model. (Do **not** move it to Haiku: quota.) |

### 12.2 Reuse found (not in section 3)

| Existing piece | Covers | Verdict |
| --- | --- | --- |
| **Memory Nag** (stock, `packages/memory-nag` 1.2.x) | Code-backed per-chat vault, active vs resolved, deterministic shortlist, user edits, injected as `<memory_nags>` | **The ledger's thread/promise/task store. Supersedes the "new store" part of 4.3**: extend Memory Nag (lifecycle kinds, evidence-cited "kept", story-time stamps) instead of a new list. Installed on `marinara`, active in none of the failing chats; not installed on `marinara-wife`. |
| **Decision conditionals** (Engine, `docs/prompts/conditional-prompts.md`) | `{{#if decision:"…" until:"…"}}`: yes/no answered by the local Decision model, latched until a second statement is true; swipes don't advance it; usable in preset sections and lorebook entries (entry-level Decision field); 32 statements/turn, priority-ranked | **The per-turn checker.** A beat/clue/thread is a latched decision. Replaces most of what a post-hoc "did this reply touch thread N" agent would do. Nested blocks are only asked when reachable, which should give clue dependencies (verify). |
| **Game mode setup** (`services/game/gm-prompts.ts`, `next-session-plan.ts`) | Sealed `storyArc`, `plotTwists`, `campaignPlan` (pressure clocks, factions with `secret`, quest seeds), refreshed per session | **Reuse the shapes** for the story bible's secret half instead of a new schema. Game mode has no per-turn tracking; that gap stays ours. |
| Advanced Memory per-character views (`knowledgeStarts`, `characterRecollections`) | Who-saw-what by message visibility, multi-character only | Keep. Single-card-as-narrator (the common case) needs the ledger's `knowledge` kind instead. |
| Mari `decision-authoring.ts`, user skills (`DATA_DIR/.mari-workspace/skills`), `app_data` | Mari already authors Decision statements and installs skills | The Story Architect interview is a Mari skill, not a new UI. |
| `quest` (stock) | ≤3 active narrative quests | Overlaps `thread`; leave as is, do not build on it. |

### 12.3 Story Architect (new component; NovelIdea-style)

A Mari skill interviews the user and writes a plan:

- **Truth nodes** (culprit, motive, method, crime timeline) — shape borrowed from Game mode's `storyArc`/`plotTwists`/faction `secret`.
- **Clue nodes**, each linked to the truth it implies; **three-clue rule** per required conclusion.
- **Red herrings** marked false.
- **Beats** with conditions and story-time anchors.
- **Knowledge edges** (who knows what).
- **Visibility per node:** planner-visible or **sealed**. Modes: sealed generation (user sets genre/cast/tone, never sees the truth), cross-authored (one spouse plans the other's mystery), partial.

Rendering: open/latched items become decision-gated prompt text (narrator gets the truth as GM-only notes plus
"clues available here"); code tracks which clues have fired.

### 12.4 What the package still has to own (stock cannot)

1. **Sealed storage.** Lorebook entries are user-visible, so they cannot hold a sealed culprit.
2. **Clue graph state** queryable across turns (which clues revealed, conclusions reachable), if nested decisions prove insufficient.
3. **Chronology** (section 4.2): no decision or tracker does arithmetic. Unchanged.
4. **Leak check:** a Decision statement per sealed truth ("the latest message states/implies X") feeding a flag, not a block.

### 12.5 Re-phasing (supersedes section 8 ordering; cheapest first)

- **A. Config, tonight, zero code.** Her preset: change the two Chekhov rules to "add a Bullet only when the story sets one up" and "unfired Bullets never expire; fire the oldest first"; drop Director unless invoked. Add an "advance or resolve an existing thread before opening a new one" line to the Cobbler preset.
- **B. Memory Nag on the local model**, in The Cobbler and Crossed Harts (install it on `marinara-wife` first). Measure against the user's concrete examples.
- **C. Decision-gated lorebook prototype**, hand- or Mari-authored, for one story: threads as `decision … until:` latches, clues nested by dependency. Needs a Decision model on `marinara-wife` (none configured). This is the beat-sheet experiment with no package.
- **D. Package, only for 12.4 gaps:** sealed plan store, clue-graph state, chronology core (old phase 1), leak flag; Memory Nag extensions upstream where general.
- Old phases 0 (baseline harness), 4 (tail seam) and 5 (retire) keep their place after D.

### 12.6 Open items to verify

1. Where a Mari skill can persist a plan the package reads: `capability_documents` vs a lorebook (and whether `app_data` reaches package documents).
2. Whether a latched block can gate another (nested `decision` inside an `until:` block) and whether the inner latch survives the outer turning off.
3. Whether decision answers are visible anywhere besides Peek Prompt (for a "what's open" panel).
4. Memory Nag scan connection can be the local model with acceptable quality on 4k-char messages.
5. The user's concrete failure examples (message numbers plus what should have been picked up) as the acceptance set for B and C.
