#!/usr/bin/env python3
"""PostToolUse hook: fast syntax gate on edited Python files.

Blanket `tsc --noEmit` is intentionally NOT run here — `tsc` hangs in this repo
(see CLAUDE.md Build Tools). Instead we do the cheap, high-signal check the repo
already relies on: `ast.parse` on any edited .py file, which catches the
import-time SyntaxError crashes that pass CI but crash the bot on boot.

Reads the PostToolUse payload on stdin; on a parse failure it emits a non-zero
exit with a message so Claude sees the error immediately after the edit.
"""
import ast
import json
import subprocess
import sys


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0  # never block on malformed payload

    tool_input = payload.get("tool_input") or {}
    path = tool_input.get("file_path") or tool_input.get("path") or ""
    if not path.endswith(".py"):
        return 0

    try:
        with open(path, "r", encoding="utf-8") as fh:
            src = fh.read()
    except OSError:
        return 0  # file gone/unreadable — nothing to check

    try:
        ast.parse(src, filename=path)
    except SyntaxError as exc:
        print(
            f"parse-check: SyntaxError in {path}:{exc.lineno} — {exc.msg}. "
            "Fix before continuing (a bad parse crashes the bot at import).",
            file=sys.stderr,
        )
        return 2  # signal the edit produced non-parseable Python

    _format(path)
    return 0


def _format(path: str) -> None:
    """Best-effort `black` on the single edited file.

    CI runs `black --check --line-length=100 bot/ api/ tests/`, so formatting at
    edit time is what keeps style failures out of CI. Scoped to ONE file on
    purpose — running black repo-wide here would rewrite unrelated code.
    Never blocks: if black is missing or errors, the edit still stands.
    """
    if not any(f"/{d}/" in path or path.startswith(f"{d}/") for d in ("bot", "api", "tests")):
        return
    try:
        subprocess.run(
            ["black", "--quiet", "--line-length=100", path],
            capture_output=True,
            timeout=30,
        )
    except (OSError, subprocess.SubprocessError):
        pass


if __name__ == "__main__":
    sys.exit(main())
