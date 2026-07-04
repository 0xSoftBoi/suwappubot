"""Regression tests for the bot x402 payment redemption path (verify_payment).

Covers the two guards added to close the sender-spoof + replay / cross-surface
double-redeem holes on the Telegram-bot subscription/credit redemption path
(``X402Service.verify_payment``):

  1. Sender binding — the on-chain payer (tx ``from``) MUST be a wallet bound to
     the redeeming user; a mismatched sender is rejected (was previously
     discarded as ``_sender``).
  2. Global consume — ``(chain, tx_hash)`` is consumed in the SHARED
     ``consumed_payments`` ledger, so the same tx_hash cannot be reused across
     multiple payment_id orders (or the api-ts surfaces).
"""

from unittest.mock import AsyncMock, patch

import pytest

RECIPIENT = "0x000000000000000000000000000000000000dEaD"
USER_WALLET = "0x1111111111111111111111111111111111111111"
ATTACKER_TX_SENDER = "0x2222222222222222222222222222222222222222"


def _make_user_and_wallet(user_id: int = 1):
    """Insert a User + a bound EVM Wallet, return the user id."""
    from database.db import get_session
    from bot.models.user import User, Wallet
    from bot.models.subscription import APICredit

    with get_session() as session:
        session.add(User(id=user_id, telegram_id=1000 + user_id))
        session.add(
            Wallet(
                user_id=user_id,
                name="Default",
                address=USER_WALLET,
                chain_type="evm",
                is_active=True,
                is_default=True,
            )
        )
        # Pre-seed the credit row so the api_credits grant path (which does
        # `balance += amount` on an unflushed default) has a concrete 0 balance.
        session.add(
            APICredit(user_id=user_id, balance=0.0, lifetime_purchased=0.0, lifetime_used=0.0)
        )
    return user_id


def _make_payment(user_id: int, payment_id: str):
    from database.db import get_session
    from bot.models.subscription import X402Payment, PaymentStatus

    with get_session() as session:
        session.add(
            X402Payment(
                user_id=user_id,
                payment_id=payment_id,
                amount=10.0,
                token_symbol="USDC",
                chain="base",
                product_type="api_credits",
                product_id=None,
                status=PaymentStatus.PENDING,
            )
        )


def _service():
    from bot.services.x402_service import X402Service

    svc = X402Service()
    svc.payment_recipient = RECIPIENT
    return svc


@pytest.mark.asyncio
async def test_verify_payment_rejects_mismatched_sender(tmp_db):
    """A valid on-chain tx whose sender is NOT the user's wallet is rejected."""
    uid = _make_user_and_wallet()
    _make_payment(uid, "x402_pay_1")
    svc = _service()

    # On-chain verify passes but the payer is the ATTACKER's tx sender, not the
    # user's bound wallet.
    with patch.object(
        svc,
        "_verify_transaction_on_chain",
        new=AsyncMock(return_value=(True, "verified", ATTACKER_TX_SENDER)),
    ):
        ok, msg = await svc.verify_payment("x402_pay_1", "0x" + "a" * 64)

    assert ok is False
    assert "sender" in msg.lower()


@pytest.mark.asyncio
async def test_verify_payment_refuses_reused_tx_hash(tmp_db):
    """A tx_hash consumed once cannot be redeemed against a second payment_id."""
    uid = _make_user_and_wallet()
    _make_payment(uid, "x402_pay_a")
    _make_payment(uid, "x402_pay_b")
    svc = _service()

    tx_hash = "0x" + "b" * 64

    # Sender matches the user's bound wallet — legitimate first redemption.
    with patch.object(
        svc,
        "_verify_transaction_on_chain",
        new=AsyncMock(return_value=(True, "verified", USER_WALLET)),
    ):
        ok1, _ = await svc.verify_payment("x402_pay_a", tx_hash)
        assert ok1 is True

        # Same tx_hash, different order → must be rejected as already consumed.
        ok2, msg2 = await svc.verify_payment("x402_pay_b", tx_hash)

    assert ok2 is False
    assert "already been used" in msg2.lower()


@pytest.mark.asyncio
async def test_verify_payment_happy_path_binds_sender_and_consumes(tmp_db):
    """A matching sender + fresh tx_hash succeeds and records the consume."""
    from database.db import get_session
    from bot.models.subscription import ConsumedPayment

    uid = _make_user_and_wallet()
    _make_payment(uid, "x402_pay_ok")
    svc = _service()
    tx_hash = "0x" + "c" * 64

    with patch.object(
        svc,
        "_verify_transaction_on_chain",
        new=AsyncMock(return_value=(True, "verified", USER_WALLET.upper())),
    ):
        ok, _ = await svc.verify_payment("x402_pay_ok", tx_hash)

    assert ok is True
    with get_session() as session:
        row = (
            session.query(ConsumedPayment)
            .filter(ConsumedPayment.tx_hash == tx_hash.lower())
            .first()
        )
        assert row is not None
        assert row.chain == "base"
