"""Tests for the post-trade execution scorer (execution intelligence phase 2).

Covers the properties that actually matter in production:
  * horizons are only scored once elapsed,
  * re-running never double-writes (the UNIQUE(swap_id, horizon) guarantee),
  * the baseline horizon carries a NULL markout and later horizons measure
    drift from it,
  * an unpriceable token is skipped rather than written as a null row.
"""

import asyncio
from datetime import datetime, timedelta

import pytest
import sqlalchemy as sa
from sqlalchemy import text


@pytest.fixture()
def engine(monkeypatch):
    """In-memory DB with just the tables the scorer touches."""
    eng = sa.create_engine("sqlite://", connect_args={"check_same_thread": False})
    with eng.begin() as c:
        c.execute(text("""
                CREATE TABLE swap_transactions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    status VARCHAR(30),
                    to_token VARCHAR(20),
                    to_amount_usd REAL,
                    from_amount_usd REAL,
                    completed_at TIMESTAMP
                )
                """))
        c.execute(text("""
                CREATE TABLE swap_execution_marks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    swap_id INTEGER NOT NULL,
                    horizon VARCHAR(8) NOT NULL,
                    to_token_price_usd REAL,
                    fill_price_usd REAL,
                    realized_vs_quoted_bps REAL,
                    markout_bps REAL,
                    scored_at TIMESTAMP,
                    CONSTRAINT uq_swap_execution_marks_swap_horizon
                        UNIQUE (swap_id, horizon)
                )
                """))
    return eng


@pytest.fixture()
def scorer(engine, monkeypatch):
    from contextlib import contextmanager

    import bot.services.execution_scorer as mod

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


def _insert_swap(engine, **kw):
    with engine.begin() as c:
        c.execute(
            text(
                "INSERT INTO swap_transactions "
                "(status,to_token,to_amount_usd,from_amount_usd,completed_at) "
                "VALUES (:status,:to_token,:to_amount_usd,:from_amount_usd,:completed_at)"
            ),
            {
                "status": "completed",
                "to_token": "ETH",
                "to_amount_usd": 995.0,
                "from_amount_usd": 1000.0,
                **kw,
            },
        )


def _marks(engine):
    with engine.begin() as c:
        return c.execute(
            text(
                "SELECT swap_id,horizon,to_token_price_usd,markout_bps,"
                "realized_vs_quoted_bps FROM swap_execution_marks ORDER BY horizon"
            )
        ).fetchall()


def _patch_price(scorer, monkeypatch, price):
    class _PS:
        async def get_price(self, _token):
            return price

    import bot.services.price_service as ps_mod

    monkeypatch.setattr(ps_mod, "price_service", _PS())


def test_unelapsed_horizons_are_not_scored(engine, scorer, monkeypatch):
    # Completed one minute ago — no horizon (min 5m) has elapsed.
    _insert_swap(engine, completed_at=datetime.utcnow() - timedelta(minutes=1))
    _patch_price(scorer, monkeypatch, 3000.0)

    written = asyncio.run(scorer.execution_scorer._score_due_swaps())
    assert written == 0
    assert _marks(engine) == []


def test_elapsed_horizons_scored_and_idempotent(engine, scorer, monkeypatch):
    _insert_swap(engine, completed_at=datetime.utcnow() - timedelta(hours=2))
    _patch_price(scorer, monkeypatch, 3000.0)

    first = asyncio.run(scorer.execution_scorer._score_due_swaps())
    # 5m and 1h have elapsed; 24h has not.
    assert first == 2
    assert {m[1] for m in _marks(engine)} == {"5m", "1h"}

    # Re-running must write nothing further — the UNIQUE(swap_id, horizon)
    # guarantee is what makes restarts and overlapping passes safe.
    second = asyncio.run(scorer.execution_scorer._score_due_swaps())
    assert second == 0
    assert len(_marks(engine)) == 2


def test_baseline_has_null_markout_and_later_horizon_measures_drift(engine, scorer, monkeypatch):
    _insert_swap(engine, completed_at=datetime.utcnow() - timedelta(hours=2))

    # Baseline pass at $3000 — only 5m is elapsed far enough to matter first.
    _patch_price(scorer, monkeypatch, 3000.0)
    asyncio.run(scorer.execution_scorer._score_due_swaps())

    rows = {m[1]: m for m in _marks(engine)}
    # The baseline horizon is the reference, so it carries no markout itself.
    assert rows["5m"][3] is None
    # The later horizon is measured against that baseline. Same price this
    # pass, so drift is zero rather than null.
    assert rows["1h"][3] == pytest.approx(0.0)


def test_realized_vs_quoted_reflects_value_lost(engine, scorer, monkeypatch):
    # $1000 in, $995 out -> -50 bps.
    _insert_swap(engine, completed_at=datetime.utcnow() - timedelta(hours=2))
    _patch_price(scorer, monkeypatch, 3000.0)
    asyncio.run(scorer.execution_scorer._score_due_swaps())

    rows = {m[1]: m for m in _marks(engine)}
    assert rows["5m"][4] == pytest.approx(-50.0)


def test_unpriceable_token_is_skipped_not_written_null(engine, scorer, monkeypatch):
    _insert_swap(engine, completed_at=datetime.utcnow() - timedelta(hours=2))
    _patch_price(scorer, monkeypatch, None)

    written = asyncio.run(scorer.execution_scorer._score_due_swaps())
    assert written == 0
    # No null-price rows: a later pass must still be able to score this swap
    # if the token becomes priceable.
    assert _marks(engine) == []


def test_pending_swaps_are_ignored(engine, scorer, monkeypatch):
    _insert_swap(
        engine,
        status="pending",
        completed_at=datetime.utcnow() - timedelta(hours=2),
    )
    _patch_price(scorer, monkeypatch, 3000.0)

    assert asyncio.run(scorer.execution_scorer._score_due_swaps()) == 0
