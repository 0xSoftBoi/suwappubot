"""Suwappu Fills — NFT ticket perks on Robinhood Chain (chain 4663).

A Fill is an order ticket for one of the ~96 tokenized equities on Robinhood
Chain. Holding one in a linked EVM wallet grants two perks:

  * a swap-fee discount, in basis points, from the ticket's DESK tier, and
  * an XP boost on swaps of the ticket's own TICKER.

Trust model
-----------
Token ids come from an indexer (Blockscout), which is convenient but NOT
authoritative. The *value* of the perk is always resolved by an ``eth_call``
against the collection contract, which checks ownership itself and ignores ids
the address does not actually own. A stale or hostile indexer response can
therefore only ever produce a SMALLER discount, never a larger one.

Guardrails (money path)
-----------------------
This module is consulted while pricing a swap. Every public entry point is
fail-safe: any RPC, indexer, config or parse error returns "no perk" rather
than raising, so a swap can never be blocked — or mispriced upward — by a
Fills lookup. Results are cached briefly to keep the swap path fast.
"""

import logging
import time
from typing import Optional

from bot.config.settings import settings

logger = logging.getLogger(__name__)

CHAIN = "robinhood"
CHAIN_ID = 4663

# Ceiling on the discount this module can ever return, as a hard backstop
# independent of whatever the deployed contract reports. The House desk is
# 50 bps; anything above that means a wrong contract or a bad read, and we
# clamp rather than hand out an unbounded fee cut.
MAX_FILL_DISCOUNT_BPS = 50
# Same idea for the XP boost (House = 3500 bps = +35%).
MAX_FILL_XP_BOOST_BPS = 3500

_CACHE_TTL = 300  # seconds
_MAX_TOKEN_IDS = 200  # cap the eth_call payload for whales / spam wallets

_ABI = [
    {
        "name": "bestDiscountBps",
        "type": "function",
        "stateMutability": "view",
        "inputs": [
            {"name": "owner", "type": "address"},
            {"name": "tokenIds", "type": "uint256[]"},
        ],
        "outputs": [{"name": "best", "type": "uint16"}],
    },
    {
        "name": "holdsTicker",
        "type": "function",
        "stateMutability": "view",
        "inputs": [
            {"name": "owner", "type": "address"},
            {"name": "tokenIds", "type": "uint256[]"},
            {"name": "tickerIndex", "type": "uint8"},
        ],
        "outputs": [{"name": "", "type": "bool"}],
    },
    {
        "name": "traitsSealed",
        "type": "function",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"name": "", "type": "bool"}],
    },
]


class FillsService:
    """Read-only perk resolver for the Suwappu Fills collection."""

    def __init__(self) -> None:
        self._holdings: dict[str, tuple[float, list[int]]] = {}
        self._discount: dict[str, tuple[float, int]] = {}
        self._user_discount: dict[int, tuple[float, int]] = {}

    # ── config ────────────────────────────────────────────────────────────────

    @property
    def contract_address(self) -> Optional[str]:
        addr = getattr(settings, "suwappu_fills_contract", None)
        if not addr or not isinstance(addr, str) or not addr.startswith("0x"):
            return None
        return addr

    @property
    def enabled(self) -> bool:
        return self.contract_address is not None

    def ticker_index(self, symbol: str) -> Optional[int]:
        """Index of `symbol` in the sorted ROBINHOOD_EQUITIES registry.

        Must match the ordering used by nft/fills/pack_traits.py, which is the
        ordering sealed into the contract.
        """
        try:
            from bot.config.tokens import ROBINHOOD_EQUITIES

            tickers = sorted(ROBINHOOD_EQUITIES)
            return tickers.index(symbol.upper())
        except (ValueError, Exception):
            return None

    # ── holdings (indexer, non-authoritative) ─────────────────────────────────

    async def _token_ids(self, address: str) -> list[int]:
        """Token ids the indexer believes `address` holds. Never raises."""
        key = address.lower()
        hit = self._holdings.get(key)
        if hit and time.time() - hit[0] < _CACHE_TTL:
            return hit[1]

        contract = self.contract_address
        if not contract:
            return []
        ids: list[int] = []
        try:
            import aiohttp

            from bot.config.chains import CHAINS

            base = CHAINS[CHAIN].explorer_url.rstrip("/")
            url = f"{base}/api/v2/addresses/{address}/nft"
            params = {"type": "ERC-721"}
            timeout = aiohttp.ClientTimeout(total=6)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(url, params=params) as resp:
                    if resp.status != 200:
                        logger.debug("Fills: indexer HTTP %s for %s", resp.status, address)
                        return []
                    data = await resp.json()
            for item in (data or {}).get("items", []) or []:
                token = item.get("token") or {}
                if (token.get("address") or "").lower() != contract.lower():
                    continue
                raw = item.get("id")
                if raw is None:
                    continue
                ids.append(int(raw))
                if len(ids) >= _MAX_TOKEN_IDS:
                    break
        except Exception as e:  # pragma: no cover - defensive
            logger.debug("Fills: holdings lookup failed for %s: %s", address, e)
            return []

        self._holdings[key] = (time.time(), ids)
        return ids

    # ── perks (contract-verified) ─────────────────────────────────────────────

    def _contract(self):
        from bot.services.rpc_manager import rpc_manager

        w3 = rpc_manager.get_web3(CHAIN)
        return w3.eth.contract(address=w3.to_checksum_address(self.contract_address), abi=_ABI)

    async def get_discount_bps(self, address: Optional[str]) -> int:
        """Best swap-fee discount in bps across the address's tickets.

        Returns 0 on any failure, when Fills is unconfigured, or when the
        address holds nothing. Clamped to MAX_FILL_DISCOUNT_BPS.
        """
        if not address or not self.enabled:
            return 0
        key = address.lower()
        hit = self._discount.get(key)
        if hit and time.time() - hit[0] < _CACHE_TTL:
            return hit[1]
        try:
            ids = await self._token_ids(address)
            if not ids:
                self._discount[key] = (time.time(), 0)
                return 0
            contract = self._contract()
            raw = contract.functions.bestDiscountBps(
                contract.w3.to_checksum_address(address), ids
            ).call()
            bps = max(0, min(int(raw), MAX_FILL_DISCOUNT_BPS))
        except Exception as e:  # pragma: no cover - defensive
            logger.debug("Fills: discount lookup failed for %s: %s", address, e)
            return 0
        self._discount[key] = (time.time(), bps)
        return bps

    async def get_ticker_xp_boost_bps(self, address: Optional[str], symbol: str) -> int:
        """XP boost in bps for swapping `symbol`, if a ticket for it is held.

        The boost comes from the best desk the address holds; the ticket only
        has to reference the same ticker being swapped.
        """
        if not address or not self.enabled or not symbol:
            return 0
        idx = self.ticker_index(symbol)
        if idx is None:
            return 0
        try:
            ids = await self._token_ids(address)
            if not ids:
                return 0
            contract = self._contract()
            owner = contract.w3.to_checksum_address(address)
            if not contract.functions.holdsTicker(owner, ids, idx).call():
                return 0
            # Desk -> XP boost, mirroring nft/fills/config.json.
            bps_by_discount = {5: 250, 10: 500, 20: 1000, 35: 2000, 50: 3500}
            discount = await self.get_discount_bps(address)
            return min(bps_by_discount.get(discount, 0), MAX_FILL_XP_BOOST_BPS)
        except Exception as e:  # pragma: no cover - defensive
            logger.debug("Fills: ticker boost lookup failed for %s: %s", address, e)
            return 0

    # ── sync cache surface (used by the fee path) ─────────────────────────────

    async def warm_for_user(self, user_id: Optional[int]) -> int:
        """Resolve the user's EVM address, refresh its perk, cache it by user_id.

        Call this from an ASYNC swap path shortly before pricing. The fee path
        itself is sync and must never do I/O, so it reads only the cache this
        populates (see ``get_cached_discount_bps_for_user``). Returns the bps
        it cached, or 0.
        """
        if user_id is None or not self.enabled:
            return 0
        try:
            from bot.services.wallet import wallet_service

            wallets = wallet_service.get_user_wallets(user_id, chain_type="evm")
            address = next((w.address for w in wallets if w.address), None)
            if not address:
                self._user_discount[user_id] = (time.time(), 0)
                return 0
            bps = await self.get_discount_bps(address)
        except Exception as e:  # pragma: no cover - defensive
            logger.debug("Fills: warm failed for user %s: %s", user_id, e)
            return 0
        self._user_discount[user_id] = (time.time(), bps)
        return bps

    def get_cached_discount_bps_for_user(self, user_id: Optional[int]) -> int:
        """Cached discount for a user. NEVER does I/O — cold cache means 0 bps.

        A cold read costs the user a discount on that one quote rather than
        adding a network round-trip to the swap price path. It can never
        overstate the discount.
        """
        if user_id is None or not self.enabled:
            return 0
        hit = self._user_discount.get(user_id)
        if not hit or time.time() - hit[0] >= _CACHE_TTL:
            return 0
        return max(0, min(hit[1], MAX_FILL_DISCOUNT_BPS))

    def invalidate(self, address: str) -> None:
        """Drop cached holdings/discount for an address (e.g. after a transfer)."""
        key = (address or "").lower()
        self._holdings.pop(key, None)
        self._discount.pop(key, None)


fills_service = FillsService()
