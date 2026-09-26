"""Superstate (superstate.co) tokenized-fund on-chain status — USTB/USCC.

Superstate's fund tokens (USTB "Invesco Short Duration US Government
Securities Fund" and USCC "Bitwise Crypto Carry Fund") are NOT vaults and
NOT free-transfer ERC-20s: they enforce an on-chain KYC allowlist inside
`transfer` itself (`isAllowed(address)`, selector 0xbabcc539, verified live
on both tokens on Ethereum mainnet). Quoting/pricing works for anyone —
settlement does not.

This is exactly why the swap engine (see
`SwapEngine._assert_not_gated` in bot/services/swap_engine.py) refuses these
tokens unconditionally: if a non-allowlisted wallet's swap were allowed to
proceed, the `approve` would succeed and the subsequent `transfer` would
REVERT, burning the user's gas for nothing. This module exists to give users
LIVE, INFORMATIVE context (are you allowlisted? is the fund paused?) — never
to gate or unblock a swap. The allowlist read here is advisory only: an RPC
failure returns `None` ("unknown"), never a false "not allowlisted", and
callers must never treat any result from this module as permission to
attempt settlement.

Read-only and blocking (uses web3.py's sync HTTPProvider like
`bot/services/morpho_api.py` / `bot/services/membership_service.py`) — async
callers must wrap calls in `asyncio.to_thread`.
"""

import logging
import threading
import time
from dataclasses import dataclass
from typing import Any, Optional

logger = logging.getLogger(__name__)

CHAIN = "ethereum"

# Verified on-chain 2026-08-26 (Ethereum mainnet). See bot/config/tokens.py.
_FUND_ADDRESSES: dict[str, str] = {
    "USTB": "0x43415eB6ff9DB7E26A15b704e7A3eDCe97d31C4e",
    "USCC": "0x14d60E7FDC0D71d8611742720E4C50E7a974020c",
}

# Minimal ABI fragments — only the selectors verified LIVE and readable on
# both tokens. `allowList()` / `hasAuthorization(address)` REVERT on both
# tokens and are deliberately NOT included here.
_ABI = [
    {
        "name": "isAllowed",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"name": "account", "type": "address"}],
        "outputs": [{"name": "", "type": "bool"}],
    },
    {
        "name": "accountingPaused",
        "type": "function",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"name": "", "type": "bool"}],
    },
    {
        "name": "decimals",
        "type": "function",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"name": "", "type": "uint8"}],
    },
    {
        "name": "name",
        "type": "function",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"name": "", "type": "string"}],
    },
]

_STATUS_TTL = 300  # 5 minutes — fund status (paused/decimals/name) changes rarely
_ALLOWLIST_TTL = 300  # 5 minutes — allowlist membership is a slow-moving KYC decision


class SuperstateError(Exception):
    """Raised for programmer errors (unknown symbol), never for RPC failures.

    RPC/network failures are swallowed and surfaced as `None` ("unknown") by
    the public functions below — they must never look like a definitive
    "not allowlisted" / "paused" result.
    """


@dataclass
class _CacheEntry:
    value: Any
    expires_at: float


class _SyncTTLCache:
    """Tiny thread-safe TTL cache for the blocking calls in this module.

    `bot/utils/cache.py`'s AsyncCache requires an event loop; this service is
    intentionally sync (called via asyncio.to_thread), so it needs its own
    lock-guarded dict — same shape, sync API.
    """

    def __init__(self) -> None:
        self._entries: dict[str, _CacheEntry] = {}
        self._lock = threading.Lock()

    def get(self, key: str) -> Optional[Any]:
        with self._lock:
            entry = self._entries.get(key)
            if entry is None or time.time() > entry.expires_at:
                return None
            return entry.value

    def set(self, key: str, value: Any, ttl: float) -> None:
        with self._lock:
            self._entries[key] = _CacheEntry(value=value, expires_at=time.time() + ttl)


class SuperstateService:
    """Read-only status lookups for Superstate's allowlist-gated fund tokens."""

    def __init__(self) -> None:
        self._cache = _SyncTTLCache()

    def _address(self, token_symbol: str) -> str:
        addr = _FUND_ADDRESSES.get(token_symbol.upper())
        if not addr:
            raise SuperstateError(f"{token_symbol} is not a known Superstate fund token.")
        return addr

    def _contract(self, address: str):
        from bot.services.rpc_manager import rpc_manager

        w3 = rpc_manager.get_web3(CHAIN)
        return w3.eth.contract(address=w3.to_checksum_address(address), abi=_ABI)

    def is_allowlisted(self, token_symbol: str, address: str) -> Optional[bool]:
        """True/False if the KYC allowlist read succeeds, else None (unknown).

        `None` means "we could not read the chain" — it is NOT a "not
        allowlisted" result and must never be rendered or treated as one.
        Docstring reminder (see module docstring): gating is enforced
        on-chain in `transfer` itself, so a non-allowlisted wallet's swap
        would settle as a REVERT after a successful `approve` — this
        pre-check exists purely to warn the user before they burn gas on
        that doomed settlement, not to grant or block anything itself.
        """
        try:
            token_addr = self._address(token_symbol)
        except SuperstateError:
            return None

        cache_key = f"allowed:{token_symbol.upper()}:{address.lower()}"
        cached = self._cache.get(cache_key)
        if cached is not None:
            return cached

        try:
            contract = self._contract(token_addr)
            checksum_addr = contract.w3.to_checksum_address(address)
            result = bool(contract.functions.isAllowed(checksum_addr).call())
            self._cache.set(cache_key, result, _ALLOWLIST_TTL)
            return result
        except Exception as e:
            logger.warning(f"superstate isAllowed({token_symbol}, {address[:10]}...) failed: {e}")
            return None

    def get_fund_status(self, token_symbol: str) -> dict:
        """Fund-level status: accounting-paused flag, decimals, on-chain name.

        Returns a dict with `None` for any field that could not be read
        rather than raising, except for an unknown symbol (raises
        SuperstateError — that IS a programmer error, unlike an RPC blip).
        Cached ~5 minutes since fund-level state changes rarely.
        """
        token_addr = self._address(token_symbol)

        cache_key = f"status:{token_symbol.upper()}"
        cached = self._cache.get(cache_key)
        if cached is not None:
            return cached

        status: dict[str, Any] = {
            "symbol": token_symbol.upper(),
            "address": token_addr,
            "accounting_paused": None,
            "decimals": None,
            "onchain_name": None,
            "price_usd": None,
        }
        try:
            contract = self._contract(token_addr)
            try:
                status["accounting_paused"] = bool(contract.functions.accountingPaused().call())
            except Exception as e:
                logger.warning(f"superstate accountingPaused({token_symbol}) failed: {e}")
            try:
                status["decimals"] = int(contract.functions.decimals().call())
            except Exception as e:
                logger.warning(f"superstate decimals({token_symbol}) failed: {e}")
            try:
                status["onchain_name"] = str(contract.functions.name().call())
            except Exception as e:
                logger.warning(f"superstate name({token_symbol}) failed: {e}")
        except Exception as e:
            logger.warning(f"superstate get_fund_status({token_symbol}) failed: {e}")

        # Price/NAV is a best-effort, cheap live lookup — never hardcoded.
        # Left None here (no bundled price API call from this module); callers
        # that need NAV should fetch it via the repo's existing price service.
        self._cache.set(cache_key, status, _STATUS_TTL)
        return status


# Module-level singleton, matching repo convention (e.g. rpc_manager, price services).
superstate_service = SuperstateService()
