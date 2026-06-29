"""Copy Trading service for social trading features.

Handles:
- Trader profile management
- Following/unfollowing traders
- Copy trade notifications
- Auto-copy execution
- Leaderboard and discovery
"""

import logging
from typing import Optional, List, Tuple
from datetime import datetime, timezone, timedelta

from sqlalchemy import func, desc, and_
from sqlalchemy.orm import Session

from bot.config.chains import get_chain_by_name
from bot.models.user import User, Wallet
from bot.models.favorites import UserSettings
from bot.models.swap import SwapStatus, SwapTransaction
from bot.models.copy_trading import (
    TraderProfile,
    CopyFollow,
    CopyTrade,
    CopyNotification,
    TraderTrade,
    TraderPosition,
)
from bot.services.points_service import points_service, POINT_ACTIONS
from database.db import get_session

logger = logging.getLogger(__name__)


# Constants
MAX_FOLLOWS = 5  # Max traders a user can follow
DEFAULT_COPY_AMOUNT = 10.0  # Default fixed copy amount in USD


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
                return True, "Profile is now public! Others can follow your trades."

            profile.is_public = not profile.is_public
            new_status = profile.is_public

        if new_status:
            return True, "Profile is now public! Others can follow your trades."
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
                .filter(TraderProfile.user_id == trader_id, TraderProfile.is_public == True)
                .first()
            )

            if not trader_profile:
                return False, "This trader doesn't have a public profile."

            # Check follow limit
            follow_count = (
                session.query(func.count(CopyFollow.id))
                .filter(CopyFollow.follower_id == follower_id, CopyFollow.is_active == True)
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
                    CopyFollow.is_active == True,
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
                    CopyFollow.is_active == True,
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
                .filter(CopyFollow.follower_id == user_id, CopyFollow.is_active == True)
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
                .filter(CopyFollow.trader_id == trader_id, CopyFollow.is_active == True)
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

                # Realized PnL via average-cost basis: the sell side realizes PnL
                # against the trader's tracked cost; the buy side adds to it.
                pnl, pnl_pct, is_win = self._settle_pnl(session, trader_id, swap, amount_usd)
                trader_trade.pnl_usd = pnl
                trader_trade.pnl_percent = pnl_pct
                trader_trade.is_winning = is_win
                if pnl != 0.0:
                    trader_trade.is_closed = True
                    trader_trade.closed_at = datetime.utcnow()
                # update_stats rolls up total_trades/volume/pnl/win_rate/best/worst/rank.
                profile.update_stats(pnl, amount_usd, is_win)

        # Award points to trader for potential copy trades
        if created_trader_trade and profile.is_public:
            points_service.award_points(
                user_id=trader_id,
                action="get_copied",
                amount=POINT_ACTIONS["get_copied"]["points"],
                description="Trade recorded for copying",
            )

        # Notify followers if profile is public
        if not profile.is_public:
            return []

        notified_users = []

        with get_session() as session:
            followers = (
                session.query(CopyFollow)
                .filter(CopyFollow.trader_id == trader_id, CopyFollow.is_active == True)
                .all()
            )

            for follow in followers:
                chains_filter = getattr(follow, "chains_filter", None)
                if chains_filter:
                    allowed_chains = {
                        chain.strip().lower() for chain in chains_filter.split(",") if chain.strip()
                    }
                    if allowed_chains and swap.from_chain.lower() not in allowed_chains:
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

                # min_wallet_pnl_pct: requires external all-time PnL data — wired for
                # future implementation; pass-through for now.
                # TODO: fetch trader's all-time PnL% from an on-chain analytics provider
                # and compare against follow.min_wallet_pnl_pct when set.

                # min_token_age_hours: requires token launch timestamp lookup — wired for
                # future implementation; pass-through for now.
                # TODO: fetch token creation time (e.g. from DexScreener / Helius) and
                # compare swap.to_token age against follow.min_token_age_hours when set.

                copy_amount = follow.get_copy_amount(amount_usd)

                # Check daily limit
                if not follow.check_daily_limit(copy_amount):
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
                    if copy_trade.status in ["pending", "notified"]:
                        notified_users.append(
                            {
                                "user_id": follow.follower_id,
                                "copy_trade_id": copy_trade.id,
                                "copy_mode": follow.copy_mode,
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
                    status="pending",
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
            amount_usd = float(swap.from_amount_usd or swap.from_amount or 0)
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
                processed.append(
                    {
                        **follower_info,
                        "status": "copied" if success else "failed",
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
    ) -> Tuple[bool, str, Optional[int]]:
        """
        Execute a copy trade.

        Returns:
            Tuple of (success, message, swap_id)
        """
        with get_session() as session:
            copy_trade = (
                session.query(CopyTrade)
                .filter(CopyTrade.id == copy_trade_id, CopyTrade.copier_id == copier_id)
                .first()
            )

            if not copy_trade:
                return False, "Copy trade not found.", None

            if copy_trade.status not in ["pending", "notified"]:
                return False, f"Trade already {copy_trade.status}.", None

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

            copy_amount = float(custom_amount or copy_trade.copy_amount_usd)
            original_amount = self._copy_from_amount(original_swap, copy_trade, copy_amount)
            source_chain = get_chain_by_name(copy_trade.from_chain)
            if not source_chain:
                copy_trade.status = "failed"
                copy_trade.failure_reason = f"Unsupported source chain {copy_trade.from_chain}"
                return False, copy_trade.failure_reason, None

            wallet = (
                session.query(Wallet)
                .filter(
                    Wallet.user_id == copier_id,
                    Wallet.chain_type == source_chain.chain_type.value,
                    Wallet.is_active == True,
                    Wallet.is_default == True,
                )
                .first()
            )
            if not wallet:
                wallet = (
                    session.query(Wallet)
                    .filter(
                        Wallet.user_id == copier_id,
                        Wallet.chain_type == source_chain.chain_type.value,
                        Wallet.is_active == True,
                    )
                    .order_by(Wallet.id.asc())
                    .first()
                )

            if not wallet:
                copy_trade.status = "failed"
                copy_trade.failure_reason = f"No active {source_chain.chain_type.value} wallet"
                return False, copy_trade.failure_reason, None

            follow = session.query(CopyFollow).filter(CopyFollow.id == copy_trade.follow_id).first()

        # Execute the swap via swap engine
        from bot.services.swap_engine import SwapEngine

        swap_engine = SwapEngine()

        try:
            quote = await swap_engine.get_quote(
                from_chain=copy_trade.from_chain,
                to_chain=copy_trade.to_chain,
                from_token=copy_trade.from_token,
                to_token=copy_trade.to_token,
                amount=original_amount,
                from_address=wallet.address,
                to_address=wallet.address,
                slippage=(follow.max_slippage_percent if follow else 1.0),
                user_id=copy_trade.copier_id,
            )
            swap_tx = await swap_engine.execute_swap(
                quote=quote,
                wallet_id=wallet.id,
                user_id=copier_id,
                idempotency_key=f"copy_{copy_trade_id}_{copier_id}",
                automated=True,
            )

            with get_session() as session:
                copy_trade = session.query(CopyTrade).filter(CopyTrade.id == copy_trade_id).first()
                copy_trade.copy_swap_id = swap_tx.id
                copy_trade.status = "copied"
                copy_trade.copied_at = datetime.now(timezone.utc)

                follow = (
                    session.query(CopyFollow).filter(CopyFollow.id == copy_trade.follow_id).first()
                )
                if follow:
                    follow.daily_copied_usd += copy_amount
                    follow.total_copied_trades += 1
                    follow.total_copied_volume += copy_amount

                trader_id = copy_trade.trader_id
                trader_profile = (
                    session.query(TraderProfile).filter(TraderProfile.user_id == trader_id).first()
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
            try:
                points_service.award_points(
                    user_id=copier_id,
                    action="copy_trade",
                    description="Copied trade from trader",
                    swap_id=swap_tx.id,
                    metadata={"amount_usd": float(copy_amount)},
                )
            except Exception as e:
                logger.debug(f"copy_trade award skipped for copier {copier_id}: {e}")

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
                logger.debug(f"get_copied award skipped for leader {trader_id}: {e}")

            return True, "Trade copied successfully!", swap_tx.id

        except Exception as e:
            logger.error(f"Copy trade failed for user {copier_id}: {e}")

            with get_session() as session:
                copy_trade = session.query(CopyTrade).filter(CopyTrade.id == copy_trade_id).first()
                copy_trade.status = "failed"
                copy_trade.failure_reason = str(e)[:255]

            return False, f"Copy failed: {str(e)}", None

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

    def _copy_from_amount(
        self, original_swap: SwapTransaction, copy_trade: CopyTrade, copy_amount: float
    ) -> float:
        """Convert the configured copy allocation into source-token amount."""
        try:
            trader_amount = float(copy_trade.trader_amount_usd or 0)
            original_from_amount = float(original_swap.from_amount or 0)
        except (TypeError, ValueError):
            return copy_amount

        if trader_amount <= 0 or original_from_amount <= 0:
            return copy_amount

        return max(0.0, original_from_amount * (copy_amount / trader_amount))

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
            trader_amount = swap_data.get("amount_usd", 0.0)
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
        self, bot, follower_info: dict, swap_data: dict, success: bool, message: str
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
            prefix = "Auto-copy submitted" if success else "Auto-copy failed"
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
                    TraderProfile.is_public == True,
                    TraderProfile.total_trades >= 5,  # Minimum trades to appear
                )
                .order_by(desc(TraderProfile.rank_score))
                .limit(limit)
                .all()
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
                    TraderProfile.is_public == True, TraderProfile.display_name.ilike(f"%{query}%")
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
            msg += (
                f"{rank_emoji} {t['avatar']} *{t['display_name']}*\n"
                f"    ✅ {t['win_rate']:.0f}% • {pnl_emoji} ${t['total_pnl']:,.0f} • 👥 {t['follower_count']}\n\n"
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
