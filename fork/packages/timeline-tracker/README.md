# Timeline Tracker

Keeps a per-chat story clock and the milestones that began on it (a skill someone started, two people
meeting, a major event, a lasting condition). Each turn the story model is told how much story time has
passed and how long ago each milestone began, so nothing that started yesterday is described as lasting weeks.

- **Post-processing extractor.** After each reply, the agent reports only what the turn says: minutes passed,
  the stated date/time, and milestones that began or ended. The package keeps the totals and does all of
  the duration math; the model never adds up time.
- **Prompt context.** The timeline block goes into the next generation, beside the other per-turn
  package context (late in the prompt, so it does not break the prompt cache).
- **World State.** When World State is active, its date and time are shown as "now" and handed to the
  extractor as a reference. Elapsed durations still come from the package's own clock, since World State
  dates are free text.
- **Swipes.** Each report is anchored to its assistant message and swipe. Swiping, regenerating or deleting a
  message drops that turn's report; branches inherit the parent's timeline.
- **First run.** On a chat that is already under way, the first run estimates the story time so far from the
  history and summary.

At most 12 milestones (newest first) are shown.
