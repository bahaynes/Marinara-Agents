# What context costs

Notes for agents (and the humans paying for them) working on the fork. Measure a session with
`python3 -I fork/tools/session-cost.py`.

## The model

Every request re-sends the whole conversation. With the prompt cache, the price of that resend depends on
whether the cache is warm. In rough input-price units (1 h cache):

| What        | Price | Notes                                                            |
| ----------- | ----- | ---------------------------------------------------------------- |
| Cache read  | 0.1   | Every request reads the whole context so far.                    |
| Cache write | 2     | New content is written once. A cold cache rewrites _everything_. |
| Output      | 5     | Your replies, tool inputs, compaction summaries.                 |

The cache lives about 1 h after the last request. A message after a longer gap rewrites the whole context:
a 300k context goes from ~30k units (warm) to ~600k units (cold), so one cold resume costs about 20 warm turns.

Measured on this repo (2026-09/10, 20 sessions): cache hits were ~98%. Most of the cost was cache _reads_:
request count × context size. About 45k of every request is the fixed prefix (system prompt, tools, AGENTS.md,
memory, skills), so 600 requests read 27M tokens before any work. In most long sessions, 60–85% of all cache
writes came from the first request after a gap of more than an hour.

## What to do

1. **Fewer round trips.** Each tool call is a full-context read. Chain dependent steps in one shell call, and
   put independent calls in one turn. Use the one-call scripts in `fork/tools/`:
   - `fork/tools/check.sh [log-dir]`: build the catalog plus every gate. Prints one line per stage.
   - `fork/tools/install.sh <id>`: install a pushed package on `marinara`, retry the GitHub cache lag, and
     restart unless someone played in the last 10 min.
2. **Keep tool output small.** Every byte you read is re-read on every later request until compaction.
   - Read slices (`sed -n 120,180p`, `grep -n`), not whole files. Never `cat` a long plan, log or transcript.
   - Send long output to a log file and print only a summary or grep of it.
   - Screenshots cost 100–400k characters each. Use them sparingly: check the DOM or app state with a
     script first (Playwright `evaluate`, the API, a read-only `python3 -I` of the storage), and take a
     screenshot only for what is really visual. Read each one once.
   - For a broad search where you need only the answer, use a subagent. Its reads stay out of this context.
3. **Look things up instead of re-exploring.** `fork/docs/engine-map.md` lists the Engine routes and seams
   the fork packages use. Add to it when you find a new one.
4. **Session lifecycle.**
   - One feature per session. The plan doc in `plan/` and memory carry state between sessions.
   - Before the human steps away for more than an hour, update the plan doc so the next session can start
     from `/clear` rather than a cold resume.
   - Self-scheduled wakeups should come back within ~55 min, or be planned as a fresh session.
   - Auto-compact: each compaction summarizes the full context (output-priced) and rewrites the result. A low
     threshold compacts often; a high one makes every request read more. The cost is roughly flat from about
     100k to 250k. The real levers are request count and output size, not the threshold.
5. **Batch fixes.** One version bump, build, install and restart per round of fixes, not per fix.
6. **Advisor and review calls** forward the whole transcript. Save them for decisions that need them.

## Seeing it live

`fork/tools/cache-status.py` shows context size and cache age: as a status line, a manual check (run it with no input), or a `UserPromptSubmit` hook that blocks the first prompt sent to a cold cache. It warns when the cache has gone
cold, so you can `/clear` instead of resuming. See its header for the settings line.
