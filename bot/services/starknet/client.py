"""Starknet RPC client manager.

Provides a starknet_py FullNodeClient with primary→fallback failover
(Alchemy primary via STARKNET_RPC_URL, Lava keyless fallback). This is
deliberately separate from bot/services/rpc_manager.py — that manager is
Web3/EVM-shaped; Starknet uses its own JSON-RPC spec and client library.

starknet_py requires Python >= 3.10. Imports are guarded so this module
still parses (and the rest of the bot still imports) on older local
interpreters; any actual use without starknet_py installed raises a clear
RuntimeError.
"""

import asyncio
import logging
import time
from typing import Optional

from bot.config.settings import settings

logger = logging.getLogger(__name__)

STARKNET_PUBLICNODE_URL = "https://starknet.publicnode.com"

try:  # pragma: no cover - exercised implicitly by import
    from starknet_py.net.full_node_client import FullNodeClient
    from starknet_py.net.account.account import Account
    from starknet_py.net.models.chains import StarknetChainId
    from starknet_py.net.signer.stark_curve_signer import KeyPair

    STARKNET_PY_AVAILABLE = True
except ImportError:  # pragma: no cover
    FullNodeClient = None  # type: ignore
    Account = None  # type: ignore
    StarknetChainId = None  # type: ignore
    KeyPair = None  # type: ignore
    STARKNET_PY_AVAILABLE = False

# How long a health-check result is trusted before re-probing (seconds)
HEALTH_CHECK_TTL = 60.0
HEALTH_CHECK_TIMEOUT = 5.0


def _require_starknet_py() -> None:
    if not STARKNET_PY_AVAILABLE:
        raise RuntimeError(
            "starknet-py is not installed (requires Python >= 3.10). "
            "Install with: pip install 'starknet-py>=0.28.1'"
        )


class StarknetClientManager:
    """Manages FullNodeClient instances with primary→fallback failover."""

    def __init__(self):
        self._clients: dict[str, "FullNodeClient"] = {}
        self._primary_healthy_until: float = 0.0
        self._primary_failed_until: float = 0.0
        self._lock = asyncio.Lock()

    def _rpc_urls(self) -> list[str]:
        """Ordered candidate RPC URLs (primary first, fallback last)."""
        urls = []
        if settings.starknet_rpc_url:
            urls.append(settings.starknet_rpc_url)
        if settings.starknet_rpc_fallback_url not in urls:
            urls.append(settings.starknet_rpc_fallback_url)
        # Keyless public endpoint of last resort (verified live 2026-06-11).
        if STARKNET_PUBLICNODE_URL not in urls:
            urls.append(STARKNET_PUBLICNODE_URL)
        return urls

    def _client_for(self, url: str) -> "FullNodeClient":
        _require_starknet_py()
        if url not in self._clients:
            self._clients[url] = FullNodeClient(node_url=url)
        return self._clients[url]

    async def _is_healthy(self, client: "FullNodeClient") -> bool:
        """Cheap liveness probe: fetch the chain's latest block number."""
        try:
            await asyncio.wait_for(client.get_block_number(), timeout=HEALTH_CHECK_TIMEOUT)
            return True
        except Exception as e:
            logger.warning("Starknet RPC health check failed: %s", str(e)[:120])
            return False

    async def get_client(self) -> "FullNodeClient":
        """Get a healthy FullNodeClient (primary preferred, fallback on failure)."""
        _require_starknet_py()
        urls = self._rpc_urls()
        primary = urls[0]
        now = time.monotonic()

        async with self._lock:
            # Primary recently verified healthy — use it without re-probing.
            if now < self._primary_healthy_until and now >= self._primary_failed_until:
                return self._client_for(primary)

            # Primary recently failed — go straight to fallback until cooldown ends.
            if now < self._primary_failed_until and len(urls) > 1:
                return self._client_for(urls[1])

            client = self._client_for(primary)
            if await self._is_healthy(client):
                self._primary_healthy_until = now + HEALTH_CHECK_TTL
                self._primary_failed_until = 0.0
                return client

            self._primary_failed_until = now + HEALTH_CHECK_TTL
            for url in urls[1:]:
                fallback = self._client_for(url)
                if await self._is_healthy(fallback):
                    logger.info("Starknet RPC failover: using %s", url)
                    return fallback

            # Nothing passed the probe — return primary and let the caller's
            # operation surface the real error (probes can false-negative).
            logger.error("All Starknet RPCs failed health checks; using primary anyway")
            return client


# Global instance
starknet_client_manager = StarknetClientManager()


async def get_starknet_client() -> "FullNodeClient":
    """Get a healthy Starknet FullNodeClient (primary with Lava fallback)."""
    return await starknet_client_manager.get_client()


def get_starknet_chain_id() -> "StarknetChainId":
    """Resolve the configured Starknet chain id (settings.starknet_chain_id)."""
    _require_starknet_py()
    if str(settings.starknet_chain_id).strip().lower() == "sepolia":
        return StarknetChainId.SEPOLIA
    return StarknetChainId.MAINNET


async def get_starknet_account(private_key: str, address: str) -> "Account":
    """Build a starknet_py Account for signing v3 (STRK-fee) transactions.

    Args:
        private_key: Stark private key (hex string or decimal string felt)
        address: The account contract address (hex string)

    Returns:
        starknet_py Account bound to a healthy RPC client (chain from
        settings.starknet_chain_id, default SN_MAIN).
    """
    _require_starknet_py()
    client = await get_starknet_client()
    key_int = int(private_key, 16) if str(private_key).startswith("0x") else int(private_key)
    key_pair = KeyPair.from_private_key(key_int)
    return Account(
        address=int(address, 16),
        client=client,
        key_pair=key_pair,
        chain=get_starknet_chain_id(),
    )
