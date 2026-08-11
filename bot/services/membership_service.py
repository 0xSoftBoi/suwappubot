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

import logging
import time
from typing import Optional

from bot.config.settings import settings
from bot.models.subscription import SubscriptionTier

logger = logging.getLogger(__name__)

CHAIN = "robinhood"
CHAIN_ID = 4663

_CACHE_TTL = 300  # seconds

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
        # user_id -> (fetched_at, tier or None)
        self._cache: dict[int, tuple[float, Optional[SubscriptionTier]]] = {}

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

    async def get_onchain_tier(self, user_id: Optional[int]) -> Optional[SubscriptionTier]:
        """The user's membership-NFT tier, or None when unknown/unavailable.

        None (not FREE) on every failure path, so the caller can distinguish
        "chain says FREE" from "could not read the chain" — both leave the DB
        tier in force under the max() rule, but only one is worth logging.
        """
        if user_id is None or not self.enabled:
            return None
        hit = self._cache.get(user_id)
        if hit and time.time() - hit[0] < _CACHE_TTL:
            return hit[1]
        tier: Optional[SubscriptionTier] = None
        try:
            from bot.services.position_cards_service import position_cards_service

            address = position_cards_service.evm_address_for_user(user_id)
            if address:
                contract = self._contract()
                raw_tier, _expiry = contract.functions.tierOf(
                    contract.w3.to_checksum_address(address)
                ).call()
                tier = TIER_BY_INDEX.get(int(raw_tier))
                # An unknown index means an incompatible contract — treat as
                # unreadable rather than guessing a tier.
        except Exception as e:  # pragma: no cover - defensive
            logger.debug("Membership: on-chain tier lookup failed for %s: %s", user_id, e)
            tier = None
        self._cache[user_id] = (time.time(), tier)
        return tier

    def best_tier(
        self, db_tier: SubscriptionTier, onchain: Optional[SubscriptionTier]
    ) -> SubscriptionTier:
        """max(db, chain) under TIER_RANK. The chain can only ever raise a tier."""
        if onchain is None:
            return db_tier
        return onchain if TIER_RANK.get(onchain, 0) > TIER_RANK.get(db_tier, 0) else db_tier

    def invalidate(self, user_id: int) -> None:
        """Drop the cached tier (e.g. right after a subscribe tx confirms)."""
        self._cache.pop(user_id, None)


membership_service = MembershipService()
