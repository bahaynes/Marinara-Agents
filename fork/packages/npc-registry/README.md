# NPC Registry

The names and pronouns already used in a story, so the story model never invents a
duplicate NPC or flips someone's pronouns. Descriptions and history are out of scope:
Lorebook Keeper entries hold them and fire by keyword.

- **Extractor agent** (post-processing): reads each reply and emits operations
  (`create`, `set` name/gender, `add`/`retract` alias, `merge`). Most turns emit nothing.
- **Roster** in the system prompt: established NPCs as `Name (pronouns)`, in creation
  order, so it changes (and breaks the prompt cache) only when an NPC is created,
  renamed or given pronouns. It also covers models or modes that cannot call the tool.
- **`npc_registry_lookup` tool**: checks a `name` against the roster and returns the
  established NPC or names that are too similar (same name, near-identical spelling,
  a shared name token).

## Graph model

Nodes are NPCs. Facts (name, gender, alias, same_as) are append-only assertions `{s, p, o, a: {m, w}, sup}`:
a change is a new assertion that supersedes older ones, a retraction is a tombstone,
a merge is a `same_as` assertion. Each assertion is anchored to the message and
swipe that produced it; reads keep only assertions whose message exists and whose
active swipe matches. Swiping, regenerating or deleting a message therefore hides
its facts without editing anything, and swiping back restores them.

An assertion with no anchor is a manual correction (written into the graph document
by hand): it is always valid, and the extractor never supersedes it.

Graphs written by 0.1.x also hold role, trait, deed, location and relation facts. They
stay in the document but are ignored.

A chat branch starts with its parent's graph, anchors remapped onto the copied
messages.

## Setup

Install from the fork catalog, then add **NPC Registry** under Chat Settings →
Agents → Tracker Agents (Roleplay or Game). The tool needs a provider with native
tool calling. In Game mode with dice, the model gets a single tool round, so the
roster is the main guard there.

To fill the registry for a chat that predates it, run the extractor over its past
replies (oldest first, one Agent call per reply; it waits while the chat is
generating and stops if a new message arrives):

```bash
docker exec -i marinara node - <chatId> [--from N] [--limit N] [--dry] < fork/tools/npc-registry-backfill.mjs
```

## Tests

```bash
node --test fork/packages/npc-registry/tests/*.test.mjs
```
