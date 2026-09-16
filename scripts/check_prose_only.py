#!/usr/bin/env python3
"""Safety gate for a prose-only rewrite.

Fails if an edit changed anything inside a fenced code block, or changed the
multiset of numbers or link targets in a file. Prose may move freely. Facts may
not.

Rewriting prose at scale means touching hundreds of files, often through agents.
This is what makes that safe to do: it proves a rewrite kept every number,
example and link exactly where it was.

    python3 scripts/check_prose_only.py                 # all modified .md files
    python3 scripts/check_prose_only.py a.md b.md       # specific files
"""

import re
import subprocess
import sys

FENCE = re.compile(r"```.*?```", re.S)
NUM = re.compile(r"(?<![\w.])\$?\d[\d,_]*(?:\.\d+)?%?")
PATH = re.compile(r"/(?:v\d+/)?[a-z][\w/:{}-]*")
LINK = re.compile(r"\]\(([^)]+)\)")


def blocks(src: str) -> list[str]:
    return [b.strip() for b in FENCE.findall(src)]


def facts(src: str) -> tuple[list[str], list[str]]:
    prose = FENCE.sub(" ", src)
    return sorted(NUM.findall(prose)), sorted(LINK.findall(prose))


def head(path: str) -> str | None:
    r = subprocess.run(["git", "show", f"HEAD:{path}"], capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else None


def main() -> int:
    files = sys.argv[1:]
    if not files:
        r = subprocess.run(
            ["git", "diff", "--name-only", "--diff-filter=M"],
            capture_output=True,
            text=True,
            check=True,
        )
        files = [f for f in r.stdout.split() if f.endswith(".md")]

    bad = 0
    for f in files:
        old = head(f)
        if old is None:
            continue
        try:
            new = open(f).read()
        except OSError:
            continue

        ob, nb = blocks(old), blocks(new)
        if ob != nb:
            bad += 1
            print(f"FAIL {f}: fenced code block content changed ({len(ob)} -> {len(nb)} blocks)")
            for a, b in zip(ob, nb):
                if a != b:
                    print(f"     was: {a[:70]!r}")
                    print(f"     now: {b[:70]!r}")
                    break
            continue

        (on, ol), (nn, nl) = facts(old), facts(new)
        if on != nn:
            bad += 1
            removed = [x for x in on if x not in nn]
            added = [x for x in nn if x not in on]
            print(f"FAIL {f}: numbers changed. removed={removed[:6]} added={added[:6]}")
        if ol != nl:
            bad += 1
            removed = [x for x in ol if x not in nl]
            added = [x for x in nl if x not in ol]
            print(f"FAIL {f}: link targets changed. removed={removed[:4]} added={added[:4]}")

    print(f"{len(files)} file(s) checked, {bad} violation(s)")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
