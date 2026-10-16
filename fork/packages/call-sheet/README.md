# Call Sheet

Scene-by-scene story play on its own Home page. Design: `plan/call-sheet.md`.

Call Sheet builds every prompt itself, so no chat preset, memory agent or lorebook applies. It reads
the Engine's character and persona library for the cast and stores its own stories.

## Play

1. Open **Home → Call Sheet** and create a story: who you play, the cast, the premise and story goals.
2. **Plan scene**, with an optional direction ("a few hours later, everyone meets to debrief"). The
   main model proposes the scene: where, who is present, what it is for, facts in play.
3. Edit any field, **Reroll** for another version (earlier versions stay selectable), or **Accept**.
   The opening is written straight away.
4. Play. **Act** turns a short note ("asks the keeper about the road") into your character's turn,
   then the story answers. **Send as written** uses your text as is. **Continue** lets the story go on.
   The newest turn can be rerolled; any turn in the open scene can be edited or deleted.
5. **End scene & plan next** when you decide the scene is over. The agent model writes a frozen
   summary (and marks each scene goal met, failed or open); it replaces the scene in later prompts.

## Settings

**Settings** in the header:

- Story: title, story model (also in the chat box), scene-summary model, turn length (short, medium,
  long: the narrator's length rule and token budget), and "Review my turn before the story answers"
  (Act writes only your turn; Continue asks for the reply). Premise, story goals, delete.
- Display, saved in this browser: text size, reading width, a box per turn, dialogue highlighting.

## Prompt layout

Every scene job sends: the fixed head (rules, cast cards, persona, story), the frozen summaries, the
current scene plan, the scene's turns, then the job's own ending. Only the newest turn and the ending
change from one request to the next, and scene turns ask for the one-hour prompt cache.

## Models

- Narrator, your turns and the scene planner: the default main connection.
- Scene summarizer: the default agent connection, falling back to main if it fails.

## Engine support

Streaming and the prompt-cache request need the `custom-mods` Engine change "prompt caching and
streaming for package model calls". On an Engine without it, replies arrive whole and caching follows
the provider's defaults; everything else works.

## Tests

```bash
node --test fork/packages/call-sheet/tests/*.test.mjs
```
