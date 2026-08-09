"""Tests for the copy-trading REALIZED wallet PnL% used by the trader leaderboard
and the min_wallet_pnl_pct follow filter (bot/services/copy_service.py).

MONEY-PATH FIX (v3, this suite). v1 computed

    pnl_pct = (SUM(to_amount_usd) - SUM(from_amount_usd)) / SUM(from_amount_usd) * 100

over raw SwapTransaction rows. That is NOT PnL: from_amount_usd/to_amount_usd are
the USD value of the INPUT and OUTPUT legs of the SAME swap (see
swap_engine.py ~2595-2599), so to_amount_usd ~= from_amount_usd * (1 - fee -
slippage) for every row and the ratio converges to a small negative fee/slippage
constant regardless of whether the trader 10x'd or got rugged. Because
min_wallet_pnl_pct enforcement was switched from pass-through to ENFORCED, any
follower who set the natural threshold of 0 ("only copy profitable traders") had
EVERY copy trade silently dropped.

v2 sourced REALIZED PnL from the existing settled-PnL path instead: `_settle_pnl()`
already computes per-swap realized PnL using per-token average-cost basis (see
`TraderPosition`) and stores it on `TraderTrade.pnl_usd` / `TraderTrade.is_closed`,
and divided:

    pnl_pct = SUM(pnl_usd) / SUM(amount_usd) * 100
              over is_closed TraderTrade rows in the trailing window

But `TraderTrade.amount_usd` is the USD value of the swap's FROM leg -- the
PROCEEDS of the realized sell (proceeds = cost + pnl), not its cost basis.
Dividing pnl by proceeds instead of cost is mathematically CAPPED at +100%: a
trader who genuinely 10x'd (cost 100, proceeds 1000, pnl 900) showed only
+90% under v2, and a follower who set `min_wallet_pnl_pct=100` ("only copy
traders who doubled their money") had EVERY copy silently dropped forever --
no trader can ever clear a threshold of 100 under a ratio that maxes out at
100. Large losses were distorted the other way (blowing out toward negative
infinity as proceeds -> 0) instead of reading a bounded -100%.

v3 recovers the true cost basis algebraically -- since pnl = proceeds - cost,
cost = proceeds - pnl -- and computes a genuine return-on-capital that CAN
exceed 100%:

    cost_basis_usd = SUM(amount_usd) - SUM(pnl_usd)
    pnl_pct        = SUM(pnl_usd) / cost_basis_usd * 100

This test suite verifies:

- A 10x trader (cost 100, proceeds 1000, pnl 900) now shows +900%, not a
  capped +90%.
- A follower with `min_wallet_pnl_pct=100` ("only copy traders who doubled")
  does NOT have a trader who genuinely doubled (cost 100, proceeds 200, pnl
  100 -> +100%) silently and permanently blocked.
- Returns None ("insufficient data") when there is no realized-close volume in
  the window (new trader, or buys-only so far) -- NEVER 0.0.
- Returns None (never a block, never a fabricated number) when the derived
  cost basis comes out <= 0 (a data anomaly).
- A row with a NULL pnl_usd (legacy/corrupt data) is excluded from BOTH the
  numerator and denominator (not just coalesced to 0 on one side), so it can't
  skew the ratio toward a spurious extreme.
- The min_wallet_pnl_pct follow filter treats None as pass-through and NEVER
  silently blocks a copy just because PnL data is unavailable (fail open).
- The in-process cache is keyed by (trader_id, days), not just trader_id, and
  the cache eviction path is race-safe under a lock (A3).
"""

import os
from datetime import datetime, timedelta

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

import pytest

from database.db import get_session, init_db
from bot.models.copy_trading import CopyFollow, TraderProfile, TraderTrade
from bot.models.swap import SwapStatus, SwapTransaction
from bot.models.user import User
from bot.services.copy_service import CopyService, _wallet_pnl_cache, format_wallet_pnl_pct


@pytest.fixture()
def sqlite_db(tmp_path, monkeypatch):
    database_url = f"sqlite:///{tmp_path / 'copy-pnl.db'}"
    assert init_db(database_url)
    monkeypatch.setattr(
        "bot.services.copy_service.points_service.award_points", lambda *_, **__: None
    )
    monkeypatch.setattr(
        "bot.services.copy_service.points_service.award_swap_points",
        lambda *_, **__: (0, None, None),
    )
    _wallet_pnl_cache.clear()
    yield
    _wallet_pnl_cache.clear()


# Monotonic unique swap_id generator for directly-constructed TraderTrade rows
# (TraderTrade.swap_id has a UNIQUE constraint). FK enforcement is off for
# sqlite in this project (see database/db.py), so these need not correspond to
# a real swap_transactions row.
_next_swap_id_counter = iter(range(100_000, 10_000_000))


def _make_trader_trade(trader_id, pnl_usd, amount_usd, is_closed=True, days_ago=1):
    """Directly construct a settled TraderTrade row, as `_settle_pnl()` would
    have written it, so PnL-aggregation tests don't need to replay a full
    swap + TraderPosition cost-basis flow.

    NOTE (A1): `amount_usd` here is the swap's FROM-leg USD value -- the
    PROCEEDS of the realized sell (proceeds = cost + pnl) -- exactly as
    `_settle_pnl()`/`record_trade()` populate it in production. It is NOT the
    cost basis. `get_wallet_pnl_pct()` derives cost basis as
    `amount_usd - pnl_usd`. When choosing test fixture values, pick
    `amount_usd = cost + pnl` for a desired cost/pnl pair.
    """
    return TraderTrade(
        trader_id=trader_id,
        swap_id=next(_next_swap_id_counter),
        from_token="ETH",
        to_token="PEPE",
        from_chain="ethereum",
        to_chain="ethereum",
        amount_usd=amount_usd,
        pnl_usd=pnl_usd,
        pnl_percent=(pnl_usd / amount_usd * 100.0) if (pnl_usd and amount_usd) else 0.0,
        is_closed=is_closed,
        is_winning=(pnl_usd or 0) > 0,
        created_at=datetime.utcnow() - timedelta(days=days_ago),
    )


class TestGetWalletPnlPct:
    def test_profit_yields_positive_pct(self, sqlite_db):
        service = CopyService()
        with get_session() as session:
            session.add(User(id=1, username="trader"))
            session.flush()
            # cost 200, pnl 50, proceeds (amount_usd) = cost + pnl = 250.
            session.add(_make_trader_trade(1, pnl_usd=50.0, amount_usd=250.0))
            session.flush()

        # 50 / (250 - 50) * 100 = 50 / 200 * 100 = 25.0
        pct = service.get_wallet_pnl_pct(1, use_cache=False)
        assert pct == pytest.approx(25.0)

    def test_loss_yields_negative_pct(self, sqlite_db):
        service = CopyService()
        with get_session() as session:
            session.add(User(id=1, username="trader"))
            session.flush()
            # cost 100, pnl -60, proceeds (amount_usd) = cost + pnl = 40.
            session.add(_make_trader_trade(1, pnl_usd=-60.0, amount_usd=40.0))
            session.flush()

        # -60 / (40 - (-60)) * 100 = -60 / 100 * 100 = -60.0
        pct = service.get_wallet_pnl_pct(1, use_cache=False)
        assert pct == pytest.approx(-60.0)

    def test_ten_x_trader_shows_900_pct_not_capped_at_100(self, sqlite_db):
        """A1 core regression: v2 divided pnl by PROCEEDS instead of cost
        basis, which mathematically caps the ratio at +100% no matter how
        large the real return was. cost 100, proceeds 1000 (a genuine 10x),
        pnl 900 -- must read +900%, not a capped +90%."""
        service = CopyService()
        with get_session() as session:
            session.add(User(id=1, username="trader"))
            session.flush()
            session.add(_make_trader_trade(1, pnl_usd=900.0, amount_usd=1000.0))
            session.flush()

        # 900 / (1000 - 900) * 100 = 900 / 100 * 100 = 900.0
        pct = service.get_wallet_pnl_pct(1, use_cache=False)
        assert pct == pytest.approx(900.0)

    def test_degenerate_cost_basis_returns_none_not_a_block(self, sqlite_db):
        """A1 guard: if the derived cost basis (amount_usd - pnl_usd) comes
        out <= 0 (a data anomaly), get_wallet_pnl_pct must fail to the
        "insufficient data" sentinel rather than dividing by a non-positive
        number or fabricating a percentage that could wrongly block a copy."""
        service = CopyService()
        with get_session() as session:
            session.add(User(id=1, username="trader"))
            session.flush()
            # proceeds == pnl -> implied cost basis is exactly 0.
            session.add(_make_trader_trade(1, pnl_usd=50.0, amount_usd=50.0))
            session.flush()

        assert service.get_wallet_pnl_pct(1, use_cache=False) is None

    def test_insufficient_data_returns_none_sentinel(self, sqlite_db):
        """No realized closes at all -> None ("insufficient data"), never 0.0."""
        service = CopyService()
        with get_session() as session:
            session.add(User(id=1, username="trader"))
            session.flush()

        assert service.get_wallet_pnl_pct(1, use_cache=False) is None

    def test_pure_buys_do_not_count_as_zero_or_dilute(self, sqlite_db):
        """A pure buy (nothing sold yet) settles with pnl_usd=0.0 and
        is_closed=False. It must not dilute a genuine profitable close by
        adding un-realized volume into the denominator."""
        service = CopyService()
        with get_session() as session:
            session.add(User(id=1, username="trader"))
            session.flush()
            # Huge pure-buy volume, no realized pnl yet.
            session.add(_make_trader_trade(1, pnl_usd=0.0, amount_usd=100_000.0, is_closed=False))
            # One real closed profit: cost 100, pnl 25, proceeds = 125.
            session.add(_make_trader_trade(1, pnl_usd=25.0, amount_usd=125.0, is_closed=True))
            session.flush()

        pct = service.get_wallet_pnl_pct(1, use_cache=False)
        # If the huge unclosed buy volume leaked into the denominator this
        # would be diluted to ~0.02%; it must reflect only the closed trade.
        assert pct == pytest.approx(25.0)

    def test_excludes_trades_outside_window(self, sqlite_db):
        service = CopyService()
        with get_session() as session:
            session.add(User(id=1, username="trader"))
            session.flush()
            # Inside the 30d window: profitable close (cost 50, pnl 100, proceeds 150).
            session.add(_make_trader_trade(1, pnl_usd=100.0, amount_usd=150.0, days_ago=5))
            # Outside the window: a big loss that must NOT be counted.
            session.add(_make_trader_trade(1, pnl_usd=-999.0, amount_usd=1000.0, days_ago=90))
            session.flush()

        # 100 / (150 - 100) * 100 = 100 / 50 * 100 = 200.0
        pct = service.get_wallet_pnl_pct(1, days=30, use_cache=False)
        assert pct == pytest.approx(200.0)

    def test_excludes_non_closed_trades(self, sqlite_db):
        service = CopyService()
        with get_session() as session:
            session.add(User(id=1, username="trader"))
            session.flush()
            session.add(_make_trader_trade(1, pnl_usd=0.0, amount_usd=100.0, is_closed=False))
            session.flush()

        assert service.get_wallet_pnl_pct(1, use_cache=False) is None

    def test_null_pnl_row_excluded_row_wise_not_averaged_in(self, sqlite_db):
        """H5 regression: a row with pnl_usd=None (e.g. a legacy/corrupted
        record) must be excluded from BOTH the numerator and denominator, not
        coalesced to 0 in the numerator while its amount_usd still drags the
        denominator -- that asymmetry is what caused v1 to trend toward a
        spurious -100% for wallets with priced buys and unpriced sells.

        Note: TraderTrade.pnl_usd has a Python-side `default=0.0`, which
        SQLAlchemy applies on INSERT even when a caller explicitly passes
        None -- so a genuine NULL can only land via UPDATE (Column defaults
        only fire on INSERT), which is how a legacy/corrupted row could
        realistically end up NULL in production (a raw migration/backfill).
        """
        from sqlalchemy import text

        service = CopyService()
        with get_session() as session:
            session.add(User(id=1, username="trader"))
            session.flush()
            # Legacy/corrupt row: large amount_usd, unknown (NULL) pnl.
            bad_row = _make_trader_trade(1, pnl_usd=-999.0, amount_usd=1000.0)
            session.add(bad_row)
            session.flush()
            bad_row_id = bad_row.id
            # A real, valid closed trade: cost 100, pnl 20, proceeds = 120.
            session.add(_make_trader_trade(1, pnl_usd=20.0, amount_usd=120.0))
            session.flush()
            # Force a genuine NULL (bypassing the ORM's INSERT-time default)
            # to reproduce a legacy/corrupted row.
            session.execute(
                text("UPDATE trader_trades SET pnl_usd = NULL WHERE id = :id"),
                {"id": bad_row_id},
            )

        pct = service.get_wallet_pnl_pct(1, use_cache=False)
        # Must reflect ONLY the valid row (20 / (120-20) * 100 = 20.0), not be
        # diluted or skewed by the NULL-pnl row's amount_usd.
        assert pct == pytest.approx(20.0)

    def test_caches_result_keyed_by_trader_and_days(self, sqlite_db):
        service = CopyService()
        with get_session() as session:
            session.add(User(id=1, username="trader"))
            session.flush()
            # cost 100, pnl 50, proceeds = 150.
            session.add(_make_trader_trade(1, pnl_usd=50.0, amount_usd=150.0))
            session.flush()

        first_30d = service.get_wallet_pnl_pct(1, days=30, use_cache=True)
        assert first_30d == pytest.approx(50.0)

        # A days=7 call must NOT reuse the days=30 cache slot (M2 regression).
        first_7d = service.get_wallet_pnl_pct(1, days=7, use_cache=True)
        assert first_7d == pytest.approx(50.0)
        assert (1, 30) in _wallet_pnl_cache
        assert (1, 7) in _wallet_pnl_cache

        # Add a new trade that would change the result if recomputed
        # (cost 100, pnl -50, proceeds = 50) -- combined with the first row
        # this nets to pnl 0 over a cost basis of 200, i.e. 0.0%.
        with get_session() as session:
            session.add(_make_trader_trade(1, pnl_usd=-50.0, amount_usd=50.0))
            session.flush()

        cached_30d = service.get_wallet_pnl_pct(1, days=30, use_cache=True)
        assert cached_30d == pytest.approx(50.0)  # stale cached value, not recomputed

        fresh_30d = service.get_wallet_pnl_pct(1, days=30, use_cache=False)
        assert fresh_30d != pytest.approx(50.0)  # bypasses cache, sees the new trade


class TestWalletPnlCacheEviction:
    def test_cache_stays_bounded_under_max_size(self, sqlite_db, monkeypatch):
        """M2: the module-level cache must not grow without bound."""
        from bot.services import copy_service as copy_service_module

        monkeypatch.setattr(copy_service_module, "_WALLET_PNL_CACHE_MAX_SIZE", 5)

        service = CopyService()
        with get_session() as session:
            session.add(User(id=1, username="trader"))
            session.flush()
            session.add(_make_trader_trade(1, pnl_usd=10.0, amount_usd=100.0))
            session.flush()

        for days in range(1, 21):
            service.get_wallet_pnl_pct(1, days=days, use_cache=True)

        assert len(_wallet_pnl_cache) <= 5

    def test_concurrent_eviction_does_not_raise(self, monkeypatch):
        """A3: `_wallet_pnl_cache_evict_if_full` used to run `min(...)` over
        the cache dict unguarded, which can KeyError (or raise "dictionary
        changed size during iteration") if another thread pops an entry
        mid-iteration. Hammer the cache/eviction path directly from many
        threads with a tiny max size (forcing constant eviction) and assert
        it never raises and never exceeds the bound.

        Deliberately bypasses the DB/service layer entirely and drives
        `_wallet_pnl_cache_evict_if_full` + the cache dict directly, the same
        way `get_wallet_pnl_pct` does under its lock -- this isolates the
        cache-locking behavior under test (A3) from SQLite's own
        thread-safety characteristics under many concurrent sessions, which
        is a separate, unrelated concern.
        """
        import concurrent.futures
        import time as time_module

        from bot.services import copy_service as copy_service_module

        monkeypatch.setattr(copy_service_module, "_WALLET_PNL_CACHE_MAX_SIZE", 8)
        _wallet_pnl_cache.clear()

        errors = []

        def _worker(worker_id):
            try:
                for i in range(200):
                    key = (worker_id, i)
                    copy_service_module._wallet_pnl_cache_evict_if_full(key)
                    now = time_module.time()
                    with copy_service_module._wallet_pnl_cache_lock:
                        _wallet_pnl_cache[key] = (float(worker_id), now + 300)
            except Exception as exc:  # pragma: no cover - surfaced via errors list
                errors.append(exc)

        with concurrent.futures.ThreadPoolExecutor(max_workers=20) as pool:
            list(pool.map(_worker, range(20)))

        assert errors == []
        assert len(_wallet_pnl_cache) <= 8


class TestFormatWalletPnlPct:
    def test_none_renders_as_na(self):
        assert format_wallet_pnl_pct(None) == "N/A"

    def test_negative_renders_with_sign(self):
        assert format_wallet_pnl_pct(-60.0) == "-60.0%"

    def test_positive_renders_with_sign(self):
        assert format_wallet_pnl_pct(25.0) == "+25.0%"


class TestLeaderboardRendersPnlPct:
    def test_get_top_traders_includes_pnl_pct(self, sqlite_db):
        service = CopyService()
        with get_session() as session:
            session.add(User(id=1, username="trader"))
            session.add(
                TraderProfile(
                    user_id=1,
                    is_public=True,
                    display_name="Leader",
                    total_trades=5,
                    win_rate=60.0,
                    total_pnl_usd=42.0,
                    follower_count=2,
                )
            )
            session.flush()
            # cost 100, pnl 50, proceeds = 150.
            session.add(_make_trader_trade(1, pnl_usd=50.0, amount_usd=150.0))
            session.flush()

        traders = service.get_top_traders(10)
        assert len(traders) == 1
        assert traders[0]["pnl_pct"] == pytest.approx(50.0)

    def test_format_top_traders_message_renders_negative_pnl(self, sqlite_db):
        service = CopyService()
        with get_session() as session:
            session.add(User(id=1, username="loser"))
            session.add(
                TraderProfile(
                    user_id=1,
                    is_public=True,
                    display_name="Loser",
                    total_trades=5,
                    win_rate=20.0,
                    total_pnl_usd=-10.0,
                    follower_count=1,
                )
            )
            session.flush()
            # cost 100, pnl -60, proceeds = 40.
            session.add(_make_trader_trade(1, pnl_usd=-60.0, amount_usd=40.0))
            session.flush()

        msg = service.format_top_traders_message()
        assert "-60.0%" in msg
        assert "Loser" in msg

    def test_format_top_traders_message_renders_na_when_insufficient_data(self, sqlite_db):
        """A public trader with only unclosed (pure-buy) history must show
        N/A, never a fabricated 0.0%."""
        service = CopyService()
        with get_session() as session:
            session.add(User(id=1, username="newtrader"))
            session.add(
                TraderProfile(
                    user_id=1,
                    is_public=True,
                    display_name="NewTrader",
                    total_trades=5,
                    win_rate=0.0,
                    total_pnl_usd=0.0,
                    follower_count=0,
                )
            )
            session.flush()
            session.add(_make_trader_trade(1, pnl_usd=0.0, amount_usd=100.0, is_closed=False))
            session.flush()

        msg = service.format_top_traders_message()
        assert "N/A" in msg
        assert "NewTrader" in msg


class TestMinWalletPnlPctFilter:
    def test_skips_follower_when_trader_below_threshold(self, sqlite_db):
        import asyncio
        from types import SimpleNamespace

        service = CopyService()
        with get_session() as session:
            session.add_all([User(id=1, username="leader"), User(id=2, username="copier")])
            session.add(TraderProfile(user_id=1, is_public=True, display_name="Leader"))
            session.flush()
            # Trader's realized wallet PnL% is -37.5% (a loss): cost 100, pnl
            # -60, proceeds 40 -> -60 / (40 - (-60)) * 100 = -37.5%.
            session.add(_make_trader_trade(1, pnl_usd=-60.0, amount_usd=40.0))
            session.add(
                CopyFollow(
                    follower_id=2,
                    trader_id=1,
                    copy_mode="notify",
                    min_wallet_pnl_pct=0.0,  # only copy traders with >= 0% recent PnL
                )
            )
            swap = SwapTransaction(
                user_id=1,
                from_chain="ethereum",
                from_token="ETH",
                from_amount="1",
                from_amount_usd=100.0,
                to_chain="ethereum",
                to_token="PEPE",
                to_amount="1000",
                to_amount_usd=95.0,
                status=SwapStatus.SUBMITTED.value,
            )
            session.add(swap)
            session.flush()
            swap_id = swap.id

        notified = asyncio.run(
            service.record_trade(
                1,
                SimpleNamespace(
                    id=swap_id,
                    from_token="ETH",
                    to_token="PEPE",
                    from_chain="ethereum",
                    to_chain="ethereum",
                    from_amount="1",
                    from_amount_usd=100.0,
                    to_amount="1000",
                    to_amount_usd=95.0,
                ),
                amount_usd=100.0,
            )
        )

        assert notified == []

    def test_notifies_follower_when_trader_meets_threshold(self, sqlite_db):
        import asyncio
        from types import SimpleNamespace

        service = CopyService()
        with get_session() as session:
            session.add_all([User(id=1, username="leader"), User(id=2, username="copier")])
            session.add(TraderProfile(user_id=1, is_public=True, display_name="Leader"))
            session.flush()
            # Trader's realized wallet PnL% is +33.3% (profit): cost 75, pnl
            # 25, proceeds 100 -> 25 / (100 - 25) * 100 = 33.33%.
            session.add(_make_trader_trade(1, pnl_usd=25.0, amount_usd=100.0))
            session.add(
                CopyFollow(
                    follower_id=2,
                    trader_id=1,
                    copy_mode="notify",
                    min_wallet_pnl_pct=10.0,
                )
            )
            swap = SwapTransaction(
                user_id=1,
                from_chain="ethereum",
                from_token="ETH",
                from_amount="1",
                from_amount_usd=100.0,
                to_chain="ethereum",
                to_token="PEPE",
                to_amount="1000",
                to_amount_usd=95.0,
                status=SwapStatus.SUBMITTED.value,
            )
            session.add(swap)
            session.flush()
            swap_id = swap.id

        notified = asyncio.run(
            service.record_trade(
                1,
                SimpleNamespace(
                    id=swap_id,
                    from_token="ETH",
                    to_token="PEPE",
                    from_chain="ethereum",
                    to_chain="ethereum",
                    from_amount="1",
                    from_amount_usd=100.0,
                    to_amount="1000",
                    to_amount_usd=95.0,
                ),
                amount_usd=100.0,
            )
        )

        assert len(notified) == 1
        assert notified[0]["user_id"] == 2

    def test_never_blocks_when_pnl_data_insufficient_fail_open(self, sqlite_db):
        """H4 core regression: a follower who sets min_wallet_pnl_pct=0.0 (the
        natural 'only copy profitable traders' threshold) must NOT have their
        copy silently dropped just because the trader has no realized-close
        history yet (e.g. a brand-new public trader who hasn't sold anything).
        Insufficient data must fail OPEN (pass-through), never block."""
        import asyncio
        from types import SimpleNamespace

        service = CopyService()
        with get_session() as session:
            session.add_all([User(id=1, username="leader"), User(id=2, username="copier")])
            session.add(TraderProfile(user_id=1, is_public=True, display_name="Leader"))
            session.flush()
            # No TraderTrade history at all yet for trader 1 -> get_wallet_pnl_pct
            # returns None (insufficient data), not 0.0.
            session.add(
                CopyFollow(
                    follower_id=2,
                    trader_id=1,
                    copy_mode="notify",
                    min_wallet_pnl_pct=0.0,
                )
            )
            swap = SwapTransaction(
                user_id=1,
                from_chain="ethereum",
                from_token="ETH",
                from_amount="1",
                from_amount_usd=100.0,
                to_chain="ethereum",
                to_token="PEPE",
                to_amount="1000",
                to_amount_usd=95.0,
                status=SwapStatus.SUBMITTED.value,
            )
            session.add(swap)
            session.flush()
            swap_id = swap.id

        notified = asyncio.run(
            service.record_trade(
                1,
                SimpleNamespace(
                    id=swap_id,
                    from_token="ETH",
                    to_token="PEPE",
                    from_chain="ethereum",
                    to_chain="ethereum",
                    from_amount="1",
                    from_amount_usd=100.0,
                    to_amount="1000",
                    to_amount_usd=95.0,
                ),
                amount_usd=100.0,
            )
        )

        # This is the trader's first-ever recorded trade: there is no prior
        # TraderPosition for ETH to realize PnL against, so record_trade()
        # itself settles it as an unrealized (is_closed=False) row and
        # wallet_pnl_pct stays None -- the follower must still be notified.
        assert len(notified) == 1
        assert notified[0]["user_id"] == 2

    def test_high_threshold_100_does_not_permanently_block_a_doubled_trader(self, sqlite_db):
        """A1 core regression: under the old (v2) proceeds-denominator formula,
        pnl/proceeds is mathematically CAPPED at +100%, so a follower who set
        min_wallet_pnl_pct=100 ("only copy traders who doubled their money")
        had EVERY copy silently and permanently dropped -- no trader could
        ever clear that bar. Under the fixed cost-basis formula, a trader who
        genuinely doubled (cost 100, pnl 100, proceeds 200) reads exactly
        +100%, which does NOT satisfy `wallet_pnl_pct < min_wallet_pnl_pct`
        (100 is not < 100) -- so the copy must NOT be blocked."""
        import asyncio
        from types import SimpleNamespace

        service = CopyService()
        with get_session() as session:
            session.add_all([User(id=1, username="leader"), User(id=2, username="copier")])
            session.add(TraderProfile(user_id=1, is_public=True, display_name="Leader"))
            session.flush()
            # Genuinely doubled: cost 100, pnl 100, proceeds 200 -> +100%.
            session.add(_make_trader_trade(1, pnl_usd=100.0, amount_usd=200.0))
            session.add(
                CopyFollow(
                    follower_id=2,
                    trader_id=1,
                    copy_mode="notify",
                    min_wallet_pnl_pct=100.0,
                )
            )
            swap = SwapTransaction(
                user_id=1,
                from_chain="ethereum",
                from_token="ETH",
                from_amount="1",
                from_amount_usd=100.0,
                to_chain="ethereum",
                to_token="PEPE",
                to_amount="1000",
                to_amount_usd=95.0,
                status=SwapStatus.SUBMITTED.value,
            )
            session.add(swap)
            session.flush()
            swap_id = swap.id

        notified = asyncio.run(
            service.record_trade(
                1,
                SimpleNamespace(
                    id=swap_id,
                    from_token="ETH",
                    to_token="PEPE",
                    from_chain="ethereum",
                    to_chain="ethereum",
                    from_amount="1",
                    from_amount_usd=100.0,
                    to_amount="1000",
                    to_amount_usd=95.0,
                ),
                amount_usd=100.0,
            )
        )

        assert len(notified) == 1
        assert notified[0]["user_id"] == 2
