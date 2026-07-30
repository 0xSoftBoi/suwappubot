"""execute_swap must refuse providers it has no executor for.

The dispatch chain in `execute_swap` used to end in `else:
_execute_lifi_swap`, so any provider it didn't recognise was handed to the
Li.Fi executor — which fetches and signs a *Li.Fi* transaction against a quote
that did not come from Li.Fi.

Two things make that reachable rather than theoretical:

1. `quote.provider` is caller-supplied on the internal and webapp execute
   paths — both `api/routes/internal.py` and `api/main.py` build the SwapQuote
   with `qd.get("provider", "lifi")`.
2. `bot/services/bridge/registry.py` can surface quotes from providers that
   have no executor at all (near_intents, allbridge, symbiosis,
   arbitrum_native, usdt0).

So the fallback is now an explicit allowlist, checked before locks, DB rows or
any fund movement.
"""

import asyncio
import os
import re

import pytest

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

from bot.services.swap_engine import EXECUTABLE_PROVIDERS, SwapEngine, SwapError, SwapQuote

SWAP_ENGINE_SOURCE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "bot",
    "services",
    "swap_engine.py",
)


def _source() -> str:
    with open(SWAP_ENGINE_SOURCE) as handle:
        return handle.read()


def _dispatch_branch_providers() -> set[str]:
    """Provider names the dispatch chain actually has a branch for."""
    return set(re.findall(r'quote\.provider == "([a-z0-9_]+)"', _source()))


def _emitted_providers() -> set[str]:
    """Provider names swap_engine stamps onto its own SwapQuotes."""
    return set(re.findall(r'provider="([a-z0-9_]+)"', _source()))


def _quote(provider: str, from_chain: str = "arbitrum", to_chain: str = "base") -> SwapQuote:
    return SwapQuote(
        provider=provider,
        from_chain=from_chain,
        to_chain=to_chain,
        from_token="USDT",
        to_token="USDT",
        from_amount="1000000",
        from_amount_human=1.0,
        to_amount="1000000",
        to_amount_human=1.0,
        to_amount_min="1000000",
        gas_cost_usd=0.0,
        fee_cost_usd=0.0,
        total_cost_usd=0.0,
        estimated_time=60,
        price_impact=0.0,
        exchange_rate=1.0,
        raw_quote={},
    )


def test_allowlist_matches_the_dispatch_chain_exactly():
    """Drift guard, in both directions.

    An allowlisted provider with no branch would fall to the deep raise; a
    branch that isn't allowlisted would be rejected up-front even though it
    works. Either way the two lists must not diverge silently.
    """
    branches = _dispatch_branch_providers()

    assert branches, "could not parse any dispatch branches — did the chain change shape?"
    assert branches - EXECUTABLE_PROVIDERS == set(), (
        "these providers have an executor branch but are not allowlisted, so "
        f"execute_swap now rejects them: {sorted(branches - EXECUTABLE_PROVIDERS)}"
    )
    assert EXECUTABLE_PROVIDERS - branches == set(), (
        "these providers are allowlisted but have no executor branch, so they "
        f"reach the deep fail-closed raise: {sorted(EXECUTABLE_PROVIDERS - branches)}"
    )


def test_every_provider_swap_engine_emits_is_executable():
    """Regression guard: quoting something we cannot execute is a dead route."""
    unexecutable = _emitted_providers() - EXECUTABLE_PROVIDERS
    assert unexecutable == set(), (
        "swap_engine emits quotes for providers it cannot execute: " f"{sorted(unexecutable)}"
    )


@pytest.mark.parametrize(
    "provider",
    ["near_intents", "allbridge", "symbiosis", "arbitrum_native"],
)
def test_quote_only_bridge_providers_are_refused(provider):
    """The bridge registry can surface these; none has an executor.

    Before the allowlist each of these would have been executed by
    `_execute_lifi_swap`. (usdt0 was in this list until it got a real
    executor — see test_usdt0_is_executable_but_gated.)
    """
    assert provider not in EXECUTABLE_PROVIDERS

    engine = SwapEngine.__new__(SwapEngine)  # guard runs before any __init__ state is needed
    with pytest.raises(SwapError, match="No executor is wired"):
        asyncio.run(engine.execute_swap(quote=_quote(provider), wallet_id=1, user_id=1))


def test_usdt0_is_executable_but_gated():
    """usdt0 has an executor, so it must pass the allowlist — but it must also
    be unreachable while the provider flag is off.

    Both halves matter: allowlisting it without the executor would mean
    mis-execution, and having the executor without the route gate would mean
    offering an un-live-tested rail by default.
    """
    assert "usdt0" in EXECUTABLE_PROVIDERS

    from bot.services.bridge.usdt0_api import usdt0_api

    assert usdt0_api.enabled is False, "USDT0 must stay default-OFF until live-tested"

    engine = SwapEngine.__new__(SwapEngine)
    assert engine._is_usdt0_route("arbitrum", "plasma", "USDT", "USDT") is False

    # Past the allowlist guard: it fails later for unrelated reasons (no
    # DB/wallet here), which is the point — the block must not be the allowlist.
    with pytest.raises(Exception) as excinfo:
        asyncio.run(engine.execute_swap(quote=_quote("usdt0"), wallet_id=1, user_id=1))
    assert "No executor is wired" not in str(excinfo.value)


@pytest.mark.parametrize("provider", ["", "totally-made-up", "LIFI", "lifi_evm", "../../etc"])
def test_caller_supplied_garbage_is_refused(provider):
    """`provider` comes from request data on the internal/webapp paths.

    Note "LIFI" and "lifi_evm" are included deliberately: matching is exact, so
    a near-miss must be rejected rather than coerced to "lifi".
    """
    engine = SwapEngine.__new__(SwapEngine)
    with pytest.raises(SwapError, match="No executor is wired"):
        asyncio.run(engine.execute_swap(quote=_quote(provider), wallet_id=1, user_id=1))


def test_lifi_is_still_allowed():
    """The real fallback provider must not have been locked out.

    It should get past the allowlist guard; it then fails later for unrelated
    reasons (no DB/wallet in this test), which is exactly the point — the
    failure must not be the allowlist.
    """
    assert "lifi" in EXECUTABLE_PROVIDERS

    engine = SwapEngine.__new__(SwapEngine)
    with pytest.raises(Exception) as excinfo:
        asyncio.run(engine.execute_swap(quote=_quote("lifi"), wallet_id=1, user_id=1))

    assert "No executor is wired" not in str(excinfo.value)
