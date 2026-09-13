"""tx_poller: Relay intents complete only when Relay reports the destination fill.

A mined origin deposit is not a completed swap for Relay; the solver may
refund on the origin chain instead. These tests pin the status mapping and
the fallback when no request id was persisted.
"""

import json
import os
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

from bot.models.swap import SwapStatus  # noqa: E402
from bot.services.tx_poller import TransactionPoller  # noqa: E402


def _tx(request_id="0xreq", provider="relay"):
    return {
        "id": 1,
        "tx_hash": "0x" + "ab" * 32,
        "from_chain": "base",
        "to_chain": "arbitrum",
        "route_provider": provider,
        "route_data": json.dumps({"request_id": request_id}) if request_id else None,
        "status": SwapStatus.SUBMITTED.value,
    }


def _poller(origin_status, relay_status=None, tx_hashes=None, raw=None):
    p = TransactionPoller()
    p._check_evm_tx = AsyncMock(return_value=origin_status)
    status_obj = SimpleNamespace(
        request_id="0xreq", status=relay_status, tx_hashes=tx_hashes or [], raw=raw or {}
    )
    return p, status_obj


def test_relay_is_a_dest_fill_provider():
    assert "relay" in TransactionPoller._PROVIDERS_WITH_DEST_FILL_CHECK


@pytest.mark.asyncio
async def test_dispatches_relay_provider_to_relay_check():
    p, _ = _poller(SwapStatus.CONFIRMING.value)
    p._check_relay_status_dict = AsyncMock(return_value=(SwapStatus.CONFIRMING.value, None))
    with patch("bot.services.tx_poller.rpc_manager"):
        out = await p._check_tx_status_dict(_tx())
    assert out == (SwapStatus.CONFIRMING.value, None)
    p._check_relay_status_dict.assert_awaited_once()


@pytest.mark.asyncio
async def test_filled_completes_with_destination_hash():
    p, st = _poller(SwapStatus.CONFIRMING.value, "FILLED", tx_hashes=["0xdest"])
    with (
        patch("bot.services.relay_api.relay_api") as api,
        patch("bot.services.tx_poller.rpc_manager"),
    ):
        api.get_status = AsyncMock(return_value=st)
        assert await p._check_relay_status_dict(_tx()) == (SwapStatus.COMPLETED.value, "0xdest")


@pytest.mark.asyncio
async def test_refund_fails_with_reason():
    p, st = _poller(SwapStatus.CONFIRMING.value, "REFUNDED", raw={"failReason": "SLIPPAGE"})
    tx = _tx()
    with (
        patch("bot.services.relay_api.relay_api") as api,
        patch("bot.services.tx_poller.rpc_manager"),
    ):
        api.get_status = AsyncMock(return_value=st)
        assert await p._check_relay_status_dict(tx) == (SwapStatus.FAILED.value, None)
    assert "refunded" in tx["error_message"] and "SLIPPAGE" in tx["error_message"]


@pytest.mark.asyncio
async def test_pending_after_origin_mined_stays_confirming_not_completed():
    p, st = _poller(SwapStatus.CONFIRMING.value, "PENDING")
    with (
        patch("bot.services.relay_api.relay_api") as api,
        patch("bot.services.tx_poller.rpc_manager"),
    ):
        api.get_status = AsyncMock(return_value=st)
        assert await p._check_relay_status_dict(_tx()) == (SwapStatus.CONFIRMING.value, None)


@pytest.mark.asyncio
async def test_pending_before_origin_mined_stays_submitted():
    p, st = _poller(SwapStatus.SUBMITTED.value, "PENDING")
    with (
        patch("bot.services.relay_api.relay_api") as api,
        patch("bot.services.tx_poller.rpc_manager"),
    ):
        api.get_status = AsyncMock(return_value=st)
        assert await p._check_relay_status_dict(_tx()) == (SwapStatus.SUBMITTED.value, None)


@pytest.mark.asyncio
async def test_origin_revert_fails_without_asking_relay():
    p, st = _poller(SwapStatus.FAILED.value, "FILLED")
    with (
        patch("bot.services.relay_api.relay_api") as api,
        patch("bot.services.tx_poller.rpc_manager"),
    ):
        api.get_status = AsyncMock(return_value=st)
        assert await p._check_relay_status_dict(_tx()) == (SwapStatus.FAILED.value, None)
        api.get_status.assert_not_awaited()


@pytest.mark.asyncio
async def test_missing_request_id_never_completes_on_origin_receipt():
    p, _ = _poller(SwapStatus.CONFIRMING.value)
    with patch("bot.services.tx_poller.rpc_manager"):
        assert await p._check_relay_status_dict(_tx(request_id=None)) == (
            SwapStatus.CONFIRMING.value,
            None,
        )


@pytest.mark.asyncio
async def test_relay_api_error_keeps_in_flight():
    p, _ = _poller(SwapStatus.CONFIRMING.value)
    with (
        patch("bot.services.relay_api.relay_api") as api,
        patch("bot.services.tx_poller.rpc_manager"),
    ):
        api.get_status = AsyncMock(side_effect=RuntimeError("429"))
        assert await p._check_relay_status_dict(_tx()) == (SwapStatus.CONFIRMING.value, None)


@pytest.mark.asyncio
async def test_unresolved_relay_intent_fails_after_wall_clock_ceiling():
    from datetime import datetime, timedelta, timezone

    p, st = _poller(SwapStatus.CONFIRMING.value, "PENDING")
    tx = _tx()
    tx["created_at"] = datetime.now(timezone.utc) - timedelta(hours=13)
    with (
        patch("bot.services.relay_api.relay_api") as api,
        patch("bot.services.tx_poller.rpc_manager"),
    ):
        api.get_status = AsyncMock(return_value=st)
        assert await p._check_relay_status_dict(tx) == (SwapStatus.FAILED.value, None)
    assert tx["error_message"] == TransactionPoller.BRIDGE_UNSETTLED_TIMEOUT_REASON


@pytest.mark.asyncio
async def test_recent_pending_relay_intent_is_not_timed_out():
    from datetime import datetime, timezone

    p, st = _poller(SwapStatus.CONFIRMING.value, "PENDING")
    tx = _tx()
    tx["created_at"] = datetime.now(timezone.utc)
    with (
        patch("bot.services.relay_api.relay_api") as api,
        patch("bot.services.tx_poller.rpc_manager"),
    ):
        api.get_status = AsyncMock(return_value=st)
        assert await p._check_relay_status_dict(tx) == (SwapStatus.CONFIRMING.value, None)


@pytest.mark.asyncio
async def test_filled_without_destination_hash_never_uses_origin_hash():
    p, st = _poller(SwapStatus.CONFIRMING.value, "FILLED", tx_hashes=[])
    with (
        patch("bot.services.relay_api.relay_api") as api,
        patch("bot.services.tx_poller.rpc_manager"),
    ):
        api.get_status = AsyncMock(return_value=st)
        assert await p._check_relay_status_dict(_tx()) == (SwapStatus.COMPLETED.value, None)


def test_relay_status_separates_origin_and_destination_hashes():
    import asyncio
    from unittest.mock import AsyncMock as _AM

    from bot.services.relay_api import RelayAPI

    class _R:
        status = 200

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def json(self):
            return {"status": "success", "inTxHashes": ["0xorigin"], "txHashes": []}

    class _S:
        def get(self, *a, **k):
            return _R()

    r = RelayAPI()
    with (
        patch("bot.services.relay_api.get_session", _AM(return_value=_S())),
        patch("bot.services.relay_api.api_limiter.wait_and_acquire", _AM(return_value=None)),
    ):
        st = asyncio.run(r.get_status("0x1"))
    assert st.status == "FILLED" and st.tx_hashes == [] and st.in_tx_hashes == ["0xorigin"]
