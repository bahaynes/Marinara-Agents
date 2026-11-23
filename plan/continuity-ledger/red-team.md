# Red-team review of spec v1 (2026-11-22)

Two independent reviewers (Sonnet): engineering (claims checked against the Engine and npc-registry code) and design
(argue it will not reduce the breaks players notice). Spec v1.1 carries the accepted changes. Two engineering
blockers were re-checked by hand (JSON mode, `<assistant_response>`); both hold.

## Ben's personal notes, classified by hand (the reviewers asked for this first)

19 notes, four of Ben's chats, as of 2026-11-22. Ben's own labels: 8 continuity, 4 trope, 2 good, 1 pacing,
1 rule broken (side quest added despite the board rule), 3 other (NPC acted without the player's control, a rules
nerf, leaked commands or formatting).

The 8 continuity notes, by cause:

| Cause | Count | Covered by P1 (on-page who-knows-what)? |
|---|---|---|
| Logic inside the current scene: blames the player for info it just gave; ignores the player's message; invents a persona choice | 3 | no |
| Misreads player intent | 1 | no |
| Narrator uses hidden plot before the player's character could know | 1 | partly: the secret was never on-page, which P1 excludes |
| When something became known (contradicts "known before the meeting") | 1 | **yes** |
| An injury that never happened | 1 | no (P2 conditions) |
| Where a place is in relation to another | 1 | no |

Most happen within a few messages of their cause, in young chats: they are failures of reading the current scene,
not of long-term memory. Tropes (the same names and props recurring across different stories) are as frequent as
any single continuity cause. n is small; the notes keep coming.

## Findings and responses

| # | Finding | Severity | Response |
|---|---|---|---|
| D1 | The leak fix (a prompt block) is untested, and v1 builds the extractor first. The block also restates the secret, which can prime a leak. | blocker | **Accepted.** Gate G2: a leak A/B with hand-written blocks on the main model, before any Gemma work. Includes a base leak rate (no headroom, no P1) and block wording variants. |
| D2 | Gemma cannot apply "deliberately private or hidden", and the filters cannot check it. Always-return-something turns it into paperwork; `public` won't be emitted. | blocker | **Accepted.** Gate G3: a Gemma privacy classifier test on labelled exchanges, with the bar set before the run. The `how` enum and the `public` op are dropped; code retires items. |
| D3 | Presence from roster plus speaker tags contradicts the 11-01 finding (tags re-add people who left). Persona rule not reconciled. | major | **Accepted.** Presence is a stated dependency with a measured error rate. Persona: Q2 stays open with the 11-01 rule cited. |
| D4 | Phase choice is weakly supported: the evidence points to scene logic, state and recall. P1 also leaves the biggest leak paths (card or lore secrets; AM, LTM and Lorebook Keeper re-injection). | major | **Accepted as gate G1:** the phase is chosen from the notes. On today's 19 notes, P1 does not lead. Leak paths listed in spec 8. |
| D5 | The evaluation can't show success: 19 notes, no control, GLM labels unreliable, no recall. The flag was dropped. | major | **Accepted.** The flag exists (Ben's notes). Notes are classified by hand. A paired A/B replaces before and after. The bar is set before the run. |
| D6 | Scope creep (panel, shared module, hash, codex metric) and invented values (25 words, header, enum). | minor | **Accepted.** The panel is deferred. Values are settings or tested variants. |
| E1 | "One message behind" doesn't fit: the Engine always sends reply N as `<assistant_response>`. | blocker | **Accepted:** extract N at N. Presence comes from `context.recentMessages[].gameState`. |
| E2 | `response_format: json_object` applies only to the local sidecar, not a llama-server connection. | blocker | **Accepted:** `jsonContextOutput: true`, prompt-only JSON, `parseJsonish`. The 65/65 figure is rechecked on the real path. |
| E3 | The edit hash destroys knowledge: an edited message's items vanish and are never re-extracted. Orphan handling is undefined. | blocker | **Accepted:** drop the hash (edited items stay). A `knows` whose item has no valid `fact` is dropped on read. |
| E4 | The extractor lag misses the whisper that just happened. | major | Resolved by E1. |
| E5 | Impersonate and regenerate runs: wrong anchor, a Gemma call per swipe. Erin plays by impersonate. | major | **Accepted:** per-run-type anchor rules, plus a stored last-extracted `{m,w}` for idempotency. Whether agents run on impersonate is to be traced before the build. |
| E6 | A shared module is impossible: packages install into separate directories. | major | **Accepted:** copy `graph.mjs` with a `ponytail:` comment. Name lookup goes through npc-registry's service when present. |
| E7 | Concurrency is unspecified. | major | **Accepted:** `withChatLock` around extraction; revision retry. |
| E8 | The prompt-context request carries no messages and no presence. | major | **Accepted:** presence is computed at read time from the last committed snapshot plus `targetCharacterIds`. |
| E9 | Panel permissions missing. | minor | Moot while the panel is deferred; the list is recorded in the spec. |
| E10 | The Engine already has audience-scoped whispers (`agentContent` "Private whisper to …"). | major | **Accepted:** whispers are taken from the Engine without a model call. |
| E11–15 | Op schema details, branch remap, placement wording, `public` vs Q1, cost cadence. | minor | Folded into spec v1.1. |

## Net effect

The build order is now gated: G1 phase from notes, G2 leak A/B, G3 Gemma classifier, then build. On current
evidence, gate G1 says who-knows-what should not be the first phase. That is Ben's decision (spec section 10).
