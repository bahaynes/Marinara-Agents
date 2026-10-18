# Shared World

Two (or more) independent Game mode chats in one world. Each player has their own chat and plays it at
their own pace; the world between them stays in sync. Design: `plan/shared-world.md`.

Works on a stock Marinara Engine: it reads and writes the Game mode keys in chat metadata.

## Opt in

1. Open **Home → Shared World** and create a shared game (e.g. "Fallout: New Vegas").
2. Add the players.
3. Under **Game chats**, pick a player for a Game mode chat and **Link** it. Link right after the game's
   setup, before the first turn. The first chat linked seeds the world; a chat linked later joins it:
   its cast, maps and invented items become the shared ones and its party starts where the first party
   started.

That is all. Play as usual. Next Session keeps the link.

## What is shared

| Shared                                                            | Each player's own                           |
| ----------------------------------------------------------------- | ------------------------------------------- |
| Characters (name, look, description, location, notes)             | Reputation and the reputation log           |
| Node maps, their places, paths and what is discovered             | Party position and the active map           |
| Invented items                                                    | Inventory, story arc, plot twists           |
| The world overview                                                | Chat history, spatial context, grid maps    |

Changes merge field by field. A discovered place stays discovered, and characters both Game Masters
created under the same name become one. Each Game Master hears the other parties' changes as news on
the next turn (swipes of that turn see it too).

When two parties stand at the same place, the game page says so and each Game Master is told the other party
is there (but not what it says or does).

## Scenes (synchronous play)

When two parties are at the same place, the game page offers **Go synchronous**. Pick who you play as and start.
Each player writes what their own character does; nobody sees the other's pending action. When everyone has
acted, one neutral narration (from the first player's chat connection) is written into every player's chat. Nobody's wording is shown afterwards, not even
their own: the narration works every action into the story, so it reads like a shared impersonation. Then the next
round opens. **Narrate again** retries a failed narration without losing the actions. **End scene**
closes it; the rounds stay in each chat's history. Players are two browser tabs on this instance: choose
"Playing as" in each. Needs the `agent-runtime` permission for the narration call.

Sync runs whenever a linked chat generates and every minute. **Sync now** on the game page runs it
straight away.

## Unlink

**Unlink** stops syncing. The chat keeps the world as it is.

## Limits

- One Marinara instance: every player's chats live on the same server.
- Records are add-only. A character deleted by hand comes back, and what a swiped-away reply added stays.
- Grid maps are not shared.
