# Shared World

Regular Game mode, with one world shared between parties. Each player runs their own Game mode chat;
what one party does to the world shows up in everyone else's. Design: `plan/shared-world.md`.

Needs the fork Engine (`custom-mods`) with the shared-world seam: it reads `gameLedgerForeign` (other
parties' deeds, as news and done world state) and `gameWorldDayFloor` (the shared calendar) from chat
metadata. On a stock Engine the package installs, but linked chats do not see anything.

## Opt in

1. Open **Home → Shared World** and create a shared game (e.g. "Fallout: New Vegas"). **Days per real
   day** sets the calendar: 1 means one in-world day passes per real day.
2. Add the players.
3. Under **Game chats**, pick a player for a Game mode chat and **Link** it. Any game chat can join,
   new or in progress.

That is all. Play as usual.

## What is shared

- A Game Master reply's answered `[world: …]` tags (`result="ok"`): deeds, facts and events. Time and
  holds stay with their author; the reader's calendar is the shared one.
- A reply publishes once it is settled: you answered it, or the session concluded. Swiping, editing or
  deleting a published reply retracts it.
- When two parties act on the same place, group or fact, your own later deed holds in your chat.
- The calendar floor follows real time and never moves back. A chat's own days can run ahead of it.

Sync runs in the background whenever a linked chat generates, so new deeds land on the next turn.
**Sync now** on the game page runs it straight away.

## Unlink

**Unlink** removes the other parties' deeds from that chat. It keeps the day floor, so the chat's
calendar never runs backwards.

## Limits

- Phase 1 is one Marinara instance: every player's chats live on the same server. Play across
  instances comes in Phase 2.
- The Engine sometimes rewrites a chat's whole metadata; the shared keys can drop until the next sync
  restores them.
