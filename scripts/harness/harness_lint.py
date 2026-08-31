#!/usr/bin/env python3
"""Verification gate for harness self-modifications.

Usage: python3 scripts/harness/harness_lint.py

Every /evolve or /reflect change to the harness (CLAUDE.md, hooks, skills,
agents, lessons) must pass this before commit. Self-improvement proposes;
this gate approves. Exits non-zero with a findings list on any failure.

Checks:
  1. .claude/settings.json is valid JSON and every referenced hook file exists.
  2. All .claude/hooks/*.py parse (ast) — a broken hook silently kills the loop.
  3. Every .claude/skills/*/SKILL.md and .claude/commands/*.md has frontmatter
     with a description.
  4. CLAUDE.md stays under budget (prompt bloat is how self-improving
     harnesses die) — hard cap on words.
  5. lessons.md stays bounded: max lesson count, no duplicate titles.
  6. Journal files are valid JSONL.
"""

import ast
import glob
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CLAUDE_MD_WORD_BUDGET = 4000
MAX_LESSONS = 25

findings = []


def check(ok, msg):
    if not ok:
        findings.append(msg)


def main():
    # 1. settings.json + referenced hooks exist
    settings_path = os.path.join(ROOT, ".claude", "settings.json")
    try:
        with open(settings_path) as fh:
            settings = json.load(fh)
        for event, groups in settings.get("hooks", {}).items():
            for group in groups:
                for hook in group.get("hooks", []):
                    cmd = hook.get("command", "")
                    for match in re.findall(r"\$CLAUDE_PROJECT_DIR/(\S+?\.py)", cmd):
                        check(
                            os.path.exists(os.path.join(ROOT, match.strip('"'))),
                            f"settings.json {event} references missing hook: {match}",
                        )
    except (OSError, json.JSONDecodeError) as e:
        check(False, f"settings.json unreadable/invalid: {e}")

    # 2. hook scripts parse
    for path in glob.glob(os.path.join(ROOT, ".claude", "hooks", "*.py")):
        try:
            ast.parse(open(path).read())
        except SyntaxError as e:
            check(False, f"hook does not parse: {os.path.basename(path)}: {e}")

    # 3. skills + commands have frontmatter with description
    md_files = glob.glob(os.path.join(ROOT, ".claude", "skills", "*", "SKILL.md"))
    md_files += glob.glob(os.path.join(ROOT, ".claude", "commands", "*.md"))
    for path in md_files:
        text = open(path, errors="replace").read()
        rel = os.path.relpath(path, ROOT)
        check(text.startswith("---"), f"{rel}: missing frontmatter")
        check(
            (
                "description:" in text.split("---")[1]
                if text.startswith("---") and len(text.split("---")) > 2
                else False
            ),
            f"{rel}: frontmatter lacks description",
        )

    # 4. CLAUDE.md word budget
    claude_md = os.path.join(ROOT, "CLAUDE.md")
    if os.path.exists(claude_md):
        words = len(open(claude_md, errors="replace").read().split())
        check(
            words <= CLAUDE_MD_WORD_BUDGET,
            f"CLAUDE.md over budget: {words} words > {CLAUDE_MD_WORD_BUDGET}. "
            "Merge or evict before adding — bloat degrades every session.",
        )

    # 5. lessons bounded + unique
    lessons_path = os.path.join(ROOT, ".claude", "harness", "lessons.md")
    if os.path.exists(lessons_path):
        titles = re.findall(r"^### (.+)$", open(lessons_path, errors="replace").read(), re.M)
        check(
            len(titles) <= MAX_LESSONS,
            f"lessons.md has {len(titles)} lessons > {MAX_LESSONS} cap — "
            "merge related lessons or evict stale ones.",
        )
        dupes = {t for t in titles if titles.count(t) > 1}
        check(not dupes, f"lessons.md duplicate titles: {sorted(dupes)}")

    # 6. journal integrity
    for path in glob.glob(os.path.join(ROOT, ".claude", "harness", "journal", "*.jsonl")):
        with open(path, errors="replace") as fh:
            for i, line in enumerate(fh, 1):
                if line.strip():
                    try:
                        json.loads(line)
                    except json.JSONDecodeError:
                        check(False, f"{os.path.basename(path)}:{i} invalid JSONL")
                        break

    if findings:
        print("HARNESS LINT: FAIL")
        for f in findings:
            print(f"  - {f}")
        sys.exit(1)
    print("HARNESS LINT: PASS")


if __name__ == "__main__":
    main()
