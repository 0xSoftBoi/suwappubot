"""Tests for bot/services/fee_sweeper.py — automatic fee sweep loop.

Covers:
  * Happy-path sweep math (totals over successful batches).
  * A failing sweep target is logged and does NOT crash the sweep — the loop
    still processes the remaining (successful) batches.
  * The vault-deposit path for the protocol's 60% share: triggered only when
    aave_enabled + threshold met, and a deposit failure is logged loudly
    (logger.error) but never crashes the sweep.
  * The outer `_sweep_loop` survives an exception raised by `_do_sweep` on one
    iteration and keeps going to the next (via logger.error, per the recent
    "must be loud" change).
  * `sweep_now()` triggers an immediate sweep and returns the (now empty)
    uncollected list.
"""

import asyncio
import logging
import os
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-32byteslong!!")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

import pytest

from bot.services.fee_sweeper import FeeSweeper


@pytest.fixture()
def sweeper():
    return FeeSweeper()


@pytest.fixture()
def mock_fee_service(monkeypatch):
    """Patch the module-level `fee_service` reference used by fee_sweeper."""
    import bot.services.fee_sweeper as fee_sweeper_module

    mock = MagicMock()
    mock.get_uncollected_fees = MagicMock(return_value=[])
    mock.sweep_all_fees = AsyncMock(return_value=[])
    monkeypatch.setattr(fee_sweeper_module, "fee_service", mock)
    return mock


def _batch(chain="ethereum", token="USDC", amount=100.0, amount_usd=100.0, tx_count=3):
    return {
        "chain": chain,
        "token": token,
        "amount": amount,
        "amount_usd": amount_usd,
        "tx_count": tx_count,
    }


def _success(chain="ethereum", token="USDC", amount=100.0, amount_usd=100.0):
    return {
        "chain": chain,
        "token": token,
        "amount": amount,
        "amount_usd": amount_usd,
        "success": True,
        "message": "ok",
    }


def _failure(chain="solana", token="SOL", message="No collector address configured"):
    return {"chain": chain, "token": token, "amount": 5.0, "success": False, "message": message}


# ---------------------------------------------------------------------------
# Filtering / no-op paths
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_do_sweep_no_uncollected_fees_is_noop(sweeper, mock_fee_service):
    mock_fee_service.get_uncollected_fees.return_value = []

    await sweeper._do_sweep()

    mock_fee_service.sweep_all_fees.assert_not_called()
    assert sweeper._last_sweep is None


@pytest.mark.asyncio
async def test_do_sweep_below_minimum_amount_is_noop(sweeper, mock_fee_service):
    mock_fee_service.get_uncollected_fees.return_value = [_batch(amount_usd=0.5)]

    await sweeper._do_sweep()

    mock_fee_service.sweep_all_fees.assert_not_called()


# ---------------------------------------------------------------------------
# Happy path math
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_do_sweep_happy_path_updates_last_sweep(sweeper, mock_fee_service):
    mock_fee_service.get_uncollected_fees.return_value = [_batch(amount_usd=100.0)]
    mock_fee_service.sweep_all_fees.return_value = [_success(amount=100.0, amount_usd=100.0)]

    assert sweeper._last_sweep is None
    await sweeper._do_sweep()

    mock_fee_service.sweep_all_fees.assert_awaited_once()
    assert sweeper._last_sweep is not None


@pytest.mark.asyncio
async def test_do_sweep_timeout_returns_without_crash_or_last_sweep(
    sweeper, mock_fee_service, monkeypatch
):
    mock_fee_service.get_uncollected_fees.return_value = [_batch(amount_usd=100.0)]

    async def _hangs(*a, **kw):
        await asyncio.sleep(10)

    mock_fee_service.sweep_all_fees = _hangs
    monkeypatch.setattr("bot.services.fee_sweeper.SWEEP_TIMEOUT_SECONDS", 0.05)

    await sweeper._do_sweep()

    # Timed out -> bailed early, no crash, no last_sweep update.
    assert sweeper._last_sweep is None


# ---------------------------------------------------------------------------
# Partial failure of individual sweep targets
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_do_sweep_partial_failure_logs_and_continues(sweeper, mock_fee_service, caplog):
    mock_fee_service.get_uncollected_fees.return_value = [
        _batch(chain="ethereum", token="USDC", amount_usd=100.0),
        _batch(chain="solana", token="SOL", amount_usd=50.0),
    ]
    mock_fee_service.sweep_all_fees.return_value = [
        _success(chain="ethereum", token="USDC", amount=100.0, amount_usd=100.0),
        _failure(chain="solana", token="SOL", message="No collector address configured"),
    ]

    with caplog.at_level(logging.WARNING, logger="bot.services.fee_sweeper"):
        await sweeper._do_sweep()

    assert any("Sweep failed for solana/SOL" in r.message for r in caplog.records)
    # Loop did not crash — successful batch still resulted in a completed sweep.
    assert sweeper._last_sweep is not None


@pytest.mark.asyncio
async def test_do_sweep_malformed_failure_dict_does_not_crash_loop(
    sweeper, mock_fee_service, caplog
):
    """A failed-batch dict missing expected keys must not blow up the sweep."""
    mock_fee_service.get_uncollected_fees.return_value = [_batch(amount_usd=100.0)]
    # Missing "chain"/"token"/"message" keys -> f['chain'] raises KeyError internally.
    mock_fee_service.sweep_all_fees.return_value = [{"success": False, "amount": 1.0}]

    with caplog.at_level(logging.ERROR, logger="bot.services.fee_sweeper"):
        await sweeper._do_sweep()  # must not raise

    assert any("Failed to log sweep failure" in r.message for r in caplog.records)


# ---------------------------------------------------------------------------
# Vault deposit split (protocol's 60% share)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_vault_deposit_triggered_when_enabled_and_threshold_met(
    sweeper, mock_fee_service, monkeypatch
):
    from bot.config.settings import settings
    import bot.services.treasury_vault_service as vault_module

    monkeypatch.setattr(settings, "aave_enabled", True)
    monkeypatch.setattr(settings, "vault_min_deposit_usdc", 50.0)

    mock_fee_service.get_uncollected_fees.return_value = [_batch(amount_usd=1000.0)]
    mock_fee_service.sweep_all_fees.return_value = [_success(amount=1000.0, amount_usd=1000.0)]

    mock_deposit = MagicMock(return_value="0xvaulttxhash")
    monkeypatch.setattr(vault_module.treasury_vault_service, "deposit_to_vault", mock_deposit)

    await sweeper._do_sweep()

    # 60% of $1000 = $600
    mock_deposit.assert_called_once()
    (amount_arg,), _ = mock_deposit.call_args
    assert amount_arg == Decimal("600.00")


@pytest.mark.asyncio
async def test_vault_deposit_skipped_below_threshold(sweeper, mock_fee_service, monkeypatch):
    from bot.config.settings import settings
    import bot.services.treasury_vault_service as vault_module

    monkeypatch.setattr(settings, "aave_enabled", True)
    monkeypatch.setattr(settings, "vault_min_deposit_usdc", 1000.0)  # far above 60% share

    mock_fee_service.get_uncollected_fees.return_value = [_batch(amount_usd=100.0)]
    mock_fee_service.sweep_all_fees.return_value = [_success(amount=100.0, amount_usd=100.0)]

    mock_deposit = MagicMock()
    monkeypatch.setattr(vault_module.treasury_vault_service, "deposit_to_vault", mock_deposit)

    await sweeper._do_sweep()

    mock_deposit.assert_not_called()


@pytest.mark.asyncio
async def test_vault_deposit_skipped_when_aave_disabled(sweeper, mock_fee_service, monkeypatch):
    from bot.config.settings import settings
    import bot.services.treasury_vault_service as vault_module

    monkeypatch.setattr(settings, "aave_enabled", False)

    mock_fee_service.get_uncollected_fees.return_value = [_batch(amount_usd=1000.0)]
    mock_fee_service.sweep_all_fees.return_value = [_success(amount=1000.0, amount_usd=1000.0)]

    mock_deposit = MagicMock()
    monkeypatch.setattr(vault_module.treasury_vault_service, "deposit_to_vault", mock_deposit)

    await sweeper._do_sweep()

    mock_deposit.assert_not_called()


@pytest.mark.asyncio
async def test_vault_deposit_failure_logs_error_but_sweep_still_completes(
    sweeper, mock_fee_service, monkeypatch, caplog
):
    """The protocol's 60% share failing to reach the vault must be LOUD (error),
    but must not crash the sweep loop or block updating `_last_sweep`."""
    from bot.config.settings import settings
    import bot.services.treasury_vault_service as vault_module

    monkeypatch.setattr(settings, "aave_enabled", True)
    monkeypatch.setattr(settings, "vault_min_deposit_usdc", 50.0)

    mock_fee_service.get_uncollected_fees.return_value = [_batch(amount_usd=1000.0)]
    mock_fee_service.sweep_all_fees.return_value = [_success(amount=1000.0, amount_usd=1000.0)]

    mock_deposit = MagicMock(side_effect=RuntimeError("Aave deposit reverted"))
    monkeypatch.setattr(vault_module.treasury_vault_service, "deposit_to_vault", mock_deposit)

    with caplog.at_level(logging.ERROR, logger="bot.services.fee_sweeper"):
        await sweeper._do_sweep()  # must not raise

    assert any("Vault deposit failed for protocol share" in r.message for r in caplog.records)
    # Sweep as a whole still "completed" (last_sweep timestamp updated).
    assert sweeper._last_sweep is not None


# ---------------------------------------------------------------------------
# sweep_now()
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_sweep_now_triggers_sweep_and_returns_uncollected(sweeper, mock_fee_service):
    mock_fee_service.get_uncollected_fees.side_effect = [
        [_batch(amount_usd=100.0)],  # inside _do_sweep
        [],  # returned by sweep_now after sweeping
    ]
    mock_fee_service.sweep_all_fees.return_value = [_success(amount=100.0, amount_usd=100.0)]

    result = await sweeper.sweep_now()

    assert result == []
    assert mock_fee_service.get_uncollected_fees.call_count == 2


# ---------------------------------------------------------------------------
# _sweep_loop resilience — an exception on one sweep iteration must not kill
# the loop; it must be logged (loudly, via logger.error) and the loop must
# continue to the next iteration.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_sweep_loop_survives_do_sweep_exception_and_continues(sweeper, monkeypatch, caplog):
    calls = {"n": 0}

    async def fake_do_sweep():
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("boom — sweep target unreachable")
        # Stop the loop after the second (successful) iteration.
        sweeper._running = False

    async def fast_sleep(_seconds):
        return None

    monkeypatch.setattr(sweeper, "_do_sweep", fake_do_sweep)
    monkeypatch.setattr(asyncio, "sleep", fast_sleep)

    sweeper._running = True
    with caplog.at_level(logging.ERROR, logger="bot.services.fee_sweeper"):
        await sweeper._sweep_loop()

    assert calls["n"] == 2  # survived the RuntimeError and ran a second time
    assert any("Fee sweep error" in r.message for r in caplog.records)
