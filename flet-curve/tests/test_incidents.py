"""Writing down a routing failure while the conditions are still true.

The point of the file is that someone can come back to it a day later and
re-run the exact quote, so what matters is that the arguments `erouter route`
needs are all in there and that nothing on this path can raise.
"""

from __future__ import annotations

import json

import pytest

from router import incidents


@pytest.fixture
def state(tmp_path, monkeypatch):
    monkeypatch.setenv("XDG_STATE_HOME", str(tmp_path))
    return tmp_path


def test_a_failure_is_one_json_line_with_everything_to_reproduce_it(state, capsys):
    incidents.record(
        "quote",
        error="RoutingError",
        message="src not connected to dst through the active set",
        chain=1,
        block=25_812_795,
        sell="0xa0b8",
        buy="0xdac1",
        pair="USDC->USDT",
        amount="1000000",
        solver="rust",
    )
    written = incidents.log_path().read_text(encoding="utf-8").splitlines()
    assert len(written) == 1
    entry = json.loads(written[0])
    assert entry["what"] == "quote"
    assert entry["block"] == 25_812_795
    assert entry["pair"] == "USDC->USDT"
    assert entry["amount"] == "1000000"
    assert entry["solver"] == "rust"
    assert entry["when"], "a record with no time on it dates nothing"
    assert "[swap-failure]" in capsys.readouterr().err, "said out loud as well"


def test_failures_accumulate_rather_than_replace_each_other(state):
    incidents.record("quote", block=1)
    incidents.record("plan", block=2)
    written = incidents.log_path().read_text(encoding="utf-8").splitlines()
    assert [json.loads(line)["block"] for line in written] == [1, 2]


def test_a_fact_with_nothing_in_it_is_left_out(state):
    """A record full of empty strings reads as though they were measured."""
    incidents.record("quote", block=7, sell="", solver=None, pair="USDC->USDT")
    entry = json.loads(incidents.log_path().read_text(encoding="utf-8"))
    assert "sell" not in entry and "solver" not in entry
    assert entry["pair"] == "USDC->USDT"


def test_a_log_that_cannot_be_written_is_not_the_error_anyone_sees(state, monkeypatch):
    """This runs on the failure path.  Failing to write down a failure must
    not become the failure on screen."""
    def refuse(*_a, **_kw):
        raise OSError("read-only file system")

    monkeypatch.setattr(incidents.Path, "mkdir", refuse)
    incidents.record("quote", block=3)          # no raise


def test_a_full_log_rolls_over_rather_than_growing_without_end(state, monkeypatch):
    monkeypatch.setattr(incidents, "MAX_BYTES", 10)
    incidents.record("quote", block=1)
    incidents.record("quote", block=2)
    rolled = incidents.log_path().with_suffix(".jsonl.1")
    assert rolled.is_file(), "the old lines are kept, in the file beside it"
    assert json.loads(incidents.log_path().read_text())["block"] == 2


def test_a_browser_says_it_and_keeps_nothing(state, monkeypatch, capsys):
    """Pyodide's filesystem does not survive the tab, so the console is the
    only place a browser has to put this."""
    monkeypatch.setattr(incidents, "is_browser", lambda: True)
    incidents.record("quote", block=9)
    assert not incidents.log_path().exists()
    assert "[swap-failure]" in capsys.readouterr().err
