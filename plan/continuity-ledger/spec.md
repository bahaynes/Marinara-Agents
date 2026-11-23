# Continuity Ledger: spec v1.2

Status: **Q0–Q4 decided; G2 leak test in progress.** v1 2026-11-22; v1.1 after `red-team.md`; v1.2 adds edit records and Erin's codex gap (1.1).
Index, TODO and links: `README.md`.

## 1. Goal

Fewer continuity breaks that a player notices and has to fix, and, concretely, **Erin no longer hand-maintaining a
ChatGPT codex** to keep her story straight (section 1.1).

The measure is what players actually had to do: personal notes (`message.extra.privateNote`), classified by hand,
and hand edits of generated messages, which we want as few as possible. Today an edit leaves no trace: the Engine
overwrites the message and its stored swipe, so 11-22 found zero detectable edits in Erin's chat. Recording them needs
one small, generic Engine change, kept in its own commit: on a user edit of a generated message, keep the pre-edit
text and a timestamp in the message's `extra`. That is an edit record, not tracker code, so it fits P4. Fact-coverage
scores from model-made fact lists are not the measure.

### 1.1 What Erin's codex does that Marinara does not

Erin rebuilds a codex in ChatGPT and imports two things by hand. The first is a lorebook of five entries: the current
scene (constant), a relationship map, character profiles, world and mysteries, and continuity rules. The second is a
chapter archive she pastes section by section into a vector lorebook. Set against what runs in her chat today
(character tracker, persona stats, quest, Lorebook Keeper, CYOA, illustrator, aside):

The chapter archive is what Advanced Memory's scene records already are. After her 11-22 re-scan they are 33 scenes
of about 15 messages, and they scored well above her codex on the same facts. Whether the live recall works for her
is still unverified (the Loki check in the TODO). Once it is, she can stop pasting the archive.

The current-scene entry is mostly tracker state: place, time and who is present (world state, which she does not
run, plus the character tracker), and open threads (quest). Its value over the trackers is that it is *correct*.
Her own canon audit lists stale tracker and Keeper entries ("Current Scene" entries from places she left days ago).
The fix there is retiring stale entries, not a new tracker.

The continuity rules (a minor's age, what a magical bond does not imply, which secrets are card-only) are per-chat
rules she writes once. Aside 0.9.0 does this: a note toggled "show to narrator" becomes an author's note in every story turn (built 2026-11-22, Ben's suggestion).

That leaves the relationship map and the who-knows-what table: her codex file 07, which carries a "do not assume"
column on every row. Nothing in Marinara produces either with message-cited "since" and "not yet" lines. Her play
style, where the narrator runs conversations between characters, often with private telepathy, is exactly the case
where the 11-01 plan found knowledge gating matters. **For Erin, relationships and knowledge are the gap.**

## 2. Decided principles

| # | Principle | Source |
|---|---|---|
| P1 | Every step works on local Gemma 4. Stronger models are a reference answer only. | Ben 11-22 |
| P2 | The model reports what changed as small ops. Code owns state, filtering, math and rendering. | 11-01 Gemma test |
| P3 | Models always return something. Never gate on "none"; filter in code. | 11-01 |
| P4 | Ships as a package in `fork/packages/`. No tracker code in the Engine fork. | Ben 11-22 |
| P5 | Advanced Memory is unchanged; it stays the general history layer. | Ben 11-22 |
| P6 | Volatile blocks sit past the cached prefix: the package block is injected before the last message (after the last assistant message on impersonate). | fork `capability-prompt-runtime.ts` |
| P7 | The prompt shows current facts only, each with "since M#" and, where it matters, a "not yet" line. | Ben 11-22; Erin's codex |
| P8 | Storage is an append-only assertion log anchored to message + swipe, resolved on read (npc-registry's graph). | 11-01 |
| P9 | Threads and the WIP limit stay in the quest board. | 11-19 |
| P10 | Gate before building: each gate can stop or redirect the work, and its bar is set before the run. | red team 11-22 |

## 3. Gates (in order)

**G1: choose the phase from what players had to fix.** Classify every personal note and edit record by cause, by
hand (not GLM: its reroll labels were 3 of 4 wrong). Ben's 19 notes so far (detail in `red-team.md`) are mostly
scene-logic slips and recurring tropes, and only 1 of 8 continuity notes is about who knows what. But they come from
Ben's chats and play style. Erin's need is documented by her codex (1.1), and it points at relationships and
knowledge. The two sources disagree because the players differ, so the phase choice is a product decision (Q0), not a
count.

**G2: leak A/B, only if who-knows-what is chosen.** It costs nothing to build. Hand-written blocks on the main model,
15–20 scenes where a present character lacks a fact, n ≥ 10 samples per arm. The arms are no block; a block naming
the fact; and a block saying only "A does not know about <topic>". A blind judge; Ben confirms a sample. Report the
base leak rate too. No headroom or no reduction means stop.

**G3: Gemma classifier.** Labelled exchanges (Ben labels ~50). Gemma answers one closed question per exchange: did
someone learn something privately or keep something hidden, and who? Report precision and recall against the labels,
on the real connection path (prompt-only JSON, see 5.2). The bar is set before the run.

Only after G2 and G3 pass: build sections 4–6.

## 4. P1 knowledge ledger (built only if G1–G3 pass)

A **knowledge item** is a fact established on-page that is deliberately private or hidden from at least one cast
member: a private channel, a concealment, a partial reveal, or something overheard.

- Engine whispers (`agentContent` "[Private whisper to <name>: …]") become items directly, with no model call.
- Out of scope: secrets that exist only on cards or in lorebooks; truth vs belief; threads.

### 4.1 Run rules

- `post_processing` agent-runtime agent. It extracts reply N at N (no lag). Presence comes from the snapshots in
  `context.recentMessages[].gameState`.
- Run types:
  - **Normal:** anchor to the created assistant message.
  - **Impersonate:** anchor to the persona message.
  - **Regenerate:** anchor to the new swipe.
  - The document stores the last extracted `{m, w}`, so a re-run on the same anchor is a no-op.
  - To verify before building: whether post-processing agents run on impersonate turns (gate not traced).
- Extraction runs inside `persistence.withChatLock(chatId)`; a save retries on revision conflict.
- Cadence: whatever the agent pipeline offers (`runInterval`, custom-agent path). Cost is one local call per run.

### 4.2 Model I/O

- `jsonContextOutput: true` and a prompt-only JSON contract. Parsing uses `runtime.json`'s `parseJsonish`.
  `response_format` is not available on a llama-server connection.
- Input:
  - the exchange (setting: exchanges shown);
  - the present cast;
  - open items, ordered by recency with a hard cap (setting). These are the ids the model copies.
- Output: `{"ops":[{"op":"learn","item":"<id>|new","fact":"...","who":["Name"],"from":"Name|"}]}`.
  - There is no `how` field and no `public` op.
  - A `learn` on an existing item with new names is "add knowers".

### 4.3 Filters (code; thresholds are settings set from G3 data)

1. Normalize ids. Unknown ids become new items.
2. Names must resolve to cast: characters, persona, or npc-registry through its service when present.
3. Drop knowers who already know. Drop the speaker as a "told" knower.
4. Near-duplicate facts merge, by a token-set rule.
5. Cap new items per run.
6. An item **retires in code**: when every cast member knows it, or after a configurable age without mention.

### 4.4 Storage

- `graph.mjs` is copied from npc-registry, marked `ponytail:`. Packages cannot share modules.
- Assertions are `{s, p, o, a: {m, w}}` with predicates `fact` and `knows`. There is no edit hash, so an edited
  message keeps its items.
- A `knows` without a valid `fact` is dropped on read.
- Unanchored assertions are corrections and are never superseded.
- Branches inherit (`inheritGraph`).

### 4.5 Prompt block

Read-only `registerPromptContext`. Presence is computed at read time from the last committed snapshot plus
`targetCharacterIds`. Lines are rendered only for items where a present cast member does not know. The wording is
the G2 winner.

### 4.6 Panel

Deferred until P1 shows value. When built, it needs the permissions `routes`, `ui`, `chat-read` and `storage`.

## 5. Leak paths this does not close

The narrator still sees everything on the cards and in the lorebooks, and Advanced Memory summaries, Long-Term Memory
and Lorebook Keeper all re-inject facts with no record of who witnessed them. The ledger can tell the narrator who
does not know something, but it cannot make the narrator not know it. The real fix for that is separate cards with
per-character history ("Separate cards" in `coherent-narrative.md`), which is out of scope here. The G2 leak test
measures how much the block helps despite this.

## 6. Later phases

Each later phase gets its own spec, in the order G1 and Q0 give. If relationships and knowledge go first for Erin,
the relationship part folds into the same log rather than a second tracker: milestones with "since M#" and a
"not yet" ceiling, which is the parked relationship-tracker redesign. Conditions such as injuries and healing, and a
money ledger where code keeps the balance from reported transactions, are the next state pieces her codex tracks by
hand. Rendering npc-registry aliases for present characters would cut the trope and naming slips in Ben's notes only
partly, because most of those are names reused across stories, not inside one.

Scene logic (the narrator misreading the current scene, ignoring input or inventing a choice for the persona) is the
largest group in Ben's notes, but it is broad and is not a tracker problem. It stays out of this plan.

## 7. Decisions (Ben, 2026-11-22)

**Q0: relationships and knowledge go first.** The work starts with the G2 leak test on scenes from Erin's chat.

**Q1: absent characters' ignorance of open talk is not tracked.** It overlaps with what Advanced Memory already
recalls, and it does not scale: every absent character would need a "does not know" line for every open event.
The decision also has a consequence for "cast". Villains and other important figures are usually not cards, so cast
means the characters, the persona *and* named NPCs (npc-registry when present, otherwise names the extractor sees on
the page). Card-only membership would miss most of the people who keep secrets.

**Q2: the persona counts as cast.** Impersonate is a first-class way to play. The persona can know, not know, tell
and be told like anyone else. Whether post-processing agents run on impersonate turns becomes a blocker to check
before building, not a nice-to-have.

**Q4: the bar is any automated, measured improvement over the baseline.** There is no fixed threshold. G2 passes if
hand-written blocks lower the leak rate against no block, judged automatically. G3 passes if Gemma-built blocks do
the same. Gemma's output is judged by its effect on leaks, not by its agreement with hand labels. Later versions must
beat the previous version on the same automated test. That needs the leak test to be a re-runnable script with a
fixed scene set, not a one-off.

Still open: turning on world state in Erin's chat and installing Aside 0.9.0 there need Ben's go-ahead and Erin
wanting them. The edit records and Aside's "show to narrator" are built (README TODO).
