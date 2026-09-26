#!/usr/bin/env python3
"""Everything that has an opinion about this code, in one command."""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGETS = ("src", "tools", "tests")


def run(label: str, command: list[str]) -> bool:
    print(f"\n\033[1m{label}\033[0m  ({' '.join(command[2:])})", flush=True)
    return subprocess.run(command, cwd=ROOT, check=False).returncode == 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--fix", action="store_true", help="apply ruff's safe fixes before checking"
    )
    options = parser.parse_args()

    python = [sys.executable, "-m"]
    fix = ["--fix"] if options.fix else []
    steps = [
        ("ruff", [*python, "ruff", "check", *TARGETS, *fix]),
        ("mypy", [*python, "mypy"]),
        ("pytest", [*python, "pytest", "-q"]),
    ]
    failed = [label for label, command in steps if not run(label, command)]
    print()
    if failed:
        print(f"\033[31mfailed: {', '.join(failed)}\033[0m")
        return 1
    print("\033[32mall checks passed\033[0m")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
