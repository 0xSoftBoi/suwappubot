"""Tests for cohort execution benchmarking (execution intelligence phase 3).

The k-threshold tests are the important ones. In trading data the valuable
records are the identifying ones — a large fill on a thin pair is a rare group
that survives aggregation. If a cohort has two participants, "the cohort
median" is one person's fills shown to their competitor. These tests exist so
that floor cannot be removed or bypassed by accident.
"""

from contextlib import contextmanager
from datetime import datetime

import pytest
import sqlalchemy as sa
from sqlalchemy import text


@pytest.fixture()
def engine():
    eng = sa.create_engine("sqlite://", connect_args={"check_same_thread": False})
    with eng.begin() as c:
        c.execute(text("""
                CREATE TABLE swap_transactions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER,
                    from_token VARCHAR(40),
                    to_token VARCHAR(40)
                )
                """))
        c.execute(text("""
                CREATE TABLE swap_execution_marks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    swap_id INTEGER NOT NULL,
                    horizon VARCHAR(8) NOT NULL,
                    realized_vs_quoted_bps REAL,
                    scored_at TIMESTAMP
                )
                """))
    return eng


@pytest.fixture()
def bench(engine, monkeypatch):
    import bot.services.execution_benchmark as mod

    Session = sa.orm.sessionmaker(bind=engine)

    @contextmanager
    def _get_session():
        s = Session()
        try:
            yield s
            s.commit()
        finally:
            s.close()

    monkeypatch.setattr(mod, "get_session", _get_session)
    return mod


def _add(engine, user_id, bps, from_token="USDC", to_token="ETH"):
    with engine.begin() as c:
        r = c.execute(
            text(
                "INSERT INTO swap_transactions (user_id,from_token,to_token) " "VALUES (:u,:f,:t)"
            ),
            {"u": user_id, "f": from_token, "t": to_token},
        )
        swap_id = r.lastrowid
        c.execute(
            text(
                "INSERT INTO swap_execution_marks "
                "(swap_id,horizon,realized_vs_quoted_bps,scored_at) "
                "VALUES (:s,'5m',:b,:ts)"
            ),
            {"s": swap_id, "b": bps, "ts": datetime.utcnow()},
        )


def test_cohort_below_threshold_is_suppressed(engine, bench):
    # Four distinct users — one under the floor of five.
    for uid in range(1, 5):
        _add(engine, uid, -30.0)

    out = bench.execution_benchmark.cohort_stats("USDC", "ETH")
    assert out["suppressed"] is True
    assert out["reason"] == "cohort_too_small"
    # No statistic may leak alongside the suppression.
    assert "median_bps" not in out
    assert "best_bps" not in out


def test_many_swaps_by_few_users_still_suppressed(engine, bench):
    # 50 swaps but only 2 people. Row count must never substitute for the
    # DISTINCT USER count, or one heavy trader unlocks their own statistics.
    for i in range(50):
        _add(engine, 1 if i % 2 else 2, -20.0 - i)

    out = bench.execution_benchmark.cohort_stats("USDC", "ETH")
    assert out["suppressed"] is True
    assert out["cohort_users"] == 2


def test_cohort_at_threshold_returns_stats(engine, bench):
    for uid in range(1, 6):  # exactly 5
        _add(engine, uid, -30.0)

    out = bench.execution_benchmark.cohort_stats("USDC", "ETH")
    assert out["suppressed"] is False
    assert out["cohort_users"] == 5
    assert out["median_bps"] == pytest.approx(-30.0)


def test_percentile_inherits_suppression(engine, bench):
    for uid in range(1, 4):
        _add(engine, uid, -30.0)

    out = bench.execution_benchmark.user_percentile(1, "USDC", "ETH")
    # A per-user view must not become a side channel around the cohort floor.
    assert out["suppressed"] is True
    assert "your_median_bps" not in out


def test_percentile_ranks_and_suggests_remedy(engine, bench):
    # Cohort losing ~10bps; our user loses 60bps — clearly worse.
    for uid in range(2, 8):
        _add(engine, uid, -10.0)
    _add(engine, 1, -60.0)

    out = bench.execution_benchmark.user_percentile(1, "USDC", "ETH")
    assert out["suppressed"] is False
    assert out["has_user_data"] is True
    assert out["your_median_bps"] == pytest.approx(-60.0)
    # Worse than everyone -> bottom of the distribution.
    assert out["percentile"] == pytest.approx(0.0)
    # A benchmark without an action is a churn risk, so a remedy is required.
    assert out["remedy"] is not None
    assert "bps" in out["remedy"]


def test_good_execution_gets_no_nagging_remedy(engine, bench):
    for uid in range(2, 8):
        _add(engine, uid, -30.0)
    _add(engine, 1, -28.0)  # marginally better than the cohort

    out = bench.execution_benchmark.user_percentile(1, "USDC", "ETH")
    assert out["remedy"] is None


def test_user_with_no_swaps_in_shape(engine, bench):
    for uid in range(2, 8):
        _add(engine, uid, -30.0)

    out = bench.execution_benchmark.user_percentile(99, "USDC", "ETH")
    assert out["has_user_data"] is False
    assert out["cohort"]["suppressed"] is False


def test_other_pairs_do_not_leak_into_cohort(engine, bench):
    for uid in range(1, 7):
        _add(engine, uid, -30.0, from_token="USDC", to_token="WBTC")

    # The requested shape has no data even though a sibling pair is populated.
    out = bench.execution_benchmark.cohort_stats("USDC", "ETH")
    assert out["suppressed"] is True
    assert out["cohort_users"] == 0


def test_user_percentile_fetches_the_cohort_join_exactly_once(bench, engine, monkeypatch):
    """Regression guard: the aggregate and the population share one fetch.

    A previous refactor deduplicated the SQL *text* by extracting _cohort_rows,
    but left user_percentile calling cohort_stats (which fetches) and then
    fetching again — so the marks/swaps join still ran twice per call while the
    docstring claimed it had been fixed. Count the calls, not the call sites.
    """
    from datetime import datetime

    with engine.begin() as c:
        for uid in range(1, 7):
            c.execute(
                text(
                    "INSERT INTO swap_transactions (user_id, from_token, to_token) "
                    "VALUES (:u, 'USDC', 'ETH')"
                ),
                {"u": uid},
            )
            c.execute(
                text(
                    "INSERT INTO swap_execution_marks "
                    "(swap_id, horizon, realized_vs_quoted_bps, scored_at) "
                    "VALUES (:s, '5m', :b, :t)"
                ),
                {"s": uid, "b": -10.0 * uid, "t": datetime.utcnow()},
            )

    calls = {"n": 0}
    original = bench.execution_benchmark._cohort_rows

    def counting(*args, **kwargs):
        calls["n"] += 1
        return original(*args, **kwargs)

    monkeypatch.setattr(bench.execution_benchmark, "_cohort_rows", counting)

    result = bench.execution_benchmark.user_percentile(1, "USDC", "ETH")
    assert not result.get("suppressed")
    assert calls["n"] == 1, f"cohort join fetched {calls['n']}x, expected 1"
