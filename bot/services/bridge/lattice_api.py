"""Suwappu Lattice Bridge (post-quantum settlement, LTP gateway) client.

**Dark / quote-only scaffold.** This provider exists so the `BridgeProvider`
seam described in docs/pq-settlement-profile.md ("Bot boundary") has a real
implementation to flip on later -- it must NOT be treated as a live
integration. It stays disabled (`settings.lattice_bridge_enabled` defaults
False) and is never added to `SwapEngine.EXECUTABLE_PROVIDERS`,
`list_chains`, MCP tools, A2A responses, or `capabilities.yaml` until every
gate in docs/pq-settlement-profile.md's "Activation gates" section passes --
including gate 7, a real observed testnet transfer, not a mocked test. Until
then this module can execute nothing; it can only ask a gateway for a price.

Post-quantum verification is a settlement property owned by the LTP gateway,
not bot business logic (docs/pq-settlement-profile.md "Bot boundary"): this
client never reimplements ML-DSA-65/ML-KEM-768 or decides whether a lattice
signature is valid. It only consumes a quote/status payload from a gateway
that has already defined those guarantees.

Endpoint contract (ASSUMED -- the LTP gateway VM's public HTTP contract does
not exist yet; this is a minimal, provider-neutral shape derived from the
design doc's "Route contract" section, parsed defensively so an eventual
real gateway response that omits or renames fields fails soft to `None`
rather than raising):

    POST {lattice_gateway_url}/gateway/quote
        request:  {
            "from_chain": str, "to_chain": str,
            "from_token": str, "from_amount": str (raw units),
            "from_address": str, "to_address": str,
            "slippage_bps": int,
        }
        response: {
            "to_amount": str, "to_amount_min": str,          # raw units
            "fee_usd": number, "gas_usd": number,
            "estimated_time_seconds": int,
            "transaction_request": {...} | {},                # optional
            "tracking_id": str,                                # optional
            "settlement_security": str,                        # e.g. "pq-mldsa65-attested"
        }

    GET {lattice_gateway_url}/gateway/status/{tracking_id}
        response: {"status": str, ...}                          # passthrough

Any transport error, non-2xx response, timeout, or malformed/missing field
in the documented shape returns `None` (get_quote) or `{"status":
"UNKNOWN"}` (get_status) -- matching the fail-soft convention every other
provider in this package uses (see usdt0_api.py, allbridge_api.py).
"""

import logging
from typing import Any, Dict, Optional

import httpx

from bot.config.settings import settings
from bot.services.bridge.base import (
    BridgeError,
    BridgeProvider,
    BridgeQuote,
    normalize_amount,
    validate_address_for_chain,
)

logger = logging.getLogger(__name__)

REQUEST_TIMEOUT = 20.0

# Route corridor, parsed from the comma-separated "from:to" settings string
# (e.g. "ethereum:arbitrum,arbitrum:ethereum"). Empty setting = no routes,
# which is the honest state until a real corridor is provisioned.
_ROUTE_SEP = ","
_CHAIN_SEP = ":"


class LatticeError(BridgeError):
    """Exception for Suwappu Lattice Bridge (LTP gateway) errors."""


def _parse_supported_routes(raw: str) -> set:
    """Parse 'from:to,from:to' into a set of (from_chain, to_chain) tuples.

    Malformed entries (missing ':', extra segments) are skipped rather than
    raising -- a typo in one route pair must not take down every other
    configured route.
    """
    routes = set()
    for pair in raw.split(_ROUTE_SEP):
        pair = pair.strip()
        if not pair:
            continue
        parts = pair.split(_CHAIN_SEP)
        if len(parts) != 2:
            logger.warning(f"Lattice: skipping malformed route pair {pair!r}")
            continue
        from_chain, to_chain = parts
        from_chain = from_chain.strip().lower()
        to_chain = to_chain.strip().lower()
        if not from_chain or not to_chain:
            continue
        routes.add((from_chain, to_chain))
    return routes


class LatticeBridge(BridgeProvider):
    """Client for the Suwappu Lattice Bridge (LTP gateway) -- dark/quote-only."""

    @property
    def name(self) -> str:
        return "lattice"

    @property
    def enabled(self) -> bool:
        # Default OFF (docs/pq-settlement-profile.md "Activation gates" --
        # none of the 7 gates have passed). Requires BOTH the explicit flag
        # AND a configured gateway URL; a flag flipped on without a URL is
        # not a real activation and must not attempt a network call.
        return bool(settings.lattice_bridge_enabled and settings.lattice_gateway_url)

    def is_supported_route(
        self, from_chain: str, to_chain: str, token: Optional[str] = None
    ) -> bool:
        if not self.enabled:
            return False
        from_chain = from_chain.lower()
        to_chain = to_chain.lower()
        if from_chain == to_chain:
            return False
        supported = _parse_supported_routes(settings.lattice_supported_routes)
        return (from_chain, to_chain) in supported

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
            raise LatticeError("slippage_bps must be > 0")
        if not self.is_supported_route(from_chain, to_chain, from_token):
            return None

        from_chain = from_chain.lower()
        to_chain = to_chain.lower()
        to_address = to_address or from_address

        if not validate_address_for_chain(from_address, from_chain):
            logger.warning(
                f"Lattice: source address failed format validation for chain {from_chain!r}"
            )
            return None
        if not validate_address_for_chain(to_address, to_chain):
            logger.warning(
                f"Lattice: destination address failed format validation for chain {to_chain!r}"
            )
            return None

        try:
            amount = normalize_amount(from_amount)
        except ValueError as e:
            logger.debug(f"Lattice quote rejected: {e}")
            return None
        if int(amount) <= 0:
            return None

        body = {
            "from_chain": from_chain,
            "to_chain": to_chain,
            "from_token": from_token,
            "from_amount": amount,
            "from_address": from_address,
            "to_address": to_address,
            "slippage_bps": slippage_bps,
        }

        base_url = (settings.lattice_gateway_url or "").rstrip("/")
        try:
            async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
                response = await client.post(f"{base_url}/gateway/quote", json=body)
        except (httpx.HTTPError, OSError) as e:
            logger.warning(f"Lattice: quote request failed ({from_chain}->{to_chain}): {e}")
            return None

        if response.status_code != 200:
            logger.warning(
                f"Lattice: quote returned {response.status_code} for "
                f"{from_chain}->{to_chain}: {response.text[:200]}"
            )
            return None

        try:
            data = response.json()
        except Exception as e:
            logger.warning(f"Lattice: quote response was not valid JSON: {e}")
            return None
        if not isinstance(data, dict):
            logger.warning(f"Lattice: quote response was not a JSON object: {data!r}")
            return None

        try:
            to_amount = normalize_amount(data.get("to_amount", ""))
            to_amount_min = normalize_amount(data.get("to_amount_min", ""))
        except ValueError as e:
            logger.warning(f"Lattice: quote response has malformed amounts: {e}")
            return None

        # Same fail-closed sanity band every provider applies (#4/#9 house
        # convention, see allbridge_api.py): a same-symbol transfer losing
        # more than half its value on the quote itself means something is
        # wrong upstream, and this is a not-yet-live gateway besides.
        if int(to_amount) < int(amount) // 2:
            logger.warning(
                f"Lattice: quote rejected -- to_amount {to_amount} is less than half "
                f"from_amount {amount}"
            )
            return None

        try:
            fee_cost_usd = float(data.get("fee_usd", 0) or 0)
            gas_cost_usd = float(data.get("gas_usd", 0) or 0)
            estimated_time = int(data.get("estimated_time_seconds", 0) or 0)
        except (TypeError, ValueError) as e:
            logger.warning(f"Lattice: quote response has malformed numeric fields: {e}")
            return None

        transaction_request = data.get("transaction_request")
        if not isinstance(transaction_request, dict):
            transaction_request = {}

        settlement_security = data.get("settlement_security")
        if not isinstance(settlement_security, str) or not settlement_security:
            settlement_security = None

        return BridgeQuote(
            provider=self.name,
            from_chain=from_chain,
            to_chain=to_chain,
            from_token=from_token,
            to_token=from_token,
            from_amount=amount,
            to_amount=to_amount,
            to_amount_min=to_amount_min,
            gas_cost_usd=gas_cost_usd,
            fee_cost_usd=fee_cost_usd,
            estimated_time=estimated_time,
            transaction_request=transaction_request,
            raw_response=data,
            # Official gateway settlement per docs/pq-settlement-profile.md,
            # not a pooled-liquidity or solver fill.
            settlement="canonical",
            trust_model="attested",
            settlement_security=settlement_security,
        )

    async def get_status(self, tracking_id: str) -> Dict[str, Any]:
        base_url = (settings.lattice_gateway_url or "").rstrip("/")
        if not base_url or not tracking_id:
            return {"status": "UNKNOWN"}

        try:
            async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
                response = await client.get(f"{base_url}/gateway/status/{tracking_id}")
        except (httpx.HTTPError, OSError) as e:
            logger.debug(f"Lattice: status request failed for {tracking_id!r}: {e}")
            return {"status": "UNKNOWN"}

        if response.status_code != 200:
            return {"status": "UNKNOWN"}

        try:
            data = response.json()
        except Exception as e:
            logger.debug(f"Lattice: status response was not valid JSON: {e}")
            return {"status": "UNKNOWN"}

        if not isinstance(data, dict) or "status" not in data:
            return {"status": "UNKNOWN"}
        return data


# Global instance
lattice_api = LatticeBridge()
