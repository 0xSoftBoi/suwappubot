"""USDT0 (LayerZero-OFT canonical USDT) bridge provider.

USDT0 is a LayerZero Omnichain Fungible Token (OFT) wrapping of Tether's
original USDT liquidity: `send()` on the source chain burns, `lzReceive()`
on the destination chain mints — 1:1, no AMM pool, no slippage. The only
variable cost is the LayerZero messaging fee (native-gas + optional OFT
protocol fee), which `quoteSend()` returns before the user commits.

VERIFIED facts (do not extend beyond these without a source):
  - Confirmed USDT0 chains: Plasma, HyperEVM, Arbitrum, Ink, Unichain,
    Berachain, Flare.
  - Plasma and HyperEVM have NO native USDT deployment; USDT0 is the only
    non-wrapped USDT path on those two chains.
  - Tron is NOT on USDT0 — it runs the original Tether TRC20 with a
    separate mint authority. Any Tron route must be rejected here.

NOT verified (and deliberately left unconfigured, see `OFT_ADDRESSES`
below): the actual OFT contract address on each chain, and a live RPC/API
endpoint for `quoteSend()`. Guessing either would risk sending funds to a
wrong/non-existent contract, so `get_quote` returns None for any chain
without a configured address instead of fabricating a quote.

When quoteSend() wiring is added, a real `BridgeQuote` built by this
provider should use `settlement="tx"` and `trust_model="liquidity"`. That
trust_model choice is deliberate even though OFT burn/mint is NOT a pooled
AMM: the user is still trusting the LayerZero DVN/messaging layer to
deliver the mint message honestly (unlike a canonical rollup bridge backed
purely by L1 contract code with no external messaging network). "liquidity"
is the closest existing category to "third-party-trusted, not pure
canonical" — router.py's stable-pair scoring (see router.py's
NATIVE_RAIL_PROVIDERS) treats this provider as a native/zero-slippage rail
regardless of this trust_model label, since the label only tracks
counterparty trust, not slippage.
"""

import logging
from typing import Any, Dict, Optional

from bot.services.bridge.base import (
    BridgeError,
    BridgeProvider,
    BridgeQuote,
    normalize_amount,
    validate_address_for_chain,
)

logger = logging.getLogger(__name__)

# Default-OFF: no OFT contract addresses are configured (see OFT_ADDRESSES),
# and there's no live quoteSend() wiring yet. Flip this only once both are
# filled in and verified on-chain. Module-level constant (not settings.py —
# that file is owned by a parallel workstream); promote to a proper Settings
# field when convenient.
USDT0_BRIDGE_ENABLED = False

# Chains confirmed to have a USDT0 OFT deployment (per verified facts above).
# This is the "is the token live here at all" set — separate from whether we
# have a *contract address* configured for it (see OFT_ADDRESSES).
USDT0_SUPPORTED_CHAINS = {
    "plasma",
    "hyperevm",
    "arbitrum",
    "ink",
    "unichain",
    "berachain",
    "flare",
}

# Chain -> USDT0 OFT contract address. Intentionally EMPTY: no address below
# has been verified against an on-chain source, and a wrong address here is
# a direct loss-of-funds bug. `get_quote` treats a missing entry as
# "unsupported" and returns None (fail closed) rather than guessing.
#
# To activate a chain: verify the OFT contract address against the official
# USDT0 deployment (e.g. LayerZero scan / Tether/USDT0 docs), add it here,
# and set USDT0_BRIDGE_ENABLED = True once quoteSend() wiring is live.
OFT_ADDRESSES: Dict[str, str] = {}


class USDT0Error(BridgeError):
    """Exception for USDT0 (LayerZero OFT) bridge errors."""


class USDT0Bridge(BridgeProvider):
    """Client for the USDT0 LayerZero-OFT canonical USDT bridge."""

    @property
    def name(self) -> str:
        return "usdt0"

    @property
    def enabled(self) -> bool:
        # Default OFF (see USDT0_BRIDGE_ENABLED docstring). Even if flipped
        # on, individual routes still gate on OFT_ADDRESSES having both legs
        # configured in get_quote/is_supported_route.
        return USDT0_BRIDGE_ENABLED

    def is_supported_route(
        self, from_chain: str, to_chain: str, token: Optional[str] = None
    ) -> bool:
        from_chain = from_chain.lower()
        to_chain = to_chain.lower()

        if from_chain == to_chain:
            return False
        if token is not None and token.upper() not in ("USDT", "USDT0"):
            return False
        # Tron is never on USDT0 — original TRC20 USDT with a separate mint
        # authority. Reject explicitly rather than relying on chain-set
        # membership alone, so this stays correct even if "tron" is ever
        # accidentally added to USDT0_SUPPORTED_CHAINS.
        if from_chain == "tron" or to_chain == "tron":
            return False
        if from_chain not in USDT0_SUPPORTED_CHAINS or to_chain not in USDT0_SUPPORTED_CHAINS:
            return False
        # Both legs need a verified contract address configured; an empty
        # OFT_ADDRESSES means no route is actually quotable yet.
        return from_chain in OFT_ADDRESSES and to_chain in OFT_ADDRESSES

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
            raise USDT0Error("slippage_bps must be > 0")
        if not self.enabled:
            return None
        if not self.is_supported_route(from_chain, to_chain, from_token):
            return None

        to_address = to_address or from_address
        if not validate_address_for_chain(to_address, to_chain):
            logger.warning(
                f"USDT0: destination address failed format validation for chain {to_chain!r}"
            )
            return None

        try:
            amount = normalize_amount(from_amount)
        except ValueError as e:
            raise USDT0Error(f"Invalid from_amount: {e}") from e

        # No live quoteSend()/RPC wiring yet — an OFT_ADDRESSES entry alone
        # is not enough to safely build a send() transaction (need live LZ
        # messaging-fee quote + correct dstEid + adapter params). Fail
        # closed rather than emit a quote with a placeholder/zero fee.
        logger.debug(
            "USDT0: get_quote unimplemented (no live quoteSend()/RPC wiring); "
            "refusing to emit a quote even though addresses are configured."
        )
        return None

    async def get_status(self, tracking_id: str) -> Dict[str, Any]:
        """LayerZero message tracking is not implemented; callers should
        track the source-chain tx hash via LayerZero Scan instead.
        """
        return {"status": "UNKNOWN", "note": "Track via LayerZero Scan using the source tx hash."}


# Global instance
usdt0_api = USDT0Bridge()
