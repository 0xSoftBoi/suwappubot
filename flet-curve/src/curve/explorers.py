"""Where to send someone who wants to see a contract for themselves."""

from __future__ import annotations

#: The chains Curve's v2 API covers, by id. Names are the API's.
EXPLORERS: dict[int, str] = {
    1: "https://etherscan.io",              # ethereum
    10: "https://optimistic.etherscan.io",  # optimism
    56: "https://bscscan.com",              # bsc
    100: "https://gnosisscan.io",           # xdai
    137: "https://polygonscan.com",         # polygon
    146: "https://sonicscan.org",           # sonic
    252: "https://fraxscan.com",            # fraxtal
    999: "https://hyperevmscan.io",         # hyperliquid
    8453: "https://basescan.org",           # base
    42161: "https://arbiscan.io",           # arbitrum
}

#: Multi-chain search. Not a real explorer for any one chain, but it finds
#: an address on most of them, which beats a dead link.
FALLBACK = "https://blockscan.com"


def base_url(chain_id: int, published: str = "") -> str:
    """The explorer for a chain."""
    if published:
        return published.rstrip("/")
    return EXPLORERS.get(chain_id, FALLBACK)


def address_url(chain_id: int, address: str, published: str = "") -> str:
    """A link to one contract. Empty for an empty address."""
    if not address:
        return ""
    return f"{base_url(chain_id, published)}/address/{address}"


def tx_url(chain_id: int, tx: str, published: str = "") -> str:
    """A link to one transaction. Empty for an empty hash."""
    if not tx:
        return ""
    return f"{base_url(chain_id, published)}/tx/{tx}"
