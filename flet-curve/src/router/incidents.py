"""Writing down a routing failure while the conditions are still true.

A router that will not price a pair it priced a minute ago is worth
reproducing, and reproducing it means knowing the state it happened against.
By the time anyone reads the red line the block has moved on and the session
has refreshed, so the facts have to be taken at the moment it happens: which
chain, which block, which pair, which amount, which solver, and what was
raised.

`erouter route --from X --to Y --amount N --chain C --block B` is what a
record here is *for* -- it is those arguments, written down.

One JSON object per line, appended, so a file can be read by eye or by `jq`
and a crash halfway through leaves every earlier line intact.  Flet-free, and
it never raises: this runs on the failure path, and a failure to write down a
failure must not become the failure anyone sees.
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

#: Where the log goes on a desktop build.  `XDG_STATE_HOME` is the directory
#: the spec sets aside for exactly this -- logs and history that should
#: survive a restart but are not configuration and are not a cache.
APP_DIR = "curve-flet"
LOG_NAME = "swap-failures.jsonl"

#: What one file is allowed to grow to before it is rolled over.  A failure
#: record is a few hundred bytes and these are rare; this is the size at which
#: something has gone wrong often enough that the oldest lines are no longer
#: the interesting ones.
MAX_BYTES = 2 * 1024 * 1024


def is_browser() -> bool:
    return sys.platform == "emscripten"


def log_path() -> Path:
    """The file, on a build that has a filesystem worth writing to."""
    state = os.environ.get("XDG_STATE_HOME")
    root = Path(state) if state else Path.home() / ".local" / "state"
    return root / APP_DIR / LOG_NAME


def record(kind: str, **facts) -> str:
    """Write down one failure, and hand back the line that was written.

    Returned rather than only written so a caller can put it somewhere else
    as well -- and so a test can read it without a filesystem.
    """
    entry = {"when": time.strftime("%Y-%m-%dT%H:%M:%S"), "what": kind}
    entry.update({key: value for key, value in facts.items() if value not in (None, "")})
    line = json.dumps(entry, default=str)
    # Always said out loud: on a desktop build this is the terminal someone
    # started the app in, and in a browser it is the console -- which is the
    # only place a browser has to keep it.
    print(f"[swap-failure] {line}", file=sys.stderr, flush=True)
    if not is_browser():
        _append(line)
    return line


def _append(line: str) -> None:
    """Add one line to the log, rolling it over when it has grown enough."""
    try:
        path = log_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.is_file() and path.stat().st_size > MAX_BYTES:
            path.replace(path.with_suffix(".jsonl.1"))
        with path.open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")
    except OSError:
        # A read-only home, a full disk, a sandbox: none of them are worth
        # turning into the error someone sees instead of the real one.
        pass


__all__ = ["LOG_NAME", "MAX_BYTES", "is_browser", "log_path", "record"]
