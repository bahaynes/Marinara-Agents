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
  python3 -I cache-status.py --rewake    Stop hook with "asyncRewake": true and "timeout": 3600: ~8 min before an
                                         idle session's cache expires, wakes the model once to write a handoff
                                         note. CLAUDE_REWAKE_AFTER_MIN overrides the idle minutes (for testing).
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


def state(info, kind):
    return os.path.join(tempfile.gettempdir(), f"claude-{kind}-{info.get('session_id', 'x')}")


def handoff_path(info):
    return os.path.expanduser(f"~/.claude/handoffs/{os.path.basename(info.get('cwd') or os.getcwd())}.md")


def rewake(info):
    """Stop hook (asyncRewake): shortly before the cache expires on an idle session, wake the model once to
    write a handoff note. One sleeper per session; fires at most once per real user prompt."""
    import signal, time
    pidf = state(info, "rewake-pid")
    try:
        old = int(open(pidf).read())
        if b"--rewake" in open(f"/proc/{old}/cmdline", "rb").read():  # never a recycled pid
            os.kill(old, signal.SIGTERM)  # a newer turn supersedes the old sleeper
    except (OSError, ValueError):
        pass
    with open(pidf, "w") as f:
        f.write(str(os.getpid()))
    after = float(os.environ.get("CLAUDE_REWAKE_AFTER_MIN", TTL_MIN - 8))
    found = last_usage(info["transcript_path"])
    if not found or found[0] < MIN_CONTEXT:
        return 0
    time.sleep(max(0, (after - found[1]) * 60))
    found = last_usage(info["transcript_path"])
    if not found or found[1] < after or found[1] >= TTL_MIN:
        return 0  # a newer turn happened (its own sleeper takes over), or the cache is already gone
    fired, prompted = state(info, "rewake-fired"), state(info, "prompted")
    if os.path.exists(fired) and (not os.path.exists(prompted) or os.path.getmtime(fired) >= os.path.getmtime(prompted)):
        return 0  # already woke since the last real prompt: don't keep the cache warm all night
    open(fired, "w").close()
    print(f"Prompt cache expires in ~{TTL_MIN - found[1]:.0f} min and Ben is away. If this session has unfinished "
          f"multi-step work, update {handoff_path(info)} (done with commit SHAs, in progress, exact next "
          "step, open questions; under 30 lines). If nothing is unfinished, reply only 'No handoff needed.' "
          "Start no new work.", file=sys.stderr)
    return 2  # asyncRewake: exit 2 wakes the model with stderr


def hook(info):
    try:  # the rewake's own wake-up also fires UserPromptSubmit: only a later, real prompt re-arms it
        woke = datetime.datetime.now().timestamp() - os.path.getmtime(state(info, "rewake-fired")) < 60
    except OSError:
        woke = False
    if not woke:
        open(state(info, "prompted"), "w").close()
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
    hint = ""
    try:
        at = datetime.datetime.fromtimestamp(os.path.getmtime(handoff_path(info)))
        hint = f" Handoff written {at:%H:%M}: /clear, then ask to resume from {handoff_path(info)}."
    except OSError:
        pass
    print(describe(*found) + f". Prompt not sent: press up-arrow and send it again within {CONFIRM_MIN} min to go ahead, or /clear."
          + hint, file=sys.stderr)
    return 2  # UserPromptSubmit: exit 2 blocks this prompt and shows stderr to the user


def newest_for_cwd():
    slug = os.getcwd().replace("/", "-").replace(".", "-")
    paths = glob.glob(os.path.expanduser(f"~/.claude/projects/{slug}/*.jsonl"))
    return max(paths, key=os.path.getmtime) if paths else None


if "--hook" in sys.argv or "--rewake" in sys.argv:
    try:
        sys.exit((rewake if "--rewake" in sys.argv else hook)(json.load(sys.stdin)))
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
