"""MONEY-PATH: Phase 5 dry-run chain rollout (docs/development/chain-rollout.md).

A chain listed in `settings.dry_run_chains` must run the full quote/policy/
balance-check path but NEVER reach a real broadcast, regardless of which
provider the quote would otherwise dispatch to -- the gate lives once, at the
top of `execute_swap`'s dispatch, before any `_execute_<provider>_swap`
method (the point where every provider signs AND broadcasts, for both the
EVM and Solana custodial paths). These tests mock the provider-level
execute methods (the effective broadcaster for this architecture) and assert
they are never awaited for a dry-run chain, and ARE awaited otherwise
(byte-identical path when dry-run is not configured).
"""

import os
from datetime import datetime, timezone
from unittest.mock import AsyncMock

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-32byteslong!!")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

import pytest  # noqa: E402

import bot.services.swap_engine as se  # noqa: E402
from bot.services.swap_engine import SwapEngine, SwapQuote  # noqa: E402
from bot.models.swap import SwapStatus  # noqa: E402

pytestmark = pytest.mark.asyncio


def _quote(chain: str, provider: str) -> SwapQuote:
    return SwapQuote(
        provider=provider,
        from_chain=chain,
        to_chain=chain,
        from_token="USDC",
        to_token="ETH" if provider != "jupiter" else "SOL",
        from_amount="1000000",
        from_amount_human=1.0,
        to_amount="500000000000000",
        to_amount_human=0.0005,
        to_amount_min="490000000000000",
        gas_cost_usd=0.5,
        fee_cost_usd=0.0,
        total_cost_usd=0.5,
        estimated_time=30,
        price_impact=0.1,
        exchange_rate=0.0005,
        raw_quote={"transactionRequest": {"to": "0x1", "data": "0x", "value": "0"}},
        timestamp=datetime.now(timezone.utc),
    )


def _setup_user_wallet(chain_type: str = "evm", address: str = "0x" + "a" * 40):
    from database.db import get_session
    from bot.models.user import User, Wallet

    with get_session() as session:
        user = User(telegram_id=hash((chain_type, address)) % 10_000_000)
        session.add(user)
        session.flush()
        wallet = Wallet(
            user_id=user.id,
            address=address,
            chain_type=chain_type,
            encrypted_private_key="enc",
        )
        session.add(wallet)
        session.flush()
        user_id, wallet_id = user.id, wallet.id
        session.commit()
    return user_id, wallet_id


def _quiet_engine(monkeypatch) -> SwapEngine:
    """A real SwapEngine with the network-touching pre-dispatch checks stubbed
    out, so execute_swap runs the real quote/policy path against a real
    (tmp_db) database without hitting an RPC or price API."""
    monkeypatch.setattr(se.quote_validator, "validate_balance", AsyncMock(return_value=True))
    monkeypatch.setattr(se.spending_limit_service, "usd_value", AsyncMock(return_value=None))
    return SwapEngine()


async def test_dry_run_chain_never_broadcasts_and_records_simulated_evm(tmp_db, monkeypatch):
    user_id, wallet_id = _setup_user_wallet(chain_type="evm")
    monkeypatch.setattr(se.settings, "dry_run_chains", "base")

    engine = _quiet_engine(monkeypatch)
    evm_broadcaster = AsyncMock()
    engine._execute_lifi_swap = evm_broadcaster

    quote = _quote(chain="base", provider="lifi")
    result = await engine.execute_swap(quote=quote, wallet_id=wallet_id, user_id=user_id)

    evm_broadcaster.assert_not_awaited()
    assert result.simulated is True
    assert result.status == SwapStatus.COMPLETED.value
    assert result.tx_hash.startswith("SIMULATED-")


async def test_dry_run_chain_never_broadcasts_and_records_simulated_solana(tmp_db, monkeypatch):
    user_id, wallet_id = _setup_user_wallet(
        chain_type="solana", address="So11111111111111111111111111111111111111112"
    )
    monkeypatch.setattr(se.settings, "dry_run_chains", "solana")

    engine = _quiet_engine(monkeypatch)
    solana_broadcaster = AsyncMock()
    engine._execute_jupiter_swap = solana_broadcaster

    quote = _quote(chain="solana", provider="jupiter")
    result = await engine.execute_swap(quote=quote, wallet_id=wallet_id, user_id=user_id)

    solana_broadcaster.assert_not_awaited()
    assert result.simulated is True
    assert result.status == SwapStatus.COMPLETED.value
    assert result.tx_hash.startswith("SIMULATED-")


async def test_non_dry_run_chain_still_broadcasts_evm(tmp_db, monkeypatch):
    """Byte-identical path: an empty/non-matching DRY_RUN_CHAINS must still
    dispatch to the real per-provider executor exactly as before this
    feature existed."""
    user_id, wallet_id = _setup_user_wallet(chain_type="evm")
    monkeypatch.setattr(se.settings, "dry_run_chains", "")  # default: nothing is dry-run

    engine = _quiet_engine(monkeypatch)
    real_hash = "0x" + "1" * 64
    evm_broadcaster = AsyncMock(return_value=real_hash)
    engine._execute_lifi_swap = evm_broadcaster

    quote = _quote(chain="base", provider="lifi")
    result = await engine.execute_swap(quote=quote, wallet_id=wallet_id, user_id=user_id)

    evm_broadcaster.assert_awaited_once()
    assert result.simulated is False
    assert result.tx_hash == real_hash
    assert result.status == SwapStatus.SUBMITTED.value


async def test_dry_run_chains_set_is_case_insensitive_and_scoped_per_chain(monkeypatch):
    monkeypatch.setattr(se.settings, "dry_run_chains", "Base, Solana")
    assert se.settings.is_dry_run_chain("base") is True
    assert se.settings.is_dry_run_chain("BASE") is True
    assert se.settings.is_dry_run_chain("solana") is True
    assert se.settings.is_dry_run_chain("ethereum") is False

    monkeypatch.setattr(se.settings, "dry_run_chains", "")
    assert se.settings.is_dry_run_chain("base") is False
