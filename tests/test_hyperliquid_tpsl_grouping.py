"""MONEY-PATH. Protection must ride along with the entry, in one signed action.

`place_order` accepted `tp_price`/`sl_price` and ignored them, so protection was
placed as separate follow-up orders — leaving a window where a filled position
was live and unprotected, and letting the stored level drift from what the
exchange was actually holding.

These tests pin the wire: a normalTpsl group carrying entry + reduce-only
triggers, and ids reported only for the legs the exchange accepted.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from bot.services.hyperliquid_client import HyperLiquidClient


def _response(statuses):
    res = MagicMock()
    res.status_code = 200
    res.json.return_value = {"response": {"data": {"statuses": statuses}}}
    return res


def _client_with(statuses):
    """A HyperLiquidClient whose exchange POST is captured rather than sent."""
    hl = HyperLiquidClient()
    http = MagicMock()
    http.post = AsyncMock(return_value=_response(statuses))
    return hl, http


async def _place(hl, http, **overrides):
    kwargs = dict(
        address="0xabc",
        api_key="k",
        api_secret="s",
        market="ETH-USD",
        side="long",
        size=1.5,
        leverage=2,
        order_type="market",
        tp_price=2500.0,
        sl_price=1500.0,
    )
    kwargs.update(overrides)

    with (
        patch.object(hl, "_get_client", AsyncMock(return_value=http)),
        patch.object(hl, "_resolve_asset_index", AsyncMock(return_value=1)),
        patch.object(hl, "_set_leverage", AsyncMock(return_value=None)),
        patch.object(hl, "get_mark_price", AsyncMock(return_value=2000.0)),
        patch.object(hl, "_sign_action", MagicMock(return_value="sig")),
    ):
        result = await hl.place_order(**kwargs)

    action = http.post.call_args.kwargs["json"]["action"]
    return result, action


@pytest.mark.asyncio
async def test_entry_and_protection_go_out_in_one_grouped_action():
    hl, http = _client_with(
        [
            {"filled": {"oid": 1, "avgPx": "2000", "totalSz": "1.5"}},
            {"resting": {"oid": 2}},
            {"resting": {"oid": 3}},
        ]
    )
    result, action = await _place(hl, http)

    assert action["grouping"] == "normalTpsl"
    assert len(action["orders"]) == 3, "entry plus both protective legs"
    assert result.tp_order_id == "2"
    assert result.sl_order_id == "3"


@pytest.mark.asyncio
async def test_protective_legs_close_the_position():
    """A long is protected by sells. Same-direction triggers would double the position."""
    hl, http = _client_with(
        [
            {"filled": {"oid": 1, "avgPx": "2000", "totalSz": "1.5"}},
            {"resting": {"oid": 2}},
            {"resting": {"oid": 3}},
        ]
    )
    _, action = await _place(hl, http, side="long")

    entry, tp, sl = action["orders"]
    assert entry["b"] is True, "a long entry buys"
    for leg, kind in ((tp, "tp"), (sl, "sl")):
        assert leg["b"] is False, f"{kind} leg must sell to close a long"
        assert leg["r"] is True, f"{kind} leg must be reduce-only"
        assert leg["t"]["trigger"]["tpsl"] == kind


@pytest.mark.asyncio
async def test_a_short_is_protected_by_buys():
    hl, http = _client_with(
        [
            {"filled": {"oid": 1, "avgPx": "2000", "totalSz": "1.5"}},
            {"resting": {"oid": 2}},
            {"resting": {"oid": 3}},
        ]
    )
    _, action = await _place(hl, http, side="short")

    entry, tp, sl = action["orders"]
    assert entry["b"] is False, "a short entry sells"
    assert tp["b"] is True and sl["b"] is True, "protection buys back to close a short"


@pytest.mark.asyncio
async def test_a_refused_leg_reports_no_id():
    """Asking for a stop is not having one — a rejected leg must not read as protection."""
    hl, http = _client_with(
        [
            {"filled": {"oid": 1, "avgPx": "2000", "totalSz": "1.5"}},
            {"resting": {"oid": 2}},
            {"error": "insufficient margin"},
        ]
    )
    result, _ = await _place(hl, http)

    assert result.tp_order_id == "2"
    assert result.sl_order_id is None


@pytest.mark.asyncio
async def test_unexpected_status_arity_reports_no_protection():
    """Fail closed. Nothing in a leg says which order it is, so position is all we have.

    Re-placing a stop that already exists is recoverable; pinning the take
    profit's id to the stop loss and cancelling the wrong order later is not.
    """
    hl, http = _client_with(
        [
            {"filled": {"oid": 1, "avgPx": "2000", "totalSz": "1.5"}},
            {"resting": {"oid": 2}},
        ]  # two statuses for three orders
    )
    result, _ = await _place(hl, http)

    assert result.order_id == "1", "the entry is still reported"
    assert result.tp_order_id is None
    assert result.sl_order_id is None


@pytest.mark.asyncio
async def test_no_protection_requested_stays_ungrouped():
    hl, http = _client_with([{"filled": {"oid": 1, "avgPx": "2000", "totalSz": "1.5"}}])
    result, action = await _place(hl, http, tp_price=None, sl_price=None)

    assert action["grouping"] == "na"
    assert len(action["orders"]) == 1
    assert result.tp_order_id is None and result.sl_order_id is None


@pytest.mark.asyncio
async def test_a_reduce_only_close_carries_no_protection():
    """Closing an existing position has nothing to protect."""
    hl, http = _client_with([{"filled": {"oid": 1, "avgPx": "2000", "totalSz": "1.5"}}])
    _, action = await _place(hl, http, reduce_only=True)

    assert action["grouping"] == "na"
    assert len(action["orders"]) == 1
