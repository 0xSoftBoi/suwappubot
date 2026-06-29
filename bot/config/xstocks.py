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
See bot/handlers/stocks.py for the gate implementation.

DO NOT add new mints here without first verifying them against the Jupiter
token list and the Backed Finance on-chain registry.
"""

from typing import TypedDict


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


def get_xstock(ticker: str) -> XStockEntry | None:
    """Return the registry entry for a ticker, or None if not found."""
    return XSTOCKS.get(ticker.upper())


def get_all_xstocks() -> list[XStockEntry]:
    """Return all xStocks entries, high-confidence first."""
    return sorted(XSTOCKS.values(), key=lambda e: (e["confidence"] != "high", e["ticker"]))
