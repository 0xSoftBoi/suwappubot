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
import threading
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
_BROADCAST_TIMEOUT = 20.0  # seconds — a subscription broadcast is rare and slower
# A quote is an explicit user command, not the swap hot path, so it can wait
# longer than _CALL_TIMEOUT — but it must never return a guessed nonce.
_QUOTE_TIMEOUT = 5.0
_MAX_WALLETS = 5  # EVM wallets checked per user (max tier across them wins)

# Wallet providers whose rows prove the user CONTROLS the address — the bot holds
# or brokers the key. "watch" is deliberately excluded: bot/handlers/import_handler.py
# creates watch rows from pasted text with no signature and no key, so treating one
# as evidence of membership would let anyone paste a known ENTERPRISE holder's
# address and inherit their fee tier for free. Ownership must be proved, either by
# key custody (here) or by an EIP-191 signature (User.membership_address).
KEY_CONTROLLED_PROVIDERS = ("local", "turnkey")

# Membership lookups run on their OWN small pool, never asyncio's default
# executor. web3's HTTPProvider timeout is seconds long and asyncio.wait_for
# cancels the await but NOT the thread, so a hung Robinhood RPC would otherwise
# pin default-executor workers that swap execution also depends on. Bounded
# here, exhaustion is contained to this feature: extra lookups fail open
# instead of starving the swap path.
_EXECUTOR = ThreadPoolExecutor(max_workers=2, thread_name_prefix="membership")
# The executor's queue is unbounded and wait_for cancels the await, not the
# thread — so during an RPC hang every timed-out lookup would still sit queued
# and eventually run, minutes late, growing without bound. This admission gate
# fails open immediately once the backlog is saturated instead of enqueuing.
_INFLIGHT = threading.BoundedSemaphore(8)

# Relayer broadcasts are serialised. Two of them ran concurrently on the
# 2-worker pool, each reading get_transaction_count() independently and getting
# the SAME nonce — the second tx then replaced the first in the mempool, so one
# user's subscription silently never landed while their signature stayed spent
# from their point of view. The lock covers nonce read AND send, which is the
# only window that matters.
_RELAYER_LOCK = threading.Lock()
# ...and a gate in front of it, because the lock alone would let broadcasts queue
# without bound behind one stuck send. Refusing is safe: the handler falls back
# to handing the user broadcastable calldata.
_RELAYER_INFLIGHT = threading.BoundedSemaphore(4)


def _subscription_nonce(subscriber: str, tier_index: int, periods: int, seq: int) -> bytes:
    """keccak256(abi.encode("SUWAPPU_SUBSCRIPTION_V2", subscriber, tier, periods, seq)).

    Byte-identical to SuwappuMembership.subscriptionNonce — a mismatch makes every
    authorization revert with IntentMismatch, so it is pinned by a test.

    `seq` is the payer's on-chain `subscriptionSeq`, read immediately before
    signing. Without it the nonce was a pure function of (payer, tier, periods),
    so the FIRST purchase of a plan burned that EIP-3009 nonce forever and every
    renewal of the same plan reverted inside USDG with no recovery path.
    """
    from eth_abi import encode
    from eth_utils import keccak

    return keccak(
        encode(
            ["string", "address", "uint8", "uint256", "uint256"],
            ["SUWAPPU_SUBSCRIPTION_V2", subscriber, tier_index, periods, seq],
        )
    )


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

_SUBSCRIBE_ABI = [
    {
        "name": "subscribeWithAuthorization",
        "type": "function",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "tier", "type": "uint8"},
            {"name": "periods", "type": "uint256"},
            {"name": "maxPricePerPeriod", "type": "uint256"},
            {
                "name": "auth",
                "type": "tuple",
                "components": [
                    {"name": "from", "type": "address"},
                    {"name": "value", "type": "uint256"},
                    {"name": "validAfter", "type": "uint256"},
                    {"name": "validBefore", "type": "uint256"},
                    {"name": "nonce", "type": "bytes32"},
                    {"name": "v", "type": "uint8"},
                    {"name": "r", "type": "bytes32"},
                    {"name": "s", "type": "bytes32"},
                ],
            },
        ],
        "outputs": [],
    }
]

_SEQ_ABI = [
    {
        "name": "subscriptionSeq",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"name": "subscriber", "type": "address"}],
        "outputs": [{"name": "", "type": "uint256"}],
    }
]

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
        # Highest relayer nonce this process has broadcast, +1. Guarded by
        # _RELAYER_LOCK; see submit_subscription.
        self._relayer_nonce_floor: int = 0

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

        Only addresses whose ownership is PROVED are eligible:
        1. The explicitly bound membership address (User.membership_address,
           signature-proved via /bindwallet) — this is how a Robinhood Wallet /
           smart-account purchase reaches the bot.
        2. The user's key-controlled EVM wallets (bounded, ordered by id so the
           result can never flip with Postgres heap order). Max tier wins.

        WATCH-ONLY WALLETS ARE EXCLUDED. /import creates them from pasted text
        with no proof whatsoever; including them would let any account claim any
        on-chain tier for free by pasting a holder's public address.
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
                    .filter(
                        Wallet.user_id == user_id,
                        Wallet.chain_type == "evm",
                        Wallet.is_active.is_(True),
                        Wallet.wallet_provider.in_(KEY_CONTROLLED_PROVIDERS),
                    )
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
                if _is_transport_error(e):
                    # An outage. Does NOT count as a contract error, or the
                    # "chain fine, contract silent" branch below would swallow it
                    # and cache a paying member as having no membership.
                    if url:
                        rpc_manager.report_failure(CHAIN, url, str(e))
                else:
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
            if not _INFLIGHT.acquire(blocking=False):
                # Backlogged: fail open rather than queue work nobody will wait
                # for. Serve a known paid tier if we have one.
                prev = self._cache.get(user_id)
                if prev and prev[1] is not None and TIER_RANK.get(prev[1], 0) > 0:
                    if time.time() - prev[0] < _STALE_PAID_TTL:
                        return prev[1]
                return None
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
            finally:
                _INFLIGHT.release()

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
                    # Keep the ORIGINAL observation timestamp so the stale window
                    # still expires on schedule, but leave it cached so the next
                    # swap is served from memory instead of re-entering the
                    # lookup and queueing another job per quote.
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

    # ── x402 rail: build a signable subscription authorization ────────────────

    @property
    def treasury_address(self) -> Optional[str]:
        """Where subscription USDG ends up. Display only.

        The authorization no longer signs over the treasury: `to` is the
        membership contract, which sweeps to `treasury()` read from ITS OWN
        storage at settlement time. So a treasury rotation between quote and
        settlement routes correctly instead of paying the old address, and this
        config value being stale can no longer strand a payment.
        """
        return getattr(settings, "suwappu_membership_treasury", None)

    def _subscription_seq_sync(self, subscriber: str) -> int:
        """Blocking eth_call for the payer's next subscription nonce counter."""
        from bot.services.rpc_manager import rpc_manager

        w3 = rpc_manager.get_web3(CHAIN)
        c = w3.eth.contract(address=w3.to_checksum_address(self.contract_address), abi=_SEQ_ABI)
        return int(c.functions.subscriptionSeq(w3.to_checksum_address(subscriber)).call())

    async def quote_subscription(
        self,
        subscriber: str,
        tier: SubscriptionTier,
        periods: int,
        valid_seconds: int = 3600,
    ) -> Optional[dict]:
        """Read the payer's on-chain seq, then build the signable payload.

        Async because the seq read is a real eth_call: signing against a stale
        seq produces a nonce the contract rejects with IntentMismatch, and
        guessing it (e.g. defaulting to 0) breaks every renewal. Runs on the
        bounded membership executor so a hung RPC cannot block the event loop.
        """
        if not self.enabled:
            return None
        loop = asyncio.get_running_loop()
        if not _INFLIGHT.acquire(blocking=False):
            logger.debug("Membership: seq lookup skipped — executor saturated")
            return None
        try:
            seq = await asyncio.wait_for(
                loop.run_in_executor(_EXECUTOR, self._subscription_seq_sync, subscriber),
                timeout=_QUOTE_TIMEOUT,
            )
        except Exception as e:
            logger.debug("Membership: seq lookup failed: %s", e)
            return None
        finally:
            _INFLIGHT.release()
        return self.build_subscription_authorization(
            subscriber, tier, periods, seq, valid_seconds=valid_seconds
        )

    def build_subscription_authorization(
        self,
        subscriber: str,
        tier: SubscriptionTier,
        periods: int,
        seq: int,
        valid_seconds: int = 3600,
        now: Optional[int] = None,
    ) -> Optional[dict]:
        """EIP-712 payload for `subscribeWithAuthorization`, ready to sign.

        This is the same EIP-3009 rail x402 already settles on for chain 4663, so
        a subscription reuses the primitive the agent stack verified rather than
        introducing a second payment path. The wallet signs once; any relayer (or
        an ERC-4337 paymaster) submits it, so the subscriber needs no gas and no
        `approve`.

        The nonce is NOT random: it commits to (subscriber, tier, periods, seq),
        mirroring `SuwappuMembership.subscriptionNonce`. EIP-3009 has no field for
        what a payment is *for*, so without that binding a relayer holding a 99.99
        USDG authorization could redirect it to ten months of a cheaper tier. The
        `seq` component keeps the nonce single-use without making the PURCHASE
        single-use — pass the payer's current on-chain `subscriptionSeq`, which
        `quote_subscription` reads for you.

        Returns None when membership is unconfigured or the tier is unpaid.
        """
        if tier == SubscriptionTier.FREE or not self.enabled:
            return None
        if periods < 1 or periods > 24:  # mirrors MAX_PERIODS_PER_PURCHASE
            return None
        try:
            from bot.services.x402_service import (
                TIER_LIMITS,
                X402_EIP712_DOMAINS,
                x402_service,
            )

            domain = X402_EIP712_DOMAINS[CHAIN]
            usdg = x402_service.payment_tokens[CHAIN][domain["symbol"]]
            # 6dp asset (the x402 registry asserts every asset is 6-decimal).
            # round() avoids 9.99 -> 9989999 float drift.
            price_base = int(round(float(TIER_LIMITS[tier]["price_usd"]) * 1_000_000))
            value = price_base * periods
            tier_index = next(i for i, t in TIER_BY_INDEX.items() if t == tier)
            nonce = _subscription_nonce(subscriber, tier_index, periods, seq)
            issued = int(time.time()) if now is None else int(now)
            valid_before = issued + valid_seconds
            nonce_hex = "0x" + nonce.hex()

            return {
                "chain": CHAIN,
                "chain_id": domain["chain_id"],
                "asset": usdg,
                "tier": tier.value,
                "tier_index": tier_index,
                "periods": periods,
                "seq": seq,
                "value": value,
                "price_per_period": price_base,
                "nonce": nonce_hex,
                "valid_after": 0,
                "valid_before": valid_before,
                "typed_data": {
                    "types": {
                        "EIP712Domain": [
                            {"name": "name", "type": "string"},
                            {"name": "version", "type": "string"},
                            {"name": "chainId", "type": "uint256"},
                            {"name": "verifyingContract", "type": "address"},
                        ],
                        "ReceiveWithAuthorization": [
                            {"name": "from", "type": "address"},
                            {"name": "to", "type": "address"},
                            {"name": "value", "type": "uint256"},
                            {"name": "validAfter", "type": "uint256"},
                            {"name": "validBefore", "type": "uint256"},
                            {"name": "nonce", "type": "bytes32"},
                        ],
                    },
                    "primaryType": "ReceiveWithAuthorization",
                    "domain": {
                        "name": domain["name"],
                        "version": domain["version"],
                        "chainId": domain["chain_id"],
                        "verifyingContract": usdg,
                    },
                    "message": {
                        "from": subscriber,
                        # NOT the treasury: USDG's receiveWithAuthorization
                        # requires to == msg.sender, so naming the membership
                        # contract here is what makes it the only address able to
                        # settle this authorization. Payment and credit become
                        # atomic; nobody can burn the nonce and strand the payer.
                        "to": self.contract_address,
                        "value": value,
                        "validAfter": 0,
                        "validBefore": valid_before,
                        "nonce": nonce_hex,
                    },
                },
            }
        except Exception as e:  # pragma: no cover - defensive
            logger.debug("Membership: authorization build failed: %s", e)
            return None

    # ── submitting a signed authorization ─────────────────────────────────────

    def verify_subscription_signature(self, payload: dict, signature: str) -> Optional[str]:
        """Recover the signer of `payload`'s EIP-712 message. None if invalid.

        The caller MUST check the recovered address against the user's bound
        membership address — recovering *an* address only proves someone signed,
        not that this user did.
        """
        try:
            from eth_account import Account
            from eth_account.messages import encode_typed_data

            msg = encode_typed_data(full_message=payload["typed_data"])
            return Account.recover_message(msg, signature=signature)
        except Exception as e:  # pragma: no cover - defensive
            logger.debug("Membership: signature recovery failed: %s", e)
            return None

    @property
    def relayer_enabled(self) -> bool:
        return bool(
            getattr(settings, "membership_relayer_enabled", False)
            and getattr(settings, "membership_relayer_private_key", None)
            and self.enabled
        )

    def build_subscribe_tx(self, payload: dict, signature: str) -> Optional[dict]:
        """Encode the `subscribeWithAuthorization` call for `payload`.

        Every argument comes from the payload WE generated, never from user
        input: the tier, period count, value and nonce are ours, and the nonce
        commits to (subscriber, tier, periods), so a tampered payload simply
        fails the contract's IntentMismatch check. The signature is the only
        user-supplied field.
        """
        if not self.enabled:
            return None
        try:
            from eth_account import Account

            from bot.services.rpc_manager import rpc_manager

            sig = signature[2:] if signature.startswith("0x") else signature
            raw = bytes.fromhex(sig)
            if len(raw) != 65:
                return None
            r, s_, v = raw[:32], raw[32:64], raw[64]
            if v < 27:
                v += 27

            w3 = rpc_manager.get_web3(CHAIN)
            contract = w3.eth.contract(
                address=w3.to_checksum_address(self.contract_address), abi=_SUBSCRIBE_ABI
            )
            msg = payload["typed_data"]["message"]
            auth = (
                w3.to_checksum_address(msg["from"]),
                int(msg["value"]),
                int(msg["validAfter"]),
                int(msg["validBefore"]),
                bytes.fromhex(msg["nonce"][2:]),
                v,
                r,
                s_,
            )
            fn = contract.functions.subscribeWithAuthorization(
                int(payload["tier_index"]),
                int(payload["periods"]),
                # Price bound: the exact price this payload was quoted at, so a
                # reprice between quote and broadcast reverts instead of
                # silently charging the user more.
                int(payload["price_per_period"]),
                auth,
            )
            return {"to": contract.address, "data": fn._encode_transaction_data(), "fn": fn}
        except Exception as e:  # pragma: no cover - defensive
            logger.debug("Membership: calldata build failed: %s", e)
            return None

    async def submit_subscription(self, payload: dict, signature: str) -> Optional[str]:
        """Broadcast the signed subscription from the relayer wallet.

        Returns the tx hash, or None when the relayer is disabled/unfunded or the
        broadcast fails. The user's funds move by their own EIP-3009 signature;
        the relayer only pays gas.
        """
        if not self.relayer_enabled:
            return None
        try:
            import asyncio

            from eth_account import Account

            from bot.services.rpc_manager import rpc_manager

            built = self.build_subscribe_tx(payload, signature)
            if not built:
                return None

            def _send() -> str:
                # Released HERE, not in the awaiting coroutine: wait_for cancels
                # the await but not the thread, so a coroutine-side release
                # would reopen the gate while this broadcast was still running.
                try:
                    return _send_inner()
                finally:
                    _RELAYER_INFLIGHT.release()

            def _send_inner() -> str:
                w3 = rpc_manager.get_web3(CHAIN)
                acct = Account.from_key(settings.membership_relayer_private_key)
                # "pending", not the default "latest": a broadcast still in the
                # mempool is invisible to "latest", so back-to-back sends would
                # both build on the same nonce.
                with _RELAYER_LOCK:
                    nonce = w3.eth.get_transaction_count(acct.address, "pending")
                    # Belt and braces: some Orbit RPCs lag on the pending tag, so
                    # never go backwards from a nonce we already used.
                    nonce = max(nonce, self._relayer_nonce_floor)
                    tx = built["fn"].build_transaction(
                        {"from": acct.address, "nonce": nonce, "chainId": CHAIN_ID}
                    )
                    signed = acct.sign_transaction(tx)
                    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction).hex()
                    self._relayer_nonce_floor = nonce + 1
                return tx_hash

            if not _RELAYER_INFLIGHT.acquire(blocking=False):
                logger.warning("Membership: relayer saturated, refusing broadcast")
                return None

            # Dedicated executor, never asyncio's default one — a hung
            # broadcast on the shared pool would starve the swap path (the same
            # mistake the tier lookup was already corrected for). Bounded wait so
            # a stuck RPC releases the worker instead of holding it forever.
            loop = asyncio.get_running_loop()
            try:
                fut = loop.run_in_executor(_EXECUTOR, _send)
            except Exception:  # pragma: no cover - pool shut down
                _RELAYER_INFLIGHT.release()
                raise
            return await asyncio.wait_for(fut, timeout=_BROADCAST_TIMEOUT)
        except Exception as e:  # pragma: no cover - defensive
            logger.warning("Membership: subscription broadcast failed: %s", e)
            return None

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
