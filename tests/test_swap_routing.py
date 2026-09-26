"""Wave 3 tests for #249: bridge providers wired into swap_engine routing.

Verifies the eligibility predicates, the per-provider quote->SwapQuote mapping
(including raw_quote keys the executors need), and that get_quote() actually
races the newly-wired providers and returns the best price.
"""

import asyncio
import os

import pytest

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

from types import SimpleNamespace  # noqa: E402
from bot.config.settings import settings  # noqa: E402
from bot.services.swap_engine import SwapEngine, SwapQuote  # noqa: E402


@pytest.fixture()
def engine():
    return SwapEngine()


# --- Eligibility predicates -----------------------------------------------


def test_cctp_generic_rail_gated_off_by_default(engine):
    """The generic CCTP rail must not be offered while completion is unwired.

    `_execute_cctp_swap` only does approve+burn on the source chain; nothing
    polls the Circle attestation or submits `receiveMessage` for this rail
    (cctp_relayer.py completes only cctp_hypercore's separate HyperCore
    burns). Offering it would burn a user's USDC and never mint it, so it is
    gated behind `settings.cctp_generic_rail_enabled`, default False.
    """
    assert settings.cctp_generic_rail_enabled is False
    assert engine._is_cctp_route("ethereum", "base", "USDC", "USDC") is False


def test_cctp_route_usdc_only(engine, monkeypatch):
    """Eligibility rules, checked with the fund-loss gate explicitly opened."""
    monkeypatch.setattr(settings, "cctp_generic_rail_enabled", True, raising=False)

    assert engine._is_cctp_route("ethereum", "base", "USDC", "USDC") is True
    assert engine._is_cctp_route("ethereum", "base", "USDT", "USDT") is False  # not USDC
    assert engine._is_cctp_route("ethereum", "ethereum", "USDC", "USDC") is False  # same chain


def test_cow_is_same_chain_evm(engine):
    assert engine._is_cow_route("ethereum", "ethereum") is True
    assert engine._is_cow_route("ethereum", "base") is False  # cross-chain
    assert engine._is_cow_route("solana", "solana") is False  # unsupported chain


def test_socket_cross_chain_evm(engine):
    assert engine._is_socket_route("ethereum", "base") is True
    assert engine._is_socket_route("ethereum", "solana") is False


def test_wormhole_gates_solana_to_evm(engine):
    # Solana -> EVM execution isn't implemented (#250): must not be offered.
    assert engine._is_wormhole_route("solana", "ethereum", "USDC", "USDC") is False
    # EVM -> Solana is allowed (same token, supported).
    assert engine._is_wormhole_route("ethereum", "solana", "USDC", "USDC") is True


# --- Per-provider quote mapping -------------------------------------------


def test_cctp_quote_mapping(engine):
    fake = SimpleNamespace(
        from_amount="1000000",
        to_amount="1000000",
        to_amount_human=1.0,
        gas_cost_usd=0.2,
        bridge_fee_usd=0.0,
        total_cost_usd=0.2,
        estimated_time=120,
        token_messenger="0xTM",
        message_transmitter="0xMT",
        destination_domain=6,
        usdc_address="0xUSDC",
        raw_data={"provider": "cctp"},
    )

    async def fake_get_quote(**kw):
        return fake

    engine.cctp.get_quote = fake_get_quote

    q = asyncio.run(engine._get_cctp_quote("ethereum", "base", "USDC", 1.0, "1000000", 0.5))
    assert q.provider == "cctp"
    assert q.to_amount_human == 1.0
    assert q.exchange_rate == 1.0
    # Execution keys must be carried in raw_quote.
    for k in ("token_messenger", "message_transmitter", "destination_domain", "usdc_address"):
        assert k in q.raw_quote


def test_socket_quote_uses_best_route(engine):
    route = SimpleNamespace(
        route_id="r1",
        bridge_name="across",
        from_amount="1000000",
        to_amount="2000000",
        to_amount_human=2.0,
        gas_usd=1.0,
        service_fee_usd=0.5,
        total_fee_usd=1.5,
        estimated_time_seconds=90,
        raw_route={"x": 1},
    )
    fake = SimpleNamespace(best_route=route)

    async def fake_get_quote(**kw):
        return fake

    engine.socket.get_quote = fake_get_quote

    q = asyncio.run(
        engine._get_socket_quote("ethereum", "base", "USDC", "USDC", 1.0, "1000000", "0xA", None)
    )
    assert q.provider == "socket"
    assert q.to_amount_human == 2.0
    assert q.raw_quote["routeId"] == "r1" and q.raw_quote["bridgeName"] == "across"


def test_socket_quote_raises_without_route(engine):
    fake = SimpleNamespace(best_route=None)

    async def fake_get_quote(**kw):
        return fake

    engine.socket.get_quote = fake_get_quote
    with pytest.raises(Exception):
        asyncio.run(
            engine._get_socket_quote(
                "ethereum", "base", "USDC", "USDC", 1.0, "1000000", "0xA", None
            )
        )


def test_cow_quote_resolves_token_addresses(engine):
    # CoW's API checksum-addresses the tokens, so symbols must be resolved first;
    # passing the raw "USDC"/"WETH" symbols made every CoW quote raise.
    captured = {}

    async def fake_get_quote(**kw):
        captured.update(kw)
        return SimpleNamespace(
            from_amount="1000000",
            to_amount="990000",
            to_amount_human=0.99,
            raw_quote={"q": 1},
        )

    engine.cow.get_quote = fake_get_quote

    q = asyncio.run(engine._get_cow_quote("ethereum", "USDC", "WETH", 1.0, "1000000", "0xA", None))
    assert q.provider == "cow"
    assert captured["from_token"] != "USDC", "symbol must be resolved to an address"
    assert captured["to_token"] != "WETH", "symbol must be resolved to an address"


def test_socket_quote_resolves_token_addresses(engine):
    captured = {}
    route = SimpleNamespace(
        route_id="r1",
        bridge_name="across",
        from_amount="1000000",
        to_amount="2000000",
        to_amount_human=2.0,
        gas_usd=1.0,
        service_fee_usd=0.5,
        total_fee_usd=1.5,
        estimated_time_seconds=90,
        raw_route={"x": 1},
    )

    async def fake_get_quote(**kw):
        captured.update(kw)
        return SimpleNamespace(best_route=route)

    engine.socket.get_quote = fake_get_quote

    asyncio.run(
        engine._get_socket_quote("ethereum", "base", "USDC", "USDC", 1.0, "1000000", "0xA", None)
    )
    assert captured["from_token"] != "USDC", "symbol must be resolved to an address"
    assert captured["to_token"] != "USDC", "symbol must be resolved to an address"


def test_across_quote_persists_recipient(engine):
    # The recipient is honored at quote time but the SwapQuote has no recipient
    # field, so execution previously defaulted to the sender. Persist it in
    # raw_quote so _execute_across_swap deposits to the intended recipient.
    async def fake_get_quote(**kw):
        return SimpleNamespace(
            from_amount="1000000",
            from_amount_human=1.0,
            to_amount="990000",
            to_amount_human=0.99,
            gas_cost_usd=0.1,
            relay_fee_usd=0.2,
            total_cost_usd=0.3,
            estimated_fill_time=30,
            raw_quote={"spoke": "0xSP"},
        )

    engine.across.get_quote = fake_get_quote

    q = asyncio.run(
        engine._get_across_quote("ethereum", "base", "USDC", 1.0, "1000000", "0xA", "0xRECIPIENT")
    )
    assert q.raw_quote["recipient"] == "0xRECIPIENT"
    # No recipient -> not injected (execution defaults to the sender).
    q2 = asyncio.run(
        engine._get_across_quote("ethereum", "base", "USDC", 1.0, "1000000", "0xA", None)
    )
    assert "recipient" not in q2.raw_quote


# --- End-to-end: get_quote races new providers and picks the best ---------


def test_get_quote_selects_best_among_wired_providers(engine, monkeypatch):
    """USDC ethereum->base should consider CCTP/Across/Socket/LiFi; best wins."""

    def make(provider, out):
        async def _q(*a, **k):
            return SwapQuote(
                provider=provider,
                from_chain="ethereum",
                to_chain="base",
                from_token="USDC",
                to_token="USDC",
                from_amount="1000000",
                from_amount_human=1.0,
                to_amount=str(int(out * 1e6)),
                to_amount_human=out,
                to_amount_min=str(int(out * 1e6)),
                gas_cost_usd=0.1,
                fee_cost_usd=0.0,
                total_cost_usd=0.1,
                estimated_time=60,
                price_impact=0,
                exchange_rate=out,
                raw_quote={},
            )

        return _q

    # Across offers the best output -> it should win the race.
    monkeypatch.setattr(engine, "_get_lifi_quote", make("lifi", 0.95))
    monkeypatch.setattr(engine, "_get_cctp_quote", make("cctp", 1.00))
    monkeypatch.setattr(engine, "_get_across_quote", make("across", 1.02))
    monkeypatch.setattr(engine, "_get_socket_quote", make("socket", 0.98))
    monkeypatch.setattr(engine, "_get_wormhole_quote", make("wormhole", 0.50))

    best = asyncio.run(
        engine.get_quote(
            from_chain="ethereum",
            to_chain="base",
            from_token="USDC",
            to_token="USDC",
            amount=1.0,
            from_address="0x" + "1" * 40,
            slippage=0.5,
        )
    )
    assert best.provider == "across"
    assert best.to_amount_human == 1.02


def test_get_quote_includes_ccip(engine, monkeypatch):
    """#257: CCIP must be raced by get_quote(), not only get_all_quotes()."""
    assert engine._is_ccip_route("ethereum", "arbitrum", "USDC", "USDC") is True

    def make(provider, out):
        async def _q(*a, **k):
            return SwapQuote(
                provider=provider,
                from_chain="ethereum",
                to_chain="arbitrum",
                from_token="USDC",
                to_token="USDC",
                from_amount="1000000",
                from_amount_human=1.0,
                to_amount=str(int(out * 1e6)),
                to_amount_human=out,
                to_amount_min=str(int(out * 1e6)),
                gas_cost_usd=0.1,
                fee_cost_usd=0.0,
                total_cost_usd=0.1,
                estimated_time=60,
                price_impact=0,
                exchange_rate=out,
                raw_quote={},
            )

        return _q

    # CCIP offers the best price -> it must win, proving it's wired into get_quote.
    monkeypatch.setattr(engine, "_get_lifi_quote", make("lifi", 0.97))
    monkeypatch.setattr(engine, "_get_ccip_quote", make("ccip", 1.05))
    monkeypatch.setattr(engine, "_get_cctp_quote", make("cctp", 1.00))
    monkeypatch.setattr(engine, "_get_across_quote", make("across", 1.01))
    monkeypatch.setattr(engine, "_get_socket_quote", make("socket", 0.99))

    best = asyncio.run(
        engine.get_quote(
            from_chain="ethereum",
            to_chain="arbitrum",
            from_token="USDC",
            to_token="USDC",
            amount=1.0,
            from_address="0x" + "1" * 40,
            slippage=0.5,
        )
    )
    assert best.provider == "ccip"
    assert best.to_amount_human == 1.05
