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


@pytest.fixture(autouse=True)
def _escrow_allow_all_chains(monkeypatch):
    """Neutralize the chain allowlist for escrow-mechanics tests (they use 'base')."""
    monkeypatch.setattr(P2PEscrow, "_allowed_chains", staticmethod(lambda: set()))


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
    # Escrow lock/release used the trade's own chain, not the global setting.
    assert tx_by_action["lock"]["chain"] == "base"
    assert tx_by_action["release"]["chain"] == "base"


async def test_release_escrow_is_not_double_spendable(tmp_db):
    """A second /p2prelease on a completed trade must NOT fire a second on-chain send."""
    from bot.services.p2p_service import P2PError

    svc = P2PService()
    release_calls = []

    async def fake_executor(action, **kw):
        if action == "release":
            release_calls.append(kw)
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

    # Release before any lock must be rejected (nothing escrowed).
    with pytest.raises(P2PError):
        await svc.release_escrow(trade_id=trade.id, buyer_address="0x" + "cd" * 20)
    assert release_calls == []

    await svc.lock_escrow(trade_id=trade.id, seller_wallet_id=5)
    await svc.release_escrow(trade_id=trade.id, buyer_address="0x" + "cd" * 20)
    assert len(release_calls) == 1

    # Second release on the same (now COMPLETED) trade must NOT call the executor again.
    with pytest.raises(P2PError):
        await svc.release_escrow(trade_id=trade.id, buyer_address="0x" + "cd" * 20)
    assert len(release_calls) == 1


async def test_cancel_trade_refuses_refund_after_fiat_sent(tmp_db):
    """A fiat-paid trade must force the dispute path, not a silent no-op refund."""
    from bot.services.p2p_service import P2PError

    svc = P2PService()
    refund_calls = []

    async def fake_executor(action, **kw):
        if action == "refund":
            refund_calls.append(kw)
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
    await svc.lock_escrow(trade_id=trade.id, seller_wallet_id=5)
    await svc.mark_fiat_sent(trade_id=trade.id, payment_ref="ref")

    with pytest.raises(P2PError):
        await svc.cancel_trade(trade_id=trade.id, seller_address="0x" + "ab" * 20)
    assert refund_calls == []


async def test_release_uses_recorded_buyer_and_rejects_mismatch(tmp_db):
    """Release defaults to the buyer recorded at trade creation; a wrong override is rejected."""
    from bot.services.p2p_service import P2PError

    svc = P2PService()
    release_to = []

    async def fake_executor(action, **kw):
        if action == "release":
            release_to.append(kw["to_address"])
        return f"0x{action}"

    svc.escrow.set_executor(fake_executor)

    taker_addr = "0x" + "cd" * 20
    offer_id = await svc.create_offer(
        maker_user_id=111,
        maker_wallet_id=5,
        offer_type=P2POfferType.SELL_CRYPTO.value,  # taker is the buyer
        fiat_currency="NGN",
        crypto_asset="USDC",
        crypto_chain="base",
        price_per_unit=1600.0,
        min_fiat_amount=1000.0,
        max_fiat_amount=1_000_000.0,
        payment_methods=["bank_transfer"],
    )
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
        taker_wallet_address=taker_addr,
        offer=quote,
        fiat_amount=160_000.0,
        payment_method="bank_transfer",
    )
    # Buyer address was captured server-side from the taker wallet.
    assert trade.buyer_address.lower() == taker_addr.lower()

    await svc.lock_escrow(trade_id=trade.id, seller_wallet_id=5)

    # A mismatched override is rejected and fires no on-chain send.
    with pytest.raises(P2PError):
        await svc.release_escrow(trade_id=trade.id, buyer_address="0x" + "11" * 20)
    assert release_to == []

    # No override → defaults to the recorded buyer.
    done = await svc.release_escrow(trade_id=trade.id)
    assert done.status == P2PTradeStatus.COMPLETED.value
    assert len(release_to) == 1
    assert release_to[0].lower() == taker_addr.lower()


async def test_native_trade_fails_closed_without_buyer_address(tmp_db):
    """A native trade can't start without a verified buyer payout address (fail closed)."""
    from bot.services.p2p_service import P2PError

    svc = P2PService()
    svc.escrow.set_executor(lambda *a, **k: "0x")

    offer_id = await svc.create_offer(
        maker_user_id=111,
        maker_wallet_id=5,
        offer_type=P2POfferType.SELL_CRYPTO.value,  # taker is the buyer
        fiat_currency="NGN",
        crypto_asset="USDC",
        crypto_chain="base",
        price_per_unit=1600.0,
        min_fiat_amount=1000.0,
        max_fiat_amount=1_000_000.0,
        payment_methods=["bank_transfer"],
    )
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
    # Taker has no wallet address → buyer leg can't be recorded → must reject.
    with pytest.raises(P2PError):
        await svc.start_trade(
            taker_user_id=222,
            taker_wallet_address=None,
            offer=quote,
            fiat_amount=160_000.0,
            payment_method="bank_transfer",
        )


async def test_lock_escrows_maker_wallet_on_sell_offer(tmp_db):
    """On a SELL_CRYPTO offer the seller is the MAKER — escrow the maker wallet, not the taker."""
    from bot.services.p2p_service import P2PError

    svc = P2PService()
    lock_kwargs = {}

    async def fake_executor(action, **kw):
        if action == "lock":
            lock_kwargs.update(kw)
        return f"0x{action}"

    svc.escrow.set_executor(fake_executor)

    maker_wallet_id = 42
    offer_id = await svc.create_offer(
        maker_user_id=111,
        maker_wallet_id=maker_wallet_id,
        offer_type=P2POfferType.SELL_CRYPTO.value,  # maker sells crypto → maker is seller
        fiat_currency="NGN",
        crypto_asset="USDC",
        crypto_chain="base",
        price_per_unit=1600.0,
        min_fiat_amount=1000.0,
        max_fiat_amount=1_000_000.0,
        payment_methods=["bank_transfer"],
    )
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

    # Resolved seller wallet is the maker's, regardless of who drives the trade.
    await svc.lock_escrow(trade_id=trade.id)
    assert lock_kwargs["from_wallet_id"] == maker_wallet_id

    # An explicit seller_wallet_id that isn't the maker's is rejected (no wrong-party escrow).
    trade2 = await svc.start_trade(
        taker_user_id=222,
        taker_wallet_address="0x" + "cd" * 20,
        offer=quote,
        fiat_amount=160_000.0,
        payment_method="bank_transfer",
    )
    with pytest.raises(P2PError):
        await svc.lock_escrow(trade_id=trade2.id, seller_wallet_id=999)


async def test_escrow_chain_allowlist_blocks_disallowed_chain(monkeypatch):
    """With a testnet-only allowlist, escrow refuses to settle on mainnet."""
    from bot.services.p2p_service import P2PError

    monkeypatch.setattr(P2PEscrow, "_allowed_chains", staticmethod(lambda: {"base-sepolia"}))
    escrow = P2PEscrow()
    calls = []

    async def fake_executor(action, **kw):
        calls.append(kw.get("chain"))
        return "0x"

    escrow.set_executor(fake_executor)

    # Mainnet 'base' is not in the allowlist → rejected before any on-chain call.
    with pytest.raises(P2PError):
        await escrow.lock(seller_wallet_id=1, amount="10", chain="base")
    with pytest.raises(P2PError):
        await escrow.release(buyer_address="0x" + "ab" * 20, amount="10", chain="base")
    assert calls == []

    # base-sepolia is allowed → proceeds.
    assert await escrow.lock(seller_wallet_id=1, amount="10", chain="base-sepolia") == "0x"
    assert calls == ["base-sepolia"]


# ── Dispute / arbitration ───────────────────────────────────────────────────


async def _locked_native_trade(svc, taker=222, maker_wallet_id=5):
    """Helper: create a SELL_CRYPTO native trade and lock its escrow. Returns trade."""
    offer_id = await svc.create_offer(
        maker_user_id=111,
        maker_wallet_id=maker_wallet_id,
        offer_type=P2POfferType.SELL_CRYPTO.value,
        fiat_currency="NGN",
        crypto_asset="USDC",
        crypto_chain="base",
        price_per_unit=1600.0,
        min_fiat_amount=1000.0,
        max_fiat_amount=1_000_000.0,
        payment_methods=["bank_transfer"],
    )
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
        taker_user_id=taker,
        taker_wallet_address="0x" + "cd" * 20,
        offer=quote,
        fiat_amount=160_000.0,
        payment_method="bank_transfer",
    )
    await svc.lock_escrow(trade_id=trade.id, seller_wallet_id=maker_wallet_id)
    return trade


async def test_dispute_open_freezes_and_blocks_unilateral_settlement(tmp_db):
    from bot.services.p2p_service import P2PError

    svc = P2PService()

    async def fake_executor(action, **kw):
        return f"0x{action}"

    svc.escrow.set_executor(fake_executor)
    trade = await _locked_native_trade(svc)

    # A non-party cannot open a dispute.
    with pytest.raises(P2PError):
        await svc.open_dispute(trade_id=trade.id, reason="not mine", opened_by=999)

    # The taker (a party) can → trade freezes to DISPUTED.
    disputed = await svc.open_dispute(trade_id=trade.id, reason="no fiat received", opened_by=222)
    assert disputed.status == P2PTradeStatus.DISPUTED.value
    assert disputed.disputed_by == 222

    # While disputed, neither side can unilaterally settle.
    with pytest.raises(P2PError):
        await svc.release_escrow(trade_id=trade.id)
    with pytest.raises(P2PError):
        await svc.cancel_trade(trade_id=trade.id, seller_address="0x" + "ab" * 20)


async def test_dispute_resolve_release_pays_buyer_once(tmp_db):
    from bot.services.p2p_service import P2PError

    svc = P2PService()
    release_to = []

    async def fake_executor(action, **kw):
        if action == "release":
            release_to.append(kw["to_address"])
        return f"0x{action}"

    svc.escrow.set_executor(fake_executor)
    trade = await _locked_native_trade(svc)
    await svc.open_dispute(trade_id=trade.id, reason="dispute", opened_by=222)

    done = await svc.resolve_dispute(
        trade_id=trade.id, resolution="release", resolver_id=7, note="buyer proved payment"
    )
    assert done.status == P2PTradeStatus.COMPLETED.value
    assert done.dispute_resolution == "release"
    assert done.resolved_by == 7
    assert [a.lower() for a in release_to] == ["0x" + "cd" * 20]  # recorded buyer

    # Second resolve is rejected — no double on-chain move.
    with pytest.raises(P2PError):
        await svc.resolve_dispute(trade_id=trade.id, resolution="release", resolver_id=7)
    assert len(release_to) == 1


async def test_dispute_resolve_fails_closed_without_recorded_seller(tmp_db):
    """A refund with no recorded seller address fails closed and stays retryable."""
    from bot.services.p2p_service import P2PError

    svc = P2PService()
    refund_to = []

    async def fake_executor(action, **kw):
        if action == "refund":
            refund_to.append(kw["to_address"])
        return f"0x{action}"

    svc.escrow.set_executor(fake_executor)
    # maker_wallet_id=5 has no Wallet row → seller_address recorded as None.
    trade = await _locked_native_trade(svc)
    await svc.open_dispute(trade_id=trade.id, reason="d", opened_by=111)

    with pytest.raises(P2PError):
        await svc.resolve_dispute(trade_id=trade.id, resolution="refund", resolver_id=7)
    assert refund_to == []  # no on-chain move
    # Reservation not consumed (payout resolved before it) → trade still DISPUTED,
    # so an arbiter can still resolve it (e.g. as a release) afterwards.
    still = await svc.get_trade(trade.id)
    assert still.status == P2PTradeStatus.DISPUTED.value
    done = await svc.resolve_dispute(trade_id=trade.id, resolution="release", resolver_id=7)
    assert done.status == P2PTradeStatus.COMPLETED.value
