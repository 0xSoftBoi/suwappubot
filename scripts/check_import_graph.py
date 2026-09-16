#!/usr/bin/env python3
"""Boot-import gate that works without third-party packages installed.

CLAUDE.md's standing rule: CI green does not prove the bot boots. The test job
never exercises `bot/main.py`'s startup import chain, so a bad intra-repo import
passes CI and then crashes on deploy.

A real `import bot.main` needs python-telegram-bot, web3 and the rest, which are
not installed in every workspace. This checks the part an edit actually puts at
risk instead: every `bot.*`, `api.*`, `database.*` import must resolve to a
module that exists, and every file must parse. Third-party imports are assumed
present, since they are pinned in requirements.

Known gaps are listed explicitly below with a date and a reason, so the gate
stays green on what we already know and fails on anything new. Do not add to
that list to silence a real break: fix the import.

Run: python3 scripts/check_import_graph.py
"""

from __future__ import annotations

import ast
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
LOCAL_ROOTS = {"bot", "api", "database", "scripts"}

# Modules that do not exist and are known to be unreachable at runtime.
# Each entry needs a reason and a date. Audited 2026-09-16.
KNOWN_MISSING = {
    # `bot/platforms/` has never existed in this repository. The Discord
    # integration is therefore dead code, not a boot risk: api/main.py only
    # imports discord_bot when `settings.discord_bot_token` is set, inside a
    # try/except that logs a warning, so `discord_bot` is always None. The
    # alerts service is then imported only `if discord_bot:`, and is wrapped in
    # `_track_degraded`, which never lets an optional service block startup.
    # Setting the token gets a warning and no Discord, never a crash.
    "bot.platforms.discord_bot": "bot/platforms/ absent; guarded by try/except (2026-09-16)",
    "bot.platforms.discord_embeds": "bot/platforms/ absent; module unreachable (2026-09-16)",
}


def module_exists(dotted: str) -> bool:
    base = ROOT.joinpath(*dotted.split("."))
    return base.with_suffix(".py").exists() or (base / "__init__.py").exists() or base.is_dir()


def main() -> int:
    targets = sorted(ROOT.glob("bot/**/*.py")) + sorted(ROOT.glob("api/**/*.py"))
    broken: list[str] = []
    unparsed: list[str] = []
    known_hit: set[str] = set()
    checked = 0

    for f in targets:
        try:
            tree = ast.parse(f.read_text())
        except SyntaxError as e:
            unparsed.append(f"{f.relative_to(ROOT)}:{e.lineno}: {e.msg}")
            continue
        for node in ast.walk(tree):
            mods: list[str] = []
            if isinstance(node, ast.Import):
                mods = [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                mods = [node.module]
            for m in mods:
                if m.split(".")[0] not in LOCAL_ROOTS:
                    continue
                checked += 1
                if module_exists(m):
                    continue
                if m in KNOWN_MISSING:
                    known_hit.add(m)
                    continue
                broken.append(f"{f.relative_to(ROOT)}:{node.lineno}: no module {m!r}")

    if unparsed:
        print("✗ files that do not parse:")
        print("\n".join(f"  {u}" for u in unparsed))
    if broken:
        print("✗ intra-repo imports that do not resolve:")
        print("\n".join(f"  {b}" for b in broken[:20]))
        print("  A bad intra-repo import passes CI and then crashes the bot on deploy.")
    if unparsed or broken:
        return 1

    print(f"✓ {len(targets)} files parse; {checked} intra-repo imports resolve")
    for m in sorted(known_hit):
        print(f"  known gap: {m} — {KNOWN_MISSING[m]}")
    stale = set(KNOWN_MISSING) - known_hit
    if stale:
        print("  note: these known gaps no longer occur and can be removed from the list:")
        for m in sorted(stale):
            print(f"    {m}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
