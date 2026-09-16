#!/usr/bin/env python3
"""Tests for scripts/copy_lint.py.

A linter that cries wolf gets ignored, which is worse than no linter. These
cases pin the rules that matter and, just as importantly, the things that must
NOT be flagged.

Run: python3 scripts/test_copy_lint.py
"""

from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from copy_lint import lint_paragraph  # noqa: E402

DUMMY = pathlib.Path("t.md")

# (text, is_list, expected_rule_codes)
CASES: list[tuple[str, bool, set[str]]] = [
    # --- W02: dash as sentence glue -----------------------------------------
    ("Those are platform totals—not a claim that every route races.", False, {"W02"}),
    ("The guidance is explicit — for EVM you need one address per user.", False, {"W02"}),
    # A label dash in a list item is punctuation, not glue.
    ("**Discover** — read-only metadata.", True, set()),
    ("[Quickstart](q.md) — one focused path to a first result.", True, set()),
    # Regression: an en-dash closed up inside the label must not absorb the
    # strip and leave the real separator to misfire.
    ("**June–July 2025** — the backlash.", True, set()),
    # Regression: numeric and magnitude ranges are ranges, not glue.
    ("Gas runs $5–25 per transfer on that path.", False, set()),
    ("Private markets grew across 2019–2024 by most measures.", False, set()),
    ("Begin at Levels 0–2 with an application-owned allowlist.", False, set()),
    ("Stake sits between 500k–1M HYPE on that validator.", False, set()),
    # A second dash past the label is still glue.
    ("**HIP-4** — outcome markets. Verify the cap — the spec moved.", True, {"W02"}),
    # --- W01: sentence length ----------------------------------------------
    (" ".join(["word"] * 40) + ".", False, {"W01"}),
    (" ".join(["word"] * 20) + ".", False, set()),
    # --- W03: paragraph length ---------------------------------------------
    ("One. Two. Three. Four. Five.", False, {"W03"}),
    ("One. Two. Three. Four.", False, set()),
    # A long list item is not a paragraph.
    ("One. Two. Three. Four. Five.", True, set()),
    # --- W04: banned words --------------------------------------------------
    ("A seamless and powerful experience.", False, {"W04"}),
    # Boundary: 'unlock' must not match 'unlocked' mid-word... it is a prefix,
    # so \b still matches 'unlock' inside 'unlocked'. Pin the real behaviour.
    ("We leverage the routing table here.", False, {"W04"}),
    ("Routing ranks every venue before you see a quote.", False, set()),
    # --- W05: stacked hedges ------------------------------------------------
    ("This may potentially reduce the fee.", False, {"W05"}),
    ("This reduces the fee on self-serve tiers.", False, set()),
    # --- W06: long parentheticals ------------------------------------------
    ("The sponsor pays (which is a separate account with its own budget line).", False, {"W06"}),
    ("The sponsor pays (see below).", False, set()),
    # A path or single token in parens is a reference, not an aside.
    ("Configured in (bot/config/settings.py).", False, set()),
]


def codes(findings: list[str]) -> set[str]:
    return {f.split(": ")[1].split(" ")[0] for f in findings}


def main() -> int:
    failed = 0
    for text, is_list, want in CASES:
        got = codes(lint_paragraph(DUMMY, 1, text, is_list))
        if got != want:
            failed += 1
            kind = "list" if is_list else "para"
            print(f"FAIL [{kind}] want={sorted(want) or '-'} got={sorted(got) or '-'}")
            print(f"     {text[:88]}")
    total = len(CASES)
    print(f"{total - failed}/{total} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
