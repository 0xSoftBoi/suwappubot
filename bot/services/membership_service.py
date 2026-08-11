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
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

from bot.config.settings import settings
from bot.models.subscription import SubscriptionTier

logger = logging.getLogger(__name__)

# Sentinel: distinguishes "cached None (chain unreadable)" from "not cached".
_MISS = object()

CHAIN = "robinhood"
CHAIN_ID = 4663

_CACHE_TTL = 300  # seconds — successful reads
_FAILURE_TTL = 15  # seconds — a transient RPC blip must not pin None for 5 min
_STALE_PAID_TTL = 3600  # a previously-OBSERVED paid tier survives an outage this long
_CACHE_MAX = 5_000  # sweep threshold; entries beyond TTL are dropped
_CALL_TIMEOUT = 1.5  # seconds — hard budget for the whole lookup
_MAX_WALLETS = 5  # EVM wallets checked per user (max tier across them wins)

# Membership lookups run on their OWN small pool, never asyncio's default
# executor. web3's HTTPProvider timeout is seconds long and asyncio.wait_for
# cancels the await but NOT the thread, so a hung Robinhood RPC would otherwise
# pin default-executor workers that swap execution also depends on. Bounded
# here, exhaustion is contained to this feature: extra lookups fail open
# instead of starving the swap path.
_EXECUTOR = ThreadPoolExecutor(max_workers=2, thread_name_prefix="membership")


def _is_transport_error(exc: BaseException) -> bool:
    """True only for errors that say something about the ENDPOINT's health.

    A missing/incompatible contract raises BadFunctionCallOutput ("could not
    decode") or ContractLogicError — the RPC answered perfectly, the contract
    just is not there. Reporting those as RPC failures trips the circuit breaker
    for the whole chain and takes position cards and every other Robinhood Chain
    read down with it. Observed live: pointing this service at an address with no
    code circuit-opened rpc.mainnet.chain.robinhood.com within six calls.
    """
    try:
        from web3.exceptions import (
            BadFunctionCallOutput,
            ContractLogicError,
            InvalidAddress,
        )

        if isinstance(exc, (BadFunctionCallOutput, ContractLogicError, InvalidAddress)):
            return False
    except Exception:  # pragma: no cover - web3 always present in practice
        pass
    return True


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
        # Bumped by invalidate(). A lookup that started before an invalidation
        # must not write its now-stale result: /bindwallet invalidates precisely
        # so a freshly bound wallet shows up immediately, and an in-flight read
        # re-populating pre-bind data would hide it for a full TTL.
        self._generation: dict[int, int] = {}

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
        """Blocking eth_calls — always executed on _EXECUTOR, never inline.

        Returns the best tier seen. Short-circuits on ENTERPRISE (nothing can
        beat it) and skips addresses that fail rather than discarding the whole
        result, so one bad wallet cannot cost a user a tier they hold elsewhere.
        """
        from bot.services.rpc_manager import rpc_manager

        contract = self._contract()
        # Attribute health to the endpoint that ACTUALLY served the call. Asking
        # rpc_manager for a URL instead would return a fresh weighted-random pick
        # and blame a healthy endpoint for this one's failure — which also evicts
        # the shared web3 cache for every other caller on this chain.
        try:
            url = contract.w3.provider.endpoint_uri
        except Exception:
            url = None

        best: Optional[SubscriptionTier] = None
        saw_success = False
        contract_errors = 0
        t0 = time.time()
        for addr in addresses:
            try:
                raw_tier, _expiry = contract.functions.tierOf(
                    contract.w3.to_checksum_address(addr)
                ).call()
            except Exception as e:
                # Only genuine transport failures count against endpoint health.
                if url and _is_transport_error(e):
                    rpc_manager.report_failure(CHAIN, url, str(e))
                contract_errors += 1
                continue
            saw_success = True
            tier = TIER_BY_INDEX.get(int(raw_tier))
            if tier is None:
                # Unknown index: an incompatible/other contract at this address.
                # Skip it — do NOT discard a paid tier already found elsewhere.
                continue
            if best is None or TIER_RANK[tier] > TIER_RANK[best]:
                best = tier
            if best == SubscriptionTier.ENTERPRISE:
                break
        if saw_success and url:
            rpc_manager.report_success(CHAIN, url, (time.time() - t0) * 1000)
        if not saw_success:
            # Distinguish "the chain is fine, the contract answered nothing
            # useful" (misconfigured address -> no membership, cache it) from a
            # real outage (raise -> stale-while-revalidate keeps a paid tier).
            if contract_errors == len(addresses):
                return None
            raise RuntimeError("all tierOf calls failed on transport errors")
        return best

    async def get_onchain_tier(self, user_id: Optional[int]) -> Optional[SubscriptionTier]:
        """The user's membership-NFT tier, or None when unknown/unavailable.

        None (not FREE) on every failure path, so the caller can distinguish
        "chain says FREE" from "could not read the chain" — both leave the DB
        tier in force under the max() rule.

        Never blocks the event loop: the DB read and the eth_calls run on a
        dedicated bounded pool inside ONE shared deadline, single-flighted per
        user. Stale-while-revalidate: a previously observed PAID tier is served
        for up to an hour through an outage, so a timeout can never silently
        downgrade a paying subscriber to FREE pricing mid-swap.
        """
        if user_id is None or not self.enabled:
            return None
        fresh = self._cached(user_id)
        if fresh is not _MISS:
            return fresh

        lock = self._locks.setdefault(user_id, asyncio.Lock())
        async with lock:
            fresh = self._cached(user_id)
            if fresh is not _MISS:
                return fresh

            loop = asyncio.get_running_loop()
            gen = self._generation.get(user_id, 0)
            deadline = time.time() + _CALL_TIMEOUT
            tier = None
            try:
                addresses = await asyncio.wait_for(
                    loop.run_in_executor(_EXECUTOR, self._addresses_for_user, user_id),
                    timeout=max(0.1, deadline - time.time()),
                )
                if addresses:
                    tier = await asyncio.wait_for(
                        loop.run_in_executor(_EXECUTOR, self._tier_for_addresses_sync, addresses),
                        timeout=max(0.1, deadline - time.time()),
                    )
            except Exception as e:  # pragma: no cover - defensive
                logger.debug("Membership: on-chain tier lookup failed for %s: %s", user_id, e)
                tier = None

            # Never let an unreadable chain silently demote a member we have
            # already SEEN holding a paid tier. This covers both an exception and
            # a `None` from the all-contract-errors path: a node serving empty
            # state answers eth_call with 0x, which decodes as a contract error,
            # and would otherwise cache "no membership" and bill a paying
            # ENTERPRISE holder at 1% for the next five minutes. Contracts do not
            # disappear, so a previously observed paid tier is better evidence
            # than one bad read. Bounded by _STALE_PAID_TTL, after which the DB
            # tier takes over.
            if tier is None:
                prev = self._cache.get(user_id)
                if (
                    prev
                    and prev[1] is not None
                    and TIER_RANK.get(prev[1], 0) > 0
                    and time.time() - prev[0] < _STALE_PAID_TTL
                ):
                    return prev[1]

            if self._generation.get(user_id, 0) != gen:
                # Invalidated while this lookup was in flight — return the value
                # but do not cache it, so the next call re-reads the chain.
                return tier
            self._set_cached(user_id, tier)
            return tier

    def _cached(self, user_id: int):
        """Cached value if still fresh, else _MISS. Failures expire fast."""
        hit = self._cache.get(user_id)
        if not hit:
            return _MISS
        fetched_at, tier = hit
        ttl = _CACHE_TTL if tier is not None else _FAILURE_TTL
        return tier if time.time() - fetched_at < ttl else _MISS

    def _set_cached(self, user_id: int, tier: Optional[SubscriptionTier]) -> None:
        if len(self._cache) > _CACHE_MAX:
            cutoff = time.time() - _CACHE_TTL
            for k in [k for k, (ts, _t) in self._cache.items() if ts < cutoff]:
                self._cache.pop(k, None)
        # Locks are swept separately and only when unlocked: a stale cache entry
        # looks identical to an in-flight lookup, so evicting its lock would let
        # another coroutine create a fresh one and defeat single-flight.
        if len(self._locks) > _CACHE_MAX:
            for k, lk in list(self._locks.items()):
                if not lk.locked() and k not in self._cache:
                    self._locks.pop(k, None)
                    self._generation.pop(k, None)
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
        self._generation[user_id] = self._generation.get(user_id, 0) + 1
        lock = self._locks.get(user_id)
        if lock is not None and not lock.locked():
            self._locks.pop(user_id, None)


membership_service = MembershipService()
