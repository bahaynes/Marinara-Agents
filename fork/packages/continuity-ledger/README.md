# Continuity Ledger

Dated **milestones** (two people became lovers, someone moved into a flat, took on a goal) and **secrets** (a private
fact and who knows it), per chat. The story model sees the entries for the people in the scene, with their age in
messages, so a new couple does not talk as if they had always been together and nobody acts on what they were never
told. Plan and spec: `plan/continuity-ledger/` in this repo.

- **Extractor**: a post-processing agent, built for local Gemma 4. It reads the new turn and returns small ops
  (`milestone`, `secret`, `tell`, `end`) plus the ids of open entries the turn contradicted. Code filters the ops.
- **Storage**: one document per chat, an append-only log anchored to message + swipe, resolved on read. Swiping,
  regenerating or deleting a message hides what it added; swiping back restores it.
- **Scene**: an entry is in the scene when one of its people is named in the last few messages (code, so NPCs
  without cards count).
- **In-flight test**: on at-risk turns the block is shown on a deterministic share of turns (`pOn`), and each turn's
  arm and contradictions are logged in the ledger for the posterior (spec section 3).

Settings (document `continuity-ledger:settings`; the defaults in `ledger.mjs` are placeholders): `maxInput`,
`maxPrompt`, `mentionWindow`, `maxNewPerRun`, `pOn`.

Not yet: a panel to correct entries; the posterior report script.
