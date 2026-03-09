"""Flashbots Protect RPC integration for Ethereum MEV protection.

Flashbots Protect is a drop-in RPC replacement that routes transactions
through a private mempool, preventing sandwich attacks and front-running.

Works by simply sending the transaction to the Flashbots Protect RPC
instead of the public mempool.
"""

import logging
from typing import Optional

logger = logging.getLogger(__name__)

# Flashbots Protect RPC endpoints
FLASHBOTS_RPC = "https://rpc.flashbots.net"
FLASHBOTS_RPC_FAST = "https://rpc.flashbots.net/fast"

# For other EVM chains with private RPCs
MEV_PROTECTED_RPCS = {
    "ethereum": FLASHBOTS_RPC,
    "bsc": "https://bsc-private.gateway.pokt.network/v1/lb/6136201a7bad1500343e248d",
    "base": "https://rpc.flashbots.net?chainId=8453",
}


def get_mev_protected_rpc(chain: str) -> Optional[str]:
    """Get the MEV-protected RPC URL for a chain.

    Args:
        chain: Chain name (ethereum, bsc, base, etc.)

    Returns:
        Protected RPC URL or None if not available for this chain
    """
    return MEV_PROTECTED_RPCS.get(chain.lower())


def is_mev_protection_available(chain: str) -> bool:
    """Check if MEV protection is available for a chain.

    Solana uses Jito bundles (separate system).
    EVM chains use private RPCs where available.
    """
    if chain.lower() == "solana":
        return True  # Via Jito
    return chain.lower() in MEV_PROTECTED_RPCS
