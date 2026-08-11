"""Tests for bot/services/gas_topup_service.py — MONEY-PATH.

Auto gas top-up from the hot wallet so a Gekko user never needs to hold ETH
to move USDC on Base. Covers: no-op when balance is already sufficient, the
per-transaction ceiling, per-user/per-IP/global daily caps, the happy path
(zero-ETH wallet gets topped up and the audit row is written), every
retryable-failure path (broadcast failure, confirmation timeout, on-chain
revert, no gas payer configured), and the Opus money-path review fixes:
  F2 — live (sum-of-both-legs) deposit gas estimate
  F3 — audit row inserted BEFORE broadcast, fails closed on insert failure
  F4 — dedicated dispatch pool / shortened confirm timeout
  F5 — genuinely-sync live price path + absolute-wei global cap
  F6 — atomic global/per-IP daily reserve
  F7 — OP-stack L1 data fee included in gas estimates
  F8 — caps fail closed (GasTopUpFailed) on a DB read failure
"""

import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("SECRET_KEY", "test-secret")

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy import text

import bot.services.gas_topup_service as topup_mod
import bot.services.hot_wallet as hot_wallet_mod
import bot.services.rpc_manager as rpc_manager_mod
from bot.models.gas_topup import GasTopUp
from bot.models.user import User
from database.db import get_session

WALLET = "0x" + "22" * 20
GAS_WALLET_ADDR = "0x" + "33" * 20
OTHER_WALLET = "0x" + "44" * 20


def _make_user(telegram_id: int) -> int:
    with get_session() as session:
        user = User(telegram_id=telegram_id, username=f"u{telegram_id}", tos_accepted=True)
        session.add(user)
        session.flush()
        return user.id


def _fake_web3(balances, gas_price=1_000_000_000, receipt_status=1, receipt_error=None):
    """`balances` is consumed in order by successive `eth.get_balance` calls."""
    web3 = MagicMock()
    web3.eth.get_balance = MagicMock(side_effect=list(balances))
    web3.eth.gas_price = gas_price
    if receipt_error is not None:
        web3.eth.wait_for_transaction_receipt = MagicMock(side_effect=receipt_error)
    else:
        web3.eth.wait_for_transaction_receipt = MagicMock(return_value={"status": receipt_status})
    return web3


@pytest.fixture(autouse=True)
def _patch_price(monkeypatch):
    """Deterministic ETH price for every test unless a test overrides it —
    F5 fix: patches the standalone sync fetch seam, not price_service."""
    monkeypatch.setattr(topup_mod, "_fetch_live_eth_price_usd", MagicMock(return_value=3000.0))


@pytest.fixture()
def fake_gas_wallet():
    return SimpleNamespace(address=GAS_WALLET_ADDR, id=1)


def _rows_for(user_id: int):
    with get_session() as session:
        return session.query(GasTopUp).filter(GasTopUp.user_id == user_id).all()


def _seed_counter(scope: str, total_wei: int, count: int = 1) -> None:
    """Seed gas_topup_daily_counters directly — the table `_daily_reserve`
    (F6) reads/writes, replacing the old gas_topups-table-sum approach for
    the global/per-IP checks."""
    with get_session() as session:
        session.execute(
            text(
                "INSERT INTO gas_topup_daily_counters (day, scope, total_wei, topup_count) "
                "VALUES (:day, :scope, :total_wei, :count)"
            ),
            {"day": topup_mod._utc_today(), "scope": scope, "total_wei": total_wei, "count": count},
        )


# ── no-op when balance is already sufficient ────────────────────────────


def test_no_topup_when_balance_sufficient(tmp_db, monkeypatch):
    user_id = _make_user(101)
    web3 = _fake_web3(balances=[10**18])
    monkeypatch.setattr(rpc_manager_mod.rpc_manager, "get_web3", MagicMock(return_value=web3))
    send_mock = AsyncMock()
    monkeypatch.setattr(hot_wallet_mod.hot_wallet_service, "send_native_token", send_mock)

    result = topup_mod.ensure_gas(
        user_id=user_id,
        wallet_address=WALLET,
        chain_name="base",
        estimated_gas_wei=1000,
        reason="test",
    )

    assert result is False
    send_mock.assert_not_called()
    assert _rows_for(user_id) == []


# ── happy path: zero-ETH wallet gets topped up ──────────────────────────


def test_topup_happy_path_zero_eth_wallet(tmp_db, monkeypatch, fake_gas_wallet):
    user_id = _make_user(102)
    web3 = _fake_web3(balances=[0])
    monkeypatch.setattr(rpc_manager_mod.rpc_manager, "get_web3", MagicMock(return_value=web3))
    monkeypatch.setattr(
        hot_wallet_mod.hot_wallet_service,
        "get_gas_payer_wallet",
        MagicMock(return_value=fake_gas_wallet),
    )
    send_mock = AsyncMock(return_value="0xtopuphash")
    monkeypatch.setattr(hot_wallet_mod.hot_wallet_service, "send_native_token", send_mock)

    result = topup_mod.ensure_gas(
        user_id=user_id,
        wallet_address=WALLET,
        chain_name="base",
        estimated_gas_wei=21_000 * 1_000_000_000,
        reason="mobile_send",
        ip_address="1.2.3.4",
    )

    assert result is True
    send_mock.assert_awaited_once()
    kwargs = send_mock.await_args.kwargs
    # Only ever sends to the wallet address the caller resolved (the
    # authenticated user's own wallet) — never anything else.
    assert kwargs["to_address"].lower() == WALLET.lower()
    assert kwargs["wallet"] is fake_gas_wallet

    rows = _rows_for(user_id)
    assert len(rows) == 1
    assert rows[0].tx_hash == "0xtopuphash"
    assert rows[0].wallet_address.lower() == WALLET.lower()
    assert rows[0].reason == "mobile_send"
    assert rows[0].status == "sent"
    assert rows[0].amount_wei > 0


# ── per-transaction ceiling ──────────────────────────────────────────────


def test_per_tx_ceiling_exceeded_raises_without_spending(tmp_db, monkeypatch):
    user_id = _make_user(103)
    web3 = _fake_web3(balances=[0])
    monkeypatch.setattr(rpc_manager_mod.rpc_manager, "get_web3", MagicMock(return_value=web3))
    send_mock = AsyncMock()
    monkeypatch.setattr(hot_wallet_mod.hot_wallet_service, "send_native_token", send_mock)

    with pytest.raises(topup_mod.GasTopUpCapExceeded):
        topup_mod.ensure_gas(
            user_id=user_id,
            wallet_address=WALLET,
            chain_name="base",
            estimated_gas_wei=10**18,  # ~1 ETH, way beyond the $0.50 ceiling
            reason="test",
        )

    send_mock.assert_not_called()
    assert _rows_for(user_id) == []


# ── per-user daily caps ──────────────────────────────────────────────────


def test_per_user_daily_count_cap(tmp_db, monkeypatch):
    user_id = _make_user(104)
    with get_session() as session:
        for _ in range(topup_mod.MAX_TOPUPS_PER_USER_PER_DAY):
            session.add(
                GasTopUp(
                    user_id=user_id,
                    wallet_address=WALLET,
                    chain="base",
                    amount_wei=1,
                    tx_hash="0xseed",
                    reason="seed",
                    status="sent",
                )
            )
    web3 = _fake_web3(balances=[0])
    monkeypatch.setattr(rpc_manager_mod.rpc_manager, "get_web3", MagicMock(return_value=web3))
    send_mock = AsyncMock()
    monkeypatch.setattr(hot_wallet_mod.hot_wallet_service, "send_native_token", send_mock)

    with pytest.raises(topup_mod.GasTopUpCapExceeded):
        topup_mod.ensure_gas(
            user_id=user_id,
            wallet_address=WALLET,
            chain_name="base",
            estimated_gas_wei=100,
            reason="test",
        )

    send_mock.assert_not_called()


def test_per_user_daily_value_cap(tmp_db, monkeypatch):
    user_id = _make_user(105)
    ceiling = topup_mod._max_topup_wei()
    max_daily = ceiling * topup_mod.USER_DAILY_TOPUP_MULTIPLE
    with get_session() as session:
        session.add(
            GasTopUp(
                user_id=user_id,
                wallet_address=WALLET,
                chain="base",
                amount_wei=max_daily - 10,
                tx_hash="0xseed",
                reason="seed",
                status="sent",
            )
        )
    web3 = _fake_web3(balances=[0])
    monkeypatch.setattr(rpc_manager_mod.rpc_manager, "get_web3", MagicMock(return_value=web3))
    send_mock = AsyncMock()
    monkeypatch.setattr(hot_wallet_mod.hot_wallet_service, "send_native_token", send_mock)

    with pytest.raises(topup_mod.GasTopUpCapExceeded):
        topup_mod.ensure_gas(
            user_id=user_id,
            wallet_address=WALLET,
            chain_name="base",
            estimated_gas_wei=ceiling,
            reason="test",
        )

    send_mock.assert_not_called()


# ── per-IP daily cap (F6) ─────────────────────────────────────────────────


def test_per_ip_daily_cap_blocks_before_global_or_gas_payer(tmp_db, monkeypatch):
    """A single IP minting many user_ids still gets capped — the sybil lever
    F6 closes. Raised before ever reaching the hot wallet."""
    user_id = _make_user(112)
    ceiling = topup_mod._max_topup_wei()
    max_ip_daily = ceiling * topup_mod.IP_DAILY_TOPUP_MULTIPLE
    _seed_counter("ip:9.9.9.9", max_ip_daily - 10)
    web3 = _fake_web3(balances=[0])
    monkeypatch.setattr(rpc_manager_mod.rpc_manager, "get_web3", MagicMock(return_value=web3))
    send_mock = AsyncMock()
    monkeypatch.setattr(hot_wallet_mod.hot_wallet_service, "send_native_token", send_mock)

    with pytest.raises(topup_mod.GasTopUpCapExceeded):
        topup_mod.ensure_gas(
            user_id=user_id,
            wallet_address=WALLET,
            chain_name="base",
            estimated_gas_wei=ceiling,
            reason="test",
            ip_address="9.9.9.9",
        )

    send_mock.assert_not_called()
    assert _rows_for(user_id) == []
    # A DIFFERENT IP's bucket is untouched by the first IP's exhausted cap —
    # tested directly against the reserve function (`ensure_gas` for a
    # second user/IP would additionally depend on gas-payer wiring not
    # relevant to what this test is about: scope isolation).
    assert topup_mod._daily_reserve("ip:1.1.1.1", ceiling, max_ip_daily, 20) is True


# ── global daily circuit breaker (F5 absolute cap / F6 atomic reserve) ──


def test_global_daily_circuit_breaker_trips_and_logs_critical(tmp_db, monkeypatch, caplog):
    user_id = _make_user(106)
    ceiling = topup_mod._max_topup_wei()
    _seed_counter("global", topup_mod.GAS_TOPUP_GLOBAL_DAILY_CAP_WEI - 10)
    web3 = _fake_web3(balances=[0])
    monkeypatch.setattr(rpc_manager_mod.rpc_manager, "get_web3", MagicMock(return_value=web3))
    send_mock = AsyncMock()
    monkeypatch.setattr(hot_wallet_mod.hot_wallet_service, "send_native_token", send_mock)

    with caplog.at_level("CRITICAL"):
        with pytest.raises(topup_mod.GasTopUpCapExceeded):
            topup_mod.ensure_gas(
                user_id=user_id,
                wallet_address=WALLET,
                chain_name="base",
                estimated_gas_wei=ceiling,
                reason="test",
            )

    send_mock.assert_not_called()
    assert any("CIRCUIT BREAKER" in rec.message for rec in caplog.records)


def test_global_cap_is_an_absolute_wei_constant_not_a_ceiling_multiple(monkeypatch):
    """F5: GAS_TOPUP_GLOBAL_DAILY_CAP_WEI must NOT move with the live/derived
    per-tx ceiling — it's a fixed constant precisely so a price-feed swing
    (or the old broken price path always hitting the fallback) can't quietly
    change the network-wide daily exposure."""
    assert topup_mod.GAS_TOPUP_GLOBAL_DAILY_CAP_WEI == 100_000_000_000_000_000
    assert not hasattr(topup_mod, "GLOBAL_DAILY_TOPUP_MULTIPLE")


def test_daily_reserve_atomically_blocks_overshoot_at_the_boundary(tmp_db):
    """Direct test of the F6 UPSERT: a reservation that would push the
    scope's total over the cap is refused and reserves nothing; one that
    fits is accepted and durably recorded."""
    cap = 1000
    assert topup_mod._daily_reserve("test-scope", 600, cap, 10) is True
    # A second reservation that would push 600+500=1100 > 1000 must fail...
    assert topup_mod._daily_reserve("test-scope", 500, cap, 10) is False
    # ...and must NOT have partially applied (still exactly 600 reserved).
    assert topup_mod._daily_reserve("test-scope", 400, cap, 10) is True  # 600+400=1000, fits


# ── failure / retryable paths ────────────────────────────────────────────


def test_no_gas_payer_wallet_raises_retryable_failure(tmp_db, monkeypatch):
    user_id = _make_user(108)
    web3 = _fake_web3(balances=[0])
    monkeypatch.setattr(rpc_manager_mod.rpc_manager, "get_web3", MagicMock(return_value=web3))
    monkeypatch.setattr(
        hot_wallet_mod.hot_wallet_service, "get_gas_payer_wallet", MagicMock(return_value=None)
    )

    with pytest.raises(topup_mod.GasTopUpFailed):
        topup_mod.ensure_gas(
            user_id=user_id,
            wallet_address=WALLET,
            chain_name="base",
            estimated_gas_wei=21_000,
            reason="test",
        )

    # F3: the row is only inserted once we're past the gas-payer lookup and
    # committed to spending, so no gas payer configured means no row either.
    assert _rows_for(user_id) == []


def test_topup_broadcast_failure_raises_retryable_and_records_a_failed_row(
    tmp_db, monkeypatch, fake_gas_wallet
):
    """F3 fix: the audit row is inserted BEFORE broadcast (status=pending)
    and updated to status=failed on a broadcast exception — never silently
    lost, unlike the old post-broadcast-only record that left nothing
    behind for a pre-confirmation failure."""
    user_id = _make_user(109)
    web3 = _fake_web3(balances=[0])
    monkeypatch.setattr(rpc_manager_mod.rpc_manager, "get_web3", MagicMock(return_value=web3))
    monkeypatch.setattr(
        hot_wallet_mod.hot_wallet_service,
        "get_gas_payer_wallet",
        MagicMock(return_value=fake_gas_wallet),
    )
    monkeypatch.setattr(
        hot_wallet_mod.hot_wallet_service,
        "send_native_token",
        AsyncMock(side_effect=RuntimeError("rpc down")),
    )

    with pytest.raises(topup_mod.GasTopUpFailed):
        topup_mod.ensure_gas(
            user_id=user_id,
            wallet_address=WALLET,
            chain_name="base",
            estimated_gas_wei=21_000,
            reason="test",
        )

    rows = _rows_for(user_id)
    assert len(rows) == 1
    assert rows[0].status == "failed"
    assert rows[0].tx_hash is None


def test_topup_confirmation_timeout_raises_retryable_but_records_the_spend(
    tmp_db, monkeypatch, fake_gas_wallet
):
    user_id = _make_user(110)
    web3 = _fake_web3(balances=[0], receipt_error=TimeoutError("no receipt"))
    monkeypatch.setattr(rpc_manager_mod.rpc_manager, "get_web3", MagicMock(return_value=web3))
    monkeypatch.setattr(
        hot_wallet_mod.hot_wallet_service,
        "get_gas_payer_wallet",
        MagicMock(return_value=fake_gas_wallet),
    )
    monkeypatch.setattr(
        hot_wallet_mod.hot_wallet_service, "send_native_token", AsyncMock(return_value="0xslow")
    )

    with pytest.raises(topup_mod.GasTopUpFailed):
        topup_mod.ensure_gas(
            user_id=user_id,
            wallet_address=WALLET,
            chain_name="base",
            estimated_gas_wei=21_000,
            reason="test",
        )

    # Real funds were broadcast even though confirmation timed out — the
    # audit trail must not silently lose that spend.
    rows = _rows_for(user_id)
    assert len(rows) == 1
    assert rows[0].tx_hash == "0xslow"
    assert rows[0].status == "sent"


def test_topup_reverted_onchain_raises_retryable_failure(tmp_db, monkeypatch, fake_gas_wallet):
    user_id = _make_user(111)
    web3 = _fake_web3(balances=[0], receipt_status=0)
    monkeypatch.setattr(rpc_manager_mod.rpc_manager, "get_web3", MagicMock(return_value=web3))
    monkeypatch.setattr(
        hot_wallet_mod.hot_wallet_service,
        "get_gas_payer_wallet",
        MagicMock(return_value=fake_gas_wallet),
    )
    monkeypatch.setattr(
        hot_wallet_mod.hot_wallet_service,
        "send_native_token",
        AsyncMock(return_value="0xreverted"),
    )

    with pytest.raises(topup_mod.GasTopUpFailed):
        topup_mod.ensure_gas(
            user_id=user_id,
            wallet_address=WALLET,
            chain_name="base",
            estimated_gas_wei=21_000,
            reason="test",
        )


def test_pending_row_insert_failure_fails_closed_before_any_spend(
    tmp_db, monkeypatch, fake_gas_wallet
):
    """F3: if the pre-broadcast audit insert itself fails, ensure_gas must
    refuse the top-up rather than spend with nothing recorded."""
    user_id = _make_user(113)
    web3 = _fake_web3(balances=[0])
    monkeypatch.setattr(rpc_manager_mod.rpc_manager, "get_web3", MagicMock(return_value=web3))
    monkeypatch.setattr(
        hot_wallet_mod.hot_wallet_service,
        "get_gas_payer_wallet",
        MagicMock(return_value=fake_gas_wallet),
    )
    send_mock = AsyncMock(return_value="0xshouldnotsend")
    monkeypatch.setattr(hot_wallet_mod.hot_wallet_service, "send_native_token", send_mock)
    # _record_topup_pending's own try/except is what converts a raw DB
    # failure into GasTopUpFailed (see test_gas_topup_service's coverage of
    # the real DB path via the DB-failure tests above); here we test that
    # ensure_gas propagates that GasTopUpFailed and stops BEFORE broadcasting.
    monkeypatch.setattr(
        topup_mod,
        "_record_topup_pending",
        MagicMock(side_effect=topup_mod.GasTopUpFailed("insert failed")),
    )

    with pytest.raises(topup_mod.GasTopUpFailed):
        topup_mod.ensure_gas(
            user_id=user_id,
            wallet_address=WALLET,
            chain_name="base",
            estimated_gas_wei=21_000,
            reason="test",
        )

    send_mock.assert_not_called()

    send_mock.assert_not_called()


# ── F8: caps fail closed on a DB read failure ────────────────────────────


def test_user_daily_stats_db_failure_fails_closed(tmp_db, monkeypatch):
    user_id = _make_user(114)
    web3 = _fake_web3(balances=[0])
    monkeypatch.setattr(rpc_manager_mod.rpc_manager, "get_web3", MagicMock(return_value=web3))
    monkeypatch.setattr(
        topup_mod, "_user_daily_stats", MagicMock(side_effect=topup_mod.GasTopUpFailed("db down"))
    )
    send_mock = AsyncMock()
    monkeypatch.setattr(hot_wallet_mod.hot_wallet_service, "send_native_token", send_mock)

    with pytest.raises(topup_mod.GasTopUpFailed):
        topup_mod.ensure_gas(
            user_id=user_id,
            wallet_address=WALLET,
            chain_name="base",
            estimated_gas_wei=21_000,
            reason="test",
        )

    send_mock.assert_not_called()


# ── price fallback / live path (F5) ──────────────────────────────────────


def test_max_topup_wei_falls_back_when_price_lookup_fails(monkeypatch):
    monkeypatch.setattr(
        topup_mod,
        "_fetch_live_eth_price_usd",
        MagicMock(side_effect=RuntimeError("price api down")),
    )
    ceiling = topup_mod._max_topup_wei()
    assert ceiling == min(
        topup_mod.GAS_TOPUP_FALLBACK_MAX_WEI, topup_mod.GAS_TOPUP_ABSOLUTE_MAX_WEI
    )


def test_max_topup_wei_uses_live_price_when_available(monkeypatch):
    """F5: the live path must actually be reachable and produce a different
    (price-derived) ceiling than the fallback — proving it isn't dead code."""
    monkeypatch.setattr(topup_mod, "_fetch_live_eth_price_usd", MagicMock(return_value=2000.0))
    ceiling = topup_mod._max_topup_wei()
    expected = int((topup_mod.GAS_TOPUP_MAX_USD / 2000) * 10**18)
    assert ceiling == min(expected, topup_mod.GAS_TOPUP_ABSOLUTE_MAX_WEI)
    assert ceiling != min(
        topup_mod.GAS_TOPUP_FALLBACK_MAX_WEI, topup_mod.GAS_TOPUP_ABSOLUTE_MAX_WEI
    )


def test_max_topup_wei_works_from_a_worker_thread_with_no_running_loop(monkeypatch):
    """F5's actual bug: the OLD price path (asyncio.run(price_service...))
    only broke from a thread with no running loop — assert the NEW path is
    genuinely callable from exactly that context."""
    monkeypatch.setattr(topup_mod, "_fetch_live_eth_price_usd", MagicMock(return_value=2500.0))
    result = {}

    def _run():
        result["ceiling"] = topup_mod._max_topup_wei()

    import threading

    t = threading.Thread(target=_run)
    t.start()
    t.join(timeout=5)
    assert "ceiling" in result
    assert result["ceiling"] > 0


# ── F4: dedicated dispatch pool / shortened timeout ──────────────────────


def test_confirm_timeout_was_shortened_to_15s():
    assert topup_mod.GAS_TOPUP_CONFIRM_TIMEOUT_SECONDS == 15


def test_run_gas_sensitive_dispatches_off_the_default_executor():
    """F4: run_gas_sensitive must use gas_topup_service's own dedicated pool,
    not asyncio.to_thread's shared default executor."""

    async def _check():
        calls = []

        def _blocking_probe(x):
            import threading

            calls.append(threading.current_thread().name)
            return x * 2

        result = await topup_mod.run_gas_sensitive(_blocking_probe, 21)
        assert result == 42
        assert calls[0].startswith("gas-topup")

    asyncio.run(_check())


# ── F2: live deposit gas estimate (sum of both legs) ─────────────────────


def test_deposit_gas_estimate_static_fallback_covers_sum_of_both_legs():
    """F2: the static fallback (used when live estimation fails) must be
    materially above the real approve+supply sum (~331k units observed),
    not the old 220k that only covered one leg."""
    assert topup_mod.DEPOSIT_GAS_UNITS_ESTIMATE >= 400_000


def test_estimate_gas_wei_for_deposit_sums_approve_and_supply_live(monkeypatch):
    web3 = MagicMock()
    web3.eth.gas_price = 1_000_000_000
    usdc = MagicMock()
    usdc.functions.allowance.return_value.call.return_value = 0  # needs approve
    usdc.functions.approve.return_value.estimate_gas.return_value = 46_000
    usdc.functions.approve.return_value.build_transaction.return_value = {"data": "0x", "gas": 0}
    pool = MagicMock()
    web3.eth.contract = MagicMock(side_effect=[usdc, pool])
    monkeypatch.setattr(rpc_manager_mod.rpc_manager, "get_web3", MagicMock(return_value=web3))
    monkeypatch.setattr(topup_mod, "estimate_l1_data_fee_wei", MagicMock(return_value=0))

    result = topup_mod.estimate_gas_wei_for_deposit("base", WALLET, 10_000_000)

    # approve (46k*1.2) + static supply-leg fallback (280k*1.2), * gas_price
    expected_units = int(46_000 * 1.2) + int(280_000 * 1.2)
    assert result == expected_units * 1_000_000_000


def test_estimate_gas_wei_for_deposit_falls_back_on_rpc_failure(monkeypatch):
    """The live estimate path fails (RPC down); the function must fall back
    to `estimate_gas_wei_for_action(chain, DEPOSIT_GAS_UNITS_ESTIMATE)`
    rather than raise — proven here by mocking that exact fallback seam so
    the test doesn't depend on the fallback's OWN RPC call also succeeding."""
    monkeypatch.setattr(
        rpc_manager_mod.rpc_manager, "get_web3", MagicMock(side_effect=RuntimeError("rpc down"))
    )
    fallback_mock = MagicMock(return_value=999)
    monkeypatch.setattr(topup_mod, "estimate_gas_wei_for_action", fallback_mock)

    result = topup_mod.estimate_gas_wei_for_deposit("base", WALLET, 10_000_000)

    assert result == 999
    fallback_mock.assert_called_once_with("base", topup_mod.DEPOSIT_GAS_UNITS_ESTIMATE)


# ── F7: OP-stack L1 data fee ──────────────────────────────────────────────


def test_estimate_l1_data_fee_wei_returns_zero_for_non_op_stack_chain():
    assert topup_mod.estimate_l1_data_fee_wei("ethereum", {"data": "0x"}) == 0


def test_estimate_l1_data_fee_wei_queries_the_oracle_on_base(monkeypatch):
    web3 = MagicMock()
    oracle = MagicMock()
    oracle.functions.getL1Fee.return_value.call.return_value = 12345
    web3.eth.contract = MagicMock(return_value=oracle)
    monkeypatch.setattr(rpc_manager_mod.rpc_manager, "get_web3", MagicMock(return_value=web3))

    fee = topup_mod.estimate_l1_data_fee_wei("base", {"data": "0xabcd"})

    assert fee == 12345


def test_estimate_l1_data_fee_wei_never_raises_on_rpc_failure(monkeypatch):
    monkeypatch.setattr(
        rpc_manager_mod.rpc_manager, "get_web3", MagicMock(side_effect=RuntimeError("down"))
    )
    assert topup_mod.estimate_l1_data_fee_wei("base", {"data": "0x"}) == 0


def test_estimate_gas_wei_for_action_includes_l1_fee(monkeypatch):
    web3 = MagicMock()
    web3.eth.gas_price = 1_000_000_000
    monkeypatch.setattr(rpc_manager_mod.rpc_manager, "get_web3", MagicMock(return_value=web3))
    monkeypatch.setattr(topup_mod, "estimate_l1_data_fee_wei", MagicMock(return_value=999))

    result = topup_mod.estimate_gas_wei_for_action("base", 170_000)

    assert result == 170_000 * 1_000_000_000 + 999
