"""A warning about one arc must not outrank a warning about the route.

The terminal spends eight lines on warnings.  They were filled in arrival
order, and the arrival order puts every per-arc note from `calibrate_arcs`
ahead of everything the solve has to say -- twenty `only 0 probes` lines from
eight dead pools, then nothing.

What that hid was the §12.1 size escalation on `ETH -> ETHx`: one arc taking
241% of its own reserve, so the modelled loss read 24.61 bp against 996.90 bp
verified on the chain.  The line explaining a 972 bp gap was written, appended,
and truncated away, and the ledger looked like an unexplained mystery instead.
"""

from __future__ import annotations

from erouter.dev.cli import WARNINGS_SHOWN, _shown_warnings


def _arc_notes(n: int, pools: int = 8) -> list[str]:
    return [f"0x{k % pools:040x}:0:0>1: only 0 probes" for k in range(n)]


def test_a_route_warning_outranks_twenty_arc_warnings():
    """The regression, stated as the line that went missing."""
    escalation = ("Curve.fi Factory Pool: E is taking 241.0% of its own reserve "
                  "(§12.1)")
    shown = _shown_warnings([*_arc_notes(20), escalation], None)
    assert escalation in shown, (
        "the §12.1 size escalation was pushed off the display by per-arc notes "
        "that arrived first"
    )


def test_the_arc_warnings_collapse_to_one_line_and_go_last():
    shown = _shown_warnings([*_arc_notes(20, pools=8), "a route-level note"], None)
    assert shown[0] == "a route-level note"
    assert len(shown) == 2
    assert "20 arc(s) across 8 pool(s)" in shown[-1]


def test_nothing_is_collapsed_when_there_is_nothing_to_collapse():
    lines = [f"note {k}" for k in range(3)]
    assert _shown_warnings(lines, None) == lines


def test_the_budget_still_binds_on_route_level_warnings():
    lines = [f"note {k}" for k in range(WARNINGS_SHOWN + 5)]
    assert len(_shown_warnings(lines, None)) == WARNINGS_SHOWN


def test_suppressed_warnings_stay_suppressed():
    shown = _shown_warnings(["kept", "hidden"], {"hidden"})
    assert shown == ["kept"]


def test_a_calibration_failure_is_still_a_per_arc_note():
    """`calibrate_arcs` writes two shapes; both name one arc and both collapse."""
    lines = ["0x" + "ab" * 20 + ":0:0>1: only 0 probes",
             "0x" + "ab" * 20 + ":0:1>0: need at least 2 probes at distinct sizes"]
    shown = _shown_warnings([*lines, "route note"], None)
    assert shown[0] == "route note"
    assert "2 arc(s) across 1 pool(s)" in shown[-1]
