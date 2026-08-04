"""Tests for the activation funnel.

The funnel exists to LOCATE a drop-off, so the properties that matter are:
percentages are relative to the right baselines, an unmeasurable stage degrades
instead of failing the whole report, and a stage we do not instrument is
reported as a gap rather than as zero.
"""

from contextlib import contextmanager

import pytest
import sqlalchemy as sa
from sqlalchemy import text


@pytest.fixture()
def engine():
    eng = sa.create_engine("sqlite://", connect_args={"check_same_thread": False})
    with eng.begin() as c:
        c.execute(text("CREATE TABLE users (id INTEGER PRIMARY KEY)"))
        c.execute(text("CREATE TABLE wallets (id INTEGER PRIMARY KEY, user_id INTEGER)"))
        c.execute(
            text("CREATE TABLE swap_route_candidates " "(id INTEGER PRIMARY KEY, user_id INTEGER)")
        )
        c.execute(text("CREATE TABLE swap_transactions (id INTEGER PRIMARY KEY, user_id INTEGER)"))
    return eng


@pytest.fixture()
def funnel(engine, monkeypatch):
    import bot.services.activation_funnel as mod

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


def _seed(engine, users=0, wallets=(), quotes=(), swaps=()):
    with engine.begin() as c:
        for i in range(1, users + 1):
            c.execute(text("INSERT INTO users (id) VALUES (:i)"), {"i": i})
        for u in wallets:
            c.execute(text("INSERT INTO wallets (user_id) VALUES (:u)"), {"u": u})
        for u in quotes:
            c.execute(text("INSERT INTO swap_route_candidates (user_id) VALUES (:u)"), {"u": u})
        for u in swaps:
            c.execute(text("INSERT INTO swap_transactions (user_id) VALUES (:u)"), {"u": u})


def test_percentages_use_the_right_baselines(engine, funnel):
    # 10 signups, 5 wallets, 4 quoted, 1 swapped.
    _seed(engine, users=10, wallets=[1, 2, 3, 4, 5], quotes=[1, 2, 3, 4], swaps=[1])
    out = funnel.activation_funnel.compute()
    by = {s["stage"]: s for s in out["stages"]}

    # Share of ALL signups.
    assert by["has_wallet"]["pct_of_signups"] == 50.0
    assert by["completed_swap"]["pct_of_signups"] == 10.0
    # Share of the PREVIOUS stage — this is what localises the drop.
    assert by["has_wallet"]["pct_of_previous"] == 50.0
    assert by["requested_quote"]["pct_of_previous"] == 80.0
    assert by["completed_swap"]["pct_of_previous"] == 25.0


def test_identifies_the_biggest_drop(engine, funnel):
    # Wallet->quote is the worst step (2 of 8 = 25%).
    _seed(engine, users=10, wallets=[1, 2, 3, 4, 5, 6, 7, 8], quotes=[1, 2], swaps=[1])
    out = funnel.activation_funnel.compute()
    assert out["biggest_drop"]["stage"] == "requested_quote"
    assert out["biggest_drop"]["retained_pct"] == 25.0


def test_duplicate_rows_count_users_not_events(engine, funnel):
    """One user with 50 quotes is ONE activated user, not 50."""
    _seed(engine, users=4, wallets=[1], quotes=[1] * 50, swaps=[])
    out = funnel.activation_funnel.compute()
    by = {s["stage"]: s for s in out["stages"]}
    assert by["requested_quote"]["users"] == 1


def test_zero_signups_does_not_divide_by_zero(engine, funnel):
    out = funnel.activation_funnel.compute()
    assert all(s["pct_of_signups"] == 0.0 for s in out["stages"] if s.get("users") is not None)


def test_missing_table_degrades_instead_of_failing(engine, funnel):
    _seed(engine, users=3, wallets=[1])
    with engine.begin() as c:
        c.execute(text("DROP TABLE swap_transactions"))
    out = funnel.activation_funnel.compute()
    by = {s["stage"]: s for s in out["stages"]}
    # The broken stage reports an error; the rest still report.
    assert by["completed_swap"]["users"] is None
    assert by["has_wallet"]["users"] == 1


def test_uninstrumented_stage_is_declared_not_silently_zero(engine, funnel):
    """A funded count of 0 would read as 'nobody funded'. It means 'unmeasured'."""
    out = funnel.activation_funnel.compute()
    assert "funded" in out["not_instrumented"]
    assert "funded" not in {s["stage"] for s in out["stages"]}
