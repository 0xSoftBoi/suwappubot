"""Tests for the native P2P escrow executor + escrow state machine.

These cover the money-path wiring WITHOUT touching a real chain: the on-chain
send is mocked, so we assert (a) the escrow seam fails loudly when unconfigured,
(b) lock/release/refund call the executor with the right arguments and record the
returned tx hashes, and (c) the full trade lifecycle advances state correctly.
"""

from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock

import pytest

from bot.services.p2p_providers import P2POfferQuote
from bot.services.p2p_service import (
    P2PEscrow,
    P2PService,
    EscrowNotConfiguredError,
)
from bot.models.p2p import P2PSource, P2POfferType, P2PTradeStatus

# ── P2PEscrow seam ───────────────────────────────────────────────────────────


async def test_escrow_unconfigured_raises():
    escrow = P2PEscrow()
    assert escrow.is_ready is False
    with pytest.raises(EscrowNotConfiguredError):
        await escrow.lock(seller_wallet_id=1, amount="10")
    with pytest.raises(EscrowNotConfiguredError):
        await escrow.release(buyer_address="0xabc", amount="10")
    with pytest.raises(EscrowNotConfiguredError):
        await escrow.refund(seller_address="0xabc", amount="10")


async def test_escrow_executor_called_with_right_args():
    escrow = P2PEscrow()
    calls = []

    async def fake_executor(action, **kw):
        calls.append((action, kw))
        return f"0x{action}hash"

    escrow.set_executor(fake_executor)
    assert escrow.is_ready is True

    assert await escrow.lock(seller_wallet_id=7, amount="25") == "0xlockhash"
    assert await escrow.release(buyer_address="0xBUY", amount="25") == "0xreleasehash"
    assert await escrow.refund(seller_address="0xSELL", amount="25") == "0xrefundhash"

    actions = [c[0] for c in calls]
    assert actions == ["lock", "release", "refund"]
    # lock pulls from the seller's wallet; release/refund push to an address.
    assert calls[0][1]["from_wallet_id"] == 7
    assert calls[1][1]["to_address"] == "0xBUY"
    assert calls[2][1]["to_address"] == "0xSELL"


# ── Real executor config guards (no chain) ──────────────────────────────────


async def test_real_executor_requires_escrow_wallet(monkeypatch):
    from bot.services import p2p_escrow_executor as ex

    monkeypatch.setattr(ex, "_get_escrow_wallet", lambda: None)
    from bot.services.p2p_escrow_executor import p2p_escrow_executor, EscrowConfigError

    with pytest.raises(EscrowConfigError):
        await p2p_escrow_executor("release", to_address="0xabc", amount="5")


async def test_real_executor_release_calls_send_token(monkeypatch):
    from bot.services import p2p_escrow_executor as ex

    escrow_wallet = MagicMock(address="0xESCROW", is_active=True, chain_type="evm")
    monkeypatch.setattr(ex, "_get_escrow_wallet", lambda: escrow_wallet)
    send_mock = AsyncMock(return_value="0xsent")
    monkeypatch.setattr(ex.hot_wallet_service, "send_token", send_mock)

    from bot.services.p2p_escrow_executor import p2p_escrow_executor

    # a valid checksum-able address
    dest = "0x" + "ab" * 20
    tx = await p2p_escrow_executor(
        "release", to_address=dest, amount="12.5", chain="base", token="USDC"
    )
    assert tx == "0xsent"
    assert send_mock.await_count == 1
    args, kwargs = send_mock.await_args
    # send_token(wallet, chain, token_address, to_address, amount, decimals, memo=...)
    assert args[0] is escrow_wallet
    assert args[1] == "base"
    assert args[4] == Decimal("12.5")


async def test_real_executor_rejects_bad_action_and_amount(monkeypatch):
    from bot.services import p2p_escrow_executor as ex

    monkeypatch.setattr(ex, "_get_escrow_wallet", lambda: MagicMock(address="0xE"))
    from bot.services.p2p_escrow_executor import p2p_escrow_executor, EscrowConfigError

    with pytest.raises(EscrowConfigError):
        await p2p_escrow_executor("bogus", to_address="0xabc", amount="1")
    with pytest.raises(EscrowConfigError):
        await p2p_escrow_executor("release", to_address="0xabc", amount="0")


# ── Full native trade lifecycle (mocked escrow, real DB) ────────────────────


async def test_native_trade_lifecycle(tmp_db):
    svc = P2PService()
    tx_by_action = {}

    async def fake_executor(action, **kw):
        tx_by_action[action] = kw
        return f"0x{action}"

    svc.escrow.set_executor(fake_executor)

    offer_id = await svc.create_offer(
        maker_user_id=111,
        maker_wallet_id=5,
        offer_type=P2POfferType.SELL_CRYPTO.value,
        fiat_currency="NGN",
        crypto_asset="USDC",
        crypto_chain="base",
        price_per_unit=1600.0,
        min_fiat_amount=1000.0,
        max_fiat_amount=1_000_000.0,
        payment_methods=["bank_transfer"],
    )
    assert isinstance(offer_id, int)

    quote = P2POfferQuote(
        source=P2PSource.NATIVE.value,
        offer_id=str(offer_id),
        offer_type=P2POfferType.SELL_CRYPTO.value,
        fiat_currency="NGN",
        crypto_asset="USDC",
        crypto_chain="base",
        price_per_unit=1600.0,
        min_fiat_amount=1000.0,
        max_fiat_amount=1_000_000.0,
        payment_methods=["bank_transfer"],
    )

    trade = await svc.start_trade(
        taker_user_id=222,
        taker_wallet_address="0x" + "cd" * 20,
        offer=quote,
        fiat_amount=160_000.0,
        payment_method="bank_transfer",
    )
    assert trade.status == P2PTradeStatus.INITIATED.value
    # 160000 NGN / 1600 = 100 USDC
    assert Decimal(trade.crypto_amount) == Decimal("100")

    locked = await svc.lock_escrow(trade_id=trade.id, seller_wallet_id=5)
    assert locked.status == P2PTradeStatus.ESCROW_LOCKED.value
    assert locked.escrow_lock_tx == "0xlock"

    paid = await svc.mark_fiat_sent(trade_id=trade.id, payment_ref="bank-ref-123")
    assert paid.status == P2PTradeStatus.FIAT_SENT.value
    assert paid.fiat_payment_ref == "bank-ref-123"

    done = await svc.release_escrow(trade_id=trade.id, buyer_address="0x" + "cd" * 20)
    assert done.status == P2PTradeStatus.COMPLETED.value
    assert done.escrow_release_tx == "0xrelease"
    assert done.completed_at is not None

    assert set(tx_by_action) == {"lock", "release"}
