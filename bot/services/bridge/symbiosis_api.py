"""Symbiosis Finance bridge provider.

https://api.symbiosis.finance/crosschain — a cross-chain swap/bridge
aggregator using numeric EVM chain IDs, which we source from
bot.config.chains.get_chain_by_name (chain_id field) rather than
hardcoding a second chain-name -> chain-id map. No API key required.

Request/response shape verified against a live call (2026-08-23):
POST /v1/swap requires token `address` and `decimals` on both sides
(422 without them); a 250 USDC ethereum->base probe returned
tokenAmountOut 249.27 USDC with executable `tx` calldata in 18s
estimated settlement. Token addresses/decimals come from the same
bot.config.tokens registry the swap engines use.
"""

import logging
from typing import Any, Dict, Optional

from bot.config.chains import get_chain_by_name
from bot.config.settings import settings
from bot.config.tokens import get_token_by_symbol, get_token_decimals
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

SYMBIOSIS_BASE_URL = "https://api.symbiosis.finance/crosschain"


class SymbiosisError(BridgeError):
    """Exception for Symbiosis API errors."""


class SymbiosisBridge(BridgeProvider):
    """Client for the Symbiosis Finance cross-chain swap/bridge API.

    Symbiosis is EVM-focused, so routes require both chains to resolve to a
    numeric `chain_id` via bot.config.chains.get_chain_by_name (Solana/Tron/
    Starknet use non-int chain_id and are rejected here).
    """

    def __init__(self):
        self.base_url = SYMBIOSIS_BASE_URL

    @property
    def name(self) -> str:
        return "symbiosis"

    @property
    def enabled(self) -> bool:
        # Public API, no key required, but still default-OFF until a live
        # small-amount transfer has been verified end-to-end.
        return settings.symbiosis_bridge_enabled

    def _numeric_chain_id(self, chain: str) -> Optional[int]:
        cfg = get_chain_by_name(chain)
        if cfg is None or not isinstance(cfg.chain_id, int):
            return None
        return cfg.chain_id

    def is_supported_route(
        self, from_chain: str, to_chain: str, token: Optional[str] = None
    ) -> bool:
        if from_chain.lower() == to_chain.lower():
            return False
        return (
            self._numeric_chain_id(from_chain) is not None
            and self._numeric_chain_id(to_chain) is not None
        )

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
            logger.debug(f"Symbiosis quote rejected: slippage_bps must be > 0, got {slippage_bps}")
            return None

        chain_id_in = self._numeric_chain_id(from_chain)
        chain_id_out = self._numeric_chain_id(to_chain)
        if chain_id_in is None or chain_id_out is None:
            return None

        try:
            from_amount = normalize_amount(from_amount)
        except ValueError as e:
            logger.debug(f"Symbiosis quote rejected: {e}")
            return None

        # Cross-format destination validation (#2): never fall back to
        # from_address on a route that crosses address formats. Symbiosis is
        # EVM-only per _numeric_chain_id, so both chains use the EVM format,
        # but we still validate explicitly rather than assuming.
        if to_address:
            if not validate_address_for_chain(to_address, to_chain):
                logger.debug(f"Symbiosis quote rejected: to_address fails {to_chain} format check")
                return None
            recipient = to_address
        else:
            if not validate_address_for_chain(from_address, to_chain):
                logger.debug(
                    "Symbiosis quote rejected: no to_address and from_address does not "
                    f"match {to_chain} address format"
                )
                return None
            recipient = from_address

        await api_limiter.wait_and_acquire("symbiosis")
        session = await get_session()

        # The API 422s without token address + decimals on both sides; symbols
        # alone are not enough. Resolve via the registry entry's OWN per-chain
        # address map — never get_token_address, whose raw-address passthrough
        # would echo one address onto both chains and fabricate the pair
        # (money-path review finding). Unknown symbols, raw addresses, and
        # chains the registry has no verified deployment for all decline.
        token_cfg = get_token_by_symbol(from_token)
        if token_cfg is None:
            logger.debug(f"Symbiosis quote rejected: unknown token symbol {from_token!r}")
            return None
        address_in = token_cfg.addresses.get(from_chain.lower())
        address_out = token_cfg.addresses.get(to_chain.lower())
        if not address_in or not address_out:
            logger.debug(
                f"Symbiosis quote rejected: no registry address for {from_token} "
                f"on {from_chain if not address_in else to_chain}"
            )
            return None

        body: Dict[str, Any] = {
            "tokenAmountIn": {
                "chainId": chain_id_in,
                "address": address_in,
                "decimals": get_token_decimals(from_token, from_chain),
                "symbol": token_cfg.symbol,
                "amount": from_amount,
            },
            "tokenOut": {
                "chainId": chain_id_out,
                "address": address_out,
                "decimals": get_token_decimals(from_token, to_chain),
                "symbol": token_cfg.symbol,
            },
            "from": from_address,
            "to": recipient,
            "slippage": slippage_bps,  # already bps
        }

        try:
            async with session.post(f"{self.base_url}/v1/swap", json=body) as response:
                if response.status != 200:
                    text = await response.text()
                    logger.warning(f"Symbiosis quote failed ({response.status}): {text}")
                    return None
                data = await response.json()
        except Exception as e:
            logger.debug(f"Symbiosis quote error: {e}")
            return None

        token_amount_out = data.get("tokenAmountOut", {})
        amount_out_raw = token_amount_out.get("amount")
        if amount_out_raw is None:
            logger.debug(f"Symbiosis quote missing tokenAmountOut: {data}")
            return None
        try:
            amount_out = int(normalize_amount(amount_out_raw))
        except ValueError as e:
            logger.debug(f"Symbiosis quote has unparseable amount: {e}")
            return None

        # Sanity band in HUMAN units: raw units are not comparable when the
        # two chains disagree on decimals (USDT/USDC are 18dp on bsc, 6dp
        # elsewhere), which made the raw comparison drop every bsc-source
        # route and wave through dust on bsc-destination routes.
        decimals_in = get_token_decimals(from_token, from_chain)
        decimals_out = get_token_decimals(from_token, to_chain)
        if amount_out / (10**decimals_out) < (int(from_amount) / (10**decimals_in)) / 2:
            logger.warning(
                f"Symbiosis quote rejected: out {amount_out} (10^{decimals_out}) is less "
                f"than half of in {from_amount} (10^{decimals_in})"
            )
            return None

        tx = data.get("tx", {})
        fee_info = data.get("fee", {}) or {}
        fee_usd = float(fee_info.get("usd", 0) or 0) if isinstance(fee_info, dict) else 0.0

        provider_min_raw = data.get("tokenAmountOutMin", {}).get("amount")
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
            gas_cost_usd=float(data.get("estimatedGasUsd", 0) or 0),
            fee_cost_usd=fee_usd,
            estimated_time=int(data.get("estimatedTime", 300) or 300),
            transaction_request=tx,
            raw_response=data,
            settlement="tx",
            trust_model="solver",
        )

    async def get_status(self, tracking_id: str) -> Dict[str, Any]:
        """Poll transfer status by source tx hash (`tracking_id`)."""
        session = await get_session()
        try:
            async with session.get(f"{self.base_url}/v1/tx/{tracking_id}") as response:
                if response.status != 200:
                    return {"status": "UNKNOWN"}
                return await response.json()
        except Exception as e:
            logger.debug(f"Symbiosis status error: {e}")
            return {"status": "UNKNOWN"}


# Global instance
symbiosis_api = SymbiosisBridge()
