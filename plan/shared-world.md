# Shared World — plan

Working name: **Shared World** (package id `shared-world`). It is regular Game mode, but one world, its lore and its history are shared by everyone who plays in it. Each player runs their own adventure in their own chat. What they settle into the world reaches every other player's world. Synchronous play together comes later, as an opt-in.

## Status

Plan only. Nothing is built yet. Phase 0 is a set of spikes that confirm the Engine seams below, run on flash (cost stated before each run).

## Goals

1. **Your own adventure in a shared world.** Each player plays ordinary Game mode on their own Engine, their own subscription and their own pace. No turn-waiting and no host.
2. **Your deeds change their world.** What one party settles into the world (a town helped, a lord crowned, a bridge destroyed, a group turned hostile) shows up in every other player's world, as world facts and as in-fiction news.
3. **Watching is gameplay.** A Home tab shows the world's chronicle: who changed what, where, and when. Reading it is a reason to open the app, not a debug view.
4. **Shared lore, not just shared numbers.** People and places that one party meets or names become lore every party can run into.
5. **Later: meet up.** Players who are in the same place can opt in to play a scene together.

## Non-goals (for now)

- Real-time co-presence. You don't see another party walk past mid-scene.
- Lockstep time. The calendar is shared, but time inside a session is each party's own (see Time).
- Players on other hosts. The sidecar can be put behind Caddy later without changing its API.
- Pay-per-token APIs or local Gemma narration. Story play stays on the Claude and Agy subscriptions. A background extractor may use the agent model, if it is needed at all.
- PvP mechanics. Contradictory actions are reconciled as story, not adjudicated.

## Why this fits Marinara with one small Engine change

Game worlds (worldgen W4–W12) already do most of the work:

- **Stable ids.** A world is built from a kit plus a seed and shared as a world file with a snapshot. Places, groups and people have stable ids, so two games built from the same world file agree on what "Thornwick" is.
- **The world ledger** (`shared/src/features/world/ledger.ts`). The GM writes `[world: …]` tags. The ledger is just those answered tags in the visible replies, oldest first, and `worldPresent(game, ledger)` folds them into the present world: places held, groups, deeds, renown, standing, time. Swipes, deletes and branches stay consistent because nothing is stored beside the replies.
- **`gameRepliesBefore` is the seam.** `game-market.service.ts:75` builds the ledger on every generation as `fold ? [{from: fold}, ...own] : readWorldLedger([carry.tags, ...own])`. The world is recomputed from that each turn, so anything added to that list reaches the GM on the next generation. The existing keys can't carry foreign entries safely (see the table), so the plan adds one key for them (see *The one Engine seam*).
- **News is already native.** `worldNewsHere` / `worldBrewingNear` turn the present world into what locals talk about. If foreign deeds are in the fold, the GM hears of them the way it hears of anything else in the world.
- **Synchronous play exists upstream.** Multiplayer rooms (`docs/development/multiplayer.md`) support Game rounds between Engines with invite, pinned certificate, password and host approval. That is the base for the meet-up phase.

## Verified seams and caveats

| Seam | Finding | Consequence |
|---|---|---|
| Carry read | `gameLedgerCarry.tags` is read on every generation, but **only when the chat has no fold** | Works in a game's first session only. |
| Fold at rollover | `game.routes.ts:7989` writes `setFold(newChat, worldFold(world, ledger))` whenever the game has a world snapshot (every library-world game). From session 2 on, `own = all.slice(1)` drops the carry entirely | Writing foreign tags into the carry stops working at the first new session. Packages have no API to rewrite the fold. **No-Engine-change ingest is ruled out.** |
| Rollover merges the carry | `carryWorldLedger(prev, replies)` concatenates the previous carry's tags with the session's, unmarked, and the fold is computed from that ledger | Even in session 1, foreign tags left in the carry would be baked into the player's own past (and fold) at rollover, crediting their renown and double-counting on the next rebuild. Foreign entries must live in a key that rollover never folds. |
| Metadata write | `persistence.updateChatMetadata` needs `chat-write` and replaces the whole blob; no write ordinal | Always do read, merge and write inside `withChatLock(chatId)`, changing only the package's own key. Rollover copies unknown metadata keys forward (`...carryMeta`), so the key survives sessions. |
| Renown and standing | `worldPresent` does `present.renown += 1` and moves `standing[group]` for **every** deed entry, with no "who" check | Folding another party's deeds as-is would credit *your* party with their renown. |
| Prompt context | `injectCapabilityContexts` appends to the **system** message | Never put news there. Each change would break the cache, the same Game-mode 0% failure `gameLoreInTail` fixed. News must come through the fold (native placement) or the lore in the tail. Spike S3 confirms where the native world block lands. |
| Package routes | Admin-gated by `requirePrivilegedAccess` | The other Engine cannot call them, so they can't be the cross-player transport. |
| Multiplayer peer listener | Serves a fixed set of room actions only; packages can't add any | It can't be the async transport either. |

### The one Engine seam: foreign entries

About 25 lines plus tests, in two shared spots (plus the calendar floor described under Time):

1. **`ledger.ts`: whose deed.** A ledger entry field `by: "<player id>"`. In `worldPresent`, an entry with `by` still changes the world (place holders, groups, crowns, falls, destruction) but skips `renown += 1` and the `standing` push.
2. **`game-market.service.ts`: a foreign key.** `gameRepliesBefore` reads `meta.gameLedgerForeign` (a JSON array of ledger entries the package writes, each with a non-empty `by`; `worldForeignLedger` drops anything else and strips `days`, `at`, `from`, `hold`, `release` and `ground`). It appends those entries after the fold or carry and before the chat's own replies. The rollover's fold and `carryWorldLedger` are computed **without** it, so foreign entries are never baked into a player's own past; the package rewrites the whole key from the log each time.

Following the memory rule *engine-fork-minimal*, this is folded into the existing Call Sheet commit on `custom-mods`, not added as a new commit. It is also a plausible upstream PR in its own right ("entries from another party"), since it is generic: any package that wants outside events in a game world needs it.

The seam was checked against the source: both the carry and the fold paths were read, and there is no package path to the fold. A no-Engine variant (rewriting foreign deeds into `fact` entries in the carry) only lasts until the first session ends, so it is a Phase 1 prototype aid at most.

## Decision 1: where the shared world lives

There are two Engines in `~/git/minecraftdocker/marinara/compose.yaml`, `marinara` and `marinara-wife`, with separate data dirs. Because package routes and the peer listener are both closed (above), two Engines can't talk through Marinara itself.

**Decided: a tiny world-log sidecar in the compose stack**, the same pattern as `dnd-engine` and `lyrics-relay`. The players are the two of you, on `marinara` and `marinara-wife`.

- A `shared-world` container on `caddy_network`, not exposed through Caddy.
- It holds any number of **shared games**. Each one has exactly one world: the pinned world file, its calendar start, and an append-only log of published entries, NPCs and images.
- Endpoints, all keyed by shared-game id:
  - `GET /games`, `GET /games/:id/world`
  - `GET /games/:id/log?since=<seq>`, `POST /games/:id/log`, `POST /games/:id/retract`
  - `PUT` and `GET /games/:id/media/:hash`, for content-addressed images
- Each player has a bearer token, set through package settings.
- The package on each Engine uses the `network` permission to pull and push.
- Storage is one SQLite or JSONL file on a mounted volume. Each entry gets a monotonic `seq` from the server, which gives one canonical order.

**Alternative if both players use one Engine:** package `storage` alone, no sidecar. That is simpler, but it doesn't fit the current two-instance setup.

**ponytail:** the sidecar trusts the docker network plus a bearer token. Its ceiling is same-host players. The upgrade path, for friends on other hosts, is to put it behind Caddy with TLS and per-player tokens. The API doesn't change.


## Model

```
world file (pinned, with snapshot)  ──►  every player's game is built from it (same ids)

player A's chat ──settled [world:] tags──► package A ──POST──► sidecar log (seq, by, at, entries)
                                                                      │
player B's chat ◄── gameLedgerCarry.tags ◄── package B ◄──GET since──┘
```

### What is published

- **World-ledger entries**, from the GM's own `[world: …]` tags, parsed with `readWorldLedger`. No extra model call is needed. Each entry is stamped with `by` (the player), the author's world day, the author's place, and the source reply id.
- **Shared lore.** These are named people and places the party met. They come from the ledger's `name`/`who` fields and, if installed, from NPC Registry facts. They become lorebook entries that other players' GMs can trigger (see Lore).
- **NPCs.** These are the game's `meta.gameNpcs` records (`GameNpc`: name, emoji, description, gender and pronouns, location, notes, `avatarUrl`, `worldId`, `role`). They are keyed by `worldId` when the world drew the person, else by normalized name.
  - Published: the description, `descriptionSource`, notes and the avatar.
  - Never published: `reputation`, which is how *your* party stands with them.
  - The reader merges them into its own `gameNpcs` under `withChatLock`, keeping its own reputation and adding the other party's notes as "heard: …". That way an NPC your wife's party met turns up in your game with the same face and history.
- **Generated images.** These are NPC avatars and scene illustrations. Bytes are uploaded to the sidecar under their content hash. A reader downloads them once and saves them into its own Engine, so the browser never has to reach the sidecar. Images are saved in package storage and served by the package route (S6). The images also illustrate the chronicle feed.
- **A one-line chronicle note** per published batch, for the feed. It is the GM's own sentence, trimmed to show what happened, not generated.

**Everything in a shared game is shared.** Everything above is published by default. Settings can narrow it per game: no images, or no NPC notes. A "keep this scene to myself" toggle is available but off by default.

Not published: inventory, party members, dice, anything in a Conversation chat.

### Commit point (swipe safety)

The ledger is defined as the *visible* replies, so a swipe, regenerate or delete takes a change back. The package publishes a reply's entries only once that reply can no longer be swiped in normal play:

- when the player sends the **next** turn after it (the reply is then superseded). The trigger is the package's prompt-context contributor, which runs on every generation with `chatId` and `mode` (S2). It publishes every visible GM reply that has a later user message, so a regenerate of the latest reply never publishes it. It returns no prompt text, so the system message and cache are untouched, and it sends the POST without awaiting it, because contributors have a 2 s deadline. Or
- at **session end** (`game.routes` session rollover), which publishes everything still pending.

If a published reply is later deleted or branched away from, the package posts a **retraction** for its entries, keyed by source reply id. Readers drop retracted entries on their next pull. Retractions are rare and visible in the feed ("…and then it was as if it had never happened").

### What a reader folds in

On each pull (at most every N minutes, and on chat open), package B:

1. Reads the whole log in `seq` order, minus retractions and minus B's own entries.
2. Converts each one for the reader's world: it keeps ids, marks it `by`, and strips the author's `days` and time steps.
3. Drops any foreign entry that B's own *published* history supersedes. That means the same place or group, where B's entry has a later `seq` (see Conflicts).
4. Writes the result as `meta.gameLedgerForeign` inside `withChatLock`. It rebuilds the key from the log every time, so the step is idempotent. The player's own carry and fold are never touched.

So the reader's world is: built world, then their own earlier sessions (fold or carry), then other players' settled deeds, then this session's replies. The present is always recomputed, never stored.

### Conflicts

There is one canonical order, sidecar `seq`, applied with one honest exception: **your live session wins until it is published.**

- Foreign entries fold *before* this session's replies. So while you play, your own `take` beats any foreign `take` of the same place, even a newer one. Once your entries are published they get a `seq`, and step 3 of the reader drops a foreign entry only when your published entry is newer. Across sessions, the later `seq` holds the place. The fold already handles a holder changing hands.
- A foreign entry older than your own published one is dropped for you, but it stays in the log, so other players still see it in order.
- If A `destroy`s a place B is standing in, B's GM sees it in B's present on the next generation. The plan accepts that this can feel abrupt; S4 tests how the GM narrates it.
- Facts aren't re-answered on the reader's side. They are replayed as settled history. Re-answering, meaning re-checking a deed against the reader's own state, is out of scope; it diverges and costs model calls.

### Time: West Marches rules

West Marches tables solve this with a few rules that map well onto Marinara. In Ben Robbins' original game, and in the many tables that copied it:

- **The calendar is real time.** Gygax's 1:1 rule: a day passes in the world for each day that passes for the players. Nobody owns the clock, so nobody drags anyone else along.
- **Every session is an expedition from a home base.** You set out from town and you're back by the end of the session. Between sessions every party is "in town", so no one is ever stuck mid-dungeon while the world moves.
- **Time on an expedition is pocket time.** The days you spend in the field are your own. The world doesn't wait for you, and you don't skip it ahead.
- **News is shared in town.** The bar talk at session start is where you hear what the other group did.

**Shared World's rule:**

1. Each shared game has a **calendar**, `start + (real days since start) × ratio`. The default ratio is 1 world day per real day; at that rate the world's own weekly step happens about once a real week. The ratio is a setting for each shared game.
2. **When a session starts**, the party's world day snaps forward to the calendar: `day = max(own day, calendar)`. If the party spent more days in the field than real time has passed, they are simply ahead for a while. Nothing rolls back, and everyone else catches up as real time passes.
3. **During a session**, `[world: days=…]` moves only your own clock, which is pocket time, as now.
4. Foreign changes are applied on the day they arrive. News of them still travels by the world's own reach, which depends on renown and distance.
5. **About one session per adventuring day.** Marinara sessions don't force a return to town, but sessions are good practice in Game mode anyway. The Game Master prompt gets one line: "a session is one adventuring day; when the party beds down for the night, offer to end the session there." It's a nudge, not a rule, and it keeps pocket time short, so parties rarely run far ahead of the calendar.

This needs one more piece in the Engine seam: a **calendar floor**, `meta.gameWorldDayFloor`. It is an `{ untilDay }` entry placed **last**, after the party's own replies, so the day is `max(own days, floor)` and never the sum. The world steps weekly up to it, and rollover *keeps* that step. The floor is a fact about time, not a foreign deed. That's about five more lines next to the `gameLedgerForeign` read.

**Known divergence.** The world's own weekly business (`stepWorld`: brewing troubles, events ripening) runs in each player's fold. It depends on that player's present and party position, so background events can differ between your world and hers. Player deeds are canonical; the world's own churn is per-player "weather" for now. The upgrade path is for the first Engine to cross a week to publish that week's events, and for the other to adopt them instead of stepping on its own. That is spike S7, and only worth building if the drift is noticeable in play.

### Lore

The user story says the *lorebook* is shared too, not just the ledger. In scope:

- **A shared seed lorebook** ships with the world file (kit lore, places, groups), same for everyone.
- **Discovered lore**: people and places a party has met or named, published as small lorebook entries, keyed by name, written in the GM's words. The package keeps them in one package-owned lorebook per game. Because `gameLoreInTail` puts triggered lore on the final user message, new entries don't break the cache.
- S5 answered: packages **cannot** write lorebooks. Persistence only has `listExistingLorebookEntryIds`, and `runInternalRoute` only reaches the package's own `/api/<id>` routes. v1 uses the fallback: discovered people go out as ledger `who` fields and shared NPCs, which the native world block already names. The seed lorebook is imported by hand at join time (below).

## Joining a shared game

Opt-in is per Game chat. Nothing is shared until a chat is linked, and an unlinked game on the same Engine stays private.

1. **Start a shared game (once, by one player).** In the Home tab, choose *New shared game* and pick a library world (New Vegas). The package uploads that world's export and its snapshot hash to the sidecar, and sets the time ratio (1:1). The sidecar returns a shared-game id and makes the creator its first player.
2. **Invite.** The creator gets a one-time join code. Either player can also be pre-seeded with a token in compose env, which is the simplest option for two people.
3. **Join.** The other player enters the code in their Home tab. The sidecar trades it for a player token, which is saved in package settings and never shown again.
4. **Get the world.** The Join panel offers the pinned world export and seed lorebook as downloads. The player imports them with Marinara's normal world and lorebook import. This is manual because a package can't create worlds, games or lorebooks (S5). Each player does it once.
5. **Start and link.** The player starts a normal Game from that world, then presses *Link to shared game* in the Home tab. That sets `meta.sharedWorld = { gameId, playerId }` on the chat. The package checks that the chat's world snapshot hash matches the pinned one and refuses the link if it doesn't, so a world edited locally can't fork the shared world.
6. **Leave.** *Unlink* stops publishing and clears `gameLedgerForeign`. The player's past entries stay in the shared log as history unless they are retracted.

Automatic import is possible: the package receives the raw Fastify `app`, and an `app.inject` from loopback would get past auth. But no package does this, and it bypasses the package permission model. Using it is a separate decision for the user, not part of v1.

## UI: the chronicle (core, not polish)

A `home-browser-tab` page, built like the Call Sheet page with theme tokens and `mari-*` controls:

- **Chronicle feed.** Newest first. Each card shows who (player and party name), where, what changed, and the chronicle line. Filter by player, place or group.
- **By place.** A world map list where each place shows its current holder, recent changes and who made them. Changes since you last looked are marked.
- **Calendar strip.** Today's world day, each party's day and how far ahead it is, and the next weekly step.
- **My mark on the world.** What your deeds changed, and which of them other players have since run into.
- **Join panel.** Create or join a shared game, download the pinned world, and link a Game chat. See *Joining a shared game*.

In-chat, nothing new is needed: the GM learns of foreign changes through the native world news. An optional small chat-header pill reads "3 things changed in the world since you last played" and links to the feed.

## Phases

**Phase 0: spikes** (flash only, cost stated before each run, no `gemini-4-argon`)

- S1 (**done**, local branch `shared-world-seam`, commit `52a06ec2f`, regression `world-ledger-foreign`; the other world regressions pass, and `world-kit-battlefields` fails on base too): Build the Engine seam on a scratch branch. Fold a hand-written `gameLedgerForeign` set into a two-session game. Check that renown and standing don't move, holders do, the native news text mentions the changes, and rollover doesn't bake them into the fold.
- S2 (answered): package agents in `agents.json` always make a model call. `agent-runtime` only wraps one, with `prepareContext` and `finalizeResult`. The trigger is the prompt-context contributor instead (see *Commit point*). It runs at `generate.routes.ts:4985`, before the lazy `gameRepliesBefore` at :5130. A foreign write that is awaited inside the deadline therefore lands in the same turn; otherwise it lands next turn. Both are fine. Metadata race: `withChatLock` uses the same `withChatMetadataPatchQueue` as the Engine's `patchMetadata`, and `patchMetadata` re-reads inside the queue. So a package write that re-reads under the lock is not lost.
- S3: Find where the native world block and news land in the Game prompt (system message or tail). Measure the cache hit rate before and after a `gameLedgerForeign` write.
- S4: Two flash games from the same world file. A destroys B's current town. Read how B's GM narrates it.
- S5 (answered): no. Use the ledger-only fallback and manual seed import.
- S6 (answered): package records can *reference* global-gallery items, but a package can't upload to the gallery. Images go to package storage and are served by the package's own route, which `avatarUrl` points at.
- S7: Two flash games, advanced four weeks each on the calendar. Compare their `stepWorld` news and decide whether the divergence matters.

**Phase 1: one-player loop, local log**

- Package with `chat-read`, `chat-write`, `storage`, `ui`, `prompt-context`. The publisher is the prompt-context contributor (code, no model call, returns no text). It reads `[world:]` tags and bails unless `mode === "game"` and the chat is linked.
- Commit point, publish to package storage, read back into a *second chat on the same Engine*. This proves the fold, retractions and the feed without any network.

**Phase 2: sidecar, two Engines**

- `shared-world` container plus `network` permission, tokens, `seq` pulls, and retractions.
- Deploy: add the service to compose, then recreate `marinara` first. `marinara-wife` is recreated only with explicit consent, after checking its logs for recent play.

**Phase 3: shared lore, NPCs and images**

- Discovered people and places become lorebook entries (or the S5 fallback), plus NPC Registry facts if it is installed.
- `gameNpcs` sharing (reputation stays local) and image upload and download (S6). Chronicle cards get images.

**First shared game: Fallout: New Vegas**

- Built from the built-in **Post-apocalyptic** starter kit (`starter-kits.ts`, family `wasteland`), then hand-edited in the world editor into the Mojave:
  - places: Goodsprings, Primm, Novac, the Strip, Freeside, Hoover Dam, and the like
  - groups: NCR, Caesar's Legion, Mr. House, the Kings, the Great Khans, the Boomers, the Brotherhood
  - the dam and the Strip as the two places everyone fights over, which is good West Marches material
- A seed lorebook of faction and setting lore, written for the two of you.
- **It stays private.** The world file and lorebook use Bethesda's IP, so they live in the sidecar volume only, never in the public catalog or the package. The package ships no world.

**Phase 4: meet up (synchronous)**

- Players whose parties are in the same place opt in to a joint scene. The vehicle is the upstream multiplayer room in Game mode. It needs its own design, because a room is *one host-owned chat*, not two players' chats. Open questions:
  - Which world does the room's GM see? Probably the host's present plus a snapshot of the guest's party.
  - How do the room's `[world:]` tags flow back? Likely published once, `by` both players, with each player's chat getting a short summary reply.
  - Package tools are unavailable in rooms, so the package can't act inside the room itself.
- Not designed further until Phases 1–3 are played.

## Validation

- Unit tests in `fork/packages/shared-world/tests/`:
  - tag conversion
  - idempotent carry rebuild
  - retraction drop
  - commit-point selection, including the swipe case: a reply that is still the latest is never published
  - time rule: foreign `days` stripped
  - NPC merge: reputation stays local, and the other party's notes are added as "heard"
- Engine seam tests:
  - in `ledger.ts`, a `by` deed changes holders but not renown or standing
  - in `game-market.service.ts`, `gameLedgerForeign` is in the ledger, but rollover's fold and carry exclude it
- Fork builder: build, entrypoint syntax, and package unit tests (`38da5bfac` builder), then catalog rebuild. Never hand-edit bundles or catalogs.
- Calendar tests: the floor snaps forward at session start, never back, and rollover keeps it.
- Play test: two flash games for an hour against one sidecar. Check the feed, news text and cache hit rate.

## Decisions (2026-10-17)

1. **Players:** the two of you, on the two existing instances. Sidecar on `caddy_network`.
2. **Time:** West Marches calendar, with real time as the floor and pocket time in sessions.
3. **Worlds:** one world per shared game. The first is New Vegas.
4. **Sharing:** everything in a shared game is shared, including NPCs and images. Settings can narrow it.

5. **Calendar ratio:** start at 1:1, adjustable per shared game.
6. **Sessions:** the Game Master nudges toward about one session per adventuring day.

## Tune in playtest

Everything below is a guess until the two of you play it:

- **Ratio.** Raise it if the world feels slow (weekly news rarely turns over between sessions), or if you're constantly ahead of the calendar. The chronicle shows each party's day next to the calendar ("you are 4 days ahead"), so "constantly ahead" is visible rather than a feeling.
- **The session nudge:** too pushy, or not enough?
- **Background drift** between the two worlds (S7).
- **News reach:** do the other player's deeds reach you too slowly or too fast through the world's own news?
