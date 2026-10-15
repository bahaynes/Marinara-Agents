# Call Sheet

Scene-by-scene story play for Roleplay chats. Design: `plan/call-sheet.md`.

The Engine still writes every reply and impersonate. Call Sheet keeps a per-chat sheet and adds it to
each turn's system prompt:

- the story (premise and goals, edited by the player);
- a frozen summary of every finished scene;
- the current scene plan: location, who is present, what the scene is for, facts in play.

## Play

1. Add the **Call Sheet** agent in Chat Settings → Agents, then open the Tracker Panel.
2. **Plan scene**, with an optional direction ("a few hours later, everyone meets to debrief"). The
   chat's main model proposes the scene.
3. Edit any field, **Reroll** for another version (earlier versions stay selectable), or **Accept**.
   Accepting hides every earlier message from the AI (they stay visible); the summaries stand in.
4. Play the scene. Turn instructions are the Engine's impersonate: type what the persona does and
   press Impersonate, then send.
5. **End scene & plan next** when you decide the scene is over. The agent model summarizes the scene
   once (and marks its goals met, failed or open), then the main model proposes the next one.

## Models

- Scene planner: the chat's own connection (main).
- Scene summarizer: the connection set on the Call Sheet agent, else the default agent connection.

## Tests

```bash
node --test fork/packages/call-sheet/tests/*.test.mjs
```
