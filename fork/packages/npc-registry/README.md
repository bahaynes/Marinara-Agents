# NPC Registry

One record per NPC, per chat, kept as a small knowledge graph.

- **Extractor agent** (post-processing): reads each reply and emits operations
  (`create`, `set`, `add`, `retract`, `relate`, `merge`), including gender
  (pronouns, shown in the roster) and short past-tense deeds (what an NPC did that later scenes should remember). It is the
  only writer.
- **`npc_registry_lookup` tool** for the story model: recall an NPC by `name`, or
  check a `proposed_name` + `concept` for name and archetype collisions before
  introducing a new character. Archetype similarity uses the agent's embedding
  connection when configured, word overlap otherwise.
- **Roster** in the system prompt: established NPC names only, in creation order,
  so it changes (and breaks the prompt cache) only when an NPC is created or renamed.
  It also covers models or modes that cannot call the tool.

## Graph model

Nodes are NPCs. Facts are append-only assertions `{s, p, o, a: {m, w}, sup}`:
a change is a new assertion that supersedes older ones, a retraction is a tombstone,
a merge is a `same_as` assertion. Each assertion is anchored to the message and
swipe that produced it; reads keep only assertions whose message exists and whose
active swipe matches. Swiping, regenerating or deleting a message therefore hides
its facts without editing anything, and swiping back restores them.

An assertion with no anchor is a manual correction (written into the graph document
by hand): it is always valid, and the extractor never supersedes it.

A chat branch starts with its parent's graph, anchors remapped onto the copied
messages.

## Setup

Install from the fork catalog, then add **NPC Registry** under Chat Settings →
Agents → Tracker Agents (Roleplay or Game). The tool needs a provider with native
tool calling. In Game mode with dice, the model gets a single tool round, so the
roster is the main guard there.

Consider telling Lorebook Keeper (in its prompt) to skip character entries in chats
that use this, so two agents do not write competing NPC facts.

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
