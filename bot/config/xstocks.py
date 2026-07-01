"""xStocks token registry — Backed Finance tokenized equities on Solana (SPL Token-2022).

These tokens are routable via Jupiter (which Suwappu already aggregates).
Execution reuses the existing swap machinery; this module is purely a registry
and geo-gate surface.

SOURCE: Solana.com xStocks case study (https://solana.com/news/xstocks) and
Backed Finance documentation.  All high-confidence addresses have been
independently cross-checked against the Backed Finance token list and the
Jupiter verified-token list.  MEDIUM confidence entries come from the Solana
canonical case-study list and should be re-validated against Jupiter's token
list at https://token.jup.ag/all before expanding the registry further.

COMPLIANCE NOTE
---------------
US, UK, Canada, and Australia persons are PROHIBITED from xStocks at the
issuance and legal level.  The on-chain Transfer Hook enforcement is currently
DISABLED, so geo-fencing is entirely the operator's responsibility.  Every
entry-point that surfaces these tokens MUST geo-block US/GB/CA/AU users.
Unknown / unset region MUST be treated conservatively (fail-closed = block).
See also: xstocks_region_allowed() in this module (shared gate used by all
execution paths) and bot/handlers/stocks.py (discovery UI gate).

DO NOT add new mints here without first verifying them against the Jupiter
token list and the Backed Finance on-chain registry.
"""

import logging
from typing import TypedDict

logger = logging.getLogger(__name__)


class XStockEntry(TypedDict):
    name: str
    ticker: str  # Exchange ticker with 'x' suffix (e.g. 'AAPLx')
    solana_mint: str  # SPL Token-2022 mint address
    chain: str  # Always 'solana' — Jupiter only routes on Solana
    confidence: str  # 'high' | 'medium'


# Canonical xStocks registry.
# Keys are the on-chain ticker symbols (e.g. "AAPLx").
XSTOCKS: dict[str, XStockEntry] = {
    # ------------------------------------------------------------------ #
    # HIGH CONFIDENCE — independently cross-checked                       #
    # ------------------------------------------------------------------ #
    "AAPLx": {
        "name": "Apple Inc.",
        "ticker": "AAPLx",
        "solana_mint": "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
        "chain": "solana",
        "confidence": "high",
    },
    "TSLAx": {
        "name": "Tesla Inc.",
        "ticker": "TSLAx",
        "solana_mint": "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
        "chain": "solana",
        "confidence": "high",
    },
    "NVDAx": {
        "name": "NVIDIA Corporation",
        "ticker": "NVDAx",
        "solana_mint": "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
        "chain": "solana",
        "confidence": "high",
    },
    "SPYx": {
        "name": "SPDR S&P 500 ETF Trust",
        "ticker": "SPYx",
        "solana_mint": "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W",
        "chain": "solana",
        "confidence": "high",
    },
    "MSFTx": {
        "name": "Microsoft Corporation",
        "ticker": "MSFTx",
        "solana_mint": "XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX",
        "chain": "solana",
        "confidence": "high",
    },
    # ------------------------------------------------------------------ #
    # MEDIUM CONFIDENCE — from Solana.com canonical case-study list.      #
    # Re-validate against Jupiter token list before enabling in prod.     #
    # ------------------------------------------------------------------ #
    "COINx": {
        "name": "Coinbase Global Inc.",
        "ticker": "COINx",
        "solana_mint": "Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu",
        "chain": "solana",
        "confidence": "medium",
    },
    "CRCLx": {
        "name": "Circle Internet Group Inc.",
        "ticker": "CRCLx",
        "solana_mint": "XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1",
        "chain": "solana",
        "confidence": "medium",
    },
    "GOOGLx": {
        "name": "Alphabet Inc.",
        "ticker": "GOOGLx",
        "solana_mint": "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN",
        "chain": "solana",
        "confidence": "medium",
    },
    "METAx": {
        "name": "Meta Platforms Inc.",
        "ticker": "METAx",
        "solana_mint": "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu",
        "chain": "solana",
        "confidence": "medium",
    },
    "AMZNx": {
        "name": "Amazon.com Inc.",
        "ticker": "AMZNx",
        "solana_mint": "Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg",
        "chain": "solana",
        "confidence": "medium",
    },
    "QQQx": {
        "name": "Invesco QQQ Trust (Nasdaq-100 ETF)",
        "ticker": "QQQx",
        "solana_mint": "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ",
        "chain": "solana",
        "confidence": "medium",
    },
    "HOODx": {
        "name": "Robinhood Markets Inc.",
        "ticker": "HOODx",
        "solana_mint": "XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg",
        "chain": "solana",
        "confidence": "medium",
    },
    "MSTRx": {
        "name": "MicroStrategy Inc.",
        "ticker": "MSTRx",
        "solana_mint": "XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ",
        "chain": "solana",
        "confidence": "medium",
    },
    "GLDx": {
        "name": "SPDR Gold Shares ETF",
        "ticker": "GLDx",
        "solana_mint": "Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re",
        "chain": "solana",
        "confidence": "medium",
    },
}

# Regions that are categorically prohibited from accessing xStocks.
# Source: Backed Finance legal terms (issuance-level prohibition).
# US / UK / Canada / Australia.
XSTOCKS_BLOCKED_REGIONS: frozenset[str] = frozenset({"US", "GB", "CA", "AU"})

# Human-readable label shown in blocked-region messages.
XSTOCKS_BLOCKED_REGION_NAMES = "US, UK, Canada, or Australia"


# Flat frozenset of every known xStock mint address — used by execution-layer
# geo-gate checks so any entry-point can identify an xStock without importing
# the full registry dict.  Case-sensitive: Solana addresses are case-sensitive.
XSTOCKS_MINTS: frozenset[str] = frozenset(e["solana_mint"] for e in XSTOCKS.values())

# Case-insensitive lookup map: fully-uppercased ticker -> canonical registry key.
# Registry keys carry a lowercase 'x' suffix (e.g. "AAPLx"), so a naive
# ``ticker.upper()`` lookup against XSTOCKS (e.g. "AAPLX") never matches.
# This map normalizes any input casing ("aaplx", "AAPLX", "AAPLx", ...) to the
# correct canonical key.
_XSTOCKS_LOOKUP: dict[str, str] = {key.upper(): key for key in XSTOCKS}


def is_xstock_mint(address: str) -> bool:
    """Return True when ``address`` is a known xStock SPL Token-2022 mint.

    Case-sensitive exact match against the registry.  Fast O(1) frozenset
    lookup — safe to call in hot paths.
    """
    return address in XSTOCKS_MINTS


def get_xstock(ticker: str) -> XStockEntry | None:
    """Return the registry entry for a ticker, or None if not found.

    Case-insensitive: "aaplx", "AAPLX", and "AAPLx" all resolve to the same
    entry. Registry keys use a lowercase 'x' suffix internally, so lookups
    go through ``_XSTOCKS_LOOKUP`` (built from an uppercased key map) rather
    than re-casing the input and indexing XSTOCKS directly.
    """
    canonical_key = _XSTOCKS_LOOKUP.get(ticker.upper())
    if canonical_key is None:
        return None
    return XSTOCKS.get(canonical_key)


def get_all_xstocks(include_medium_confidence: bool = False) -> list[XStockEntry]:
    """Return xStocks entries that are safe to surface as tradable.

    SAFE DEFAULT: only 'high' confidence entries are returned. 9 of 14 mints
    in the registry are 'medium' confidence (sourced from the Solana.com
    canonical case-study list, explicitly flagged "re-validate against
    Jupiter's token list before expanding the registry further" — see module
    docstring). Surfacing an unverified mint as tradable risks a user
    swapping into the wrong token entirely (fund loss), so discovery/trading
    surfaces (this is the function used by /stocks and the webapp xStocks
    endpoint) must not list medium-confidence entries until re-validated.

    Pass ``include_medium_confidence=True`` only for internal/admin tooling
    that explicitly needs to audit the full registry — never for a
    user-facing trade/discovery surface.
    """
    entries = (
        XSTOCKS.values()
        if include_medium_confidence
        else (e for e in XSTOCKS.values() if e["confidence"] == "high")
    )
    return sorted(entries, key=lambda e: (e["confidence"] != "high", e["ticker"]))


# ---------------------------------------------------------------------------
# Shared execution-layer geo-gate
# ---------------------------------------------------------------------------
# This function is intentionally defined here (not in a handler module) so that
# swap.py, paste_trade.py, and any future execution surface can import it
# without creating a circular import.  xstocks.py is a pure config/registry
# module — it MUST NOT import from bot.handlers.*.


def xstocks_region_allowed(telegram_id: int) -> tuple[bool, str]:
    """Check whether a user may access xStocks.

    Returns ``(allowed: bool, reason: str)`` where reason is one of:
      "ok"      — user is in an allowed region
      "blocked" — user is in a prohibited region (US/GB/CA/AU)
      "unknown" — region is not set or empty
      "error"   — DB lookup failed

    Fail-closed: unknown region and DB errors are treated as blocked.
    This is the authoritative gate for ALL xStocks execution paths.
    Handlers use this function rather than reimplementing the logic.

    NOTE: This function performs a *synchronous* DB query (via get_session).
    It is safe to call from async handlers because get_session is a
    synchronous context manager.  Do not await it.
    """
    # Import here (not at module top) to keep xstocks.py free of circular
    # import risk.  bot.models and database are leaf packages with no upward
    # imports into bot.config.
    try:
        from bot.models.user import User
        from database.db import get_session

        with get_session() as session:
            user = session.query(User).filter(User.telegram_id == telegram_id).first()
            region = (user.region or "").strip().upper() if user else ""

        if not region:
            return False, "unknown"

        if region in XSTOCKS_BLOCKED_REGIONS:
            return False, "blocked"

        return True, "ok"

    except Exception as exc:  # noqa: BLE001
        logger.warning("xstocks region lookup failed for %s: %s", telegram_id, exc)
        # Fail-closed on any error.
        return False, "error"
