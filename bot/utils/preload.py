"""Preload commonly used data at startup for faster access."""

import logging
from typing import Dict, Set

logger = logging.getLogger(__name__)

# Preloaded lookup tables (populated at startup)
_chain_id_map: Dict[str, int] = {}
_chain_name_map: Dict[int, str] = {}
_token_addresses: Dict[str, Dict[str, str]] = {}  # token -> chain -> address
_supported_tokens: Set[str] = set()
_supported_chains: Set[str] = set()


def preload_config():
    """Preload chain and token configurations into memory."""
    global _chain_id_map, _chain_name_map, _token_addresses, _supported_tokens, _supported_chains

    from bot.config.chains import CHAINS
    from bot.config.tokens import TOKENS

    # Preload chains
    for chain in CHAINS.values():
        _chain_id_map[chain.name] = chain.chain_id
        _chain_name_map[chain.chain_id] = chain.name
        _supported_chains.add(chain.name)

    # Preload tokens
    for symbol, token in TOKENS.items():
        _supported_tokens.add(symbol)
        _token_addresses[symbol] = dict(token.addresses)

    logger.info(f"Preloaded {len(_supported_chains)} chains and {len(_supported_tokens)} tokens")


def get_chain_id_fast(chain_name: str) -> int:
    """Get chain ID from name (fast lookup)."""
    return _chain_id_map.get(chain_name, 0)


def get_chain_name_fast(chain_id: int) -> str:
    """Get chain name from ID (fast lookup)."""
    return _chain_name_map.get(chain_id, "")


def get_token_address_fast(symbol: str, chain: str) -> str:
    """Get token address for chain (fast lookup)."""
    token_addrs = _token_addresses.get(symbol, {})
    return token_addrs.get(chain, "")


def is_supported_token(symbol: str) -> bool:
    """Check if token is supported (fast)."""
    return symbol in _supported_tokens


def is_supported_chain(chain_name: str) -> bool:
    """Check if chain is supported (fast)."""
    return chain_name in _supported_chains


def get_all_token_symbols() -> Set[str]:
    """Get all supported token symbols."""
    return _supported_tokens.copy()


def get_all_chain_names() -> Set[str]:
    """Get all supported chain names."""
    return _supported_chains.copy()
