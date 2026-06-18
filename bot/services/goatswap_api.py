"""GOATSwap API — thin shim over the generalized UniV3-fork client.

The original GOATSwap-specific client was generalized into
bot/services/univ3_fork_api.py (per-venue configs: GOATSwap on GOAT,
JuiceSwap on Citrea). This module re-exports the GOAT-configured client and
all previously public names so existing imports and tests keep working
unchanged.

See univ3_fork_api for the full design notes (router calling conventions,
native-in handling, fee tier probing, gas headroom).
"""

from bot.services.univ3_fork_api import (
    FEE_TIERS,
    GOAT_VENUE,
    NATIVE_ADDRESS as NATIVE_BTC_ADDRESS,
    UniV3ForkAPI,
    UniV3ForkError,
    UniV3ForkQuote,
    compute_min_out,
)

GOAT_CHAIN_ID = GOAT_VENUE.chain_id

# Verified GOATSwap contract addresses (GOAT mainnet)
GOATSWAP_SWAP_ROUTER02 = GOAT_VENUE.router_address
GOATSWAP_QUOTER_V2 = GOAT_VENUE.quoter_address
GOATSWAP_V2_ROUTER02 = "0xc6189404eACa8a96A9B26eCc6c892568f55deD9E"  # unused in v1

# WGBTC wraps GOAT's native BTC (18 decimals) — the chain's WETH9 equivalent
WGBTC_ADDRESS = GOAT_VENUE.wrapped_native_address

# Backwards-compatible aliases
GoatSwapError = UniV3ForkError
GoatSwapQuote = UniV3ForkQuote


class GoatSwapAPI(UniV3ForkAPI):
    """The GOAT-configured UniV3-fork client (SwapRouter02 multicall style)."""

    def __init__(self):
        super().__init__(GOAT_VENUE)


goatswap_api = GoatSwapAPI()

__all__ = [
    "FEE_TIERS",
    "GOAT_CHAIN_ID",
    "GOATSWAP_SWAP_ROUTER02",
    "GOATSWAP_QUOTER_V2",
    "GOATSWAP_V2_ROUTER02",
    "WGBTC_ADDRESS",
    "NATIVE_BTC_ADDRESS",
    "GoatSwapAPI",
    "GoatSwapError",
    "GoatSwapQuote",
    "compute_min_out",
    "goatswap_api",
]
