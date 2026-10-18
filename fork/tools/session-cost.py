#!/usr/bin/env python3
"""Where a Claude Code session's tokens went, from its transcript.

Usage: python3 -I fork/tools/session-cost.py [transcript.jsonl ...]   (default: this repo's 10 newest sessions)

Weights are relative input-price units with the 1 h cache: read 0.1, write 2, output 5 (uncached input 1).
"idle" counts the writes made by the first request after a gap of more than an hour (the cache had expired).
"""
import datetime, glob, json, os, sys

def report(path):
    seen, n, r, w, o, idle, compacts, prev = set(), 0, 0, 0, 0, 0, 0, None
    for line in open(path, errors="ignore"):
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if e.get("isCompactSummary") or (e.get("type") == "system" and e.get("subtype") == "compact_boundary"):
            compacts += 1
        m = e.get("message") or {}
        u = m.get("usage")
        if e.get("type") != "assistant" or not u or m.get("id") in seen:
            continue
        seen.add(m.get("id"))
        n += 1
        cw = u.get("cache_creation_input_tokens", 0)
        r += u.get("cache_read_input_tokens", 0) + u.get("input_tokens", 0) * 10
        w += cw
        o += u.get("output_tokens", 0)
        t = datetime.datetime.fromisoformat(e["timestamp"].replace("Z", "+00:00"))
        if prev and (t - prev).total_seconds() > 3600:
            idle += cw
        prev = t
    if not n:
        return
    cost = r * 0.1 + w * 2 + o * 5
    pct = lambda x: f"{100 * x / cost:.0f}%"
    print(f"{os.path.basename(path)[:8]}  {n:4d} req  avg ctx {r // n // 1000:4d}k  "
          f"reads {pct(r * 0.1):>4}  writes {pct(w * 2):>4} (idle {pct(idle * 2):>4})  output {pct(o * 5):>4}  "
          f"compactions {compacts}  units {cost / 1e6:.1f}M")

paths = sys.argv[1:] or sorted(glob.glob(os.path.expanduser("~/.claude/projects/-home-bah-git-marinara-agents/*.jsonl")),
                               key=os.path.getmtime)[-10:]
for p in paths:
    report(p)
