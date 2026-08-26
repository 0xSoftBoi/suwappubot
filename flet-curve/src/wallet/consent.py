"""Whether the app may connect a wallet without being asked."""

from __future__ import annotations

import contextlib
import os
from pathlib import Path

#: Name of the marker. Its presence means "the user disconnected".
_MARKER = "disconnected"


def state_dir() -> Path:
    """Where per-machine state lives, following the XDG convention."""
    base = os.environ.get("XDG_STATE_HOME") or "~/.local/state"
    return Path(base).expanduser() / "flet-curve"


def _marker() -> Path:
    return state_dir() / _MARKER


def autoconnect_allowed() -> bool:
    """False once the user has disconnected, until they connect again."""
    try:
        return not _marker().exists()
    except OSError:
        return True


def record_disconnect() -> None:
    """Remember that the user disconnected deliberately."""
    with contextlib.suppress(OSError):
        path = _marker()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.touch()


def record_connect() -> None:
    """Forget it: connecting is the answer to the question it asked."""
    with contextlib.suppress(OSError):
        _marker().unlink()
