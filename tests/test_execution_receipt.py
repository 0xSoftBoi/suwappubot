"""Tests for the per-swap execution receipt (execution intelligence phase 4).

The ownership tests are the important ones. A receipt is built from a swap id
that arrives from a callback button or a URL path, so the scoping has to live
in the query — and "not yours" has to be indistinguishable from "does not
exist", or the endpoint becomes an enumeration oracle for other people's
trades.

The second group guards the routing/market split. Collapsing realized-vs-quoted
and markout into one number would let a routing regression hide behind a
volatile day, so the verdict must keep them in separate fields.
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


def _swap(session_factory, user_id=1, status="completed"):
    from bot.models.swap import SwapTransaction

    s = session_factory()
    swap = SwapTransaction(
        user_id=user_id,
        from_token="USDC",
        to_token="ETH",
        from_chain="base",
        to_chain="base",
        from_amount="1000000",
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
    assert r["realized_vs_quoted_bps"] is None
    assert "Not scored yet" in r["verdict"]["routing"]


def test_realized_bps_comes_from_earliest_horizon_carrying_it(receipt, session_factory):
    swap_id = _swap(session_factory, user_id=1)
    _mark(session_factory, swap_id, "1h", realized=-30.0)
    _mark(session_factory, swap_id, "5m", realized=-12.0)
    r = receipt.build(user_id=1, swap_id=swap_id)
    assert r["realized_vs_quoted_bps"] == -12.0


def test_shortfall_is_attributed_to_us(receipt, session_factory):
    swap_id = _swap(session_factory, user_id=1)
    _mark(session_factory, swap_id, "5m", realized=-40.0)
    verdict = receipt.build(user_id=1, swap_id=swap_id)["verdict"]
    assert "ours" in verdict["routing"]


def test_adverse_price_move_is_attributed_to_the_market(receipt, session_factory):
    swap_id = _swap(session_factory, user_id=1)
    _mark(session_factory, swap_id, "5m", realized=0.0, markout=-60.0)
    verdict = receipt.build(user_id=1, swap_id=swap_id)["verdict"]
    assert "the market, not the route" in verdict["market"]
    # Crucially, the market's move must NOT contaminate the routing verdict.
    assert "ours" not in verdict["routing"]


def test_noise_is_not_reported_as_a_finding(receipt, session_factory):
    swap_id = _swap(session_factory, user_id=1)
    _mark(session_factory, swap_id, "5m", realized=-1.0)
    verdict = receipt.build(user_id=1, swap_id=swap_id)["verdict"]
    assert "matched the quote" in verdict["routing"]


# ---------------------------------------------------------------------------
# Honesty constraints
# ---------------------------------------------------------------------------


def test_quote_timing_caveat_is_always_present(receipt, session_factory):
    """We under-report our own slippage; every receipt must say so."""
    swap_id = _swap(session_factory, user_id=1)
    r = receipt.build(user_id=1, swap_id=swap_id)
    assert any("re-quote" in c for c in r["caveats"])


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
