#!/usr/bin/env python3
"""Digest the harness journal into a friction report for /evolve.

Usage: python3 scripts/harness/journal_digest.py [--days 30]

Reads .claude/harness/journal/*.jsonl and prints a compact report:
sessions, error rates, recurring error buckets, and denial-heavy sessions.
Deterministic on purpose — the model reads this instead of raw transcripts.
"""

import argparse
import glob
import json
import os
from collections import Counter
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
JOURNAL_DIR = os.path.join(ROOT, ".claude", "harness", "journal")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=30)
    args = ap.parse_args()
    cutoff = datetime.now(timezone.utc) - timedelta(days=args.days)

    records = []
    for path in sorted(glob.glob(os.path.join(JOURNAL_DIR, "*.jsonl"))):
        with open(path, errors="replace") as fh:
            for raw in fh:
                try:
                    rec = json.loads(raw)
                    ts = datetime.fromisoformat(rec["ts"].replace("Z", "+00:00"))
                    if ts >= cutoff:
                        records.append(rec)
                except (json.JSONDecodeError, KeyError, ValueError):
                    continue

    if not records:
        print(f"No journal records in the last {args.days} days. "
              f"({JOURNAL_DIR} — the Stop hook populates this as sessions end.)")
        return

    sessions = len(records)
    turns = sum(r.get("turns", 0) for r in records)
    calls = sum(r.get("tool_calls", 0) for r in records)
    errors = sum(r.get("tool_errors", 0) for r in records)
    denials = sum(r.get("denials", 0) for r in records)

    buckets = Counter()
    for r in records:
        for e in r.get("top_errors", []):
            buckets[e] += 1

    print(f"# Harness friction report — last {args.days} days")
    print(f"sessions={sessions} turns={turns} tool_calls={calls} "
          f"tool_errors={errors} denials={denials}")
    if calls:
        print(f"error_rate={errors / calls:.1%} of tool calls")
    print()
    print("## Recurring error buckets (sessions affected)")
    for bucket, n in buckets.most_common(10):
        print(f"{n:3d}x  {bucket}")
    if not buckets:
        print("(none recorded)")
    print()
    print("## Highest-friction sessions")
    worst = sorted(records, key=lambda r: r.get("tool_errors", 0), reverse=True)[:5]
    for r in worst:
        if r.get("tool_errors", 0) == 0:
            break
        print(f"{r['ts']}  errors={r['tool_errors']} denials={r.get('denials', 0)} "
              f"turns={r['turns']}  {r.get('prompt', '')[:90]}")


if __name__ == "__main__":
    main()
