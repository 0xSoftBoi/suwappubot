"""Tests for bot/services/turnkey_fallback.py — Turnkey outage fallback signing.

Covers:
  * CircuitBreaker state machine (CLOSED -> OPEN -> HALF_OPEN -> CLOSED/OPEN).
  * should_use_fallback() mode dispatch (disabled / manual / auto-via-breaker).
  * sign_evm_with_fallback: primary (Turnkey) path records success; on Turnkey
    failure with a backup key present, falls back to local signing and records
    the failure; on Turnkey failure with NO backup key, the error surfaces
    (re-raised, not swallowed).
  * Same fallback/raise contract for sign_typed_data_with_fallback and
    sign_solana_with_fallback (one representative test each, since the control
    flow is identical to the EVM path).
  * The local backup-key helpers: _get_backup_private_key raises when there is
    no backup key, and _sign_evm_local produces a real, verifiable signature.
"""

import os
import time
from unittest.mock import AsyncMock, MagicMock

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-32byteslong!!")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

import pytest

import bot.services.turnkey_fallback as tf
from bot.services.turnkey_client import TurnkeyAPIError


@pytest.fixture(autouse=True)
def _reset_circuit_breaker_singleton():
    """The module keeps a process-global breaker; isolate each test."""
    tf._circuit_breaker = None
    yield
    tf._circuit_breaker = None


def _wallet(is_turnkey=True, encrypted_private_key="ciphertext-blob", address="0x" + "ab" * 20):
    wallet = MagicMock()
    wallet.is_turnkey_wallet = is_turnkey
    wallet.encrypted_private_key = encrypted_private_key
    wallet.address = address
    return wallet


# ---------------------------------------------------------------------------
# CircuitBreaker state machine
# ---------------------------------------------------------------------------


def test_circuit_breaker_starts_closed():
    cb = tf.CircuitBreaker()
    assert cb.state == tf.CircuitState.CLOSED
    assert cb.is_open is False


def test_circuit_breaker_opens_after_threshold_consecutive_failures():
    cb = tf.CircuitBreaker(threshold=3)
    cb.record_failure()
    cb.record_failure()
    assert cb.state == tf.CircuitState.CLOSED
    cb.record_failure()
    assert cb.state == tf.CircuitState.OPEN
    assert cb.is_open is True


def test_circuit_breaker_success_resets_failure_count_while_closed():
    cb = tf.CircuitBreaker(threshold=3)
    cb.record_failure()
    cb.record_failure()
    cb.record_success()  # resets the streak
    cb.record_failure()
    cb.record_failure()
    assert cb.state == tf.CircuitState.CLOSED  # only 2 consecutive since reset


def test_circuit_breaker_transitions_to_half_open_after_recovery_timeout(monkeypatch):
    cb = tf.CircuitBreaker(threshold=1, recovery_timeout=100)
    cb.record_failure()
    assert cb.state == tf.CircuitState.OPEN

    t = {"now": cb._last_failure_time}
    monkeypatch.setattr(time, "time", lambda: t["now"] + 101)
    assert cb.state == tf.CircuitState.HALF_OPEN


def test_circuit_breaker_half_open_closes_after_success_threshold(monkeypatch):
    cb = tf.CircuitBreaker(threshold=1, recovery_timeout=100, success_threshold=2)
    cb.record_failure()
    monkeypatch.setattr(time, "time", lambda: cb._last_failure_time + 101)
    assert cb.state == tf.CircuitState.HALF_OPEN

    cb.record_success()
    assert cb.state == tf.CircuitState.HALF_OPEN  # only 1 of 2 successes so far
    cb.record_success()
    assert cb.state == tf.CircuitState.CLOSED


def test_circuit_breaker_half_open_reopens_on_any_failure(monkeypatch):
    cb = tf.CircuitBreaker(threshold=1, recovery_timeout=100)
    cb.record_failure()
    # Freeze "now" to a fixed value (not re-derived from cb state on each call) —
    # otherwise a later record_failure() that bumps _last_failure_time would
    # keep pushing the mocked clock forward too and falsely re-trigger the
    # recovery-timeout check below.
    frozen_now = cb._last_failure_time + 101
    monkeypatch.setattr(time, "time", lambda: frozen_now)
    assert cb.state == tf.CircuitState.HALF_OPEN

    cb.record_failure()
    assert cb.state == tf.CircuitState.OPEN


def test_circuit_breaker_reset_clears_state():
    cb = tf.CircuitBreaker(threshold=1)
    cb.record_failure()
    assert cb.state == tf.CircuitState.OPEN
    cb.reset()
    assert cb.state == tf.CircuitState.CLOSED
    assert cb._failure_count == 0


# ---------------------------------------------------------------------------
# should_use_fallback()
# ---------------------------------------------------------------------------


def test_should_use_fallback_disabled_mode_is_always_false(monkeypatch):
    from bot.config.settings import settings

    monkeypatch.setattr(settings, "turnkey_fallback_mode", "disabled")
    assert tf.should_use_fallback() is False


def test_should_use_fallback_manual_mode_is_always_true(monkeypatch):
    from bot.config.settings import settings

    monkeypatch.setattr(settings, "turnkey_fallback_mode", "manual")
    assert tf.should_use_fallback() is True


def test_should_use_fallback_auto_mode_follows_circuit_breaker(monkeypatch):
    from bot.config.settings import settings

    monkeypatch.setattr(settings, "turnkey_fallback_mode", "auto")
    monkeypatch.setattr(settings, "turnkey_circuit_breaker_threshold", 1)
    assert tf.should_use_fallback() is False  # breaker starts closed

    tf.get_circuit_breaker().record_failure()
    assert tf.should_use_fallback() is True  # breaker now open


# ---------------------------------------------------------------------------
# sign_evm_with_fallback
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_sign_evm_fallback_disabled_delegates_straight_to_primary(monkeypatch):
    from bot.config.settings import settings

    monkeypatch.setattr(settings, "turnkey_fallback_enabled", False)
    wallet_service = MagicMock()
    wallet_service.sign_evm_transaction = AsyncMock(return_value="0xsigned")
    wallet = _wallet()

    result = await tf.sign_evm_with_fallback(wallet_service, wallet, {"to": "0x0"})

    assert result == "0xsigned"
    wallet_service.sign_evm_transaction.assert_awaited_once_with(wallet, {"to": "0x0"})


@pytest.mark.asyncio
async def test_sign_evm_fallback_non_turnkey_wallet_uses_local_signer_directly(monkeypatch):
    from bot.config.settings import settings

    monkeypatch.setattr(settings, "turnkey_fallback_enabled", True)
    wallet_service = MagicMock()
    wallet_service._sign_evm_local = AsyncMock(return_value="0xlocalsigned")
    wallet = _wallet(is_turnkey=False)

    result = await tf.sign_evm_with_fallback(wallet_service, wallet, {"to": "0x0"})

    assert result == "0xlocalsigned"
    wallet_service._sign_evm_local.assert_awaited_once_with(wallet, {"to": "0x0"})


@pytest.mark.asyncio
async def test_sign_evm_fallback_circuit_open_skips_turnkey_and_uses_backup(monkeypatch):
    from bot.config.settings import settings

    monkeypatch.setattr(settings, "turnkey_fallback_enabled", True)
    monkeypatch.setattr(tf, "should_use_fallback", lambda: True)
    monkeypatch.setattr(tf, "_sign_evm_local", MagicMock(return_value="0xbackupsigned"))

    wallet_service = MagicMock()
    wallet_service._sign_evm_via_turnkey = AsyncMock()  # must NOT be called
    wallet = _wallet(is_turnkey=True)

    result = await tf.sign_evm_with_fallback(wallet_service, wallet, {"to": "0x0"})

    assert result == "0xbackupsigned"
    wallet_service._sign_evm_via_turnkey.assert_not_called()


@pytest.mark.asyncio
async def test_sign_evm_fallback_primary_success_records_success_on_breaker(monkeypatch):
    from bot.config.settings import settings

    monkeypatch.setattr(settings, "turnkey_fallback_enabled", True)
    monkeypatch.setattr(tf, "should_use_fallback", lambda: False)

    fake_breaker = MagicMock()
    monkeypatch.setattr(tf, "get_circuit_breaker", lambda: fake_breaker)

    wallet_service = MagicMock()
    wallet_service._sign_evm_via_turnkey = AsyncMock(return_value="0xturnkeysigned")
    wallet = _wallet(is_turnkey=True)

    result = await tf.sign_evm_with_fallback(wallet_service, wallet, {"to": "0x0"})

    assert result == "0xturnkeysigned"
    fake_breaker.record_success.assert_called_once()
    fake_breaker.record_failure.assert_not_called()


@pytest.mark.asyncio
async def test_sign_evm_fallback_primary_failure_with_backup_key_falls_back(monkeypatch):
    from bot.config.settings import settings

    monkeypatch.setattr(settings, "turnkey_fallback_enabled", True)
    monkeypatch.setattr(tf, "should_use_fallback", lambda: False)

    fake_breaker = MagicMock()
    monkeypatch.setattr(tf, "get_circuit_breaker", lambda: fake_breaker)
    monkeypatch.setattr(tf, "_sign_evm_local", MagicMock(return_value="0xbackupsigned"))

    wallet_service = MagicMock()
    wallet_service._sign_evm_via_turnkey = AsyncMock(
        side_effect=TurnkeyAPIError(503, "service unavailable")
    )
    wallet = _wallet(is_turnkey=True, encrypted_private_key="real-ciphertext")

    result = await tf.sign_evm_with_fallback(wallet_service, wallet, {"to": "0x0"})

    assert result == "0xbackupsigned"
    fake_breaker.record_failure.assert_called_once()


@pytest.mark.asyncio
async def test_sign_evm_fallback_primary_failure_no_backup_key_raises(monkeypatch):
    """Both Turnkey AND the local backup are unavailable -> the error must
    surface to the caller, not be swallowed."""
    from bot.config.settings import settings

    monkeypatch.setattr(settings, "turnkey_fallback_enabled", True)
    monkeypatch.setattr(tf, "should_use_fallback", lambda: False)
    monkeypatch.setattr(tf, "get_circuit_breaker", lambda: MagicMock())

    wallet_service = MagicMock()
    wallet_service._sign_evm_via_turnkey = AsyncMock(
        side_effect=TurnkeyAPIError(503, "service unavailable")
    )
    # No usable backup key -> nothing to fall back to.
    wallet = _wallet(is_turnkey=True, encrypted_private_key="turnkey_managed")

    with pytest.raises(TurnkeyAPIError):
        await tf.sign_evm_with_fallback(wallet_service, wallet, {"to": "0x0"})


# ---------------------------------------------------------------------------
# sign_typed_data_with_fallback / sign_solana_with_fallback — same contract
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_sign_typed_data_fallback_primary_failure_falls_back_to_backup(monkeypatch):
    from bot.config.settings import settings

    monkeypatch.setattr(settings, "turnkey_fallback_enabled", True)
    monkeypatch.setattr(tf, "should_use_fallback", lambda: False)
    monkeypatch.setattr(tf, "get_circuit_breaker", lambda: MagicMock())
    monkeypatch.setattr(tf, "_sign_typed_data_local", MagicMock(return_value="0xtypeddatasig"))

    wallet_service = MagicMock()
    wallet_service._sign_typed_data_via_turnkey = AsyncMock(side_effect=RuntimeError("down"))
    wallet = _wallet(is_turnkey=True, encrypted_private_key="real-ciphertext")

    result = await tf.sign_typed_data_with_fallback(wallet_service, wallet, {"domain": {}})

    assert result == "0xtypeddatasig"


@pytest.mark.asyncio
async def test_sign_typed_data_fallback_no_backup_key_raises(monkeypatch):
    from bot.config.settings import settings

    monkeypatch.setattr(settings, "turnkey_fallback_enabled", True)
    monkeypatch.setattr(tf, "should_use_fallback", lambda: False)
    monkeypatch.setattr(tf, "get_circuit_breaker", lambda: MagicMock())

    wallet_service = MagicMock()
    wallet_service._sign_typed_data_via_turnkey = AsyncMock(side_effect=RuntimeError("down"))
    wallet = _wallet(is_turnkey=True, encrypted_private_key=None)

    with pytest.raises(RuntimeError):
        await tf.sign_typed_data_with_fallback(wallet_service, wallet, {"domain": {}})


@pytest.mark.asyncio
async def test_sign_solana_fallback_primary_failure_falls_back_to_backup(monkeypatch):
    from bot.config.settings import settings

    monkeypatch.setattr(settings, "turnkey_fallback_enabled", True)
    monkeypatch.setattr(tf, "should_use_fallback", lambda: False)
    monkeypatch.setattr(tf, "get_circuit_breaker", lambda: MagicMock())
    monkeypatch.setattr(tf, "_sign_solana_local", MagicMock(return_value=b"solana-sig-bytes"))

    wallet_service = MagicMock()
    wallet_service._sign_solana_via_turnkey = AsyncMock(side_effect=RuntimeError("down"))
    wallet = _wallet(is_turnkey=True, encrypted_private_key="real-ciphertext")

    result = await tf.sign_solana_with_fallback(wallet_service, wallet, b"raw-tx-bytes")

    assert result == b"solana-sig-bytes"


@pytest.mark.asyncio
async def test_sign_solana_fallback_no_backup_key_raises(monkeypatch):
    from bot.config.settings import settings

    monkeypatch.setattr(settings, "turnkey_fallback_enabled", True)
    monkeypatch.setattr(tf, "should_use_fallback", lambda: False)
    monkeypatch.setattr(tf, "get_circuit_breaker", lambda: MagicMock())

    wallet_service = MagicMock()
    wallet_service._sign_solana_via_turnkey = AsyncMock(side_effect=RuntimeError("down"))
    wallet = _wallet(is_turnkey=True, encrypted_private_key="turnkey_managed")

    with pytest.raises(RuntimeError):
        await tf.sign_solana_with_fallback(wallet_service, wallet, b"raw-tx-bytes")


# ---------------------------------------------------------------------------
# Local backup-key helpers
# ---------------------------------------------------------------------------


def test_get_backup_private_key_raises_when_no_backup_key():
    wallet = _wallet(encrypted_private_key=None)
    with pytest.raises(ValueError, match="No backup key"):
        tf._get_backup_private_key(wallet)


def test_get_backup_private_key_raises_when_turnkey_managed_sentinel():
    wallet = _wallet(encrypted_private_key="turnkey_managed")
    with pytest.raises(ValueError, match="No backup key"):
        tf._get_backup_private_key(wallet)


def test_sign_evm_local_produces_a_valid_verifiable_signature(monkeypatch):
    from eth_account import Account
    from eth_utils import to_checksum_address

    private_key = "0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318"
    monkeypatch.setattr(tf, "_get_backup_private_key", lambda wallet: private_key)

    wallet = _wallet()
    transaction = {
        "nonce": 0,
        "gasPrice": 20_000_000_000,
        "gas": 21000,
        "to": to_checksum_address("0x000000000000000000000000000000000000dead"),
        "value": 0,
        "chainId": 1,
        "data": b"",
    }

    signed_hex = tf._sign_evm_local(MagicMock(), wallet, transaction)

    assert signed_hex.startswith("0x") or isinstance(signed_hex, str)
    # The raw signed tx should recover to the same address that signed it.
    expected_address = Account.from_key(private_key).address
    recovered = Account.recover_transaction(signed_hex)
    assert recovered == expected_address
