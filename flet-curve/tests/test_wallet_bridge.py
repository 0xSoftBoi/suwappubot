"""The bridge, driven under node as two tabs of the app at once."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
BRIDGE = ROOT / "src" / "assets" / "wallet_bridge.js"
HARNESS = Path(__file__).resolve().parent / "js" / "bridge_harness.mjs"

pytestmark = pytest.mark.skipif(
    shutil.which("node") is None, reason="needs node to run the bridge"
)


def run() -> dict:
    """Boot the bridge, announce two wallets, drive it as clients A and B."""
    done = subprocess.run(
        ["node", str(HARNESS), str(BRIDGE)],
        capture_output=True,
        text=True,
        timeout=60,
        check=True,
    )
    return json.loads(done.stderr.strip().splitlines()[-1])


def test_the_bridge_still_boots_and_answers() -> None:
    result = run()

    assert result["selectA"]["result"]["name"] == "alpha"
    assert result["selectB"]["result"]["name"] == "beta"


def test_two_tabs_keep_their_own_wallets() -> None:
    """One `selected` for the origin meant the tab that connected last
    took over the other tab's requests: A picks alpha, B picks beta, and
    A's next call went to beta. It is the same bug behind "change wallet,
    keep the old one if it fails" -- the bridge had already moved.
    """
    result = run()

    assert result["afterA"]["result"] == "answered by alpha"
    assert result["afterB"]["result"] == "answered by beta"
    assert (result["alphaCalls"], result["betaCalls"]) == (1, 1)
