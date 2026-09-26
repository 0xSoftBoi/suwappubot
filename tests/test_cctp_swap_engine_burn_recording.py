"""C2 money-path tests: the CCTP burn must be recorded BEFORE it is broadcast.

`_execute_cctp_swap` previously called `record_burn` strictly *after*
`send_raw_transaction`. That leaves a window where the burn is on-chain but has
no DB row — a client-side read timeout on a congested RPC (where the raw tx
still propagates) or a process kill mid-call strands the user's USDC
permanently, because the completion relayer only ever sees deposits that exist
in the DB.

The fix relies on the tx hash being deterministic from the signed payload, so
it can be recovered locally with `Web3.keccak` and persisted as
`status="pending_broadcast"` before broadcasting.

Note on shape: `_execute_cctp_swap` broadcasts TWICE — first the ERC20
approve, then the burn. So `send_raw_transaction` is legitimately called once
before any burn bookkeeping happens, and these tests distinguish the two by
signing a different payload for each rather than asserting on raw call counts.
"""

import os
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from web3 import Web3

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

from bot.services.swap_engine import SwapEngine, SwapError, SwapQuote  # noqa: E402

ADDR = "0x1111111111111111111111111111111111111111"

# Distinct signed payloads so the approve broadcast and the burn broadcast are
# tellable apart. Content need not be a real signature — only keccak matters.
SIGNED_APPROVE = "0x" + "aa" * 110
SIGNED_BURN = "0x" + "bb" * 110

APPROVE_BYTES = bytes.fromhex(SIGNED_APPROVE[2:])
BURN_BYTES = bytes.fromhex(SIGNED_BURN[2:])
BURN_HASH = Web3.keccak(BURN_BYTES)


def _expected_burn_hex() -> str:
    hex_ = BURN_HASH.hex()
    return hex_ if hex_.startswith("0x") else "0x" + hex_


def _quote(from_chain="arbitrum", to_chain="base"):
    return SwapQuote(
        provider="cctp",
        from_chain=from_chain,
        to_chain=to_chain,
        from_token="USDC",
        to_token="USDC",
        from_amount="100000000",
        from_amount_human=100.0,
        to_amount="100000000",
        to_amount_human=100.0,
        to_amount_min="100000000",
        gas_cost_usd=0.5,
        fee_cost_usd=0.0,
        total_cost_usd=0.5,
        estimated_time=120,
        price_impact=0.0,
        exchange_rate=1.0,
        raw_quote={},
    )


def _wallet_data():
    return {"user_id": 42, "address": ADDR}


def _engine_with_mocks(burn_send_side_effect=None, events=None):
    """Build a SwapEngine whose approve leg always succeeds.

    `burn_send_side_effect` applies ONLY to the burn broadcast, so a test can
    fail the burn without also breaking the approve that precedes it.
    `events`, if given, records an ordered trace of the interesting calls.
    """
    engine = SwapEngine()
    engine._get_wallet_for_signing = AsyncMock(
        return_value=SimpleNamespace(is_turnkey_wallet=False)
    )

    cctp_quote = SimpleNamespace(from_amount="100000000", version=2)
    engine.cctp = SimpleNamespace(
        get_quote=AsyncMock(return_value=cctp_quote),
        build_approve_transaction=MagicMock(return_value={"to": ADDR, "data": "0x", "value": 0}),
        build_burn_transaction=MagicMock(return_value={"to": ADDR, "data": "0x", "value": 0}),
    )

    web3 = MagicMock()
    web3.eth.get_transaction_count.return_value = 1
    web3.eth.gas_price = 1_000_000_000
    web3.eth.estimate_gas.return_value = 100_000
    web3.eth.wait_for_transaction_receipt.return_value = {"status": 1}

    def _send(raw):
        """Route on payload so approve and burn behave independently."""
        if raw == BURN_BYTES:
            if events is not None:
                events.append("send_burn")
            if burn_send_side_effect is not None:
                raise burn_send_side_effect
            return BURN_HASH
        if events is not None:
            events.append("send_approve")
        return Web3.keccak(APPROVE_BYTES)

    web3.eth.send_raw_transaction.side_effect = _send

    # Approve first, burn second.
    engine.wallet_service = SimpleNamespace(
        sign_evm_transaction=AsyncMock(side_effect=[SIGNED_APPROVE, SIGNED_BURN])
    )

    return engine, web3


def _fake_relayer(record_side_effect=None, events=None):
    def _record(**kwargs):
        if events is not None:
            events.append("record_burn")
        if record_side_effect is not None:
            raise record_side_effect
        return 1

    def _mark(burn_hash):
        if events is not None:
            events.append("mark_broadcast")

    return SimpleNamespace(
        record_burn=MagicMock(side_effect=_record),
        mark_broadcast=MagicMock(side_effect=_mark),
    )


def _patches(web3, relayer):
    return (
        patch("bot.services.swap_engine.rpc_manager.get_web3", return_value=web3),
        patch(
            "bot.services.swap_engine.get_chain_by_name",
            return_value=SimpleNamespace(chain_id=42161, native_token="ETH"),
        ),
        patch("bot.services.cctp_generic_relayer.cctp_generic_relayer", relayer),
    )


@pytest.mark.asyncio
async def test_burn_is_recorded_before_it_is_broadcast():
    """The ordering that closes the fund-loss window."""
    events: list[str] = []
    engine, web3 = _engine_with_mocks(events=events)
    relayer = _fake_relayer(events=events)

    p1, p2, p3 = _patches(web3, relayer)
    with p1, p2, p3:
        burn_hex = await engine._execute_cctp_swap(_quote(), _wallet_data())

    # The approve broadcast comes first and is unrelated to burn bookkeeping.
    assert events == ["send_approve", "record_burn", "send_burn", "mark_broadcast"], events
    assert events.index("record_burn") < events.index("send_burn")

    kwargs = relayer.record_burn.call_args.kwargs
    assert kwargs["status"] == "pending_broadcast"
    assert kwargs["burn_tx_hash"] == burn_hex
    assert relayer.mark_broadcast.call_args.args[0] == burn_hex


@pytest.mark.asyncio
async def test_locally_derived_hash_matches_the_broadcast_hash():
    """Pre-recording is only safe if the local hash is the real tx hash."""
    engine, web3 = _engine_with_mocks()
    relayer = _fake_relayer()

    p1, p2, p3 = _patches(web3, relayer)
    with p1, p2, p3:
        burn_hex = await engine._execute_cctp_swap(_quote(), _wallet_data())

    assert burn_hex.lower() == _expected_burn_hex().lower()


@pytest.mark.asyncio
async def test_aborts_before_broadcasting_the_burn_if_recording_fails():
    """Safe direction: if the DB is down, refuse to burn at all.

    Note the approve may already have been broadcast — that costs gas but
    burns nothing, so it is recoverable. What must never happen is a burn with
    no DB row.
    """
    events: list[str] = []
    engine, web3 = _engine_with_mocks(events=events)
    relayer = _fake_relayer(record_side_effect=RuntimeError("db down"), events=events)

    p1, p2, p3 = _patches(web3, relayer)
    with p1, p2, p3:
        with pytest.raises(SwapError):
            await engine._execute_cctp_swap(_quote(), _wallet_data())

    assert "send_burn" not in events, "burn was broadcast despite recording failure"
    assert events == ["send_approve", "record_burn"], events


@pytest.mark.asyncio
async def test_pending_broadcast_row_survives_a_broadcast_timeout():
    """A read timeout does NOT mean the tx failed — it may already have landed.

    The row must be left exactly as recorded so the relayer's reconciler can
    resolve it from an on-chain receipt. In particular it must not be deleted,
    and it must not be promoted to "burned" as if the broadcast had succeeded.
    """
    events: list[str] = []
    engine, web3 = _engine_with_mocks(
        burn_send_side_effect=TimeoutError("read timed out"), events=events
    )
    relayer = _fake_relayer(events=events)

    p1, p2, p3 = _patches(web3, relayer)
    with p1, p2, p3:
        with pytest.raises(Exception):
            await engine._execute_cctp_swap(_quote(), _wallet_data())

    # Recorded before the attempt, and never optimistically promoted.
    assert "record_burn" in events
    assert events.index("record_burn") < events.index("send_burn")
    relayer.mark_broadcast.assert_not_called()
    assert relayer.record_burn.call_args.kwargs["status"] == "pending_broadcast"
