"""Tests for the per-swap execution receipt (execution intelligence phase 4).

The ownership tests are the important ones. A receipt is built from a swap id
that arrives from a callback button or a URL path, so the scoping has to live
in the query — and "not yours" has to be indistinguishable from "does not
exist", or the endpoint becomes an enumeration oracle for other people's
trades.

The second group guards the cost/market split and, more importantly, guards
against the receipt re-acquiring a claim it cannot support. The underlying
column is named ``realized_vs_quoted_bps`` but contains no realized fill data
(see the ExecutionReceipt module docstring) — so the verdict must describe cost,
never blame routing, until realized output amounts are actually recorded.
"""

from contextlib import contextmanager
from datetime import datetime

import pytest
import sqlalchemy as sa


@pytest.fixture()
def session_factory():
    from database.db import Base
    import bot.models.swap  # noqa: F401 — registers the tables on Base

    eng = sa.create_engine("sqlite://", connect_args={"check_same_thread": False})
    Base.metadata.create_all(
        eng,
        tables=[
            Base.metadata.tables["swap_transactions"],
            Base.metadata.tables["swap_execution_marks"],
            Base.metadata.tables["swap_route_candidates"],
        ],
    )
    return sa.orm.sessionmaker(bind=eng)


@pytest.fixture()
def receipt(session_factory, monkeypatch):
    import bot.services.execution_receipt as mod

    @contextmanager
    def _get_session():
        s = session_factory()
        try:
            yield s
            s.commit()
        finally:
            s.close()

    monkeypatch.setattr(mod, "get_session", _get_session)
    # Cohort stats have their own tests; stub so these assert the receipt only.
    monkeypatch.setattr(
        mod.execution_benchmark,
        "user_percentile",
        lambda **kw: {"suppressed": True, "reason": "cohort_too_small"},
    )
    return mod.execution_receipt


def _swap(
    session_factory,
    user_id=1,
    status="completed",
    to_amount=None,
    realized_to_amount=None,
):
    from bot.models.swap import SwapTransaction

    s = session_factory()
    swap = SwapTransaction(
        user_id=user_id,
        from_token="USDC",
        to_token="ETH",
        from_chain="base",
        to_chain="base",
        from_amount="1000000",
        to_amount=to_amount,
        realized_to_amount=realized_to_amount,
        status=status,
        completed_at=datetime.utcnow(),
    )
    s.add(swap)
    s.commit()
    swap_id = swap.id
    s.close()
    return swap_id


def _mark(session_factory, swap_id, horizon, realized=None, markout=None):
    from bot.models.swap import SwapExecutionMark

    s = session_factory()
    s.add(
        SwapExecutionMark(
            swap_id=swap_id,
            horizon=horizon,
            realized_vs_quoted_bps=realized,
            markout_bps=markout,
        )
    )
    s.commit()
    s.close()


# ---------------------------------------------------------------------------
# Ownership — the enumeration boundary
# ---------------------------------------------------------------------------


def test_other_users_swap_is_not_readable(receipt, session_factory):
    swap_id = _swap(session_factory, user_id=1)
    assert receipt.build(user_id=2, swap_id=swap_id) is None


def test_missing_swap_is_indistinguishable_from_forbidden(receipt, session_factory):
    """Both return a bare None so the caller cannot tell them apart."""
    swap_id = _swap(session_factory, user_id=1)
    forbidden = receipt.build(user_id=2, swap_id=swap_id)
    missing = receipt.build(user_id=2, swap_id=swap_id + 9999)
    assert forbidden is None and missing is None


def test_owner_can_read_their_own_swap(receipt, session_factory):
    swap_id = _swap(session_factory, user_id=1)
    assert receipt.build(user_id=1, swap_id=swap_id) is not None


# ---------------------------------------------------------------------------
# The routing / market split
# ---------------------------------------------------------------------------


def test_unscored_swap_reports_pending_not_zero(receipt, session_factory):
    """A swap with no marks must not read as 'you lost 0 bps'."""
    swap_id = _swap(session_factory, user_id=1)
    r = receipt.build(user_id=1, swap_id=swap_id)
    assert r["scored"] is False
    assert r["quoted_cost_bps"] is None
    assert "Not scored yet" in r["verdict"]["cost"]


def test_cost_bps_comes_from_earliest_horizon_carrying_it(receipt, session_factory):
    swap_id = _swap(session_factory, user_id=1)
    _mark(session_factory, swap_id, "1h", realized=-30.0)
    _mark(session_factory, swap_id, "5m", realized=-12.0)
    r = receipt.build(user_id=1, swap_id=swap_id)
    assert r["quoted_cost_bps"] == -12.0


def test_cost_is_described_not_blamed_on_routing(receipt, session_factory):
    """The regression guard for the mislabelled column.

    A -100bps figure here is mostly our own platform fee plus the spread. If
    this ever renders as "that gap is ours", the receipt is accusing us of a
    fill failure it has no data to support.
    """
    swap_id = _swap(session_factory, user_id=1)
    _mark(session_factory, swap_id, "5m", realized=-100.0)
    verdict = receipt.build(user_id=1, swap_id=swap_id)["verdict"]
    assert "cost about 100 bps to cross" in verdict["cost"]
    assert "ours" not in verdict["cost"]
    assert "routing" not in verdict["cost"]


def test_adverse_price_move_is_attributed_to_the_market(receipt, session_factory):
    swap_id = _swap(session_factory, user_id=1)
    _mark(session_factory, swap_id, "5m", realized=0.0, markout=-60.0)
    verdict = receipt.build(user_id=1, swap_id=swap_id)["verdict"]
    assert "the market, not the route" in verdict["market"]
    # Crucially, the market's move must NOT contaminate the cost verdict.
    assert "market" not in verdict["cost"]


def test_noise_is_not_reported_as_a_finding(receipt, session_factory):
    swap_id = _swap(session_factory, user_id=1)
    _mark(session_factory, swap_id, "5m", realized=-1.0)
    verdict = receipt.build(user_id=1, swap_id=swap_id)["verdict"]
    assert "close to flat" in verdict["cost"]


# ---------------------------------------------------------------------------
# Honesty constraints
# ---------------------------------------------------------------------------


def test_cost_basis_caveat_is_always_present(receipt, session_factory):
    """Every receipt must disclaim that fill accuracy is not measured."""
    swap_id = _swap(session_factory, user_id=1)
    r = receipt.build(user_id=1, swap_id=swap_id)
    assert any("not a measure of whether the fill matched" in c for c in r["caveats"])


def test_counterfactual_absent_without_rejected_routes(receipt, session_factory):
    swap_id = _swap(session_factory, user_id=1)
    assert receipt.build(user_id=1, swap_id=swap_id)["counterfactual"] is None


def test_counterfactual_is_labelled_modeled(receipt, session_factory):
    from bot.models.swap import SwapRouteCandidate

    swap_id = _swap(session_factory, user_id=1)
    s = session_factory()
    for provider, usd, sel in (("lifi", 100.0, True), ("socket", 103.0, False)):
        s.add(
            SwapRouteCandidate(
                quote_id="q1",
                swap_id=swap_id,
                from_chain="base",
                to_chain="base",
                from_token="USDC",
                to_token="ETH",
                provider=provider,
                quoted_to_amount_usd=usd,
                was_selected=sel,
            )
        )
    s.commit()
    s.close()

    cf = receipt.build(user_id=1, swap_id=swap_id)["counterfactual"]
    assert cf["modeled"] is True
    assert cf["best_alternative_provider"] == "socket"
    assert cf["delta_usd"] == pytest.approx(3.0)


def test_benchmark_failure_does_not_sink_the_receipt(receipt, session_factory, monkeypatch):
    import bot.services.execution_receipt as mod

    def _boom(**kw):
        raise RuntimeError("cohort query down")

    monkeypatch.setattr(mod.execution_benchmark, "user_percentile", _boom)
    swap_id = _swap(session_factory, user_id=1)
    r = receipt.build(user_id=1, swap_id=swap_id)
    assert r is not None and r["benchmark"] is None


# ---------------------------------------------------------------------------
# Fill accuracy — the only line that grades us, so it must stay silent unless
# a settled amount was genuinely observed.
# ---------------------------------------------------------------------------


def test_fill_accuracy_absent_when_nothing_settled(receipt, session_factory):
    """No realized amount must read as 'not observed', not as a shortfall."""
    swap_id = _swap(session_factory, user_id=1, to_amount="1000000")
    r = receipt.build(user_id=1, swap_id=swap_id)
    assert r["fill_vs_quote_bps"] is None
    assert r["verdict"]["fill"] is None


def test_fill_accuracy_measures_shortfall(receipt, session_factory):
    swap_id = _swap(session_factory, user_id=1, to_amount="1000000", realized_to_amount="990000")
    r = receipt.build(user_id=1, swap_id=swap_id)
    assert r["fill_vs_quote_bps"] == pytest.approx(-100.0)
    assert "shortfall is ours" in r["verdict"]["fill"]


def test_fill_accuracy_is_price_independent(receipt, session_factory):
    """Token units, not USD — a price move must not show up as our shortfall.

    Same fill, wildly different USD marks; the bps figure must not budge.
    """
    a = _swap(session_factory, user_id=1, to_amount="1000000", realized_to_amount="995000")
    b = _swap(session_factory, user_id=1, to_amount="1000000", realized_to_amount="995000")
    ra = receipt.build(user_id=1, swap_id=a)
    rb = receipt.build(user_id=1, swap_id=b)
    assert ra["fill_vs_quote_bps"] == rb["fill_vs_quote_bps"] == pytest.approx(-50.0)


def test_unparseable_amounts_do_not_fabricate_a_number(receipt, session_factory):
    swap_id = _swap(
        session_factory, user_id=1, to_amount="not-a-number", realized_to_amount="990000"
    )
    assert receipt.build(user_id=1, swap_id=swap_id)["fill_vs_quote_bps"] is None


def test_zero_quote_does_not_divide_by_zero(receipt, session_factory):
    swap_id = _swap(session_factory, user_id=1, to_amount="0", realized_to_amount="990000")
    assert receipt.build(user_id=1, swap_id=swap_id)["fill_vs_quote_bps"] is None


def test_counterfactual_reports_rank_when_we_picked_the_best(receipt, session_factory):
    """Symmetry guard: a win must be reported, not just a loss.

    Surfacing only the swaps where an alternative quoted better looks candid
    but is still selective reporting — and reporting only the wins would be
    marketing. Both cases render.
    """
    from bot.models.swap import SwapRouteCandidate

    swap_id = _swap(session_factory, user_id=1)
    s = session_factory()
    for provider, usd, sel in (("lifi", 105.0, True), ("socket", 100.0, False)):
        s.add(
            SwapRouteCandidate(
                quote_id="q2",
                swap_id=swap_id,
                from_chain="base",
                to_chain="base",
                from_token="USDC",
                to_token="ETH",
                provider=provider,
                quoted_to_amount_usd=usd,
                was_selected=sel,
            )
        )
    s.commit()
    s.close()

    cf = receipt.build(user_id=1, swap_id=swap_id)["counterfactual"]
    assert cf["selected_rank"] == 1
    assert cf["priced_candidates"] == 2
    assert cf["delta_usd"] < 0  # no alternative beat us
