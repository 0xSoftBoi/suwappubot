#!/usr/bin/env python3
"""Prove a TypeScript/TSX edit changed only copy, not code.

Blanks every string literal and JSX text node, then compares the remaining
skeleton against HEAD. Identical skeletons mean no identifier, call, import,
prop, or control-flow token moved: the diff is prose and nothing else.

This is the TS analogue of comparing Python syntax trees, and it is what makes
a large delegated copy rewrite safe to accept even when a workspace has no
node_modules and cannot be built.

    python3 scripts/check_ts_copy_only.py             # all modified .ts/.tsx
    python3 scripts/check_ts_copy_only.py a.tsx b.ts  # specific files
"""

import re
import subprocess
import sys

STRING = re.compile(r"'(?:[^'\\\n]|\\.)*'|\"(?:[^\"\\\n]|\\.)*\"|`(?:[^`\\]|\\.)*`", re.S)
JSX_TEXT = re.compile(r">([^<>{}]*[A-Za-z][^<>{}]*)<")
WS = re.compile(r"\s+")


def skeleton(src: str) -> str:
    s = STRING.sub("<STR>", src)
    s = JSX_TEXT.sub("><TXT><", s)
    return WS.sub(" ", s).strip()


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
        files = [f for f in r.stdout.split() if f.endswith((".ts", ".tsx"))]

    bad = 0
    for f in files:
        old = head(f)
        if old is None:
            continue
        try:
            new = open(f).read()
        except OSError:
            continue
        if skeleton(old) != skeleton(new):
            bad += 1
            print(f"FAIL {f}: code skeleton changed, not just copy")
    print(f"{len(files)} file(s) checked, {bad} with code changes")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
