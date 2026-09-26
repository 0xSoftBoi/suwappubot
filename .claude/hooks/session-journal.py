#!/usr/bin/env python3
"""Stop hook: distill the finished session's transcript into one journal line.

This is the telemetry half of the self-improving harness (see
docs/harness/self-improving.md). Every session maintains exactly one compact
JSON record in its own shard file, .claude/harness/journal/YYYY-MM.d/<session>.jsonl,
capturing friction signals (tool errors, permission denials, retries). The
/evolve skill mines these records to decide what to fix in the harness itself.

Never blocks the session: any failure exits 0 silently.
"""

import json
import os
import re
import sys
from collections import Counter
from datetime import datetime, timezone

JOURNAL_DIR = os.path.join(
    os.environ.get("CLAUDE_PROJECT_DIR", "."), ".claude", "harness", "journal"
)
MAX_LINE_BYTES = 4000  # one record must stay compact — the digest reads many
ERROR_SNIPPET_LEN = 160


def _text_of(content):
    """Flatten a message content field (str or block list) to text."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict):
                if block.get("type") == "text":
                    parts.append(block.get("text", ""))
                elif block.get("type") == "tool_result":
                    inner = block.get("content", "")
                    parts.append(_text_of(inner))
        return "\n".join(parts)
    return ""


def main():
    payload = json.load(sys.stdin)
    transcript_path = payload.get("transcript_path", "")
    if not transcript_path or not os.path.exists(transcript_path):
        return

    turns = 0
    tool_calls = 0
    tool_errors = 0
    denials = 0
    error_kinds = Counter()
    first_prompt = ""

    with open(transcript_path, "r", errors="replace") as fh:
        for raw in fh:
            try:
                entry = json.loads(raw)
            except json.JSONDecodeError:
                continue
            msg = entry.get("message") or {}
            role = msg.get("role") or entry.get("type", "")
            content = msg.get("content", "")

            if role == "user" and not entry.get("isMeta"):
                text = _text_of(content)
                if not first_prompt and text and not text.startswith("<"):
                    first_prompt = text[:200]
            if role == "assistant":
                turns += 1
                if isinstance(content, list):
                    tool_calls += sum(
                        1 for b in content if isinstance(b, dict) and b.get("type") == "tool_use"
                    )
            # tool_result errors live in user-role messages
            if isinstance(content, list):
                for block in content:
                    if not isinstance(block, dict):
                        continue
                    if block.get("type") == "tool_result" and block.get("is_error"):
                        tool_errors += 1
                        snippet = _text_of(block.get("content", ""))[:ERROR_SNIPPET_LEN]
                        snippet = re.sub(r"\s+", " ", snippet).strip()
                        if "permission" in snippet.lower() or "denied" in snippet.lower():
                            denials += 1
                        # bucket by first few words so identical failures merge
                        error_kinds[" ".join(snippet.split()[:8])] += 1

    if turns == 0:
        return  # empty/aborted session — nothing to learn from

    record = {
        "ts": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "session": payload.get("session_id", "")[:12],
        "turns": turns,
        "tool_calls": tool_calls,
        "tool_errors": tool_errors,
        "denials": denials,
        "top_errors": [k for k, _ in error_kinds.most_common(3)],
        "prompt": re.sub(r"\s+", " ", first_prompt).strip(),
    }
    line = json.dumps(record, ensure_ascii=False)
    if len(line.encode()) > MAX_LINE_BYTES:
        record["top_errors"] = []
        record["prompt"] = record["prompt"][:80]
        line = json.dumps(record, ensure_ascii=False)

    # One shard file per session, in a per-month directory. Two failure modes
    # of the old shared monthly file, both hit on 2026-08-31: (a) two branches
    # carrying different sessions' appends merge-conflict on the same path;
    # (b) rewriting the shared file on every Stop kept the tree dirty mid-PR,
    # CCR's stop hook then forced a commit+push, and each push cancelled the
    # PR's in-flight CI run (test.yml has no path filters and cancels
    # superseded PR runs). A per-session file is conflict-free by construction
    # and turns the per-Stop upsert into a plain overwrite. Existing monthly
    # *.jsonl files stay as read-only legacy; digest and lint read both.
    month_dir = os.path.join(JOURNAL_DIR, datetime.now(timezone.utc).strftime("%Y-%m") + ".d")
    os.makedirs(month_dir, exist_ok=True)
    session_slug = re.sub(r"\W+", "", record["session"]) or "unknown"
    with open(os.path.join(month_dir, session_slug + ".jsonl"), "w") as fh:
        fh.write(line + "\n")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass  # telemetry must never break a session
    sys.exit(0)
