"""Registry that races all bridge providers and returns sorted quotes."""

import asyncio
import logging
from typing import List, Optional

from bot.services.bridge.allbridge_api import allbridge_api
from bot.services.bridge.arbitrum_native import arbitrum_native_api
from bot.services.bridge.base import BridgeProvider, BridgeQuote
from bot.services.bridge.near_intents import near_intents_api
from bot.services.bridge.symbiosis_api import symbiosis_api
from bot.services.bridge.usdt0_api import usdt0_api

logger = logging.getLogger(__name__)

BRIDGE_PROVIDERS: List[BridgeProvider] = [
    near_intents_api,
    allbridge_api,
    symbiosis_api,
    arbitrum_native_api,
    usdt0_api,
]


async def get_bridge_quotes(
    from_chain: str,
    to_chain: str,
    from_token: str,
    from_amount: str,
    from_address: str,
    to_address: Optional[str] = None,
    slippage_bps: int = 50,
) -> List[BridgeQuote]:
    """Race all enabled, route-supporting bridge providers in parallel.

    Failures in one provider never abort the others (asyncio.gather with
    return_exceptions=True); each failure is logged and skipped. Returns
    quotes sorted best-output-first (highest to_amount first).
    """
    candidates = [
        provider
        for provider in BRIDGE_PROVIDERS
        if provider.enabled and provider.is_supported_route(from_chain, to_chain, from_token)
    ]

    if not candidates:
        return []

    tasks = [
        provider.get_quote(
            from_chain=from_chain,
            to_chain=to_chain,
            from_token=from_token,
            from_amount=from_amount,
            from_address=from_address,
            to_address=to_address,
            slippage_bps=slippage_bps,
        )
        for provider in candidates
    ]

    results = await asyncio.gather(*tasks, return_exceptions=True)

    quotes: List[BridgeQuote] = []
    for provider, result in zip(candidates, results):
        if isinstance(result, Exception):
            logger.warning(f"Bridge provider '{provider.name}' quote failed: {result}")
            continue
        if result:
            quotes.append(result)

    def _safe_int(value: str) -> int:
        try:
            return int(value)
        except (TypeError, ValueError):
            return -1

    # Sort by to_amount_min descending (the conservative, worst-case-floor
    # figure — see #4/#9 — not the optimistic to_amount or provider-reported
    # USD fee fields, which a dishonest/buggy provider could misreport to
    # rank itself artificially high). Amounts are raw-unit strings; convert
    # to int for comparison only (never for the stored value itself). This
    # cross-provider comparison is only safe because every current provider
    # sets to_token == from_token (same-symbol transfers) — if a future
    # provider quotes a different to_token with different decimals, this
    # sort would need a USD-normalized comparison instead.
    # `_safe_int` returns -1 (never picked as "best") on a malformed amount
    # instead of raising, so one bad quote can't crash sort() and wipe out
    # every other provider's route.
    quotes.sort(key=lambda q: _safe_int(q.to_amount_min), reverse=True)

    return quotes


async def bridge_quote(
    from_chain: str,
    to_chain: str,
    from_token: str,
    from_amount: str,
    from_address: str,
    to_address: Optional[str] = None,
    slippage_bps: int = 50,
) -> Optional[BridgeQuote]:
    """Convenience wrapper returning the single best bridge quote, if any."""
    quotes = await get_bridge_quotes(
        from_chain=from_chain,
        to_chain=to_chain,
        from_token=from_token,
        from_amount=from_amount,
        from_address=from_address,
        to_address=to_address,
        slippage_bps=slippage_bps,
    )
    return quotes[0] if quotes else None
