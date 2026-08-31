"""Copy Trading service for social trading features.

Handles:
- Trader profile management
- Following/unfollowing traders
- Copy trade notifications
- Auto-copy execution
- Leaderboard and discovery
"""

import logging
import threading
import time
from typing import Optional, List, Tuple
from datetime import datetime, timezone, timedelta

from sqlalchemy import func, desc, and_, or_
from sqlalchemy.orm import Session

from bot.config.chains import get_chain_by_name
from bot.models.user import User, Wallet
from bot.models.favorites import UserSettings
from bot.models.swap import SwapStatus, SwapTransaction
from bot.models.copy_trading import (
    TraderProfile,
    CopyFollow,
    CopyTrade,
    TraderTrade,
    TraderPosition,
)
from bot.services.points_service import points_service, POINT_ACTIONS
from bot.services.spending_limits import spending_limit_service
from database.db import get_session

logger = logging.getLogger(__name__)


# Constants
MAX_FOLLOWS = 5  # Max traders a user can follow
DEFAULT_COPY_AMOUNT = 10.0  # Default fixed copy amount in USD

# In-process TTL cache for the computed wallet PnL% (see get_wallet_pnl_pct).
# Avoids re-aggregating a trader's realized-PnL history on every leaderboard
# render or copy-notification filter check. Keyed by (trader_id, days) ->
# (pnl_pct, expires_at) — MUST include `days` in the key, otherwise a days=7
# caller can be served a cached days=30 value (and vice versa).
_WALLET_PNL_CACHE_TTL_SECONDS = 300  # 5 minutes
_WALLET_PNL_CACHE_MAX_SIZE = 2000  # bound the unbounded-dict risk; simple eviction below
_wallet_pnl_cache: dict = {}
# A3 hardening: get_wallet_pnl_pct() is called from request/notification code
# that ultimately runs on the run_in_db thread pool (multiple worker threads),
# so the module-level cache above is mutated concurrently. Without a lock,
# `min(_wallet_pnl_cache, key=...)` during eviction can KeyError (or blow up
# with "dictionary changed size during iteration") if another thread pops an
# entry mid-iteration. A single RLock around every read/evict/write of
# `_wallet_pnl_cache` closes that race; RLock (not Lock) so the evict helper
# can be called standalone in tests without deadlocking against the
# read/write critical section below.
_wallet_pnl_cache_lock = threading.RLock()


def format_wallet_pnl_pct(pnl_pct: Optional[float]) -> str:
    """Render a wallet PnL% for display. `pnl_pct` is None when
    get_wallet_pnl_pct() has insufficient realized-close data — show a plain
    "N/A" rather than a fabricated 0.0% or a misleading blank."""
    if pnl_pct is None:
        return "N/A"
    return f"{pnl_pct:+.1f}%"


def _wallet_pnl_cache_evict_if_full(cache_key) -> None:
    """Simple size cap for the module-level PnL cache: when full, clear it
    rather than scanning for a victim to evict. TTL already expires most
    entries well before the cache fills, so a full-clear has the same
    amortized effect as evicting one entry at a time (a handful of cold
    lookups get re-aggregated on the next few calls) without an O(n) scan.

    A3: guarded by `_wallet_pnl_cache_lock` so the size check and the clear
    can never race against a concurrent read/write from another thread.
    """
    with _wallet_pnl_cache_lock:
        if cache_key in _wallet_pnl_cache or len(_wallet_pnl_cache) < _WALLET_PNL_CACHE_MAX_SIZE:
            return
        _wallet_pnl_cache.clear()


class CopyService:
    """Service for managing copy trading functionality."""

    # ==================== Profile Management ====================

    def get_or_create_profile(self, user_id: int) -> TraderProfile:
        """Get or create a trader profile for a user."""
        with get_session() as session:
            profile = session.query(TraderProfile).filter(TraderProfile.user_id == user_id).first()

            if profile:
                return profile

            # Get user info for default display name
            user = session.query(User).filter(User.id == user_id).first()
            display_name = user.username if user else f"Trader{user_id}"

            profile = TraderProfile(
                user_id=user_id,
                display_name=display_name,
                is_public=False,
            )
            session.add(profile)
            session.flush()
            profile_id = profile.id

        with get_session() as session:
            return session.query(TraderProfile).filter(TraderProfile.id == profile_id).first()

    def update_profile(
        self,
        user_id: int,
        display_name: Optional[str] = None,
        bio: Optional[str] = None,
        avatar_emoji: Optional[str] = None,
        is_public: Optional[bool] = None,
    ) -> TraderProfile:
        """Update trader profile settings."""
        with get_session() as session:
            profile = session.query(TraderProfile).filter(TraderProfile.user_id == user_id).first()

            if not profile:
                profile = TraderProfile(user_id=user_id)
                session.add(profile)

            if display_name is not None:
                profile.display_name = display_name[:50]
            if bio is not None:
                profile.bio = bio[:255]
            if avatar_emoji is not None:
                profile.avatar_emoji = avatar_emoji[:10]
            if is_public is not None:
                profile.is_public = is_public

        return self.get_or_create_profile(user_id)

    def toggle_public(self, user_id: int) -> Tuple[bool, str]:
        """Toggle public visibility of trader profile."""
        with get_session() as session:
            profile = session.query(TraderProfile).filter(TraderProfile.user_id == user_id).first()

            if not profile:
                profile = TraderProfile(user_id=user_id, is_public=True)
                session.add(profile)
                return True, (
                    "Profile is now public on the Terminal web app. Anyone can see your "
                    "active wallet address, recent Suwappu trades, performance, and linked "
                    "social identity."
                )

            profile.is_public = not profile.is_public
            new_status = profile.is_public

        if new_status:
            return True, (
                "Profile is now public on the Terminal web app. Anyone can see your active "
                "wallet address, recent Suwappu trades, performance, and linked social identity."
            )
        else:
            return False, "Profile is now private. You won't appear in trader lists."

    # ==================== Following ====================

    def follow_trader(
        self,
        follower_id: int,
        trader_id: int,
        copy_mode: str = "notify",
        copy_amount_usd: float = DEFAULT_COPY_AMOUNT,
    ) -> Tuple[bool, str]:
        """
        Follow a trader for copy trading.

        Args:
            follower_id: User ID of the follower
            trader_id: User ID of the trader to follow
            copy_mode: "notify" or "auto"
            copy_amount_usd: Fixed USD amount to copy

        Returns:
            Tuple of (success, message)
        """
        if follower_id == trader_id:
            return False, "You can't follow yourself!"

        with get_session() as session:
            # Check if trader has a public profile
            trader_profile = (
                session.query(TraderProfile)
                .filter(
                    TraderProfile.user_id == trader_id,
                    TraderProfile.is_public == True,  # noqa: E712
                )  # noqa: E712
                .first()
            )

            if not trader_profile:
                return False, "This trader doesn't have a public profile."

            # Check follow limit
            follow_count = (
                session.query(func.count(CopyFollow.id))
                .filter(
                    CopyFollow.follower_id == follower_id,
                    CopyFollow.is_active == True,  # noqa: E712
                )  # noqa: E712
                .scalar()
            )

            if follow_count >= MAX_FOLLOWS:
                return False, f"You can only follow up to {MAX_FOLLOWS} traders."

            # Check if already following
            existing = (
                session.query(CopyFollow)
                .filter(CopyFollow.follower_id == follower_id, CopyFollow.trader_id == trader_id)
                .first()
            )

            if existing:
                if existing.is_active:
                    return False, "You're already following this trader."
                # Reactivate
                existing.is_active = True
                existing.copy_mode = copy_mode
                existing.copy_amount_usd = copy_amount_usd
            else:
                follow = CopyFollow(
                    follower_id=follower_id,
                    trader_id=trader_id,
                    copy_mode=copy_mode,
                    copy_amount_usd=copy_amount_usd,
                )
                session.add(follow)

            # Update follower count
            trader_profile.follower_count += 1

        trader_name = trader_profile.display_name or f"Trader{trader_id}"
        mode_desc = (
            "with notifications"
            if copy_mode == "notify"
            else "in paper mode" if copy_mode == "paper" else "in auto mode"
        )
        return True, f"Now following {trader_name} {mode_desc}!"

    def unfollow_trader(self, follower_id: int, trader_id: int) -> Tuple[bool, str]:
        """Unfollow a trader."""
        with get_session() as session:
            follow = (
                session.query(CopyFollow)
                .filter(
                    CopyFollow.follower_id == follower_id,
                    CopyFollow.trader_id == trader_id,
                    CopyFollow.is_active == True,  # noqa: E712
                )
                .first()
            )

            if not follow:
                return False, "You're not following this trader."

            follow.is_active = False

            # Update follower count
            trader_profile = (
                session.query(TraderProfile).filter(TraderProfile.user_id == trader_id).first()
            )
            if trader_profile and trader_profile.follower_count > 0:
                trader_profile.follower_count -= 1

        return True, "Unfollowed successfully."

    def update_follow_settings(
        self,
        follower_id: int,
        trader_id: int,
        copy_mode: Optional[str] = None,
        copy_amount_usd: Optional[float] = None,
        max_trade_usd: Optional[float] = None,
        daily_limit_usd: Optional[float] = None,
    ) -> Tuple[bool, str]:
        """Update copy settings for a followed trader."""
        with get_session() as session:
            follow = (
                session.query(CopyFollow)
                .filter(
                    CopyFollow.follower_id == follower_id,
                    CopyFollow.trader_id == trader_id,
                    CopyFollow.is_active == True,  # noqa: E712
                )
                .first()
            )

            if not follow:
                return False, "You're not following this trader."

            if copy_mode is not None:
                follow.copy_mode = copy_mode
            if copy_amount_usd is not None:
                follow.copy_amount_usd = copy_amount_usd
            if max_trade_usd is not None:
                follow.max_trade_usd = max_trade_usd
            if daily_limit_usd is not None:
                follow.daily_limit_usd = daily_limit_usd

        return True, "Settings updated!"

    def get_following(self, user_id: int) -> List[dict]:
        """Get list of traders a user is following."""
        with get_session() as session:
            follows = (
                session.query(CopyFollow, TraderProfile)
                .join(TraderProfile, CopyFollow.trader_id == TraderProfile.user_id)
                .filter(
                    CopyFollow.follower_id == user_id, CopyFollow.is_active == True  # noqa: E712
                )  # noqa: E712
                .all()
            )

            return [
                {
                    "trader_id": f.trader_id,
                    "display_name": p.display_name,
                    "avatar": p.avatar_emoji,
                    "copy_mode": f.copy_mode,
                    "copy_amount": f.copy_amount_usd,
                    "total_copied": f.total_copied_trades,
                    "copy_pnl": f.total_copy_pnl,
                    "win_rate": p.win_rate,
                }
                for f, p in follows
            ]

    def get_followers(self, trader_id: int) -> List[dict]:
        """Get list of users following a trader."""
        with get_session() as session:
            follows = (
                session.query(CopyFollow, User)
                .join(User, CopyFollow.follower_id == User.id)
                .filter(
                    CopyFollow.trader_id == trader_id, CopyFollow.is_active == True  # noqa: E712
                )  # noqa: E712
                .all()
            )

            return [
                {
                    "follower_id": f.follower_id,
                    "username": u.username or f"User{u.id}",
                    "copy_mode": f.copy_mode,
                    "since": f.created_at,
                }
                for f, u in follows
            ]

    # ==================== Trade Recording & Notifications ====================

    @staticmethod
    def _settle_pnl(session, trader_id: int, swap, amount_usd: float):
        """Average-cost realized PnL for one swap.

        Reduces the from_token position (realizing PnL = proceeds - avg_cost*qty_sold)
        and adds the to_token to cost basis. Returns (pnl_usd, pnl_percent, is_winning)
        for the realized sell side. A pure buy (USDC->X) realizes ~0, which is correct.
        Tokens are keyed by (symbol, chain) — the best identity the stored data offers.
        """

        def _f(x):
            try:
                return float(x)
            except (TypeError, ValueError):
                return 0.0

        from_qty = _f(swap.from_amount)
        from_usd = _f(swap.from_amount_usd) or amount_usd
        to_qty = _f(swap.to_amount)
        to_usd = _f(swap.to_amount_usd) or amount_usd

        pnl = 0.0
        cost_of_sold = 0.0

        # SELL side: realize PnL on the disposed (from) token against tracked basis.
        if from_qty > 0:
            pos = (
                session.query(TraderPosition)
                .filter(
                    TraderPosition.trader_id == trader_id,
                    TraderPosition.token == swap.from_token,
                    TraderPosition.chain == swap.from_chain,
                )
                .first()
            )
            if pos and pos.qty > 0:
                avg_cost = pos.cost_usd / pos.qty
                qty_sold = min(from_qty, pos.qty)
                cost_of_sold = avg_cost * qty_sold
                proceeds = from_usd * (qty_sold / from_qty)  # tracked portion only
                pnl = proceeds - cost_of_sold
                pos.qty -= qty_sold
                pos.cost_usd = max(0.0, pos.cost_usd - cost_of_sold)
                if pos.qty <= 1e-12:
                    session.delete(pos)

        # BUY side: add the acquired (to) token to cost basis.
        if to_qty > 0:
            pos = (
                session.query(TraderPosition)
                .filter(
                    TraderPosition.trader_id == trader_id,
                    TraderPosition.token == swap.to_token,
                    TraderPosition.chain == swap.to_chain,
                )
                .first()
            )
            if not pos:
                pos = TraderPosition(
                    trader_id=trader_id,
                    token=swap.to_token,
                    chain=swap.to_chain,
                    qty=0.0,
                    cost_usd=0.0,
                )
                session.add(pos)
            pos.qty += to_qty
            pos.cost_usd += to_usd

        pnl_pct = (pnl / cost_of_sold * 100.0) if cost_of_sold > 0 else 0.0
        return pnl, pnl_pct, (pnl > 0)

    def get_wallet_pnl_pct(
        self,
        trader_id: int,
        days: int = 30,
        use_cache: bool = True,
        session: Optional[Session] = None,
    ) -> Optional[float]:
        """A trader's REALIZED wallet PnL% over a trailing window, sourced from
        already-settled per-trade PnL — never a meaningless same-swap spread.

        Computed as return-on-capital against the trader's true cost basis,
        over is_closed TraderTrade rows in the trailing window:

            cost_basis_usd = SUM(amount_usd) - SUM(pnl_usd)
            pnl_pct        = SUM(pnl_usd) / cost_basis_usd * 100

        `TraderTrade.amount_usd` is the PROCEEDS of the realized sell (the USD
        value of the swap's FROM leg), not its cost basis — and since
        proceeds = cost + pnl, cost = proceeds - pnl. The denominator here is
        deliberately the derived cost, not proceeds: dividing pnl by proceeds
        instead is mathematically CAPPED at +100% (as cost -> 0, pnl/proceeds
        -> 1), so a trader who genuinely 10x'd would show only +90%, and a
        `min_wallet_pnl_pct=100` filter ("only copy traders who doubled their
        money") could never be satisfied by anyone. Dividing by cost basis
        instead has no such ceiling: a 10x (cost 100, proceeds 1000, pnl 900)
        correctly reads +900%, and doubling (cost 100, proceeds 200, pnl 100)
        reads exactly +100%.

        Both source columns are filtered row-wise to be non-NULL together
        (not just coalesced at the aggregate level) so one asymmetric/legacy-
        NULL row can't silently skew the ratio in either direction. The
        derived `cost_basis_usd` is separately guarded: if it comes out <= 0
        (e.g. a data anomaly), this returns None ("insufficient data") rather
        than dividing by a non-positive number or fabricating a percentage —
        never a block.

        Returns None ("insufficient data") when there is no realized-close
        volume in the window — e.g. a brand-new trader, or one who has only
        bought so far. Callers (the `min_wallet_pnl_pct` follow filter and the
        leaderboard/stat renderers) MUST treat None as pass-through / unknown,
        never as 0.0 and never as a below-threshold block.

        Results are cached in-process for `_WALLET_PNL_CACHE_TTL_SECONDS`,
        keyed by (trader_id, days), so repeated leaderboard renders /
        notification fan-outs don't re-aggregate trade history every time.
        """
        now = time.time()
        cache_key = (trader_id, days)
        if use_cache:
            with _wallet_pnl_cache_lock:
                cached = _wallet_pnl_cache.get(cache_key)
                if cached is not None and cached[1] > now:
                    return cached[0]

        cutoff = datetime.utcnow() - timedelta(days=days)

        def _query(s: Session):
            return (
                s.query(
                    func.sum(TraderTrade.pnl_usd),
                    func.sum(TraderTrade.amount_usd),
                )
                .filter(
                    TraderTrade.trader_id == trader_id,
                    TraderTrade.is_closed == True,  # noqa: E712
                    TraderTrade.created_at >= cutoff,
                    TraderTrade.pnl_usd.isnot(None),
                    TraderTrade.amount_usd.isnot(None),
                )
                .one()
            )

        if session is not None:
            total_realized_pnl_usd, total_realized_proceeds_usd = _query(session)
        else:
            with get_session() as new_session:
                total_realized_pnl_usd, total_realized_proceeds_usd = _query(new_session)

        if total_realized_pnl_usd is None or total_realized_proceeds_usd is None:
            # No realized closes in the window -> insufficient data, not 0.0.
            pnl_pct = None
        else:
            # proceeds = cost + pnl  =>  cost = proceeds - pnl.
            cost_basis_usd = float(total_realized_proceeds_usd) - float(total_realized_pnl_usd)
            if cost_basis_usd <= 0:
                # Degenerate/anomalous aggregate (e.g. zero or negative
                # implied cost basis) -- fail to "unknown", never fabricate a
                # percentage and never treat this as a block.
                pnl_pct = None
            else:
                pnl_pct = float(total_realized_pnl_usd) / cost_basis_usd * 100.0

        if use_cache:
            with _wallet_pnl_cache_lock:
                _wallet_pnl_cache_evict_if_full(cache_key)
                _wallet_pnl_cache[cache_key] = (pnl_pct, now + _WALLET_PNL_CACHE_TTL_SECONDS)

        return pnl_pct

    def _get_wallet_pnl_pct_bulk(
        self,
        trader_ids: List[int],
        days: int = 30,
        session: Optional[Session] = None,
    ) -> dict:
        """Bulk variant of get_wallet_pnl_pct() for rendering a whole page of
        traders (e.g. the leaderboard) without one aggregate query per row.

        Serves each trader_id from the in-process cache when warm (same
        (trader_id, days) key as get_wallet_pnl_pct()), and for whatever is
        left issues ONE grouped query covering all of them instead of one
        query per trader -- same non-NULL row filters, same cost-basis
        denominator (SUM(amount_usd) - SUM(pnl_usd)), same None-on-
        insufficient-data sentinel, same cache population. A trader_id with
        no matching group in the result set yields None, never 0.0.

        Returns a dict of {trader_id: Optional[float]} covering every id in
        `trader_ids`.
        """
        now = time.time()
        results: dict = {}
        missing_ids: List[int] = []

        with _wallet_pnl_cache_lock:
            for trader_id in trader_ids:
                cached = _wallet_pnl_cache.get((trader_id, days))
                if cached is not None and cached[1] > now:
                    results[trader_id] = cached[0]
                else:
                    missing_ids.append(trader_id)

        if not missing_ids:
            return results

        cutoff = datetime.utcnow() - timedelta(days=days)

        def _query(s: Session):
            return (
                s.query(
                    TraderTrade.trader_id,
                    func.sum(TraderTrade.pnl_usd),
                    func.sum(TraderTrade.amount_usd),
                )
                .filter(
                    TraderTrade.trader_id.in_(missing_ids),
                    TraderTrade.is_closed == True,  # noqa: E712
                    TraderTrade.created_at >= cutoff,
                    TraderTrade.pnl_usd.isnot(None),
                    TraderTrade.amount_usd.isnot(None),
                )
                .group_by(TraderTrade.trader_id)
                .all()
            )

        if session is not None:
            rows = _query(session)
        else:
            with get_session() as new_session:
                rows = _query(new_session)

        totals_by_trader = {row[0]: (row[1], row[2]) for row in rows}

        for trader_id in missing_ids:
            row = totals_by_trader.get(trader_id)
            if row is None:
                # No realized closes in the window for this trader -> insufficient
                # data, not 0.0 (same sentinel as get_wallet_pnl_pct()).
                pnl_pct = None
            else:
                total_realized_pnl_usd, total_realized_proceeds_usd = row
                if total_realized_pnl_usd is None or total_realized_proceeds_usd is None:
                    pnl_pct = None
                else:
                    # proceeds = cost + pnl  =>  cost = proceeds - pnl.
                    cost_basis_usd = float(total_realized_proceeds_usd) - float(
                        total_realized_pnl_usd
                    )
                    if cost_basis_usd <= 0:
                        pnl_pct = None
                    else:
                        pnl_pct = float(total_realized_pnl_usd) / cost_basis_usd * 100.0

            results[trader_id] = pnl_pct

            with _wallet_pnl_cache_lock:
                _wallet_pnl_cache_evict_if_full((trader_id, days))
                _wallet_pnl_cache[(trader_id, days)] = (
                    pnl_pct,
                    now + _WALLET_PNL_CACHE_TTL_SECONDS,
                )

        return results

    async def record_trade(
        self,
        trader_id: int,
        swap: SwapTransaction,
        amount_usd: float,
    ) -> List[int]:
        """
        Record a trader's swap and notify/copy followers.

        Returns:
            List of follower user IDs that were notified/copied
        """
        # Update trader profile stats
        created_trader_trade = False
        with get_session() as session:
            profile = (
                session.query(TraderProfile).filter(TraderProfile.user_id == trader_id).first()
            )

            if not profile:
                profile = TraderProfile(user_id=trader_id, is_public=False)
                session.add(profile)

            existing_trade = (
                session.query(TraderTrade).filter(TraderTrade.swap_id == swap.id).first()
            )

            if not existing_trade:
                created_trader_trade = True
                trader_trade = TraderTrade(
                    trader_id=trader_id,
                    swap_id=swap.id,
                    from_token=swap.from_token,
                    to_token=swap.to_token,
                    from_chain=swap.from_chain,
                    to_chain=swap.to_chain,
                    amount_usd=amount_usd,
                )
                session.add(trader_trade)

                if amount_usd > 0:
                    # Realized PnL via average-cost basis: the sell side realizes PnL
                    # against the trader's tracked cost; the buy side adds to it.
                    # Unpriced trades stay visible as activity but never mutate
                    # cost basis or performance stats; a zero-dollar cost basis
                    # would manufacture fake profit on a later priced sell.
                    pnl, pnl_pct, is_win = self._settle_pnl(session, trader_id, swap, amount_usd)
                    trader_trade.pnl_usd = pnl
                    trader_trade.pnl_percent = pnl_pct
                    trader_trade.is_winning = is_win
                    if pnl != 0.0:
                        trader_trade.is_closed = True
                        trader_trade.closed_at = datetime.utcnow()
                    # update_stats rolls up total_trades/volume/pnl/win_rate/best/worst/rank.
                    profile.update_stats(pnl, amount_usd, is_win)

        # Notify followers if profile is public
        if not profile.is_public:
            return []

        # Copy allocations are denominated in USD. If the source notional was
        # not priced, never substitute source-token units as dollars: doing so
        # can turn e.g. a 1 ETH trade into a "$1" denominator and massively
        # oversize a follower's token amount. Keep the activity in the public
        # track record, but do not create executable follower signals.
        if amount_usd <= 0:
            logger.warning("Copy signal skipped for swap %s: USD notional unavailable", swap.id)
            return []

        # Award points only once the trade is actually eligible for follower
        # signals; an unpriced event must not become a zero-cost points faucet.
        if created_trader_trade:
            points_service.award_points(
                user_id=trader_id,
                action="get_copied",
                amount=POINT_ACTIONS["get_copied"]["points"],
                description="Trade recorded for copying",
            )

        notified_users = []

        with get_session() as session:
            followers = (
                session.query(CopyFollow)
                .filter(
                    CopyFollow.trader_id == trader_id, CopyFollow.is_active == True  # noqa: E712
                )  # noqa: E712
                # Serialize budget reservations for each follow. Without this,
                # two trader events could both observe the same remaining daily
                # budget and each schedule an automatic copy.
                .with_for_update()
                .all()
            )

            # Computed once per trade (not per follower) — reused by the
            # min_wallet_pnl_pct filter below and cached across calls.
            wallet_pnl_pct = self.get_wallet_pnl_pct(trader_id, session=session)

            for follow in followers:
                chains_filter = getattr(follow, "chains_filter", None)
                if chains_filter:
                    allowed_chains = {
                        chain.strip().lower() for chain in chains_filter.split(",") if chain.strip()
                    }
                    if allowed_chains and (
                        swap.from_chain.lower() not in allowed_chains
                        or swap.to_chain.lower() not in allowed_chains
                    ):
                        continue

                # --- Advanced filters ---
                # min_trade_usd: skip if the original trade is below the follower's threshold
                if follow.min_trade_usd is not None and amount_usd < follow.min_trade_usd:
                    logger.debug(
                        "copy skipped for follow %s: below min trade size " "(%.2f < %.2f)",
                        follow.id,
                        amount_usd,
                        follow.min_trade_usd,
                    )
                    continue

                # min_wallet_pnl_pct: only copy/notify if the trader's own recent
                # REALIZED wallet performance clears the follower's bar. Computed
                # from settled TraderTrade PnL — see get_wallet_pnl_pct() — no
                # external analytics provider call.
                #
                # wallet_pnl_pct is None when there isn't enough realized-close
                # data yet (new trader / buys-only so far). That is "unknown",
                # not "failing" — fail OPEN (pass-through) rather than silently
                # dropping every copy for a trader we simply can't measure yet.
                if (
                    follow.min_wallet_pnl_pct is not None
                    and wallet_pnl_pct is not None
                    and wallet_pnl_pct < follow.min_wallet_pnl_pct
                ):
                    # A2: this is a paid feature — a follower's copy being
                    # silently dropped (with only a DEBUG log nobody looks at
                    # in production) is a support incident waiting to happen.
                    # logger.info + trader/follower ids + the compared values
                    # so this is at least diagnosable from normal log level.
                    logger.info(
                        "Copy skipped: trader %s wallet PnL %.2f%% below follower %s's "
                        "min_wallet_pnl_pct threshold %.2f%% (follow_id=%s)",
                        trader_id,
                        wallet_pnl_pct,
                        follow.follower_id,
                        follow.min_wallet_pnl_pct,
                        follow.id,
                    )
                    continue

                # min_token_age_hours: requires a token launch-timestamp source
                # (e.g. a DexScreener/Helius pair-creation lookup) that copy-trading
                # does not have wired up today, and we're deliberately NOT adding a
                # new external client just for this filter. Deferred — pass-through
                # (never blocks a copy on unknown data) until that data exists.

                copy_amount = follow.get_copy_amount(amount_usd)

                # Automatic copies reserve daily budget while still pending so
                # concurrent trader events cannot oversubscribe the configured
                # limit before the first on-chain execution finishes. Copied
                # rows count by execution date; pending rows count by creation.
                if follow.copy_mode == "auto":
                    follow.check_daily_limit(0)
                    day_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
                    reserved_usd = (
                        session.query(func.coalesce(func.sum(CopyTrade.copy_amount_usd), 0.0))
                        .filter(
                            CopyTrade.follow_id == follow.id,
                            or_(
                                and_(
                                    CopyTrade.status.in_(
                                        ["copied", "executing", "outcome_unknown"]
                                    ),
                                    CopyTrade.copied_at >= day_start,
                                ),
                                and_(
                                    CopyTrade.status.in_(["pending", "auto_pending"]),
                                    CopyTrade.created_at >= day_start,
                                ),
                            ),
                        )
                        .scalar()
                    )
                    if float(reserved_usd or 0) + copy_amount > follow.daily_limit_usd:
                        continue
                elif not follow.check_daily_limit(copy_amount):
                    continue

                copy_trade = (
                    session.query(CopyTrade)
                    .filter(
                        CopyTrade.original_swap_id == swap.id,
                        CopyTrade.follow_id == follow.id,
                        CopyTrade.copier_id == follow.follower_id,
                    )
                    .first()
                )
                if copy_trade:
                    if copy_trade.status in ["pending", "auto_pending", "notified"]:
                        notified_users.append(
                            {
                                "user_id": follow.follower_id,
                                "copy_trade_id": copy_trade.id,
                                # Recover authority from the persisted signal,
                                # never the follow's mutable current mode.
                                "copy_mode": (
                                    "auto" if copy_trade.status == "auto_pending" else "notify"
                                ),
                                "copy_amount": copy_trade.copy_amount_usd,
                            }
                        )
                    continue

                copy_trade = CopyTrade(
                    original_swap_id=swap.id,
                    trader_id=trader_id,
                    copier_id=follow.follower_id,
                    follow_id=follow.id,
                    from_token=swap.from_token,
                    to_token=swap.to_token,
                    from_chain=swap.from_chain,
                    to_chain=swap.to_chain,
                    trader_amount_usd=amount_usd,
                    copy_amount_usd=copy_amount,
                    # Persist whether this signal carried unattended authority.
                    # Follow settings can change before the event is processed,
                    # so deriving this later from mutable state is unsafe.
                    status="auto_pending" if follow.copy_mode == "auto" else "pending",
                )
                session.add(copy_trade)
                session.flush()

                notified_users.append(
                    {
                        "user_id": follow.follower_id,
                        "copy_trade_id": copy_trade.id,
                        "copy_mode": follow.copy_mode,
                        "copy_amount": copy_amount,
                    }
                )

        return notified_users

    async def handle_swap_submitted(self, swap_id: int, bot=None) -> List[dict]:
        """Record a submitted trader swap and process notify/auto-copy followers."""
        with get_session() as session:
            swap = session.query(SwapTransaction).filter(SwapTransaction.id == swap_id).first()
            if not swap:
                return []
            if swap.idempotency_key and swap.idempotency_key.startswith("copy_"):
                return []
            if swap.status not in [SwapStatus.SUBMITTED.value, SwapStatus.COMPLETED.value]:
                return []
            try:
                amount_usd = float(swap.from_amount_usd or 0)
            except (TypeError, ValueError):
                amount_usd = 0.0
            swap_data = {
                "user_id": swap.user_id,
                "from_chain": swap.from_chain,
                "to_chain": swap.to_chain,
                "from_token": swap.from_token,
                "to_token": swap.to_token,
                "amount_usd": amount_usd,
            }

        followers = await self.record_trade(
            trader_id=swap.user_id,
            swap=swap,
            amount_usd=amount_usd,
        )

        processed = []
        for follower_info in followers:
            follower_id = follower_info["user_id"]
            copy_trade_id = follower_info["copy_trade_id"]
            if follower_info["copy_mode"] == "auto":
                success, message, swap_id = await self.execute_copy(follower_id, copy_trade_id)
                result_status = (
                    "copied"
                    if success is True
                    else "outcome_unknown" if success is None else "failed"
                )
                processed.append(
                    {
                        **follower_info,
                        "status": result_status,
                        "message": message,
                        "swap_id": swap_id,
                    }
                )
                await self._notify_copy_result(bot, follower_info, swap_data, success, message)
            elif follower_info["copy_mode"] == "paper":
                await self._execute_paper_copy(
                    follower_id, copy_trade_id, bot, follower_info, swap_data
                )
                processed.append({**follower_info, "status": "paper"})
            else:
                self.mark_notified(follower_id, copy_trade_id)
                processed.append({**follower_info, "status": "notified"})
                await self._notify_copy_signal(bot, follower_info, swap_data)

        return processed

    async def handle_swap_submitted_event(self, envelope: dict) -> None:
        """Event-bus adapter for submitted swap events."""
        data = envelope.get("event", {}).get("data", {})
        swap_id = data.get("swapId") or data.get("swap_id")
        if not swap_id:
            return
        await self.handle_swap_submitted(int(swap_id))

    async def execute_copy(
        self,
        copier_id: int,
        copy_trade_id: int,
        custom_amount: Optional[float] = None,
    ) -> Tuple[Optional[bool], str, Optional[int]]:
        """
        Execute a copy trade.

        Returns:
            Tuple of (success, message, swap_id). ``success`` is None when a
            submission may have landed but confirmation is unknown; callers
            must not present that state as failed or invite a retry.
        """
        with get_session() as session:
            copy_trade = (
                session.query(CopyTrade)
                .filter(CopyTrade.id == copy_trade_id, CopyTrade.copier_id == copier_id)
                .first()
            )

            if not copy_trade:
                return False, "Copy trade not found.", None

            if copy_trade.status not in ["pending", "auto_pending", "notified"]:
                return False, f"Trade already {copy_trade.status}.", None

            follow = session.query(CopyFollow).filter(CopyFollow.id == copy_trade.follow_id).first()
            if not follow or not follow.is_active:
                copy_trade.status = "failed"
                copy_trade.failure_reason = "Trader follow is no longer active"
                return False, copy_trade.failure_reason, None

            if copy_trade.status == "auto_pending":
                automatic = True
            elif copy_trade.status == "notified":
                automatic = False
            else:
                # Generic pending predates the explicit authority snapshot and
                # is ambiguous. Never upgrade it to unattended spend from a
                # mutable follow setting.
                copy_trade.status = "failed"
                copy_trade.failure_reason = "Pending copy requires explicit user confirmation"
                return False, copy_trade.failure_reason, None

            # Get the original swap details
            original_swap = (
                session.query(SwapTransaction)
                .filter(SwapTransaction.id == copy_trade.original_swap_id)
                .first()
            )

            if not original_swap:
                copy_trade.status = "failed"
                copy_trade.failure_reason = "Original swap not found"
                return False, "Original swap not found.", None

            try:
                original_notional_usd = float(original_swap.from_amount_usd or 0)
            except (TypeError, ValueError):
                original_notional_usd = 0.0
            if original_notional_usd <= 0:
                copy_trade.status = "failed"
                copy_trade.failure_reason = "Original trade USD notional is unavailable"
                return False, copy_trade.failure_reason, None

            target_copy_amount = float(custom_amount or copy_trade.copy_amount_usd)
            if target_copy_amount <= 0:
                copy_trade.status = "failed"
                copy_trade.failure_reason = "Copy amount must be positive"
                return False, copy_trade.failure_reason, None
            source_chain = get_chain_by_name(copy_trade.from_chain)
            if not source_chain:
                copy_trade.status = "failed"
                copy_trade.failure_reason = f"Unsupported source chain {copy_trade.from_chain}"
                return False, copy_trade.failure_reason, None
            destination_chain = get_chain_by_name(copy_trade.to_chain)
            if not destination_chain:
                copy_trade.status = "failed"
                copy_trade.failure_reason = f"Unsupported destination chain {copy_trade.to_chain}"
                return False, copy_trade.failure_reason, None
            if source_chain.chain_type != destination_chain.chain_type:
                copy_trade.status = "failed"
                copy_trade.failure_reason = (
                    "Cross-wallet-family copy requires an explicit destination wallet"
                )
                return False, copy_trade.failure_reason, None

            wallet = (
                session.query(Wallet)
                .filter(
                    Wallet.user_id == copier_id,
                    Wallet.chain_type == source_chain.chain_type.value,
                    Wallet.is_active == True,  # noqa: E712
                    Wallet.is_default == True,  # noqa: E712
                )
                .first()
            )
            if not wallet:
                wallet = (
                    session.query(Wallet)
                    .filter(
                        Wallet.user_id == copier_id,
                        Wallet.chain_type == source_chain.chain_type.value,
                        Wallet.is_active == True,  # noqa: E712
                    )
                    .order_by(Wallet.id.asc())
                    .first()
                )

            if not wallet:
                copy_trade.status = "failed"
                copy_trade.failure_reason = f"No active {source_chain.chain_type.value} wallet"
                return False, copy_trade.failure_reason, None

            if not wallet.can_server_sign:
                copy_trade.status = "failed"
                copy_trade.failure_reason = "Copy execution requires a Suwappu signing wallet"
                return False, copy_trade.failure_reason, None

            slippage = float(follow.max_slippage_percent or 1.0)

        if automatic:
            # Re-check the future-spend authority at execution time. A subscriber
            # can downgrade/expire or change wallets after saving the copy rule;
            # a stale rule must never retain broader authority than the account
            # has right now.
            from bot.models.subscription import SubscriptionTier
            from bot.services.x402_service import x402_service

            tier = await x402_service.get_tier(copier_id)
            if tier not in {
                SubscriptionTier.PRO,
                SubscriptionTier.PREMIUM,
                SubscriptionTier.ENTERPRISE,
            }:
                reason = "Automatic copy requires an active Pro subscription"
                self._mark_copy_failed(copy_trade_id, reason)
                return False, reason, None

        # Copy allocations are USD-denominated. SwapTransaction.from_amount is
        # deliberately stored in raw base units by SwapEngine (wei/lamports/
        # token atoms), while get_quote() accepts a human-readable token amount.
        # Derive the source quantity from a current USD price instead of scaling
        # the leader's raw integer; this also keeps fixed/percentage copy sizing
        # tied to the user's configured dollar allocation as prices move.
        source_unit_usd = await spending_limit_service.usd_value(copy_trade.from_token, 1.0)
        if source_unit_usd is None or source_unit_usd <= 0:
            reason = "Current source-token USD price is unavailable"
            self._mark_copy_failed(copy_trade_id, reason)
            return False, reason, None
        source_amount = target_copy_amount / float(source_unit_usd)
        if source_amount <= 0:
            reason = "Unable to derive a safe source-token copy amount"
            self._mark_copy_failed(copy_trade_id, reason)
            return False, reason, None

        # Execute the swap via swap engine
        from bot.services.swap_engine import SwapEngine

        swap_engine = SwapEngine()

        execution_claimed = False
        try:
            quote = await swap_engine.get_quote(
                from_chain=copy_trade.from_chain,
                to_chain=copy_trade.to_chain,
                from_token=copy_trade.from_token,
                to_token=copy_trade.to_token,
                amount=source_amount,
                from_address=wallet.address,
                to_address=wallet.address,
                slippage=slippage,
                user_id=copy_trade.copier_id,
            )

            # Re-price the exact human input returned in the quote immediately
            # before the locked claim. Limits and accounting below must reserve
            # what this copy is actually about to spend, not the stale leader
            # notional or the originally requested allocation.
            execution_notional_usd = await spending_limit_service.usd_value(
                quote.from_token, quote.from_amount_human
            )
            if execution_notional_usd is None or execution_notional_usd <= 0:
                reason = "Unable to verify copy USD notional before execution"
                self._mark_copy_failed(copy_trade_id, reason)
                return False, reason, None
            copy_amount = float(execution_notional_usd)

            # Quote generation is asynchronous, so mutable authorization may
            # have changed while it was in flight. Re-check Pro, then atomically
            # revalidate the follow/settings/wallet and claim this copy before
            # any signing or submission begins.
            if automatic:
                tier = await x402_service.get_tier(copier_id)
                if tier not in {
                    SubscriptionTier.PRO,
                    SubscriptionTier.PREMIUM,
                    SubscriptionTier.ENTERPRISE,
                }:
                    reason = "Automatic copy requires an active Pro subscription"
                    self._mark_copy_failed(copy_trade_id, reason)
                    return False, reason, None

            claimed, claim_error = self._claim_copy_for_execution(
                copier_id=copier_id,
                copy_trade_id=copy_trade_id,
                wallet_id=wallet.id,
                automatic=automatic,
                copy_amount=copy_amount,
                slippage=slippage,
            )
            if not claimed:
                return False, claim_error, None
            execution_claimed = True

            swap_tx = await swap_engine.execute_swap(
                quote=quote,
                wallet_id=wallet.id,
                user_id=copier_id,
                idempotency_key=f"copy_{copy_trade_id}_{copier_id}",
                automated=True,
            )

            # A simulated (dry-run chain) fill never moved real funds, so it must
            # never credit real copy-volume/leaderboard stats or points below.
            # Safe today only because a copy runs on the leader's (real) chain so
            # swap_tx is never simulated here; this guard keeps it safe if the
            # fan-out is ever re-wired to a path where a simulated row can reach.
            # Bookkeeping (status/copy_swap_id) still records the simulated copy;
            # only the real-value increments and points are gated.
            is_simulated = getattr(swap_tx, "simulated", False)

            with get_session() as session:
                copy_trade = session.query(CopyTrade).filter(CopyTrade.id == copy_trade_id).first()
                copy_trade.copy_swap_id = swap_tx.id
                copy_trade.status = "copied"
                copy_trade.copied_at = datetime.now(timezone.utc)

                trader_id = copy_trade.trader_id
                if not is_simulated:
                    follow = (
                        session.query(CopyFollow)
                        .filter(CopyFollow.id == copy_trade.follow_id)
                        .first()
                    )
                    if follow:
                        follow.daily_copied_usd += copy_amount
                        follow.total_copied_trades += 1
                        follow.total_copied_volume += copy_amount

                    trader_profile = (
                        session.query(TraderProfile)
                        .filter(TraderProfile.user_id == trader_id)
                        .first()
                    )
                    if trader_profile:
                        trader_profile.times_copied += 1
                        trader_profile.total_copy_volume_usd += copy_amount

            # Whole-product points: reward BOTH legs of a successful copy trade —
            # the copier (copy_trade) and the leader being copied (get_copied).
            # Wrapped so a points failure never marks the (already-executed) copy
            # swap as failed via the outer except. Volume proxy = copy_amount;
            # neither side carries a separate Suwappu fee here (the underlying
            # swap's own fee is rewarded on the swap path), so no fee_usd.
            if not is_simulated:
                try:
                    points_service.award_points(
                        user_id=copier_id,
                        action="copy_trade",
                        description="Copied trade from trader",
                        swap_id=swap_tx.id,
                        metadata={"amount_usd": float(copy_amount)},
                    )
                except Exception as e:
                    logger.error(f"copy_trade points award failed for copier {copier_id}: {e}")

                try:
                    if trader_id:
                        points_service.award_points(
                            user_id=int(trader_id),
                            action="get_copied",
                            description="Your trade was copied",
                            swap_id=swap_tx.id,
                            metadata={"amount_usd": float(copy_amount)},
                        )
                except Exception as e:
                    logger.error(f"get_copied points award failed for leader {trader_id}: {e}")

            return True, "Trade copied successfully!", swap_tx.id

        except Exception as e:
            logger.error(f"Copy trade failed for user {copier_id}: {e}")

            with get_session() as session:
                copy_trade = session.query(CopyTrade).filter(CopyTrade.id == copy_trade_id).first()
                if copy_trade:
                    # Once execution has been claimed, an RPC/provider error
                    # may have happened after broadcast. Preserve the budget
                    # reservation until reconciliation rather than allowing a
                    # later copy to spend the same daily allocation again.
                    if execution_claimed and copy_trade.status == "executing":
                        copy_trade.status = "outcome_unknown"
                    elif not execution_claimed:
                        copy_trade.status = "failed"
                    copy_trade.failure_reason = str(e)[:255]

            if execution_claimed:
                return (
                    None,
                    "Copy submission outcome is unknown. Do not retry until your wallet "
                    "or transaction history confirms whether it landed.",
                    None,
                )
            return False, f"Copy failed: {str(e)}", None

    @staticmethod
    def _mark_copy_failed(copy_trade_id: int, reason: str) -> None:
        """Persist a fail-closed pre-execution outcome for an auto-copy attempt."""
        with get_session() as session:
            copy_trade = session.query(CopyTrade).filter(CopyTrade.id == copy_trade_id).first()
            if copy_trade and copy_trade.status in [
                "pending",
                "auto_pending",
                "notified",
            ]:
                copy_trade.status = "failed"
                copy_trade.failure_reason = reason[:255]

    @staticmethod
    def _claim_copy_for_execution(
        *,
        copier_id: int,
        copy_trade_id: int,
        wallet_id: int,
        automatic: bool,
        copy_amount: float,
        slippage: float,
    ) -> Tuple[bool, str]:
        """Atomically revalidate mutable authority and claim one copy execution."""
        with get_session() as session:
            copy_trade = (
                session.query(CopyTrade)
                .filter(CopyTrade.id == copy_trade_id, CopyTrade.copier_id == copier_id)
                .with_for_update()
                .first()
            )
            if not copy_trade or copy_trade.status not in [
                "pending",
                "auto_pending",
                "notified",
            ]:
                return False, "Copy trade is no longer pending"

            def reject(reason: str) -> Tuple[bool, str]:
                copy_trade.status = "failed"
                copy_trade.failure_reason = reason[:255]
                return False, reason

            follow = (
                session.query(CopyFollow)
                .filter(CopyFollow.id == copy_trade.follow_id)
                .with_for_update()
                .first()
            )
            if not follow or not follow.is_active:
                return reject("Trader follow is no longer active")
            if automatic:
                if follow.copy_mode != "auto" or copy_trade.status != "auto_pending":
                    return reject("Automatic copy was disabled before execution")
            elif follow.copy_mode == "auto" or copy_trade.status != "notified":
                return reject("Copy mode changed before manual execution")

            source_chain = get_chain_by_name(copy_trade.from_chain)
            if not source_chain:
                return reject(f"Unsupported source chain {copy_trade.from_chain}")
            current_wallet = (
                session.query(Wallet)
                .filter(
                    Wallet.user_id == copier_id,
                    Wallet.chain_type == source_chain.chain_type.value,
                    Wallet.is_active == True,  # noqa: E712
                )
                .order_by(Wallet.is_default.desc(), Wallet.id.asc())
                .first()
            )
            if (
                not current_wallet
                or current_wallet.id != wallet_id
                or not current_wallet.can_server_sign
            ):
                return reject("Copy signing wallet changed before execution")

            chains_filter = getattr(follow, "chains_filter", None)
            if chains_filter:
                allowed_chains = {
                    chain.strip().lower() for chain in chains_filter.split(",") if chain.strip()
                }
                if allowed_chains and (
                    copy_trade.from_chain.lower() not in allowed_chains
                    or copy_trade.to_chain.lower() not in allowed_chains
                ):
                    return reject("Copy chain is no longer allowed")

            current_copy_cap = follow.get_copy_amount(float(copy_trade.trader_amount_usd or 0))
            if copy_amount > current_copy_cap + 1e-9:
                return reject("Copy amount exceeds the current per-trade limit")

            current_slippage = float(follow.max_slippage_percent or 1.0)
            if slippage > current_slippage + 1e-9:
                return reject("Copy slippage exceeds the current limit")

            day_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
            reserved_other = (
                session.query(func.coalesce(func.sum(CopyTrade.copy_amount_usd), 0.0))
                .filter(
                    CopyTrade.follow_id == follow.id,
                    CopyTrade.id != copy_trade.id,
                    or_(
                        and_(
                            CopyTrade.status.in_(["copied", "executing", "outcome_unknown"]),
                            CopyTrade.copied_at >= day_start,
                        ),
                        and_(
                            CopyTrade.status.in_(["pending", "auto_pending"]),
                            CopyTrade.created_at >= day_start,
                        ),
                    ),
                )
                .scalar()
            )
            if float(reserved_other or 0) + copy_amount > float(follow.daily_limit_usd or 0):
                return reject("Copy amount exceeds the current daily limit")

            copy_trade.copy_amount_usd = copy_amount
            copy_trade.status = "executing"
            # This is the execution-attempt timestamp. Successful execution
            # overwrites it below; ambiguous outcomes retain it so the daily
            # reservation expires predictably at the next UTC boundary.
            copy_trade.copied_at = datetime.now(timezone.utc)
            return True, ""

    def skip_copy(self, copier_id: int, copy_trade_id: int) -> bool:
        """Mark a copy trade as skipped."""
        with get_session() as session:
            copy_trade = (
                session.query(CopyTrade)
                .filter(CopyTrade.id == copy_trade_id, CopyTrade.copier_id == copier_id)
                .first()
            )

            if copy_trade and copy_trade.status in ["pending", "notified"]:
                copy_trade.status = "skipped"
                return True

        return False

    def mark_notified(self, copier_id: int, copy_trade_id: int) -> bool:
        """Mark a pending copy trade as notified."""
        with get_session() as session:
            copy_trade = (
                session.query(CopyTrade)
                .filter(CopyTrade.id == copy_trade_id, CopyTrade.copier_id == copier_id)
                .first()
            )

            if copy_trade and copy_trade.status == "pending":
                copy_trade.status = "notified"
                return True

        return False

    async def _notify_copy_signal(self, bot, follower_info: dict, swap_data: dict) -> None:
        if not bot:
            return
        try:
            follower = None
            with get_session() as session:
                follower = session.query(User).filter(User.id == follower_info["user_id"]).first()
                if follower:
                    user_settings = (
                        session.query(UserSettings)
                        .filter(UserSettings.user_id == follower.id)
                        .first()
                    )
                    if user_settings and not getattr(user_settings, "notify_copy_executed", True):
                        return
            if not follower or not follower.telegram_id:
                return
            await bot.send_message(
                chat_id=follower.telegram_id,
                text=(
                    f"Copy signal: {swap_data['from_token']} -> {swap_data['to_token']}\n"
                    f"Copy amount: ${follower_info['copy_amount']:.2f}"
                ),
            )
        except Exception as exc:
            logger.warning("Failed to send copy signal notification: %s", exc)

    async def _execute_paper_copy(
        self,
        copier_id: int,
        copy_trade_id: int,
        bot,
        follower_info: dict,
        swap_data: dict,
    ) -> None:
        """Record a paper copy trade (no real swap executed)."""
        # current_token_price_usd: ideally fetched from a price feed; use
        # the trader's per-unit price as a best-effort proxy for now.
        try:
            copy_amount = follower_info.get("copy_amount", 0.0)
            trader_amount = swap_data.get("amount_usd", 0.0)  # noqa: F841
            current_token_price_usd = None  # placeholder — wire up price feed if available

            with get_session() as session:
                copy_trade = session.query(CopyTrade).filter(CopyTrade.id == copy_trade_id).first()
                if copy_trade and copy_trade.status in ["pending", "notified"]:
                    copy_trade.status = "copied"
                    copy_trade.copied_at = datetime.now(timezone.utc)
                    copy_trade.paper_entry_price_usd = current_token_price_usd
                    copy_trade.copy_amount_usd = copy_amount

                follow = (
                    session.query(CopyFollow)
                    .filter(
                        CopyFollow.copier_id == copier_id
                        if hasattr(CopyFollow, "copier_id")
                        else CopyFollow.follower_id == copier_id
                    )
                    .filter(CopyFollow.id == copy_trade.follow_id if copy_trade else False)
                    .first()
                )
                if follow:
                    follow.total_copied_trades += 1
                    follow.total_copied_volume += copy_amount

            if bot:
                follower = None
                with get_session() as session:
                    follower = session.query(User).filter(User.id == copier_id).first()
                if follower and follower.telegram_id:
                    price_str = (
                        f"${current_token_price_usd:,.6f}"
                        if current_token_price_usd
                        else "market price"
                    )
                    await bot.send_message(
                        chat_id=follower.telegram_id,
                        text=(
                            f"Paper trade: would have bought "
                            f"{swap_data.get('to_token', '?')} at {price_str} "
                            f"(${copy_amount:.2f} allocation)"
                        ),
                    )
        except Exception as exc:
            logger.warning("Paper copy failed for user %s: %s", copier_id, exc)

    async def _notify_copy_result(
        self, bot, follower_info: dict, swap_data: dict, success: Optional[bool], message: str
    ) -> None:
        if not bot:
            return
        try:
            follower = None
            with get_session() as session:
                follower = session.query(User).filter(User.id == follower_info["user_id"]).first()
                if follower:
                    user_settings = (
                        session.query(UserSettings)
                        .filter(UserSettings.user_id == follower.id)
                        .first()
                    )
                    if user_settings and not getattr(user_settings, "notify_copy_executed", True):
                        return
            if not follower or not follower.telegram_id:
                return
            if success is True:
                prefix = "Auto-copy submitted"
            elif success is None:
                prefix = "Auto-copy outcome unknown — do not retry"
            else:
                prefix = "Auto-copy failed"
            await bot.send_message(
                chat_id=follower.telegram_id,
                text=f"{prefix}: {swap_data['from_token']} -> {swap_data['to_token']}\n{message}",
            )
        except Exception as exc:
            logger.warning("Failed to send copy result notification: %s", exc)

    # ==================== Discovery & Leaderboard ====================

    def get_top_traders(self, limit: int = 10) -> List[dict]:
        """Get top public traders by rank score."""
        with get_session() as session:
            profiles = (
                session.query(TraderProfile, User)
                .join(User, TraderProfile.user_id == User.id)
                .filter(
                    TraderProfile.is_public == True,  # noqa: E712
                    TraderProfile.total_trades >= 5,  # Minimum trades to appear
                )
                .order_by(desc(TraderProfile.rank_score))
                .limit(limit)
                .all()
            )

            # 30d REALIZED wallet PnL% (None = insufficient data, not 0) for
            # every trader on this page, from settled TraderTrade records —
            # see get_wallet_pnl_pct(). One grouped query covers every cache
            # miss instead of one aggregate query per row (was N+1 on a cold
            # cache). Reuses this open session.
            pnl_pct_by_trader = self._get_wallet_pnl_pct_bulk(
                [p.user_id for p, _ in profiles], session=session
            )

            return [
                {
                    "rank": i + 1,
                    "user_id": p.user_id,
                    "display_name": p.display_name or u.username or f"Trader{p.user_id}",
                    "avatar": p.avatar_emoji,
                    "total_trades": p.total_trades,
                    "win_rate": p.win_rate,
                    "total_pnl": p.total_pnl_usd,
                    "total_volume": p.total_volume_usd,
                    "follower_count": p.follower_count,
                    "times_copied": p.times_copied,
                    "pnl_pct": pnl_pct_by_trader.get(p.user_id),
                }
                for i, (p, u) in enumerate(profiles)
            ]

    def search_traders(self, query: str, limit: int = 10) -> List[dict]:
        """Search for traders by display name."""
        with get_session() as session:
            profiles = (
                session.query(TraderProfile, User)
                .join(User, TraderProfile.user_id == User.id)
                .filter(
                    TraderProfile.is_public == True,  # noqa: E712
                    TraderProfile.display_name.ilike(f"%{query}%"),  # noqa: E712
                )
                .limit(limit)
                .all()
            )

            return [
                {
                    "user_id": p.user_id,
                    "display_name": p.display_name,
                    "avatar": p.avatar_emoji,
                    "win_rate": p.win_rate,
                    "follower_count": p.follower_count,
                }
                for p, u in profiles
            ]

    def get_trader_stats(self, trader_id: int) -> Optional[dict]:
        """Get detailed stats for a trader."""
        with get_session() as session:
            profile = (
                session.query(TraderProfile).filter(TraderProfile.user_id == trader_id).first()
            )

            if not profile:
                return None

            # Get recent trades
            recent_trades = (
                session.query(TraderTrade)
                .filter(TraderTrade.trader_id == trader_id)
                .order_by(desc(TraderTrade.created_at))
                .limit(5)
                .all()
            )

            return {
                "profile": {
                    "display_name": profile.display_name,
                    "avatar": profile.avatar_emoji,
                    "bio": profile.bio,
                    "is_public": profile.is_public,
                },
                "stats": {
                    "total_trades": profile.total_trades,
                    "winning_trades": profile.winning_trades,
                    "win_rate": profile.win_rate,
                    "total_pnl": profile.total_pnl_usd,
                    "total_volume": profile.total_volume_usd,
                    "avg_trade_size": profile.avg_trade_size_usd,
                    "best_trade": profile.best_trade_pnl_usd,
                    "worst_trade": profile.worst_trade_pnl_usd,
                    # 30d REALIZED wallet PnL% (None = insufficient data), from
                    # settled TraderTrade records (cached).
                    "pnl_pct": self.get_wallet_pnl_pct(trader_id, session=session),
                },
                "social": {
                    "follower_count": profile.follower_count,
                    "times_copied": profile.times_copied,
                    "copy_volume": profile.total_copy_volume_usd,
                },
                "recent_trades": [
                    {
                        "from": t.from_token,
                        "to": t.to_token,
                        "amount": t.amount_usd,
                        "pnl": t.pnl_usd,
                        "date": t.created_at,
                        # Token launch age: no metadata/dexscreener client with cached
                        # creation timestamps exists in bot/services/ yet for copy-trading
                        # — deferred rather than adding a new external API client.
                        # Render "—" instead of a blank/broken cell until that's wired up.
                        "token_age": "—",
                    }
                    for t in recent_trades
                ],
            }

    # ==================== Formatting ====================

    def format_trader_card(self, trader_data: dict) -> str:
        """Format a trader's summary for display."""
        pnl_emoji = "📈" if trader_data.get("total_pnl", 0) >= 0 else "📉"
        return (
            f"{trader_data.get('avatar', '🦊')} *{trader_data['display_name']}*\n"
            f"├ 📊 {trader_data['total_trades']} trades\n"
            f"├ ✅ {trader_data['win_rate']:.1f}% win rate\n"
            f"├ {pnl_emoji} ${trader_data.get('total_pnl', 0):,.2f} PnL\n"
            f"└ 👥 {trader_data['follower_count']} followers\n"
        )

    def format_top_traders_message(self) -> str:
        """Format top traders leaderboard."""
        traders = self.get_top_traders(10)

        if not traders:
            return "🏆 *Top Traders*\n\nNo traders yet. Be the first to go public!"

        msg = "🏆 *Top Traders*\n\n"

        for t in traders:
            rank_emoji = (
                "🥇"
                if t["rank"] == 1
                else "🥈" if t["rank"] == 2 else "🥉" if t["rank"] == 3 else f"#{t['rank']}"
            )
            pnl_emoji = "📈" if t["total_pnl"] >= 0 else "📉"
            pnl_pct_display = format_wallet_pnl_pct(t.get("pnl_pct"))
            msg += (
                f"{rank_emoji} {t['avatar']} *{t['display_name']}*\n"
                f"    ✅ {t['win_rate']:.0f}% • {pnl_emoji} ${t['total_pnl']:,.0f} "
                f"({pnl_pct_display} 30d) • 👥 {t['follower_count']}\n\n"
            )

        msg += "_Go public to appear on this list!_"

        return msg

    def format_following_message(self, user_id: int) -> str:
        """Format user's following list."""
        following = self.get_following(user_id)

        if not following:
            return (
                "👥 *Following*\n\n"
                "You're not following anyone yet.\n\n"
                "Use /traders to find traders to follow!"
            )

        msg = f"👥 *Following* ({len(following)}/{MAX_FOLLOWS})\n\n"

        for f in following:
            mode_emoji = (
                "🔔" if f["copy_mode"] == "notify" else "📄" if f["copy_mode"] == "paper" else "🤖"
            )
            pnl_emoji = "📈" if f["copy_pnl"] >= 0 else "📉"
            msg += (
                f"{f['avatar']} *{f['display_name']}*\n"
                f"├ {mode_emoji} ${f['copy_amount']:.0f} per trade\n"
                f"├ 📊 {f['total_copied']} copied\n"
                f"└ {pnl_emoji} ${f['copy_pnl']:,.2f} PnL\n\n"
            )

        return msg


# Global instance
copy_service = CopyService()
