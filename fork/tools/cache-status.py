#!/usr/bin/env python3
"""Claude Code status line: context size and prompt-cache age, so a cold resume is visible before you send it.

The prompt cache lives ~1 h after the last request. Past that, the next message re-writes the whole context at
about 2x input price instead of reading it at about 0.1x: a 300k context costs ~20x more than a warm turn. When
the line says COLD, /clear (with a handoff note in plan/) is usually cheaper than resuming or compacting.

Enable in ~/.claude/settings.json:
  "statusLine": {"type": "command", "command": "python3 -I /home/bah/git/marinara-agents/fork/tools/cache-status.py"}
"""
import datetime, json, os, sys

TTL_MIN = 60

def last_usage(path):
    # Read only the tail: transcripts reach tens of MB and the status line runs often.
    with open(path, "rb") as f:
        f.seek(max(0, os.path.getsize(path) - 400_000))
        lines = f.read().decode(errors="ignore").splitlines()
    for line in reversed(lines):
        try:
            o = json.loads(line)
        except ValueError:
            continue
        u = (o.get("message") or {}).get("usage")
        if o.get("type") == "assistant" and u:
            ctx = u.get("input_tokens", 0) + u.get("cache_read_input_tokens", 0) + u.get("cache_creation_input_tokens", 0)
            if ctx:  # synthetic entries (errors, interrupts) carry zero usage
                return ctx, datetime.datetime.fromisoformat(o["timestamp"].replace("Z", "+00:00"))
    return None

try:
    info = json.load(sys.stdin)
    found = last_usage(info["transcript_path"])
except Exception:
    found = None
if not found:
    print("ctx — · cache —")
    sys.exit()
ctx, at = found
age = (datetime.datetime.now(datetime.timezone.utc) - at).total_seconds() / 60
k = f"{ctx // 1000}k"
if age < TTL_MIN - 10:
    print(f"ctx {k} · cache warm {age:.0f}m")
elif age < TTL_MIN:
    print(f"ctx {k} · cache expires in {TTL_MIN - age:.0f}m")
else:
    print(f"ctx {k} · cache COLD {age:.0f}m: next message re-writes {k}, ~20 warm turns' worth — consider /clear")
