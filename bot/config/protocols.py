"""Registry of DeFi protocols whose tokens this bot can quote/swap.

This is a thin, read-only index over bot/config/tokens.py — it does not add
new addresses, it groups existing TOKENS entries by the protocol that issues
them so callers can answer "what protocol is this token from" and "is this
token allowlist-gated" without hardcoding symbol lists at each call site.

The only consumer today is the swap-engine gated-token guard (see
bot/services/swap_engine.py, is_gated_token()) which fails a quote fast for
Superstate RWA tokens (USTB/USCC) whose transfers revert for non-allowlisted
wallets even though quoting itself works fine.
"""

from dataclasses import dataclass, field
from typing import Optional

from bot.config.tokens import TOKENS

# Address-based gating index — required because a pasted contract address
# (paste-to-trade) never resolves to a TOKENS symbol lookup, so the
# symbol-only check below misses it entirely for gated tokens like USTB/USCC.
# Keyed on (chain, lowercased address) since the same symbol/token can have
# different addresses (or gating status) per chain.
_GATED_ADDRESSES: frozenset[tuple[str, str]] = frozenset(
    (chain, addr.lower())
    for t in TOKENS.values()
    if t.transfer_gated
    for chain, addr in t.addresses.items()
)


@dataclass
class ProtocolConfig:
    """Static metadata for a DeFi protocol integrated (fully or partially) here."""

    name: str
    slug: str
    category: str
    chains: list[str]
    tokens: list[str] = field(default_factory=list)  # symbols keying into TOKENS
    docs_url: str = ""
    notes: str = ""


PROTOCOLS: dict[str, ProtocolConfig] = {
    "superstate": ProtocolConfig(
        name="Superstate",
        slug="superstate",
        category="RWA / tokenized funds",
        chains=["ethereum"],
        tokens=["USTB", "USCC"],
        docs_url="https://superstate.co",
        notes=(
            "Both fund tokens enforce an on-chain KYC allowlist — transfers "
            "revert for wallets not allowlisted with Superstate (qualified "
            "purchasers only). Quoting works; settlement does not."
        ),
    ),
    "ethena": ProtocolConfig(
        name="Ethena",
        slug="ethena",
        category="Delta-neutral synthetic dollar",
        chains=["ethereum", "arbitrum", "base"],
        tokens=["USDe", "sUSDe", "ENA"],
        docs_url="https://ethena.fi",
        notes="USDe is the synthetic dollar; sUSDe is its ERC-4626 staked yield vault; ENA is governance.",
    ),
    "lido": ProtocolConfig(
        name="Lido",
        slug="lido",
        category="Liquid staking",
        chains=["ethereum"],
        tokens=["stETH", "wstETH"],
        docs_url="https://lido.fi",
        notes="stETH is the rebasing staked-ETH receipt; wstETH is its non-rebasing wrapper.",
    ),
    "aave": ProtocolConfig(
        name="Aave",
        slug="aave",
        category="Lending",
        chains=["ethereum", "polygon", "arbitrum", "optimism"],
        tokens=["AAVE"],
        docs_url="https://aave.com",
        notes="Governance token only — no lending-pool integration in this bot.",
    ),
    "morpho": ProtocolConfig(
        name="Morpho",
        slug="morpho",
        category="Lending",
        chains=["ethereum", "base"],
        tokens=["MORPHO"],
        docs_url="https://morpho.org",
        notes=(
            "Governance token here. The actual borrow/earn integration (cbBTC/USDC "
            "market + MetaMorpho vaults) lives in bot/config/morpho_config.py + "
            "bot/services/morpho_api.py on Base. Morpho is also the lending "
            "backbone of Robinhood Earn on Robinhood Chain (chain id 4663)."
        ),
    ),
    "pendle": ProtocolConfig(
        name="Pendle",
        slug="pendle",
        category="Yield trading",
        chains=["ethereum"],
        tokens=["PENDLE"],
        docs_url="https://pendle.finance",
        notes="Governance token only — no yield-market integration in this bot.",
    ),
}


def get_protocol_for_token(symbol: str) -> Optional[ProtocolConfig]:
    """Return the ProtocolConfig that issues `symbol`, if any.

    Case-insensitive, consistent with the TOKENS lookup helpers in
    bot/config/tokens.py (e.g. get_token_by_symbol). Unknown symbols return
    None rather than raising.
    """
    if not symbol:
        return None
    symbol = symbol.strip()
    for protocol in PROTOCOLS.values():
        for token_symbol in protocol.tokens:
            if token_symbol.lower() == symbol.lower():
                return protocol
    return None


def is_gated_token(symbol: str, chain: Optional[str] = None) -> bool:
    """True if `symbol` (or a pasted contract address) is transfer-gated.

    Reads TokenConfig.transfer_gated directly. Tolerates unknown symbols
    (returns False rather than raising) and is case-insensitive, matching
    how bot/config/tokens.py's own lookup helpers resolve symbols.

    `symbol` may also be a raw pasted contract address (paste-to-trade) that
    never resolves to a TOKENS entry via the symbol lookup below — in that
    case, check it against the address-based gating index instead. When
    `chain` is given, only that chain's gated addresses are checked; when
    omitted, the address is checked against gated addresses on any chain.
    """
    if not symbol:
        return False
    symbol = symbol.strip()
    token = TOKENS.get(symbol.upper())
    if token is None:
        # Fall back to a case-insensitive scan since TOKENS keys aren't all
        # uppercase (e.g. "USDe", "stETH") — mirrors get_token_by_symbol's
        # intent without assuming every registry key is upper-cased.
        for key, candidate in TOKENS.items():
            if key.lower() == symbol.lower():
                token = candidate
                break
    if token is not None:
        return token.transfer_gated

    # Not a known symbol — if it looks like a pasted address, check it
    # against the address-based gating index (paste-to-trade path).
    if (symbol.startswith("0x") or symbol.startswith("0X")) and len(symbol) >= 42:
        addr = symbol.lower()
        if chain:
            return (chain.lower(), addr) in _GATED_ADDRESSES
        return any(gated_addr == addr for _chain, gated_addr in _GATED_ADDRESSES)

    return False
