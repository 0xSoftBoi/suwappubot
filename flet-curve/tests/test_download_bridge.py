"""The main-thread half of saving a file, driven under node.

Worth a test of its own for the same reason `wallet_bridge.js` has one: it is
the piece that only exists because Python runs in a worker, and the worker
cannot see whether it worked.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
BRIDGE = ROOT / "src" / "assets" / "download_bridge.js"
HARNESS = Path(__file__).resolve().parent / "js" / "download_harness.mjs"

pytestmark = pytest.mark.skipif(
    shutil.which("node") is None, reason="needs node to run the bridge"
)


def run() -> dict:
    done = subprocess.run(
        ["node", str(HARNESS), str(BRIDGE)],
        capture_output=True, text=True, timeout=60, check=True,
    )
    return json.loads(done.stderr.strip().splitlines()[-1])


def test_a_save_becomes_one_download_with_the_name_it_was_given():
    got = run()
    assert len(got["saved"]) == 1, "one blob, and only for the message meant for it"
    blob = got["saved"][0]
    assert blob["text"] == "<svg/>"
    assert blob["media"] == "image/svg+xml"

    assert len(got["downloads"]) == 1
    anchor = got["downloads"][0]
    assert anchor["download"] == "route.svg"
    assert anchor["clicked"] == 1, "clicked once, not left for someone to find"
    assert anchor["href"] == blob["url"]


def test_anything_else_on_the_channel_is_left_alone():
    """The channel is shared by every page on the origin, and a message from
    a version that does not match is one this cannot read."""
    got = run()
    assert len(got["saved"]) == 1, "the wrong dir and the wrong version, ignored"
