"""Morpho Blue on Base — constants for the cbBTC/USDC borrow market + USDC earn vaults.

All addresses verified on-chain 2026-06-12 (see docs/internal/plans/btcfi-expansion-plan.md P2).

Oracle note: ORACLE is a MorphoChainlinkOracleV2 whose `price()` is 1e36-scaled
adjusted for token decimals: scale = 1e(36 + loanDecimals - collateralDecimals)
= 1e(36 + 6 - 8) = 1e34 USD-per-BTC-ish units. The oracle wraps Chainlink feeds
and does NOT expose staleness; we assume Chainlink's Base cbBTC/USD feed heartbeat
(<= 24h, 0.5% deviation) keeps it fresh — same trust assumption Morpho itself makes.
Liquidation is enforced by the protocol against this same price, so our health
math is consistent with what liquidators see.
"""

from eth_abi import encode as abi_encode
from web3 import Web3

BASE_CHAIN_ID = 8453

# ── Core contracts (Base) ────────────────────────────────────────────────────
MORPHO_BLUE = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb"  # verified, name "Morpho"
USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"  # 6dp
CBBTC = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf"  # 8dp

# cbBTC/USDC market (immutable params — hardcoded + asserted at startup)
MARKET_ID = "0x9103c3b4e834476c9a62ea009ba2c884ee42e94e6e314a26f04d312434191836"
ORACLE = "0x663BECd10daE6C4A3Dcd89F1d76c1174199639B9"  # MorphoChainlinkOracleV2
IRM = "0x46415998764C29aB2a25CbeA6254146D50D22687"  # AdaptiveCurveIRM
LLTV = 860000000000000000  # 86% (wad)

# MarketParams tuple in Morpho ABI order: (loanToken, collateralToken, oracle, irm, lltv)
MARKET_PARAMS = (USDC_BASE, CBBTC, ORACLE, IRM, LLTV)

# ── Earn vaults (MetaMorpho ERC-4626, USDC-denominated) ──────────────────────
STEAKHOUSE_USDC = "0xbeeF010f9cb27031ad51e3333f9aF9C6B1228183"  # verified on-chain
GAUNTLET_USDC_PRIME = "0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61"  # API-sourced

# ── Decimals / scales ────────────────────────────────────────────────────────
USDC_DECIMALS = 6
CBBTC_DECIMALS = 8
WAD = 10**18
ORACLE_PRICE_SCALE = 10**36  # Morpho's fixed oracle scale (collateral→loan conversion)
# Effective USD-per-BTC scale of price(): 1e(36 + 6 - 8) = 1e34
ORACLE_USD_SCALE = 10**34
# MetaMorpho vault shares are 18dp ERC-4626 shares
METAMORPHO_SHARE_DECIMALS = 18

# Morpho's virtual-shares offsets (SharesMathLib)
VIRTUAL_ASSETS = 1
VIRTUAL_SHARES = 10**6

# ── LTV / health policy ──────────────────────────────────────────────────────
DEFAULT_LTV = 0.50  # default borrow at 50% LTV
MAX_LTV = 0.645  # hard cap: 0.75 × LLTV
WARN_HF = 1.2  # warning alert tier
URGENT_HF = 1.05  # urgent alert tier
MIN_WITHDRAW_HF = 1.1  # post-withdrawal health floor (unless debt == 0)


def compute_market_id(params=MARKET_PARAMS) -> str:
    """keccak256(abi.encode(MarketParams)) — Morpho's market id derivation."""
    encoded = abi_encode(["(address,address,address,address,uint256)"], [params])
    return Web3.keccak(encoded).hex()


def _normalize_id(market_id: str) -> str:
    h = market_id.lower()
    return h if h.startswith("0x") else "0x" + h


def assert_market_id() -> None:
    """Startup assertion: hardcoded MARKET_ID matches keccak(abi.encode(params)).

    Guards against a typo in any address/LLTV silently pointing all txs at a
    different (or nonexistent) market.
    """
    computed = _normalize_id(compute_market_id())
    expected = _normalize_id(MARKET_ID)
    if computed != expected:
        raise AssertionError(
            f"Morpho market id mismatch: computed {computed} != expected {expected}. "
            "Check MARKET_PARAMS in bot/config/morpho_config.py."
        )
