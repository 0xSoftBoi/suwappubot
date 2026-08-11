"""Suwappu Membership — on-chain subscription tier from Robinhood Chain.

The SuwappuMembership NFT (chain 4663) IS a subscription: FREE is a free soulbound
mint, paid tiers are bought in USDG for 30-day periods. This service resolves a
user's on-chain tier so ``x402_service.get_tier`` can take
``max(db_tier, onchain_tier)``.

Guardrails (money path)
-----------------------
Tier feeds TIER_FEE_RATES and every quote, so this module is fail-OPEN to the
database: any RPC, config, wallet or parse error yields ``None`` ("no on-chain
tier"), which leaves the DB tier in force. On-chain state can only ever RAISE a
user's tier, never lower it, and an RPC outage can never strip a paying
subscriber mid-swap. Results are TTL-cached so the swap path stays fast.
"""

import asyncio
import logging
import time
from typing import Optional

from bot.config.settings import settings
from bot.models.subscription import SubscriptionTier

logger = logging.getLogger(__name__)

CHAIN = "robinhood"
CHAIN_ID = 4663

_CACHE_TTL = 300  # seconds — successful reads
_FAILURE_TTL = 15  # seconds — a transient RPC blip must not pin None for 5 min
_CACHE_MAX = 5_000  # sweep threshold; entries beyond TTL are dropped
_CALL_TIMEOUT = 1.5  # seconds — hard budget for the eth_call off-thread
_MAX_WALLETS = 5  # EVM wallets checked per user (max tier across them wins)

# Contract Tier enum index -> bot tier. Order is fixed by SuwappuMembership.sol.
TIER_BY_INDEX = {
    0: SubscriptionTier.FREE,
    1: SubscriptionTier.PRO,
    2: SubscriptionTier.PREMIUM,
    3: SubscriptionTier.ENTERPRISE,
}

# Ranking for the max() rule in get_tier. Higher wins.
TIER_RANK = {
    SubscriptionTier.FREE: 0,
    SubscriptionTier.PRO: 1,
    SubscriptionTier.PREMIUM: 2,
    SubscriptionTier.ENTERPRISE: 3,
}

_ABI = [
    {
        "name": "tierOf",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"name": "who", "type": "address"}],
        "outputs": [
            {"name": "tier", "type": "uint8"},
            {"name": "expiry", "type": "uint64"},
        ],
    }
]


class MembershipService:
    """Read-only resolver for the on-chain membership tier."""

    def __init__(self) -> None:
        # user_id -> (fetched_at, tier or None-for-failure)
        self._cache: dict[int, tuple[float, Optional[SubscriptionTier]]] = {}
        self._locks: dict[int, asyncio.Lock] = {}

    @property
    def contract_address(self) -> Optional[str]:
        addr = getattr(settings, "suwappu_membership_contract", None)
        if not addr or not isinstance(addr, str) or not addr.startswith("0x"):
            return None
        return addr

    @property
    def enabled(self) -> bool:
        return self.contract_address is not None

    def _contract(self):
        from bot.services.rpc_manager import rpc_manager

        w3 = rpc_manager.get_web3(CHAIN)
        return w3.eth.contract(address=w3.to_checksum_address(self.contract_address), abi=_ABI)

    def _addresses_for_user(self, user_id: int) -> list[str]:
        """Addresses to check, deterministically ordered.

        1. The explicitly bound membership address (User.membership_address,
           signature-proved via /bindwallet) — this is how a Robinhood Wallet /
           smart-account purchase reaches the bot.
        2. All the user's EVM wallet rows (bounded, ordered by id so the result
           can never flip with Postgres heap order). Max tier across all wins.
        """
        out: list[str] = []
        try:
            from bot.models.user import User, Wallet
            from database.db import get_session

            with get_session() as session:
                user = session.query(User).filter(User.id == user_id).first()
                bound = getattr(user, "membership_address", None) if user else None
                if bound:
                    out.append(bound)
                rows = (
                    session.query(Wallet.address)
                    .filter(Wallet.user_id == user_id, Wallet.chain_type == "evm")
                    .order_by(Wallet.id)
                    .limit(_MAX_WALLETS)
                    .all()
                )
                for (addr,) in rows:
                    if addr and addr.lower() not in {a.lower() for a in out}:
                        out.append(addr)
        except Exception as e:  # pragma: no cover - defensive
            logger.debug("Membership: address resolution failed for %s: %s", user_id, e)
        return out[: _MAX_WALLETS + 1]

    def _tier_for_addresses_sync(self, addresses: list[str]) -> Optional[SubscriptionTier]:
        """Blocking eth_calls — always executed via asyncio.to_thread."""
        from bot.services.rpc_manager import rpc_manager

        contract = self._contract()
        url = None
        try:
            url = rpc_manager.get_rpc_url(CHAIN)
        except Exception:
            pass
        best: Optional[SubscriptionTier] = None
        t0 = time.time()
        try:
            for addr in addresses:
                raw_tier, _expiry = contract.functions.tierOf(
                    contract.w3.to_checksum_address(addr)
                ).call()
                tier = TIER_BY_INDEX.get(int(raw_tier))
                # Unknown index == incompatible contract: unreadable, not FREE.
                if tier is None:
                    return None
                if best is None or TIER_RANK[tier] > TIER_RANK[best]:
                    best = tier
            if url:
                rpc_manager.report_success(CHAIN, url, (time.time() - t0) * 1000)
            return best
        except Exception as e:
            if url:
                rpc_manager.report_failure(CHAIN, url, str(e))
            raise

    async def get_onchain_tier(self, user_id: Optional[int]) -> Optional[SubscriptionTier]:
        """The user's membership-NFT tier, or None when unknown/unavailable.

        None (not FREE) on every failure path, so the caller can distinguish
        "chain says FREE" from "could not read the chain" — both leave the DB
        tier in force under the max() rule.

        Never blocks the event loop: the sync eth_call runs in a worker thread
        under a hard timeout, single-flighted per user so N concurrent cold
        reads for one user cost one RPC call. Successes cache for 5 minutes,
        failures for 15 seconds.
        """
        if user_id is None or not self.enabled:
            return None
        hit = self._cache.get(user_id)
        if hit:
            fetched_at, tier = hit
            ttl = _CACHE_TTL if tier is not None else _FAILURE_TTL
            if time.time() - fetched_at < ttl:
                return tier

        lock = self._locks.setdefault(user_id, asyncio.Lock())
        async with lock:
            # Re-check under the lock — another waiter may have filled it.
            hit = self._cache.get(user_id)
            if hit:
                fetched_at, tier = hit
                ttl = _CACHE_TTL if tier is not None else _FAILURE_TTL
                if time.time() - fetched_at < ttl:
                    return tier

            tier = None
            try:
                addresses = await asyncio.to_thread(self._addresses_for_user, user_id)
                if addresses:
                    tier = await asyncio.wait_for(
                        asyncio.to_thread(self._tier_for_addresses_sync, addresses),
                        timeout=_CALL_TIMEOUT,
                    )
            except Exception as e:  # pragma: no cover - defensive
                logger.debug("Membership: on-chain tier lookup failed for %s: %s", user_id, e)
                tier = None

            self._set_cached(user_id, tier)
            return tier

    def _set_cached(self, user_id: int, tier: Optional[SubscriptionTier]) -> None:
        if len(self._cache) > _CACHE_MAX:
            cutoff = time.time() - _CACHE_TTL
            stale = [k for k, (ts, _t) in self._cache.items() if ts < cutoff]
            for k in stale:
                self._cache.pop(k, None)
                self._locks.pop(k, None)
        self._cache[user_id] = (time.time(), tier)

    def best_tier(
        self, db_tier: SubscriptionTier, onchain: Optional[SubscriptionTier]
    ) -> SubscriptionTier:
        """max(db, chain) under TIER_RANK. The chain can only ever raise a tier."""
        if onchain is None:
            return db_tier
        return onchain if TIER_RANK.get(onchain, 0) > TIER_RANK.get(db_tier, 0) else db_tier

    def invalidate(self, user_id: int) -> None:
        """Drop the cached tier. Called by /bindwallet after a successful bind so
        a fresh purchase is visible immediately, not after the TTL."""
        self._cache.pop(user_id, None)


membership_service = MembershipService()
