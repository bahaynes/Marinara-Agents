# Aside

Per-chat **Notes** and a `/btw`-style **side chat** with the narrator, for Roleplay and Game chats.

- **Notes**: add, edit, pin and delete notes for the chat. Pinned notes are shown to the narrator in side-chat questions.
- **Show to narrator**: a note switched on with the speech-bubble button becomes an author's note in every story turn (an `<author_notes>` block injected before the latest message, so the cached prompt prefix is untouched). Use it for per-chat continuity rules. Only chats with Aside added as an agent get it.
- **Side chat**: ask the narrator a question out of character. It runs the chat's real prompt through the Engine's dry run (so the main chat's cache, lorebooks and persona apply), with your question as a temporary last message; pinned notes and earlier asides are included. The question and answer stay in the side thread; nothing is written to the story.
- **Save as note**: turn any side-chat answer into a note.

Add Aside in Chat Settings → Agents, then open it from the toolbar button (or the tracker panel).

Settings (side-thread turns kept, connection override) are configurable in the Aside tab; the defaults are starting points, not limits.

Not yet: sending an answer to the story as a steer.
