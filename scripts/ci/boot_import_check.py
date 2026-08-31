#!/usr/bin/env python3
"""Boot-import gate: fail CI if `api.main` / `bot.main` don't even import.

`pytest tests/` never imports these two modules directly, so an import-time
crash (bad import, syntax error surviving a merge, a `def` that awaits) sails
through CI green and only shows up as Railway logs full of ImportError after
the deploy already happened. This script is the cheapest possible check that
catches that class of bug before it ships: import the two modules, nothing
else. It must not need a database or network — only pydantic-settings
validation runs at import time, so the stub env vars below only need to
satisfy required (no-default) `Settings` fields, matching the same values
`tests/conftest.py` already pins for the same reason.

Usage: python3 scripts/ci/boot_import_check.py
Exit: 0 on success, 1 with the traceback on failure.
"""

import importlib
import os
import sys
import traceback
from pathlib import Path

# Run from anywhere: `bot`/`api` are top-level packages resolved relative to
# the repo root, not to this script's directory (scripts/ci/). Pytest gets
# this for free from `pythonpath = ["."]` in pyproject.toml; a standalone
# script invoked as `python3 scripts/ci/boot_import_check.py` does not.
_repo_root = str(Path(__file__).resolve().parent.parent.parent)
if _repo_root not in sys.path:
    sys.path.insert(0, _repo_root)

# Required (no-default) Settings fields — see bot/config/settings.py. Dummy
# but syntactically valid: encryption_key backs Fernet, which requires a
# 32-byte urlsafe-base64 key or key derivation fails at import-adjacent
# module init, not just at first use.
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-32byteslong!!")
# sqlite, no network: importing must not require a reachable database.
os.environ.setdefault("DATABASE_URL", "sqlite:///boot_import_check.db")
os.environ.setdefault("KMS_PROVIDER", "dev")  # never touch real KMS
# api.main freezes JWT_SECRET at import time (random if unset) — pin it so
# the check is deterministic, matching tests/conftest.py.
os.environ.setdefault("SECRET_KEY", "test-secret")

MODULES = ["bot.main", "api.main"]


def main() -> int:
    for name in MODULES:
        try:
            importlib.import_module(name)
        except Exception:
            print(f"boot_import_check: FAILED importing {name!r}", file=sys.stderr)
            traceback.print_exc()
            return 1
        print(f"boot_import_check: OK {name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
