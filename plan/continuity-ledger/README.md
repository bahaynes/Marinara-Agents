# Continuity Ledger: plan index

**Priority one** for memory and continuity work. Status: spec v1.3; package 0.1.0 built and Gemma-checked; next is installing it on one of Ben's chats (Ben, 2026-11-22). Start here. Do not start a new design or eval in
this area without first updating this folder (memory: `build_dont_rederive`).

- `spec.md`: what we build (P1 = who knows what, on Gemma 4).
- `red-team.md`: the adversarial review and the answers to it.

## Supersedes

- `minecraftdocker/docs/llm/story-threads-plan.md` (2026-11-01): its storage, ops, filters and Gemma findings are
  carried into `spec.md`. Its threads and WIP part was built as the quest board (2026-11-19).
- `plan/coherent-narrative.md` (2026-10-25): still the source for chronology (4.2), sealed storage and the leak check
  (12.4), and the story bible. Nothing from it is in P1.

## TODO

- [x] Audit agents, package API and player corrections (2026-11-22).
- [x] Spec v1, red team, spec v1.1 (2026-11-22).
- [x] G1 first pass: 19 personal notes classified by hand (`red-team.md`). Who-knows-what covers 1 of 8 continuity notes.
- [x] Ben decided Q0–Q4 (2026-11-22, spec 7): relationships and knowledge first; persona and named NPCs are cast; bar = automated improvement over baseline.
- [ ] Keep writing personal notes; re-run G1 at about 50 notes.
- [x] Edit records: `extra.handEdit {original, count, lastAt}` on hand edits (Engine fixup 135bd51d8e into the cache-report commit, 2026-11-22; not pushed).
- [x] Continuity rules: Aside 0.9.0 "show to narrator" notes as author's notes (b7d758d1a; not pushed or installed).
- [ ] Verify Erin's live AM recall in Loki; then she can stop pasting the chapter archive (spec 1.1, her call).
- [x] Offline A/B dropped: too expensive on the subscription (Ben, 2026-11-22). Evaluation is in flight (spec 3).
- [x] Minimal ledger package `fork/packages/continuity-ledger` 0.1.0 (d87d5647c + fixups; not pushed, not installed).
- [x] Gemma checks (2026-11-22, Erin's M220-300 replay, `~/codex-eval/dartalia/ledger_replay_220_300_v2.json`):
  80/80 valid JSON; tighter definitions cut 55 entries to 14. A judge folded into the extractor missed every
  probe contradiction, so the judge is separate yes/no questions (two wordings per milestone; 6/6 probes each way).
- [x] Posterior script `scripts/posterior.mjs` (Gibbs; validated on synthetic data). Pooling by narrator model: not yet.
- [ ] Install on one of Ben's chats (needs Ben); add it as a matrix row; read the posterior at each matrix check.
- [ ] Known gaps: near-duplicate entries (two wordings of one milestone); with agents blocked on impersonate, "secrets" everyone present shares (21 entries vs 14 on the M220-300 replay, `~/codex-eval/dartalia/ledger_replay_220_300_blocked.json`).
- [ ] Ben: set the pOn floor/ceiling (placeholders 0.2/0.8) and the keep/switch-off thresholds. Labels: classified by reading, no prefix (Ben 11-22).
- [x] Impersonate traced (11-22): post-processing runs on impersonated turns unless "Block agents" is ticked, and Ben and Erin both tick it (Erin: 1127 of 1245 impersonated turns since 11-01; agents ran on 117 of the 118 unblocked). The extractor now reads those messages as `player_turn` on the next reply; blocked-mode replay still caught every milestone.
- [ ] Each later phase gets its own spec, in the order G1 gives.

## Evidence and results

Outside git (they contain Erin's story text), in `~/codex-eval/`:

| What | Where |
|---|---|
| Continuity audit, 11-22: agents, package API, rerolls, OOC | `audit-2026-11-22-continuity.md` |
| Tracker and salience hypothesis test, 11-22 | `findings-2026-11-22-tracker-hypothesis.md` |
| Scripts: GLM judge, block generator, tracker export, salience, reroll classifier, scorer | `scripts/` |
| Dartalia data, verdicts, rerolls | `dartalia/`, `dartalia/corrections/` |
| Chaos Royals data, verdicts, salience | `chaos-royals/` |
| Erin's codex v7 (ChatGPT) | `~/Dartalia_Two_Codex_v7-*.zip` |

Results from 11-22, short:

- GLM judges like Sonnet on totals but agrees on only 66–70% of facts. Use one judge per comparison.
- A structured always-on block beat prose summaries on coverage, but it duplicates trackers. Dropped.
- The narrator sees one tracker snapshot. Latest snapshot coverage was 0% and 4%. Full history held 54% (Dartalia,
  mostly character "thoughts") and 17% (Chaos Royals).
- AM excerpts are fixed 3-message windows with no salience. Emotional salience did not predict model-made facts;
  narrative salience did, moderately. The fact list is model-made, so this is weak evidence.
- Neither player's chat records continuity errors (Erin: 26 rerolls, no OOC; GLM reroll labels were 3 of 4 wrong
  on spot-check). The measure is Ben's personal notes.
- Gemma wrote half-length blocks and scored about half of GLM. Hence spec principle P1: design for Gemma.

Earlier, in git:

- `minecraftdocker/docs/llm/story-threads-plan.md` and `story-threads-step1/` (untracked harness): 11-01 Gemma
  op-diff tests, filters, the presence test and the alias test.
- Memory: `story_threads_plan_docs`, `design_for_gemma`, `build_dont_rederive`, `quest_board_plan`,
  `codex_package_plan`, `relationship_tracker_redesign`, `erin_external_codex_memory`.
