# Shared World — synchronous scenes — plan

Extends `plan/shared-world.md`. Shared World is asynchronous: each player plays their own Classic Game mode chat, and the other party's changes arrive as news on the next turn. This adds an opt-in **synchronous scene**: a pop-up over each player's own Game chat where both players act in the same round, and one narration lands in both chats.

## Why

The upstream multiplayer rooms were rejected (`shared-world.md`: "one host-owned chat, the model doesn't answer both players, synchronous, not fun"). The play that went badly had two causes:

- **No communication.** Each player typed alone and hoped the model reconciled them.
- **Hard to read.** Several players' text and narration in one stream, with nothing marking who is who.

## Design

The progression the maintainer wants: **1 staggered turns → 2 meeting detection → 4 shared scene.** 1 already works.

- **Stage 1: staggered turns (done).** News arrives on the next turn.
- **Stage 2: meeting detection.** When the shared character records put both parties at the same place, each GM gets a prompt line saying the other party's characters are here, and the page offers **Go synchronous**. Needs a look at what the news text says today, and a rule for "same place" (shared map node id).
- **Stage 4: the scene.**
  - Both players press **Go synchronous**. A pop-up mounts over each player's own chat.
  - **Rounds wait for both players.** Each player writes their own character's action (impersonation is the point) and submits. Nothing resolves until both have. A player can submit "play my character" for the round, but there is no timeout.
  - **One neutral narration call per round** (not either player's GM) sees both actions, the shared world state and both parties' recent context, and writes one response.
  - The response is appended to **both** chats as ordinary messages, labelled per character. Closing the pop-up ends the scene.
  - **Private until resolved.** A player's submitted action is not shown to the other until the round resolves.
  - **Readability lives in the pop-up:** a colour and name label per character, narration visually separate, the out-of-character side channel in its own strip.
  - **Hand-off:** both histories already contain the scene, so each GM knows it. The scene's changes (new places, characters, items) go through the normal merge.

## What the Engine gives us (checked 2026-10-18, `capability-package.schema.ts`)

- **Slots:** `game-surface` ("mounts the package's own game UI over the narration") and `chat-runtime` look like the fit for the pop-up. The current manifest only declares `home-browser-tab`. `pixelforge` already uses `game-surface`, so there is a working example to read.
- **Permissions:** `chat-read`, `chat-write`, `prompt-context`, `routes`, `storage`, `ui` are held today. `agent-runtime` and `scenes` exist and may be what a package-owned model call needs. Not verified.
- No Engine change is known to be needed. If the pop-up cannot be mounted from the package, that is the one thing that would need an Engine commit, and the fork stays minimal (memory: *engine-fork-minimal*).

## Open questions (each answered by reading code)

1. Can a package make a model call, and under which permission and connection? (`agent-runtime`, `scenes`.) Tested on NanoGPT or local llama.cpp, not Claude or Agy.
2. How does a package append a message to a chat without breaking the Engine's state (swipes, branches, the world snapshot)? What does `chat-write` allow?
3. What `game-surface` props does a package get (chat id, metadata, a way to close)? Does the surface mount over the narration only when the package asks, or always?
4. Both players are on one instance with one login, so the two players are two browser tabs or devices. Round state therefore lives in package storage, with polling or the existing minute sync made faster during a scene.
5. Does a GM's own context hold the scene afterwards, or do we also write a summary message? (Writing the messages should be enough.)
6. Which messages count as "the scene" for swipes and branches?

## Phase A findings (2026-10-18, read-only)

- **Model call: yes.** The server runtime has `languageModels.resolveForRequest({ connectionId, chatConnectionId }).chatComplete(messages, options)` (`capability-runtime.ts`). `relationship-tracker`, `memory-nag` and `quartermaster` already use it. The permission that gates it is likely `agent-runtime` (held by `beholder`, `2d-avatars`); not confirmed. Shared World holds `chat-read`, `chat-write`, `prompt-context`, `routes`, `storage`, `ui`.
- **Append to both chats: yes.** `persistence.createMessageWithSwipe({ id, swipeId, chatId, role, characterId, content, extra, createdAt })` plus `updateChatActivity`. Both under `chat-write`. Still to check: how an appended message interacts with swipes, branches and the world snapshot.
- **The pop-up is the one real problem.** `game-surface` is not an overlay. It is an Experience, chosen when the game is created and fixed for its life (`GameSurface.tsx` ~2340), and it replaces the HUD. A Classic game has no free slot for a package to mount into. The only precedent is the fork's own hidden `CapabilityElement` for `hierarchical-maps` (`view="setup-apply"`, hard-coded `packageId`, ~12261).
- **Options for the surface:**
  1. **Engine hook (smallest honest one):** a single `CapabilityElement` mount in Classic `GameSurface.tsx` for a package-declared view, e.g. `view="scene"`, plus the props the pop-up needs (`chatId`, `chatMeta`, `messages`, `narrationDone`). One minimal Engine commit, per the fork rule.
  2. **No Engine change:** run the scene from the Shared World page (`home-browser-tab`) in a second tab or window, with both chats updating underneath. Worse to play, and it costs nothing to try first.
- **Recommendation:** build the scene on option 2 first (Phases B and C do not depend on the surface), and add option 1 only if the scene proves fun.

## Phases

- **Phase A: read-only checks.** Questions 1 to 3. Read `pixelforge`'s `game-surface` code and the Engine's surface and message-append paths. Output: what is possible, in one page. Cost: reading only.
- **Phase B: stage 2.** Meeting detection and the **Go synchronous** button, with the prompt line. Unit tests in `fork/packages/shared-world/tests/`. Cheap, and it is useful alone.
- **Phase C: scene prototype.** One round, two tabs, a local model. Pop-up with colour labels, hidden-until-resolved actions, neutral narration, append to both chats. Tests for the round state machine (both submitted, one missing, double submit, close mid-round).
- **Phase D: play test.** A real scene on the NanoGPT subscription, then judge whether it is fun and readable. Claude or Agy play stays a decision for the maintainer.

## Risks

- A scene that appends to two chats can leave them out of step with the Engine if a player branches or swipes during it. Phase A decides how to guard that.
- Quota: the neutral call is one more generation per round on top of each player's own.
- Spoilers between threads remain on the honor system, except that hidden actions inside a round are enforced.

## Decided (2026-10-18)

- Rounds wait for both players.
- The narration call is neutral and shared.
- The scene is a pop-up in classic Game mode, with no new room or chat.
