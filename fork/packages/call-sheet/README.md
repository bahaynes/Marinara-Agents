# Call Sheet

Scene-by-scene story play on its own Home page. Design: `plan/call-sheet.md`.

Call Sheet builds every prompt itself, so no chat preset, memory agent or lorebook applies. It reads
the Engine's character and persona library for the cast and stores its own stories.

## Play

1. Open **Home → Call Sheet** and create a story: who you play, the cast, the premise and story goals.
2. **Plan scene**, with an optional direction ("a few hours later, everyone meets to debrief"). The
   main model proposes the scene: where, who is present, what it is for, facts in play.
3. Edit any field, use the **quick-toggle cast chips** to bring characters in or out, **Reroll** for
   another version (earlier versions and your edits stay selectable), or **Accept & start**. The
   opening is written straight away.
4. Play. **Act** (`Ctrl+Enter`) turns a short note ("asks the keeper about the road") into your
   character's turn, then the story answers. **Send as written** (`Shift+Ctrl+Enter`) uses your text
   as is. **Continue** lets the story go on, and **Stop** (`Esc`) cancels an in-flight stream without
   losing an already-written player turn. The newest turn can be rerolled; any turn in the open scene
   can be edited (`Ctrl+Enter` to save) or deleted.
5. **End scene & plan next** when you decide the scene is over. The agent model writes a frozen
   summary (and marks each scene goal met, failed or open), and you can rate the finished scene 1–5
   stars; the frozen summary replaces the scene in later prompts.

## Workspace & Settings

- **Top Scene HUD**: shows the active scene title, location, present cast badges (with character card
  avatars and colors), goal count, live prompt-cache read share / token-equivalents, and the
  **Scene Sheet** drawer toggle.
- **Composer bar**: model connection pill, turn length pill, and **Review: On/Off** pill ("Review my
  turn before the story answers"), plus **Stories ▾** and **Settings** in the header.
- **Settings drawer**: title, story ID & `mari` CLI query helper, story model, scene-summary model,
  turn length, review toggle, premise, story goals, and delete.

The page uses Marinara's own look: theme colors, the package-safelisted classes, `mari-chrome-control`
buttons and the Roleplay message shapes (narrator bubble with speaking character avatar chips, persona
with avatar). Text size, text color and bold dialogue follow the player's Roleplay settings; dialogue
takes each character's card dialogue color through `<speaker="Name">` tags, the Engine's group-chat
convention.

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
