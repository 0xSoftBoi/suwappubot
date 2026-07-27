#!/usr/bin/env python3
"""SessionStart hook: surface the things that have historically killed a session.

Cheap, read-only, never blocks. Prints a short WARN banner so the conductor sees
the hazard on turn 0 instead of discovering it at commit time:
  1. Unset git identity  -> forced a clean commit rebuild in a past session.
  2. Stash entries       -> the stash stack is SHARED across worktrees here;
                            another Claude session may own those entries.
  3. Worktree context    -> in a worktree, `git rebase` is forbidden (CLAUDE.md).
"""
import subprocess
import sys


def _git(*args: str) -> str:
    try:
        out = subprocess.run(
            ["git", *args], capture_output=True, text=True, timeout=10
        )
        return out.stdout.strip() if out.returncode == 0 else ""
    except (OSError, subprocess.SubprocessError):
        return ""


def main() -> int:
    warnings = []

    if not (_git("config", "user.name") and _git("config", "user.email")):
        warnings.append("git identity unset — set user.name/user.email before committing")

    stash = _git("stash", "list")
    if stash:
        n = len(stash.splitlines())
        warnings.append(
            f"{n} stash entr{'y' if n == 1 else 'ies'} present and the stash stack is "
            "SHARED across worktrees — never bare `git stash pop`"
        )

    common = _git("rev-parse", "--git-common-dir")
    gitdir = _git("rev-parse", "--git-dir")
    if common and gitdir and common != gitdir:
        warnings.append("inside a git worktree — use `git merge`, NEVER `git rebase`")

    for w in warnings:
        print(f"WARN: {w}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
