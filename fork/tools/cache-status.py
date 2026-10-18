#!/usr/bin/env python3
"""Prompt-cache age and context size, so a cold resume is visible before you send it.

The prompt cache lives ~1 h after the last request. Past that, the next message re-writes the whole context at
about 2x input price instead of reading it at about 0.1x: a 300k context costs ~20x more than a warm turn. When
it says COLD, /clear (with a handoff note in plan/) is usually cheaper than resuming or compacting.

Three modes:
  python3 -I cache-status.py            manual check: the newest session for the current directory
  (status line, JSON on stdin)           "statusLine": {"type": "command", "command": "python3 -I <this file>"}
  python3 -I cache-status.py --hook      UserPromptSubmit hook: blocks the first prompt sent to a cold cache.
                                         Send it again within 10 min to go ahead (up-arrow recalls it).
The status line only redraws when the conversation changes, so after a break it can still read "warm".
"""
import datetime, glob, json, os, sys, tempfile

TTL_MIN = 60
CONFIRM_MIN = 10
MIN_CONTEXT = 60_000  # below this a rewrite is cheap; don't nag


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
                at = datetime.datetime.fromisoformat(o["timestamp"].replace("Z", "+00:00"))
                return ctx, (datetime.datetime.now(datetime.timezone.utc) - at).total_seconds() / 60
    return None


def describe(ctx, age):
    k = f"{ctx // 1000}k"
    if age < TTL_MIN - 10:
        return f"ctx {k} · cache warm {age:.0f}m"
    if age < TTL_MIN:
        return f"ctx {k} · cache expires in {TTL_MIN - age:.0f}m"
    return f"ctx {k} · cache COLD {age:.0f}m: next message re-writes {k}, ~20 warm turns' worth — consider /clear"


def hook(info):
    found = last_usage(info["transcript_path"])
    if not found or found[1] < TTL_MIN or found[0] < MIN_CONTEXT:
        return 0
    mark = os.path.join(tempfile.gettempdir(), f"claude-cold-ack-{info.get('session_id', 'x')}")
    try:
        if (datetime.datetime.now().timestamp() - os.path.getmtime(mark)) / 60 < CONFIRM_MIN:
            return 0
    except OSError:
        pass
    open(mark, "w").close()
    print(describe(*found) + f". Prompt not sent: press up-arrow and send it again within {CONFIRM_MIN} min to go ahead, or /clear.",
          file=sys.stderr)
    return 2  # UserPromptSubmit: exit 2 blocks this prompt and shows stderr to the user


def newest_for_cwd():
    slug = os.getcwd().replace("/", "-").replace(".", "-")
    paths = glob.glob(os.path.expanduser(f"~/.claude/projects/{slug}/*.jsonl"))
    return max(paths, key=os.path.getmtime) if paths else None


if "--hook" in sys.argv:
    try:
        sys.exit(hook(json.load(sys.stdin)))
    except SystemExit:
        raise
    except Exception:
        sys.exit(0)  # never block a prompt because this script broke

if sys.stdin.isatty():
    path = newest_for_cwd()
    found = path and last_usage(path)
    print(f"{os.path.basename(path)[:8]}  {describe(*found)}" if found else "no session with usage for this directory")
    sys.exit()

try:
    found = last_usage(json.load(sys.stdin)["transcript_path"])
except Exception:
    found = None
print(describe(*found) if found else "ctx — · cache —")
