"""POST /webapp/bridge/routes — the terminal's bridge route list.

The endpoint's job is to preserve the two fields that make a bridge different
from a swap: how it settles, and who holds the funds in flight. A response that
flattens those into a provider name would leave the UI unable to tell a
canonical rollup bridge from a solver network.
"""

import asyncio
import os

import pytest
from fastapi import HTTPException

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

from api.webapp import (  # noqa: E402
    WebAppBridgeRoutesRequest,
    list_terminal_bridge_routes,
)
from bot.services.bridge.base import BridgeQuote  # noqa: E402


def _call(**overrides):
    body = WebAppBridgeRoutesRequest(
        fromChain=overrides.pop("fromChain", "arbitrum"),
        toChain=overrides.pop("toChain", "base"),
        token=overrides.pop("token", "USDC"),
        amount=overrides.pop("amount", "1000000"),
        **overrides,
    )
    return asyncio.run(list_terminal_bridge_routes(body, auth_payload=None, db=None))


def test_same_chain_is_rejected():
    """Bridging to the same chain is a swap; say so rather than return [] ."""
    with pytest.raises(HTTPException) as excinfo:
        _call(fromChain="base", toChain="base")
    assert excinfo.value.status_code == 400


def test_no_enabled_provider_returns_empty_not_an_error():
    """Every provider is behind a default-OFF flag, so "no routes" is the
    normal answer — the UI renders an empty state for it."""
    result = _call()
    assert result.routes == []


def test_settlement_and_trust_survive_the_wire(monkeypatch):
    """The whole reason this endpoint exists rather than reusing /swap/quote."""

    async def _fake_quotes(**kwargs):
        return [
            BridgeQuote(
                provider="cctp",
                from_chain="arbitrum",
                to_chain="base",
                from_token="USDC",
                to_token="USDC",
                from_amount="1000000",
                to_amount="1000000",
                to_amount_min="1000000",
                gas_cost_usd=0.4,
                fee_cost_usd=0.1,
                estimated_time=20,
                settlement="tx",
                trust_model="liquidity",
            )
        ]

    monkeypatch.setattr("bot.services.bridge.registry.get_bridge_quotes", _fake_quotes)

    route = _call().routes[0]
    assert route.settlement == "tx"
    assert route.trustModel == "liquidity"
    # USDC is 6dp, so 1_000_000 base units is 1.0.
    assert route.toAmountHuman == pytest.approx(1.0)
    assert route.totalCostUsd == pytest.approx(0.5)


def test_zero_slippage_is_claimed_only_for_mint_burn_rails(monkeypatch):
    """`zeroSlippage` drives a "no price impact" claim in the UI, so an
    unrecognised provider must be reported as pooled rather than guaranteed."""

    async def _fake_quotes(**kwargs):
        base = dict(
            from_chain="arbitrum",
            to_chain="base",
            from_token="USDC",
            to_token="USDC",
            from_amount="1000000",
            to_amount="1000000",
            to_amount_min="990000",
            gas_cost_usd=0.0,
            fee_cost_usd=0.0,
            estimated_time=60,
        )
        return [
            BridgeQuote(provider="cctp", **base),
            BridgeQuote(provider="usdt0", **base),
            BridgeQuote(provider="some_pooled_bridge", **base),
        ]

    monkeypatch.setattr("bot.services.bridge.registry.get_bridge_quotes", _fake_quotes)

    by_provider = {route.provider: route for route in _call().routes}
    assert by_provider["cctp"].zeroSlippage is True
    assert by_provider["usdt0"].zeroSlippage is True
    assert by_provider["some_pooled_bridge"].zeroSlippage is False


def test_unparseable_amount_is_dropped_not_rendered_wrong(monkeypatch):
    """Better to show one fewer route than a wrong number."""

    async def _fake_quotes(**kwargs):
        return [
            BridgeQuote(
                provider="broken",
                from_chain="arbitrum",
                to_chain="base",
                from_token="USDC",
                to_token="USDC",
                from_amount="1000000",
                to_amount="not-a-number",
                to_amount_min="0",
                gas_cost_usd=0.0,
                fee_cost_usd=0.0,
                estimated_time=60,
            )
        ]

    monkeypatch.setattr("bot.services.bridge.registry.get_bridge_quotes", _fake_quotes)
    assert _call().routes == []


def test_provider_failure_does_not_500_the_page(monkeypatch):
    async def _boom(**kwargs):
        raise RuntimeError("upstream down")

    monkeypatch.setattr("bot.services.bridge.registry.get_bridge_quotes", _boom)
    assert _call().routes == []


def test_amount_is_converted_to_raw_units(monkeypatch):
    """Routes takes HUMAN units and providers take raw base units — this is
    the lock on that conversion (money-path review): '250' USDC must reach
    get_bridge_quotes as '250000000', with a sentinel sender when no wallet
    is connected yet."""
    captured = {}

    async def _fake_quotes(**kwargs):
        captured.update(kwargs)
        return []

    import bot.services.bridge.registry as registry

    monkeypatch.setattr(registry, "get_bridge_quotes", _fake_quotes)

    _call(amount="250")
    assert captured["from_amount"] == "250000000"  # 250 * 10^6 (USDC)
    assert captured["from_address"] == "0x000000000000000000000000000000000000dEaD"

    _call(amount="0.5", fromAddress="0x1111111111111111111111111111111111111111")
    assert captured["from_amount"] == "500000"
    assert captured["from_address"] == "0x1111111111111111111111111111111111111111"


def test_bad_amounts_are_rejected_not_500s():
    """Infinity/NaN/garbage/zero are 400s, never unhandled exceptions."""
    for bad in ("Infinity", "-Infinity", "NaN", "abc", "0", "-5"):
        with pytest.raises(HTTPException) as excinfo:
            _call(amount=bad)
        assert excinfo.value.status_code == 400, bad


def test_unknown_token_is_rejected():
    """Raw addresses and unknown symbols fail closed — the registry is the
    only source of token identity on this endpoint."""
    with pytest.raises(HTTPException) as excinfo:
        _call(token="0x1111111111111111111111111111111111111111")
    assert excinfo.value.status_code == 400
