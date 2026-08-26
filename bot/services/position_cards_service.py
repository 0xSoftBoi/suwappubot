"""Suwappu Positions — NFT position cards on Robinhood Chain (chain 4663).

A Position is a card bound to one of the ~96 tokenized equities on Robinhood
Chain. The holder's entry price is stamped on-chain at mint; the card renders
live P&L against it. Holding one grants a swap-fee discount.

Trust model
-----------
Card STATE (P&L, grade) comes from an indexer (Blockscout) for the token-id
list, which is convenient but NOT authoritative — each id is re-verified
on-chain before it is trusted. The fee discount does not need that indexer at
all: its VALUE is resolved by an ``eth_call`` against ``discountFor(address)``,
which reads native ERC-721 state (goldBalance / balanceOf) directly. The
discount is flat per holder, not per card — Gold beats base, never additive —
so stacking cards cannot compound the giveaway.

Guardrails (money path)
-----------------------
Consulted while pricing a swap. Every entry point is fail-safe: any RPC,
indexer, config or parse error returns "no perk" rather than raising, so a swap
can never be blocked — or mispriced upward — by a Positions lookup. The sync
fee path reads an in-memory cache only and never does I/O.
"""

import asyncio
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

from bot.config.settings import settings

logger = logging.getLogger(__name__)

CHAIN = "robinhood"
CHAIN_ID = 4663

# discountFor() reports the discount in BASIS POINTS OF THE TIER RATE
# (holdDiscountFractionBps / goldDiscountFractionBps in SuwappuPositions.sol;
# 4000 == 40% base, 5500 == 55% Founders' Gold), so we divide by 10,000 to get
# the fraction fee_service multiplies by. Note the unit: these are bps OF THE
# RATE, not bps OF THE SWAP. That distinction is the whole point — a flat
# bps-of-the-swap subtraction from unevenly-spaced tiers (FREE 100 / PRO 50 /
# PREMIUM 30 / ENTERPRISE 10) floored PRO and PREMIUM to the same rate, making
# PREMIUM worthless to a card holder. See fee_service.get_fee_decimal.
#
# The contract defaults (4000, 5500) yield the 0.40 / 0.55 fractions documented
# as economics.hold_discount_fraction / economics.gold_discount_fraction in
# nft/position-cards/config.json — pinned equal in tests/test_position_cards.py
# so the two cannot drift.
#
# Hard backstop on the FRACTION this module can return, independent of whatever the
# deployed contract reports. It mirrors MAX_HOLD_DISCOUNT_FRACTION_BPS (6000) so the
# on-chain cap and this one agree; a reading of 10000 would divide out to 1.0 (a free
# swap), and we clamp well below that so a wrong contract or a bad read can never
# zero out the fee.
MAX_CARD_DISCOUNT_FRACTION = 0.60

_CACHE_TTL = 300  # seconds
_MAX_TOKEN_IDS = 200  # cap the eth_call payload for whales / spam wallets

# Every eth_call below used to run inline inside an `async def`. web3's
# HTTPProvider is blocking and its timeout is seconds long, so a slow Robinhood
# RPC stalled the whole event loop — and a bulk swap made one such call PER LEG,
# multiplying the stall by the number of legs. These run on a dedicated small
# pool, never asyncio's default executor (which swap execution also uses), so
# exhaustion degrades this feature instead of starving swaps.
_EXECUTOR = ThreadPoolExecutor(max_workers=2, thread_name_prefix="positions")
# wait_for cancels the await, not the thread, so timed-out work would otherwise
# keep piling into an unbounded queue during an RPC hang. Fail open immediately
# once saturated: "no perk" is always the safe answer here.
_INFLIGHT = threading.BoundedSemaphore(8)
_RPC_TIMEOUT = 2.0  # seconds — perks are a nice-to-have, never worth a stall
_VIEW_TIMEOUT = 12.0  # seconds — /cards renders up to 50 cards, 2 reads each

GRADES = ["Underwater", "Flat", "In Profit", "Runner", "Multiple", "Moonshot"]

# Earned-allowlist thresholds. These MUST match classify() in
# nft/position-cards/build_allowlist.py, which builds the Merkle roots the
# contract actually enforces — otherwise the bot promises a spot the mint denies.
FOUNDER_LEVELS = ("gold", "platinum", "diamond")
FOUNDER_VOLUME_USD = 50_000
FOUNDER_REFERRALS = 5
ALLOWLIST_SWAPS = 5
ALLOWLIST_VOLUME_USD = 1_000
ALLOWLIST_REFERRALS = 1

# Canonical ticker order for the collection — the PRICED subset of
# ROBINHOOD_EQUITIES (those with a live Chainlink feed on chain 4663), sorted by
# symbol. This is the same order the contract's ticker arrays were built from;
# see nft/position-cards/deploy_args.json. Do not reorder.
# Wallet providers whose private key Suwappu actually holds. A "watch" wallet is
# just an address the user typed in — proving nothing about ownership — so it must
# never source a perk. Mirrors membership_service.KEY_CONTROLLED_PROVIDERS.
KEY_CONTROLLED_PROVIDERS = ("local", "turnkey")

PRICED_TICKERS = [
    "AAPL",
    "AMD",
    "AMZN",
    "ASML",
    "BABA",
    "CLSK",
    "COIN",
    "CRCL",
    "CRWV",
    "DELL",
    "EWY",
    "GME",
    "GOOGL",
    "INTC",
    "IONQ",
    "META",
    "MSFT",
    "MSTR",
    "MU",
    "NBIS",
    "NVDA",
    "ORCL",
    "PLTR",
    "QQQ",
    "RGTI",
    "RKLB",
    "SGOV",
    "SLV",
    "SNDK",
    "SPCX",
    "SPY",
    "TSLA",
    "TSM",
    "USAR",
    "USO",
]

_ABI = [
    {
        "name": "discountFor",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"name": "holder", "type": "address"}],
        "outputs": [{"name": "", "type": "uint16"}],
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
        "name": "returnBps",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"name": "tokenId", "type": "uint256"}],
        "outputs": [
            {"name": "bps", "type": "int256"},
            {"name": "priced", "type": "bool"},
        ],
    },
    {
        "name": "grade",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"name": "tokenId", "type": "uint256"}],
        "outputs": [{"name": "", "type": "uint8"}],
    },
    {
        "name": "remaining",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"name": "tickerIndex", "type": "uint8"}],
        "outputs": [{"name": "", "type": "uint256"}],
    },
    {
        "name": "isGold",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"name": "tokenId", "type": "uint256"}],
        "outputs": [{"name": "", "type": "bool"}],
    },
]


class PositionCardsService:
    """Read-only resolver for Suwappu Positions perks and live card state."""

    def __init__(self) -> None:
        self._holdings: dict[str, tuple[float, list[int]]] = {}
        # (t, fraction) — fraction, not raw bps; see MAX_CARD_DISCOUNT_FRACTION.
        self._discount: dict[str, tuple[float, float]] = {}
        self._user_discount: dict[int, tuple[float, float]] = {}
        # (address, ticker index) -> (t, bps). Without this a bulk swap did one
        # uncached holdsTicker eth_call per leg, per side.
        self._ticker_boost: dict[tuple[str, int], tuple[float, int]] = {}

    # ── config ────────────────────────────────────────────────────────────────

    @property
    def contract_address(self) -> Optional[str]:
        addr = getattr(settings, "suwappu_position_cards_contract", None)
        if not addr or not isinstance(addr, str) or not addr.startswith("0x"):
            return None
        return addr

    @property
    def enabled(self) -> bool:
        return self.contract_address is not None

    def ticker_index(self, symbol: str) -> Optional[int]:
        """Index of `symbol` in the collection's canonical ticker order.

        MUST match the on-chain array order in SuwappuPositions, which is built
        from nft/position-cards/deploy_args.json. Note this is the PRICED subset
        (35 tickers with a Chainlink feed), NOT all ~96 tokenized equities in
        ROBINHOOD_EQUITIES — deriving it from the full registry would shift every
        index and point each card at the wrong company.

        The list is inlined rather than read from nft/ because that directory is
        not part of the deployed bot image. tests/test_position_cards.py asserts
        it matches deploy_args.json exactly.
        """
        try:
            return PRICED_TICKERS.index(symbol.upper())
        except ValueError:
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
            timeout = aiohttp.ClientTimeout(total=6)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(url, params={"type": "ERC-721"}) as resp:
                    if resp.status != 200:
                        logger.debug("Positions: indexer HTTP %s for %s", resp.status, address)
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
            logger.debug("Positions: holdings lookup failed for %s: %s", address, e)
            return []

        self._holdings[key] = (time.time(), ids)
        return ids

    # ── perks (contract-verified) ─────────────────────────────────────────────

    def _contract(self):
        from bot.services.rpc_manager import rpc_manager

        w3 = rpc_manager.get_web3(CHAIN)
        return w3.eth.contract(address=w3.to_checksum_address(self.contract_address), abi=_ABI)

    async def _offload(self, fn, *args, default=None, timeout: float = _RPC_TIMEOUT):
        """Run a blocking web3 read off the event loop, bounded and time-boxed.

        Returns `default` on saturation, timeout or any error — every caller here
        treats that as "no perk", which is the fail-safe direction.
        """
        loop = asyncio.get_running_loop()
        if not _INFLIGHT.acquire(blocking=False):
            logger.debug("Positions: read skipped — executor saturated")
            return default
        try:
            return await asyncio.wait_for(
                loop.run_in_executor(_EXECUTOR, fn, *args), timeout=timeout
            )
        except Exception as e:  # pragma: no cover - defensive
            logger.debug("Positions: offloaded read failed: %s", e)
            return default
        finally:
            _INFLIGHT.release()

    async def get_discount_fraction(self, address: Optional[str]) -> float:
        """Swap-fee discount for an address, as a PROPORTIONAL fraction of the
        tier rate (0.40 base, 0.55 Founders' Gold). 0.0 on any failure.

        Reads the contract's `discountFor(address)` directly — goldBalance and
        balanceOf are both native ERC-721 state, so this needs no indexer-sourced
        token-id list and cannot under-count a holder's Gold card the way a stale
        indexer snapshot could. `discountFor` already applies the best-single-card
        rule (Gold beats base; never additive), so this only clamps the result.
        """
        if not address or not self.enabled:
            return 0.0
        key = address.lower()
        hit = self._discount.get(key)
        if hit and time.time() - hit[0] < _CACHE_TTL:
            return hit[1]
        try:

            def _read():
                contract = self._contract()
                return contract.functions.discountFor(
                    contract.w3.to_checksum_address(address)
                ).call()

            raw = await self._offload(_read)
            if raw is None:
                return 0.0
            fraction = max(0.0, min(int(raw) / 10_000.0, MAX_CARD_DISCOUNT_FRACTION))
        except Exception as e:  # pragma: no cover - defensive
            logger.debug("Positions: discount lookup failed for %s: %s", address, e)
            return 0.0
        self._discount[key] = (time.time(), fraction)
        return fraction

    async def get_positions(self, address: Optional[str]) -> list[dict]:
        """Live state for each card an address holds. Empty on any failure."""
        if not address or not self.enabled:
            return []
        try:
            ids = await self._token_ids(address)
            if not ids:
                return []

            def _read_all():
                contract = self._contract()
                rows = []
                for tid in ids[:50]:
                    try:
                        bps, priced = contract.functions.returnBps(tid).call()
                        grade_idx = contract.functions.grade(tid).call()
                        # Fail-safe false: a Gold read is decorative (a badge in
                        # /cards output), never a discount source — the fee path
                        # already resolves Gold authoritatively via discountFor.
                        # A failed isGold call must not drop the whole row.
                        try:
                            gold = bool(contract.functions.isGold(tid).call())
                        except Exception:
                            gold = False
                        rows.append((tid, bps, priced, grade_idx, gold))
                    except Exception:
                        continue
                return rows

            # One offload for the whole loop: 50 separate hops would each pay the
            # semaphore and could interleave with a leg's discount read. This is
            # an explicit /cards render, not the fee path, so it gets a longer
            # budget than _RPC_TIMEOUT — up to 100 eth_calls do not fit in 2s.
            rows = await self._offload(_read_all, default=[], timeout=_VIEW_TIMEOUT)
            out = []
            for tid, bps, priced, grade_idx, gold in rows or []:
                out.append(
                    {
                        "token_id": tid,
                        "return_bps": int(bps) if priced else None,
                        "priced": bool(priced),
                        "grade": GRADES[grade_idx] if 0 <= grade_idx < len(GRADES) else "Flat",
                        "gold": gold,
                    }
                )
            return out
        except Exception as e:  # pragma: no cover - defensive
            logger.debug("Positions: state lookup failed for %s: %s", address, e)
            return []

    async def get_ticker_xp_boost_bps(self, address: Optional[str], symbol: str) -> int:
        """XP boost in bps for swapping a ticker the address holds a position on."""
        if not address or not self.enabled or not symbol:
            return 0
        idx = self.ticker_index(symbol)
        if idx is None:
            return 0
        try:
            key = (address.lower(), idx)
            hit = self._ticker_boost.get(key)
            if hit and time.time() - hit[0] < _CACHE_TTL:
                return hit[1]
            ids = await self._token_ids(address)
            if not ids:
                return 0

            def _read():
                contract = self._contract()
                return contract.functions.holdsTicker(
                    contract.w3.to_checksum_address(address), ids, idx
                ).call()

            holds = await self._offload(_read)
            if holds is None:
                return 0  # do not cache a failure as "no boost"
            boost = 2500 if holds else 0  # +25% XP on a ticker you hold
            if len(self._ticker_boost) > 4096:
                self._ticker_boost.clear()
            self._ticker_boost[key] = (time.time(), boost)
            return boost
        except Exception as e:  # pragma: no cover - defensive
            logger.debug("Positions: ticker boost lookup failed for %s: %s", address, e)
            return 0

    async def swap_xp_boost_bps(
        self,
        user_id: Optional[int],
        from_symbol: Optional[str],
        to_symbol: Optional[str],
    ) -> int:
        """XP boost for a swap, given both sides of the trade.

        A card boosts swaps of ITS OWN ticker. A trade has two sides and either
        can be the tokenized equity (buying AAPL with USDG, or selling it back),
        so both are checked and the better boost wins — a holder should not lose
        the perk for trading in the direction the UI happened to put second.

        Never raises and never does a lookup for a user with no wallet: returns 0.
        """
        if user_id is None or not self.enabled:
            return 0
        try:
            # DB round-trip, so off the loop as well.
            address = await self._offload(self.evm_address_for_user, user_id)
            if not address:
                return 0
            best = 0
            for symbol in (from_symbol, to_symbol):
                if not symbol:
                    continue
                if self.ticker_index(symbol) is None:
                    continue  # not a card ticker; skip the RPC entirely
                boost = await self.get_ticker_xp_boost_bps(address, symbol)
                if boost > best:
                    best = boost
            return best
        except Exception as e:  # pragma: no cover - defensive
            logger.debug("Positions: swap XP boost failed for %s: %s", user_id, e)
            return 0

    async def remaining_for_ticker(self, symbol: str) -> Optional[int]:
        """Unminted supply left on a ticker — drives the mint-urgency UI."""
        idx = self.ticker_index(symbol)
        if idx is None or not self.enabled:
            return None
        try:
            raw = await self._offload(lambda: self._contract().functions.remaining(idx).call())
            return None if raw is None else int(raw)
        except Exception:
            return None

    # ── sync cache surface (used by the fee path) ─────────────────────────────

    # ── allowlist eligibility (mirrors nft/position-cards/build_allowlist.py) ──

    def allowlist_status(self, user_id: Optional[int]) -> dict:
        """Which mint phase this user has EARNED, and why.

        Deliberately mirrors classify() in build_allowlist.py — the snapshot that
        actually produces the Merkle roots. If the two drift, users are told they
        qualify and then revert at mint, so tests pin the thresholds in both.

        Never raises: on any error returns the "public" fallback, which understates
        rather than overstates eligibility.
        """
        out = {
            "phase": "Public",
            "reasons": [],
            "volume_usd": 0.0,
            "swaps": 0,
            "level": None,
            "referrals": 0,
        }
        if user_id is None:
            return out
        try:
            from bot.models.points import UserPoints
            from database.db import get_session

            with get_session() as session:
                pts = session.query(UserPoints).filter(UserPoints.user_id == user_id).first()
                level = (getattr(pts, "level", None) or "").lower() if pts else ""
                volume = float(getattr(pts, "total_volume_usd", 0) or 0) if pts else 0.0
                swaps = int(getattr(pts, "total_swaps", 0) or 0) if pts else 0
                # VERIFIED referrals only. Referral.verified_at is NULL until
                # the service layer clears a fraud/activity check, and the model
                # states only verified referrals count toward milestones.
                # Counting raw rows here told a user with five throwaway
                # referrals they had earned Founder — and build_allowlist.py
                # counted the same way, so the snapshot agreed and the sybil
                # went all the way onto the on-chain Merkle root.
                referrals = 0
                try:
                    from bot.models.referral import Referral

                    referrals = (
                        session.query(Referral)
                        .filter(
                            Referral.referrer_id == user_id,
                            Referral.verified_at.isnot(None),
                        )
                        .count()
                    )
                except Exception:
                    pass

            out.update(volume_usd=volume, swaps=swaps, level=level or None, referrals=referrals)
            reasons = []
            if level in FOUNDER_LEVELS:
                reasons.append(f"{level} XP level")
            if volume >= FOUNDER_VOLUME_USD:
                reasons.append(f"${volume:,.0f} lifetime volume")
            if referrals >= FOUNDER_REFERRALS:
                reasons.append(f"{referrals} referrals")
            if reasons:
                out.update(phase="Founder", reasons=reasons)
                return out

            reasons = []
            if swaps >= ALLOWLIST_SWAPS:
                reasons.append(f"{swaps} swaps")
            if volume >= ALLOWLIST_VOLUME_USD:
                reasons.append(f"${volume:,.0f} lifetime volume")
            if referrals >= ALLOWLIST_REFERRALS:
                reasons.append(f"{referrals} referral(s)")
            if reasons:
                out.update(phase="Allowlist", reasons=reasons)
        except Exception as e:  # pragma: no cover - defensive
            logger.debug("Positions: allowlist status failed for %s: %s", user_id, e)
        return out

    def evm_address_for_user(self, user_id: Optional[int]) -> Optional[str]:
        """The user's own EVM address for perk purposes, or None. Never raises.

        Only KEY-CONTROLLED wallets count. `get_user_wallets` also returns
        watch-only entries — addresses a user merely typed in — so reading the
        first row of that list handed anyone who watched a whale's address that
        whale's Position-card fee discount and XP boost. Ownership of the card is
        the perk; watching it is not.

        Ordered by Wallet.id so the answer is stable: an unordered `first row`
        makes the discount flicker between wallets across calls, which is the
        kind of thing that only shows up as a support ticket about fees.
        """
        if user_id is None:
            return None
        try:
            from bot.models.user import Wallet
            from database.db import get_session

            with get_session() as session:
                row = (
                    session.query(Wallet.address)
                    .filter(
                        Wallet.user_id == user_id,
                        Wallet.chain_type == "evm",
                        Wallet.is_active.is_(True),
                        Wallet.wallet_provider.in_(KEY_CONTROLLED_PROVIDERS),
                    )
                    .order_by(Wallet.id)
                    .first()
                )
            return row[0] if row and row[0] else None
        except Exception as e:  # pragma: no cover - defensive
            logger.debug("Positions: wallet lookup failed for user %s: %s", user_id, e)
            return None

    async def warm_for_user(self, user_id: Optional[int]) -> float:
        """Resolve the user's EVM address, refresh its perk, cache it by user_id.

        Returns the discount as a PROPORTIONAL FRACTION (0.40 == 40% off), not bps.

        Call from an ASYNC swap path shortly before pricing. The fee path is
        sync and must never do I/O, so it reads only the cache this populates.
        """
        if user_id is None or not self.enabled:
            return 0.0
        try:
            address = self.evm_address_for_user(user_id)
            if not address:
                self._user_discount[user_id] = (time.time(), 0.0)
                return 0.0
            fraction = await self.get_discount_fraction(address)
        except Exception as e:  # pragma: no cover - defensive
            logger.debug("Positions: warm failed for user %s: %s", user_id, e)
            return 0.0
        self._user_discount[user_id] = (time.time(), fraction)
        return fraction

    def get_cached_discount_fraction_for_user(self, user_id: Optional[int]) -> float:
        """Cached discount for a user, as a PROPORTIONAL FRACTION (0.40 == 40% off
        the tier rate). NEVER does I/O — cold cache means 0.0 (no discount).

        A cold read costs the user a discount on that one quote rather than
        adding a network round-trip to pricing. It can never overstate.
        """
        if user_id is None or not self.enabled:
            return 0.0
        hit = self._user_discount.get(user_id)
        if not hit or time.time() - hit[0] >= _CACHE_TTL:
            return 0.0
        return max(0.0, min(hit[1], MAX_CARD_DISCOUNT_FRACTION))

    def invalidate(self, address: str, user_id: Optional[int] = None) -> None:
        """Drop every cached perk derived from `address`.

        It previously cleared only `_holdings` and `_discount`, leaving
        `_ticker_boost` (keyed by address+ticker) and `_user_discount` (keyed by
        user_id) stale — so a holder who sold or transferred their card kept the
        fee discount and the XP boost for up to _CACHE_TTL. Bounded, but it is
        revenue, and a cache invalidation that clears two of four is a trap for
        the next reader.
        """
        key = (address or "").lower()
        self._holdings.pop(key, None)
        self._discount.pop(key, None)
        for k in [k for k in self._ticker_boost if k[0] == key]:
            self._ticker_boost.pop(k, None)
        if user_id is not None:
            self._user_discount.pop(user_id, None)


position_cards_service = PositionCardsService()
