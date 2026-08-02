"""Allbridge Core bridge provider.

https://docs.allbridge.io/allbridge-core — a public liquidity-pool bridge
notable for reaching non-EVM chains our other providers largely skip:
Solana, Tron, Stellar, Sui (plus common EVM chains). No API key is required
(public REST API), so `enabled` is always True.

Guess/assumption flag: the /raw/bridge and /raw/swap request/response shapes
below follow the publicly documented Allbridge Core REST conventions as of
the code-review date, but were NOT verified against a live call in this
session (no live network calls were made).
"""

import logging
from typing import Any, Dict, Optional

from bot.config.settings import settings
from bot.services.bridge.base import (
    BridgeError,
    BridgeProvider,
    BridgeQuote,
    normalize_amount,
    validate_address_for_chain,
)
from bot.utils.http_client import get_session
from bot.utils.rate_limiter import api_limiter

logger = logging.getLogger(__name__)

# Allbridge Core chain symbols (their identifier, not ours). Non-EVM chains
# are the priority reach for this provider; EVM chains are also supported
# but generally better served by Socket/Li.Fi/Across already wired in
# router.py, so we still surface them here for completeness/fallback.
ALLBRIDGE_CHAIN_SYMBOLS: Dict[str, str] = {
    "solana": "SOL",
    "tron": "TRX",
    "stellar": "STLR",
    "sui": "SUI",
    "ethereum": "ETH",
    "polygon": "POL",
    "arbitrum": "ARB",
    "optimism": "OPT",
    "base": "BAS",
    "bsc": "BSC",
    "avalanche": "AVA",
}

# Non-EVM chains this provider prioritizes (our stated reach advantage).
ALLBRIDGE_PRIORITY_NON_EVM = {"solana", "tron", "stellar", "sui"}


class AllbridgeError(BridgeError):
    """Exception for Allbridge Core API errors."""


class AllbridgeBridge(BridgeProvider):
    """Client for the Allbridge Core public REST API."""

    def __init__(self):
        self.base_url = settings.allbridge_api_url

    @property
    def name(self) -> str:
        return "allbridge"

    @property
    def enabled(self) -> bool:
        # Public API, no key required, but still default-OFF until a live
        # small-amount transfer has been verified end-to-end.
        return settings.allbridge_bridge_enabled

    def is_supported_route(
        self, from_chain: str, to_chain: str, token: Optional[str] = None
    ) -> bool:
        from_chain = from_chain.lower()
        to_chain = to_chain.lower()
        if from_chain == to_chain:
            return False
        if from_chain not in ALLBRIDGE_CHAIN_SYMBOLS or to_chain not in ALLBRIDGE_CHAIN_SYMBOLS:
            return False
        # Prioritize routes that touch at least one of our non-EVM strengths;
        # pure EVM<->EVM routes are already well covered by other providers,
        # but we still allow them so the registry has a fallback option.
        return True

    async def get_quote(
        self,
        from_chain: str,
        to_chain: str,
        from_token: str,
        from_amount: str,
        from_address: str,
        to_address: Optional[str] = None,
        slippage_bps: int = 50,
    ) -> Optional[BridgeQuote]:
        if slippage_bps <= 0:
            logger.debug(f"Allbridge quote rejected: slippage_bps must be > 0, got {slippage_bps}")
            return None
        if not self.is_supported_route(from_chain, to_chain, from_token):
            return None

        try:
            from_amount = normalize_amount(from_amount)
        except ValueError as e:
            logger.debug(f"Allbridge quote rejected: {e}")
            return None

        # Cross-format destination validation (#2): never fall back to
        # from_address on a route that crosses address formats (e.g.
        # EVM sender -> Tron destination). Only same-format routes may
        # default the recipient to the sender.
        if to_address:
            if not validate_address_for_chain(to_address, to_chain):
                logger.debug(f"Allbridge quote rejected: to_address fails {to_chain} format check")
                return None
            recipient = to_address
        else:
            if not validate_address_for_chain(from_address, to_chain):
                logger.debug(
                    "Allbridge quote rejected: no to_address and from_address does not "
                    f"match {to_chain} address format (cross-format route needs an "
                    "explicit to_address)"
                )
                return None
            recipient = from_address

        from_symbol = ALLBRIDGE_CHAIN_SYMBOLS[from_chain.lower()]
        to_symbol = ALLBRIDGE_CHAIN_SYMBOLS[to_chain.lower()]

        await api_limiter.wait_and_acquire("allbridge")
        session = await get_session()

        params = {
            "sourceChainSymbol": from_symbol,
            "destinationChainSymbol": to_symbol,
            "sourceToken": from_token.upper(),
            "destinationToken": from_token.upper(),
            "amount": from_amount,
            "sender": from_address,
            "recipient": recipient,
        }

        try:
            async with session.get(f"{self.base_url}/raw/bridge", params=params) as response:
                if response.status != 200:
                    text = await response.text()
                    logger.warning(f"Allbridge quote failed ({response.status}): {text}")
                    return None
                data = await response.json()
        except Exception as e:
            logger.debug(f"Allbridge quote error: {e}")
            return None

        amount_out_raw = data.get("amountOut") or data.get("result", {}).get("amountOut")
        if amount_out_raw is None:
            logger.debug(f"Allbridge quote missing amountOut: {data}")
            return None
        try:
            amount_out = int(normalize_amount(amount_out_raw))
        except ValueError as e:
            logger.debug(f"Allbridge quote has unparseable amountOut: {e}")
            return None

        # Sanity band (#5-style, applied to every provider per #4): a
        # same-symbol transfer losing more than half its value on the quote
        # itself means something is wrong upstream — never surface it.
        if amount_out < int(from_amount) // 2:
            logger.warning(
                f"Allbridge quote rejected: amountOut {amount_out} is less than half "
                f"from_amount {from_amount}"
            )
            return None

        fee = data.get("fee") or data.get("result", {}).get("fee") or {}
        fee_usd = float(fee.get("usd", 0) or 0) if isinstance(fee, dict) else 0.0
        tx = data.get("tx") or data.get("result", {}).get("tx") or {}

        provider_min_raw = data.get("minAmountOut")
        floor = amount_out * (10000 - slippage_bps) // 10000
        if provider_min_raw is None:
            to_amount_min = floor
        else:
            try:
                provider_min = int(normalize_amount(provider_min_raw))
            except ValueError:
                provider_min = floor
            to_amount_min = min(provider_min, floor)

        return BridgeQuote(
            provider=self.name,
            from_chain=from_chain,
            to_chain=to_chain,
            from_token=from_token,
            to_token=from_token,
            from_amount=from_amount,
            to_amount=str(amount_out),
            to_amount_min=str(to_amount_min),
            gas_cost_usd=float(data.get("gasFeeUsd", 0) or 0),
            fee_cost_usd=fee_usd,
            estimated_time=int(data.get("estimatedTimeSeconds", 300) or 300),
            transaction_request=tx,
            raw_response=data,
            settlement="tx",
            trust_model="liquidity",
        )

    async def get_status(self, tracking_id: str) -> Dict[str, Any]:
        """Poll transfer status by source tx hash (`tracking_id`)."""
        session = await get_session()
        try:
            async with session.get(
                f"{self.base_url}/raw/status", params={"txId": tracking_id}
            ) as response:
                if response.status != 200:
                    return {"status": "UNKNOWN"}
                return await response.json()
        except Exception as e:
            logger.debug(f"Allbridge status error: {e}")
            return {"status": "UNKNOWN"}


# Global instance
allbridge_api = AllbridgeBridge()
