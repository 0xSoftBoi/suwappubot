"""TON Jetton (token standard) support.

Jettons are the TON equivalent of ERC-20 tokens.
Each Jetton has a master contract and per-owner wallet contracts.
"""

import logging
from typing import Optional, Dict
from dataclasses import dataclass

import aiohttp

from bot.config.settings import settings

logger = logging.getLogger(__name__)

TON_API_BASE = "https://toncenter.com/api/v2"

# Well-known Jettons on TON mainnet
KNOWN_JETTONS: Dict[str, Dict] = {
    "USDT": {
        "address": "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs",
        "symbol": "USDT",
        "name": "Tether USD",
        "decimals": 6,
    },
    "NOT": {
        "address": "EQAvlWFDxGF2lXm67y4yzC17wYKD9A0guwPkMs1gOsM__NOT",
        "symbol": "NOT",
        "name": "Notcoin",
        "decimals": 9,
    },
    "DOGS": {
        "address": "EQCvxJy4eG8hyHBFsZ7eePxrRsUQSFE_jpptRAYBmcG_DOGS",
        "symbol": "DOGS",
        "name": "Dogs",
        "decimals": 9,
    },
    "STON": {
        "address": "EQA2kCVNwVsil2EM2mB0SkXytxCqQjS4mttjDpnXmwG9T6bO",
        "symbol": "STON",
        "name": "STON.fi",
        "decimals": 9,
    },
    "TON": {
        "address": "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c",
        "symbol": "TON",
        "name": "Toncoin",
        "decimals": 9,
    },
}


@dataclass
class JettonInfo:
    """Jetton token information."""
    address: str
    symbol: str
    name: str
    decimals: int
    total_supply: Optional[int] = None
    image_url: Optional[str] = None


def get_jetton_info(symbol_or_address: str) -> Optional[JettonInfo]:
    """Look up Jetton info by symbol or address.

    Checks known Jettons first, falls back to on-chain lookup.
    """
    # Check known Jettons by symbol
    upper = symbol_or_address.upper()
    if upper in KNOWN_JETTONS:
        info = KNOWN_JETTONS[upper]
        return JettonInfo(
            address=info["address"],
            symbol=info["symbol"],
            name=info["name"],
            decimals=info["decimals"],
        )

    # Check known Jettons by address
    for info in KNOWN_JETTONS.values():
        if info["address"] == symbol_or_address:
            return JettonInfo(
                address=info["address"],
                symbol=info["symbol"],
                name=info["name"],
                decimals=info["decimals"],
            )

    return None


def get_jetton_address(symbol: str) -> Optional[str]:
    """Get the master contract address for a Jetton by symbol."""
    info = KNOWN_JETTONS.get(symbol.upper())
    return info["address"] if info else None


def get_jetton_decimals(symbol: str) -> int:
    """Get decimals for a Jetton. Defaults to 9 (TON standard)."""
    info = KNOWN_JETTONS.get(symbol.upper())
    return info["decimals"] if info else 9


async def fetch_jetton_metadata(jetton_address: str) -> Optional[JettonInfo]:
    """Fetch Jetton metadata from the blockchain.

    Args:
        jetton_address: The Jetton master contract address

    Returns:
        JettonInfo or None if fetch fails
    """
    api_key = getattr(settings, "ton_api_key", None)
    headers = {}
    if api_key:
        headers["X-API-Key"] = api_key

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{TON_API_BASE}/getJettonData",
                params={"address": jetton_address},
                headers=headers,
            ) as resp:
                if resp.status != 200:
                    return None

                data = await resp.json()
                if not data.get("ok"):
                    return None

                result = data.get("result", {})
                content = result.get("jetton_content", {}).get("data", {})

                return JettonInfo(
                    address=jetton_address,
                    symbol=content.get("symbol", "???"),
                    name=content.get("name", "Unknown"),
                    decimals=int(content.get("decimals", "9")),
                    total_supply=int(result.get("total_supply", "0")),
                    image_url=content.get("image"),
                )

    except Exception as e:
        logger.error("Jetton metadata fetch error for %s: %s", jetton_address, e)
        return None
