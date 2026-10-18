# Shared World — plan

Working name: **Shared World** (package id `shared-world`). Two people each play their own Classic Game mode chat, on their own Engine, at their own pace. **Everything about the game syncs except the chat history**: the world, its people, its places, its plot and its items. What stays separate is each thread's story and where each party is standing in it.

## Status (2026-10-18)

- **v0.1 (0.1.1) is superseded.** It synced Overworld world-ledger deeds through the Engine seam `52a06ec2f`. Overworld games are locked behind `MARINARA_OVERWORLD_GAMES` (upstream: "not ready for everyone yet"), which is unset on both instances, and every game we play is Classic. So v0.1 can't run for us.
- **This plan replaces it** with a sync of Classic game metadata. The two checks below were answered by reading code, with no generations or deploys.
- **The Overworld seam is reverted** (`dd28c8f33` on the Engine's `custom-mods`, reverting `52a06ec2f`). The Classic sync needs no Engine change, and that keeps the fork minimal (memory: *engine-fork-minimal*).
- **One instance may be the whole solution (2026-10-18).** If two chats on `marinara` sync well, she plays her chat on that instance and there's no sidecar at all. See *One instance first*.
- **v0.2.1 is installed on `marinara` (2026-10-18):** the Classic sync, one instance, package storage as the hub. Code is `fork/packages/shared-world/merge.mjs` (pure merge) and `server.mjs` (store, sync, news, routes), with 11 unit tests. It needs no Engine change. Where the build differs from the design below, *Phase 0 findings* wins.
  - **The model-free live test passed** on 0.2.0, with two throwaway Game chats made through the Engine API, the first seeded with a copy of Fallout Duo's world keys.
    - Join copied the cast and map, with reputation 0 and the start node.
    - Story arc stayed per chat, and `spatialContext` was not copied.
    - An Engine metadata patch crossed over to the other chat.
    - A 75 s idle (one background tick) wrote nothing.
  - **It found one bug:** the feed hid later edits. That is fixed in 0.2.1.
  - **Not yet tested:** a model play test, to check that GMs use the news and that real turns merge cleanly. It costs about 0.4% of the weekly Agy Gemini bucket per flash call, roughly 8–15% for two setups and a few turns each.
  - **Leftover:** an inert "SW live test" game remains in the tab, because there is no delete-game route yet.
- **Rejected alternatives:** upstream multiplayer rooms (one host-owned chat, the model doesn't answer both players, synchronous, not fun) and one Engine with two personas (not two independent threads).

## Goals

1. **Two independent threads, one game.** Each player plays ordinary Classic Game mode in their own chat on their own instance. No host, no turn-waiting.
2. **One world state.** When a GM reply in one thread adds an NPC, kills one, discovers a place or invents an item, the other thread's game has it too from its next turn.
3. **Changes become story, not glitches.** The other thread's GM hears what changed as in-fiction news, so the world doesn't just silently shift underneath it.
4. **Watching is gameplay.** A Home tab feed shows what the other party changed.

## Non-goals (for now)

- Syncing chat history, or co-presence mid-scene.
- Lockstep time (see *Time*).
- Players on other hosts. The sidecar can go behind Caddy later with no API change.
- Pay-per-token or local narration. Story play stays on the Claude and Agy subscriptions.
- Adjudicating contradictions. They are reconciled as story.

## What syncs

Classic game state is plain top-level chat metadata (checked on Fallout Duo's keys). The split:

| Shared (the game) | Per player (the thread) |
|---|---|
| `gameNpcs`: who exists, alive or dead, description, notes, avatar | `reputation` inside each NPC: how *your* party stands with them |
| `gameMaps` / `gameMap`: maps, nodes, what's discovered | `activeGameMapId`, `lastMapPosition`: where *you* are |
| `gameWorldOverview`, `gameStoryArc`, `gamePlotTwists` | Chat history, `gamePreviousSessionSummaries`, `gameJournal` |
| `gameBlueprint.campaignPlan`, `gameRuleset`, `gameSetupConfig` world fields | `gameInventory`, `gameInventoryTurn`, `gameCharacterCards`, `gamePartyCharacterIds` |
| `gameInventedItems` (item definitions, not who holds them) | `gameActiveState`, combat, scene, music, media, widget state |
| | `gameSessionNumber`, `gameSessionStatus`, connections, `metadataWriteOrdinals`, `multiplayer*` |

**Not synced in v1, by necessity:**

- **Lorebook contents.** The package persistence host has no lorebook write (only `listExistingLorebookEntryIds`). Each player imports the shared lorebook once by hand. Lore discovered in play travels as NPC notes and news.
- **Date and weather.** These live in per-message `game_state_snapshots` rows, not in metadata, and they rewind with swipes. They stay per thread (see *Time*).
- **`activeLorebookIds`.** The package's `updateChatMetadata` is a raw whole-blob write that skips `patchMetadata`'s side effects, including the lorebook-entry cleanup tied to this key. Don't touch it.

### What `gameNpcs` is

It's the roster of **everyone the game has ever named**, not who's in the scene. The Engine only adds to it: setup's starting NPCs (`game.routes.ts` ~6607), people the GM names in play (`generate.routes.ts` ~11118), recruits (~2595), and up to 3 new NPCs per session end. After that, it only updates reputation and avatars. Nothing removes an NPC except starting a new game (~7114) or a hand edit. The GM prompt gets the whole roster (`game-gm-prompt-runtime.ts` ~201, ~404).

**Who's in the scene** is `presentCharacters`, a separate field in the per-message `game_state_snapshots` row. It rewinds with swipes, and it stays per thread.

So for sync:
- **The roster syncs as add-only.** That matches how the Engine already treats it.
- **`reputation` stays per player**, because it's your party's standing with that NPC.
- **`location` is ambiguous.** It's where the NPC was last seen, so two threads will disagree. It syncs as last writer wins with attribution, and news tells the GM the NPC was seen elsewhere.
- **Roster growth costs prompt tokens.** Two threads naming people roughly doubles the list the GM reads each turn. Watch it in playtest.

Whether the campaign plan, story arc and plot twists should be shared or per thread is a playtest question. The default is shared, per the ask ("everything but the chat history"). A per-game setting can make them per thread if two players chasing one plot feels wrong.

## The two checks

### 1. Does the GM read these keys fresh every turn? Yes, with a one-turn lag for package writes.

- `generate.routes.ts` ~1662 reads `chatMeta` once per turn from the database. The GM prompt is built from it (`injectGameGmPromptRuntime`, ~4902: story arc, plot twists, blueprint, map, NPCs and so on).
- Package prompt contexts run after that (`injectCapabilityContexts`, ~4985). Anything the package writes from its hook therefore lands **next** turn.
- **Design:** pull and merge in the background between turns (after each settled reply, and on a timer while a chat is linked). Use the hook's return value only for this turn's news text.
- **ponytail:** a change made in the other thread reaches yours one turn after it syncs, not instantly. The upgrade path, if it matters in play, is an Engine seam that runs a package "before turn" hook ahead of the ~1662 read.

### 2. Can a package write metadata between turns safely? Mostly. Stale Engine writes exist, so the merge must contain them.

- **The lock is shared.** `persistence.withChatLock` is the Engine's own `withChatMetadataPatchQueue`, and the Engine's `patchMetadata` re-reads inside that queue. Most turn writes are fresh read-modify-writes: `generate.routes.ts` ~11118 (named world people) and `game.routes.ts` ~16570 (NPC avatars) both read `gameNpcs` inside the updater.
- **Client edits are partial.** The client's `PATCH /chats/:id/metadata` (`use-chats.ts` ~965) sends only the keys it changed. A UI edit can't wipe unrelated synced keys, but an edit to `gameNpcs` does send the whole array from the client's cache.
- **Some Engine writes are stale.** There are 21 whole-blob `chats.updateMetadata` calls across the game and generate routes, and they don't use the queue. Most re-read just before writing, so their window is small. One isn't: the party-turn reputation write (`game.routes.ts` ~13685) builds `gameNpcs` from turn-start `meta`, then writes it after a model call. An NPC synced in during that turn is wiped.
- **Session end adds NPCs, it doesn't prune them.** `normalizeNextSessionNpcs` (`next-session-plan.ts:79`) keeps every current NPC and appends up to 3 new ones.
- **Metadata never rewinds.** It is chat-global (see the #5406 note in `chats.storage.ts`), so a swiped-away reply's NPC stays, the same as in single-player play.
- **Network:** packages are loaded with plain `import()` in the Engine process, so `fetch` works. The manifest still declares the `network` permission (see *Transport*).

**Conclusion: no Engine change is needed,** as long as the merge can't let one stale write spread to both instances (next section).

## Merge

Both Engines' GMs rewrite these keys whole, so plain syncing means last writer wins. Instead, the package merges **three-way** against a **base**: what sync last wrote into this game.

- **Where the base lives:** package storage, keyed by (shared game, local `gameId`). All session chats of one game share `gameId`, so the base survives Next Session even though the chat id changes.
- **Local changes** are `local − base`. They are pushed to the sidecar. **Remote changes** are `remote − base`. They are written into the chat, under `withChatLock`, re-reading inside it, changing only the synced keys.
- **Records merge by id, field by field.** That covers NPCs, maps and map nodes, and invented items. Never whole arrays.
- **Add-only through sync.** A record missing locally that's in the base is a local deletion (a stale write, or a hand edit in the NPC panel). It isn't pushed as a deletion, and remote doesn't re-add it to this chat. A record missing remotely is never deleted locally.
- **Sticky facts only move forward:** dead stays dead, destroyed stays destroyed, discovered stays discovered.
- **Regression is loss, not an edit.** A local field that changed back to an *older* value sync has already seen is treated as a stale write. It's re-applied, not pushed. This keeps one stale whole-blob write from turning into "player deleted X" on both instances.
- **Other fields conflict as last writer wins**, in sidecar `seq` order, with attribution (`by`, `at`) kept for the feed and news.
- **Per-player fields are never pushed or written.** That includes NPC `reputation`.

### Identity

NPC, map and node ids are minted per chat, so two separately generated games share nothing to merge on.

- **Join seeds from the first game.** The second player starts a Classic game (any quick setup), then links it with *Join*. The package overwrites that chat's shared keys with the shared game's current state before its first real turn, so ids match from then on.
- **Records either GM invents later** are matched by normalized name, using the Engine's own rule (`normalizeJournalMatch` and `findNpcRecordByName`, ported). A name match adopts the shared id.
- Check whether `packages/client/src/lib/game-setup-share.ts` (the "marinara-game-setup" share file) is a usable seed for the setup itself. It only carries `GameSetupConfig` plus connections, not world state, so it's a convenience at most.

## News

On each pull, the package diffs what the other thread changed and stores a short news list. On the next turn, the prompt-context hook returns it once as text ("Word around the wasteland: …"), with who did it, then clears it.

- **Cost:** capability context goes into the **system** message, which breaks the prompt cache on that turn. That's acceptable because it happens only on turns that carry news, and any synced change to `gameNpcs` or the map changes the GM prompt on that turn anyway. Turns with nothing new return `null`.

## Time

- Each thread keeps its own date and weather (per-message snapshots that rewind with swipes).
- v1 adds no shared calendar. News carries the other party's date ("…on 14 June, the other party…") so each GM can place the change in its own timeline.
- A shared calendar floor, as in the old West Marches design, needs a way to write snapshot dates. That's an Engine seam, so it's deferred until play says it matters.

## One instance first

Both chats live on `marinara`, and she logs in there to play hers. The package's own storage is the hub. Compared with two instances, this:

- **Removes the sidecar, the `network` permission, tokens and the deploy** to `marinara-wife`.
- **Makes joining free.** *Branch* a game chat (`POST /chats/:id/branch`, `chats.routes.ts` ~5022) and the copy keeps the metadata, the same NPC, map and item ids, and the world snapshot. Name matching is then only for people either GM invents later.
- **Shares lorebooks for free.** Both chats can use the same lorebooks, so the lorebook gap above goes away.
- **Shares avatars and assets**, because the URLs resolve on the same instance.

Costs and open questions:
- **No separate accounts.** The instance has one login (Basic Auth), so she sees all your chats, characters and settings. Spoilers between threads are on the honor system.
- **Branching copies your thread.** It copies the per-player keys too (party, cards, inventory, journal) and the messages up to the branch point. *Join* has to branch at the first message and then reset the per-player keys, or she plays a copy of your party. Decide in Phase 1.
- **One subscription for both.** Both threads draw on the same Claude and Agy subscriptions, so quota runs out roughly twice as fast.
- **Two generations at once on one Engine** haven't been tested. Phase 1 checks it.

If all of that is fine in play, the *Transport* section below is never built.

## Transport (only if one instance isn't enough)

Package routes are admin-gated (`requirePrivilegedAccess`), so the two Engines can't call each other's packages. Each package talks to a sidecar instead.

- **A `shared-world` sidecar** joins the compose network both Engines already share, the same pattern as `dnd-engine` and `lyrics-relay`. It isn't exposed through Caddy. Verify with `docker network inspect` that `marinara` and `marinara-wife` are both on it.
- **It holds shared games:** players, the current merged state per key and record, an append-only change log with a server `seq`, and attribution.
- **Endpoints:**
  - `GET /games`, `POST /games`, `POST /games/:id/players`
  - `GET /games/:id/state`
  - `GET /games/:id/log?since=<seq>`, `POST /games/:id/changes`
- **Storage** is one SQLite or JSONL file on the sidecar's own volume, so no Engine volume changes.
- **Auth:** a bearer token per player, set in package settings.
- **Permissions:** the manifest adds `network`. That's a permission change, which `AGENTS.md` treats as security-sensitive, so it needs validation notes.
- **Deploy:** add the service and start it with `--no-deps`, which doesn't recreate either Engine. Installing the package on `marinara-wife` still needs an Engine restart. That restart needs explicit consent, after checking its logs for recent play.
- **ponytail:** the sidecar trusts the docker network plus a bearer token, so its ceiling is same-host players. The upgrade path is Caddy with TLS, with no API change.

## What carries over from v0.1

- **Kept:** the store and its revision-checked writes, the players list, link and unlink, the Home tab, the sync queue, `withChatLock` writes, and the prompt-context trigger.
- **Next Session:** `sharedWorld` survives it, because the new session's metadata spreads every unlisted key (`...carryMeta`, `game.routes.ts` ~7932). The link's `since` message id won't exist in the new chat. Linking is by `gameId`, and a missing `since` means "from the start of this chat".
- **Replaced:** `world.mjs` (world-ledger tags) becomes `merge.mjs`. `gameLedgerForeign` and `gameWorldDayFloor` go away.
- **Fixed in passing:** v0.1 accepted chats with no world, silently. v1 validates against Classic game keys.

## Phase 0 findings (2026-10-18, from a read-only dump of Fallout Duo)

These change the design above:

- **No dead field.** `GameNpc` has no alive/dead flag (`id, name, emoji, description, descriptionSource, gender, pronouns, location, reputation, notes[], avatarUrl, worldId?, role?`). A death lives in description and notes, so "dead stays dead" is just add-only notes. The sticky field is the map node's `discovered`.
- **Notes are split.** Reputation-log notes (`[action] reputation +N → R (tier)` and `🏛️ Milestone: …`) stay per player, like `reputation`. Every other note is shared, as a union.
- **Story arc and plot twists stay per player.** Two GMs steering one arc fight each other. The world overview is shared, last writer wins.
- **`spatialContext` is not shared.** Its revision is tied to the Engine's snapshot rows. A shared `spatialLocationId` that the chat's own `spatialContext` doesn't know is dropped or kept as the chat's own.
- **Maps:** `gameMap` is the active map and overrides its `gameMaps` entry. Node ids are label slugs, and edges are undirected. Only node maps are shared; grid maps stay per chat.
- **`sharedWorld` carries over on Next Session.** `carryMeta` copies it into the new session chat, which has the same `groupId`. The base is keyed by local game id, and only the newest session chat of a game syncs.
- **Missing records come back.** The design said a locally missing record is not re-added. The build re-adds it from the hub, because a stale Engine write or a swipe loses records far more often than a hand edit does. Hand deletion doesn't stick (a known limit).
- **The regression guard** stores, per field, the hash Shared World wrote and the hash it replaced. A chat that writes back the replaced value is treated as stale: re-applied, not pushed.
- **Join seeds.** The first linked chat seeds the hub. A later chat that links with a non-empty hub takes on the hub's cast, maps, items and overview, with its own reputation reset, and its party starts at the first party's start position. Link right after setup, before the first turn.
- **Name matching** applies only to new records against hub records nobody in this chat has claimed: maps by name, then nodes by label within a matched map, then NPCs by name. A match is kept in a per-chat alias map, so local ids never change.
- **News delivery:** the prompt contributor returns the other parties' changes since this chat's last delivery. It holds them for the whole turn (the latest user message), so swipes see them too, and drops them on the next user message.
- **Sync timing:** after each generation's prompt is built (in the background) and every 60 s.

## Phases

**Phase 0: checks (done, by reading code).** See *The two checks*. Still to read before Phase 1:
- The real shape of `gameMaps` / `gameMap` and their node ids, and whether a GM map rewrite keeps ids.
- The fields of `gameInventedItems`.

Read both from a scratch dump of Fallout Duo's metadata. No generation needed.

**Phase 1: one Engine, two chats, package storage as the hub.** No sidecar and no network.
- Two Classic chats on `marinara`, linked to one shared game, with play on flash (cost stated first).
- Proves the merge, add-only, sticky facts, the regression guard, join seeding, name matching and the news text.
- Unit tests in `fork/packages/shared-world/tests/`:
  - three-way merge per record and field
  - add-only, both ways
  - sticky dead and discovered
  - stale regression re-applied, not pushed
  - reputation never pushed
  - join seed rewrites ids
  - name match adopts the shared id
  - the base survives a chat-id change (Next Session)
  - news emitted once, then cleared

Phase 1 also decides whether Phase 2 is needed. Check how *Join* by branch handles per-player keys, two generations running at once, and the shared subscription quota.

**Phase 2 (only if needed): sidecar, two instances.** The `shared-world` container, the `network` permission, tokens and `seq` pulls. Deploy to `marinara` first; `marinara-wife` only with consent.

**Phase 3: polish.** Chronicle feed cards, NPC avatars carried across instances (bytes through the sidecar, saved into package storage, served by the package route), and per-game settings for what's shared.

**Later, if play asks for it:** a shared calendar floor and shared lorebook writes (each an Engine seam, so weigh them against *engine-fork-minimal*), and a "before turn" hook to remove the one-turn lag.

## Validation

- Package unit tests (above) and the fork builder: build, entrypoint syntax, tests, then a catalog rebuild. Never hand-edit bundles or catalogs.
- Engine: none expected. If a seam turns out to be needed, it's one commit with its own regression test.
- Play test: two flash chats for an hour.
  - Check that NPCs and places cross over, dead stays dead, and the news reads well.
  - Check that a party-turn reputation write and a session end don't spread deletions.

## Tune in playtest

- Shared vs per-thread campaign plan and story arc.
- How often to pull (timer interval).
- Whether the one-turn lag is noticeable.
- How news reads, and how much of it is too much.
