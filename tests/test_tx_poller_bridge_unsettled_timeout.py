"""Round-3 hardening: distinguish a bridge-unsettled wall-clock timeout from
a genuine origin-tx revert, both for the 0x Cross-Chain "unresolved status"
path and for a stuck ``bridge_pending`` state.

A revert means the funds never left the wallet -- retrying is safe. A
timeout with a MINED origin receipt (or a bridge stuck reporting
``bridge_pending`` well past a sane ceiling) means the funds already left
the wallet and are somewhere in the bridge -- retrying risks a double-send,
so the user must be told to wait/contact support instead.
"""

import asyncio
import json
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock

from bot.models.swap import SwapStatus
from bot.services.tx_poller import TransactionPoller


def _tx_dict(**overrides) -> dict:
    base = {
        "id": 1,
        "tx_hash": "0xorigin",
        "from_chain": "base",
        "to_chain": "robinhood",
        "route_provider": "0x_crosschain",
        "route_data": json.dumps({"quote_id": "0xquote-robinhood"}),
        "status": SwapStatus.CONFIRMING.value,
        "user_id": 1,
        "from_token": "USDC",
        "to_token": "FRONG",
        "from_amount": "1000000",
        "error_message": None,
        "created_at": datetime.now(timezone.utc) - timedelta(hours=3),
    }
    base.update(overrides)
    return base


# --- fix #1: unresolved-status timeout must tell a mined receipt apart -----
# --- from a genuine revert ---------------------------------------------------


def test_unresolved_timeout_with_mined_receipt_sets_bridge_unsettled_reason():
    """Origin receipt mined (0x1) but the 0x status API never resolved the
    bridge fill within ZEROX_UNRESOLVED_FAIL_AFTER: this is a stuck bridge,
    NOT a revert -- funds already left the wallet."""
    poller = TransactionPoller()

    async def fake_check_evm_tx(tx_hash, rpc_url, provider=None):
        # Mined + success, is_cross_chain=True -> CONFIRMING per _check_evm_tx.
        return SwapStatus.CONFIRMING.value

    poller._check_evm_tx = fake_check_evm_tx
    tx_dict = _tx_dict()

    status, dest_hash = asyncio.run(
        poller._handle_zerox_status_unresolved(tx_dict, {"quote_id": "0xquote-robinhood"})
    )

    assert status == SwapStatus.FAILED.value
    assert dest_hash is None
    assert tx_dict["error_message"] == poller.BRIDGE_UNSETTLED_TIMEOUT_REASON


def test_unresolved_timeout_on_receipt_revert_keeps_generic_reason():
    """A reverted origin receipt is a real revert -- must NOT get the
    funds-in-transit copy, and must resolve immediately (no timeout wait)."""
    poller = TransactionPoller()

    async def fake_check_evm_tx(tx_hash, rpc_url, provider=None):
        return SwapStatus.FAILED.value

    poller._check_evm_tx = fake_check_evm_tx
    # Freshly created -- must fail immediately on revert, not wait for the bound.
    tx_dict = _tx_dict(created_at=datetime.now(timezone.utc))

    status, dest_hash = asyncio.run(
        poller._handle_zerox_status_unresolved(tx_dict, {"quote_id": "0xquote-robinhood"})
    )

    assert status == SwapStatus.FAILED.value
    assert dest_hash is None
    assert tx_dict.get("error_message") != poller.BRIDGE_UNSETTLED_TIMEOUT_REASON


def test_unresolved_timeout_without_mined_receipt_keeps_generic_reason():
    """Origin tx not even mined yet at the 2h bound -- still fails closed
    (existing behavior), but is not the "funds in transit" case since there
    is no evidence the funds ever left the wallet."""
    poller = TransactionPoller()

    async def fake_check_evm_tx(tx_hash, rpc_url, provider=None):
        return SwapStatus.SUBMITTED.value

    poller._check_evm_tx = fake_check_evm_tx
    tx_dict = _tx_dict()

    status, dest_hash = asyncio.run(
        poller._handle_zerox_status_unresolved(tx_dict, {"quote_id": "0xquote-robinhood"})
    )

    assert status == SwapStatus.FAILED.value
    assert tx_dict.get("error_message") != poller.BRIDGE_UNSETTLED_TIMEOUT_REASON


# --- fix #1: the two FAILED notification variants ---------------------------


class _CapturingBot:
    def __init__(self):
        self.sent = []
        self.send_message = AsyncMock(side_effect=self._record)

    async def _record(self, **kwargs):
        self.sent.append(kwargs)


def _run_notify(error_message):
    poller = TransactionPoller()
    bot = _CapturingBot()
    poller._bot = bot

    fake_user = MagicMock(telegram_id=42)
    fake_session = MagicMock()
    fake_session.query.return_value.filter.return_value.first.return_value = fake_user
    fake_session.__enter__.return_value = fake_session
    fake_session.__exit__.return_value = False

    import bot.services.tx_poller as tx_poller_module

    orig_get_session = tx_poller_module.get_db_session
    tx_poller_module.get_db_session = lambda: fake_session
    try:
        tx_dict = _tx_dict(error_message=error_message)
        asyncio.run(
            poller._notify_user_dict(tx_dict, SwapStatus.CONFIRMING.value, SwapStatus.FAILED.value)
        )
    finally:
        tx_poller_module.get_db_session = orig_get_session

    assert len(bot.sent) == 1
    return bot.sent[0]


def test_notify_bridge_unsettled_timeout_omits_retry_and_flags_no_retry():
    sent = _run_notify(TransactionPoller.BRIDGE_UNSETTLED_TIMEOUT_REASON)
    text = sent["text"]
    assert "has not confirmed settlement after 2 hours" in text
    assert "do NOT retry this swap" in text
    assert "Support has been flagged" in text

    keyboard_buttons = [b.text for row in sent["reply_markup"].inline_keyboard for b in row]
    keyboard_callbacks = [
        b.callback_data for row in sent["reply_markup"].inline_keyboard for b in row
    ]
    assert not any("Retry" in t for t in keyboard_buttons)
    assert "swap_start" not in keyboard_callbacks


def test_notify_generic_failed_keeps_retry_button():
    sent = _run_notify(None)
    text = sent["text"]
    assert "Swap Failed" in text
    assert "Transaction reverted" in text

    keyboard_callbacks = [
        b.callback_data for row in sent["reply_markup"].inline_keyboard for b in row
    ]
    assert "swap_start" in keyboard_callbacks


# --- fix #3: bridge_pending also needs a wall-clock ceiling ------------------


def test_bridge_pending_within_bound_stays_confirming(tmp_db):
    from bot.models.swap import SwapTransaction
    from bot.models.user import User
    from database.db import get_session as get_db_session

    with get_db_session() as session:
        user = User(telegram_id=760101)
        session.add(user)
        session.flush()
        tx = SwapTransaction(
            user_id=user.id,
            from_chain="base",
            from_token="USDC",
            from_amount="1000000",
            to_chain="robinhood",
            to_token="FRONG",
            to_amount="1000000000000000000",
            status=SwapStatus.CONFIRMING.value,
            tx_hash="0xorigin",
            route_provider="0x_crosschain",
            route_data=json.dumps({"quote_id": "0xquote-robinhood"}),
            created_at=datetime.now(timezone.utc) - timedelta(hours=6),
        )
        session.add(tx)
        session.commit()
        tx_id = tx.id

    poller = TransactionPoller()
    poller._zerox = MagicMock()
    poller._zerox.get_cross_chain_status = AsyncMock(
        return_value={"status": "bridge_pending", "transactions": []}
    )

    asyncio.run(poller._check_pending_transactions())

    with get_db_session() as session:
        stored = session.get(SwapTransaction, tx_id)
        assert stored.status == SwapStatus.CONFIRMING.value


def test_bridge_pending_past_12h_bound_fails_as_bridge_unsettled(tmp_db):
    from bot.models.swap import SwapTransaction
    from bot.models.user import User
    from database.db import get_session as get_db_session

    with get_db_session() as session:
        user = User(telegram_id=760102)
        session.add(user)
        session.flush()
        tx = SwapTransaction(
            user_id=user.id,
            from_chain="base",
            from_token="USDC",
            from_amount="1000000",
            to_chain="robinhood",
            to_token="FRONG",
            to_amount="1000000000000000000",
            status=SwapStatus.CONFIRMING.value,
            tx_hash="0xorigin",
            route_provider="0x_crosschain",
            route_data=json.dumps({"quote_id": "0xquote-robinhood"}),
            created_at=datetime.now(timezone.utc) - timedelta(hours=13),
        )
        session.add(tx)
        session.commit()
        tx_id = tx.id

    poller = TransactionPoller()
    poller._zerox = MagicMock()
    poller._zerox.get_cross_chain_status = AsyncMock(
        return_value={"status": "bridge_pending", "transactions": []}
    )

    asyncio.run(poller._check_pending_transactions())

    with get_db_session() as session:
        stored = session.get(SwapTransaction, tx_id)
        assert stored.status == SwapStatus.FAILED.value
        assert stored.error_message == TransactionPoller.BRIDGE_UNSETTLED_TIMEOUT_REASON
