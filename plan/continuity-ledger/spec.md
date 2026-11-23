# Continuity Ledger: spec v1.1

Status: **red-teamed; waiting on Ben's phase decision (Q0).** v1 2026-11-22, v1.1 same day after `red-team.md`.
Index, TODO and links: `README.md`.

## 1. Goal

Fewer continuity breaks that a player notices and has to fix. The measure is the player's own flags: Ben's personal
notes (`message.extra.privateNote`), classified by hand. Fact-coverage scores from model-made fact lists are not
the measure.

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

**G1: choose the phase from the notes.** Classify every personal note by cause, by hand (not GLM: its reroll labels
were 3 of 4 wrong). The phase that addresses the most frequent cause a package can fix goes first.
State on 2026-11-22 (19 notes; detail in `red-team.md`): 8 continuity notes, of which on-page who-knows-what covers
1. Scene-logic failures (3), tropes (4, a separate category) and one each of intent, hidden-plot use, injury and place.
**On this evidence, P1 below does not lead.** Q0 is Ben's.

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

## 5. Unaddressed leak paths (known, out of P1)

- Card and lorebook secrets the narrator always sees.
- Advanced Memory summaries, Long-Term Memory and Lorebook Keeper re-inject facts with no witness record.
- A narrator that knows everything: the block tells it who doesn't know, but cannot make it not know. The real fix
  is separate cards with per-character history (`coherent-narrative.md`, "Separate cards").

## 6. Later phases (each needs its own spec; order from G1)

- **Scene logic:** the narrator misreads the current scene, ignores input, or invents persona choices. The notes'
  largest continuity group. Probably prompt or model work rather than a tracker; needs its own investigation.
- **Tropes:** recurring names and props across stories. Not continuity; 4 of 19 notes.
- **Conditions:** injuries with since M# and healing state.
- **Money ledger:** transactions as ops, code keeps the balance.
- **Relationship milestones:** decide against the parked relationship-tracker redesign.
- **Cast:** npc-registry aliases rendered for present characters.

## 7. Open questions for Ben

- **Q0:** which phase goes first, given G1 (P1 does not lead on 19 notes)?
- **Q1:** track absent characters' ignorance of openly discussed events?
- **Q2:** persona as a cast member? The 11-01 rule keeps the persona out of the gate; Erin plays by impersonate, so
  the model writes the persona too.
- **Q4:** the G2 and G3 bars, set before the runs.
