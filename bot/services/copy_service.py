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
from datetime import datetime, timedelta

from sqlalchemy import func, desc, and_
from sqlalchemy.orm import Session

from bot.models.user import User
from bot.models.swap import SwapTransaction
from bot.models.copy_trading import (
    TraderProfile, CopyFollow, CopyTrade, CopyNotification, TraderTrade
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
            profile = session.query(TraderProfile).filter(
                TraderProfile.user_id == user_id
            ).first()
            
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
            profile = session.query(TraderProfile).filter(
                TraderProfile.user_id == user_id
            ).first()
            
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
            profile = session.query(TraderProfile).filter(
                TraderProfile.user_id == user_id
            ).first()
            
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
            trader_profile = session.query(TraderProfile).filter(
                TraderProfile.user_id == trader_id,
                TraderProfile.is_public == True
            ).first()
            
            if not trader_profile:
                return False, "This trader doesn't have a public profile."
            
            # Check follow limit
            follow_count = session.query(func.count(CopyFollow.id)).filter(
                CopyFollow.follower_id == follower_id,
                CopyFollow.is_active == True
            ).scalar()
            
            if follow_count >= MAX_FOLLOWS:
                return False, f"You can only follow up to {MAX_FOLLOWS} traders."
            
            # Check if already following
            existing = session.query(CopyFollow).filter(
                CopyFollow.follower_id == follower_id,
                CopyFollow.trader_id == trader_id
            ).first()
            
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
        mode_desc = "with notifications" if copy_mode == "notify" else "in auto mode"
        return True, f"Now following {trader_name} {mode_desc}!"
    
    def unfollow_trader(self, follower_id: int, trader_id: int) -> Tuple[bool, str]:
        """Unfollow a trader."""
        with get_session() as session:
            follow = session.query(CopyFollow).filter(
                CopyFollow.follower_id == follower_id,
                CopyFollow.trader_id == trader_id,
                CopyFollow.is_active == True
            ).first()
            
            if not follow:
                return False, "You're not following this trader."
            
            follow.is_active = False
            
            # Update follower count
            trader_profile = session.query(TraderProfile).filter(
                TraderProfile.user_id == trader_id
            ).first()
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
            follow = session.query(CopyFollow).filter(
                CopyFollow.follower_id == follower_id,
                CopyFollow.trader_id == trader_id,
                CopyFollow.is_active == True
            ).first()
            
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
            follows = session.query(CopyFollow, TraderProfile).join(
                TraderProfile, CopyFollow.trader_id == TraderProfile.user_id
            ).filter(
                CopyFollow.follower_id == user_id,
                CopyFollow.is_active == True
            ).all()
            
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
            follows = session.query(CopyFollow, User).join(
                User, CopyFollow.follower_id == User.id
            ).filter(
                CopyFollow.trader_id == trader_id,
                CopyFollow.is_active == True
            ).all()
            
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
        with get_session() as session:
            profile = session.query(TraderProfile).filter(
                TraderProfile.user_id == trader_id
            ).first()
            
            if not profile:
                profile = TraderProfile(user_id=trader_id, is_public=False)
                session.add(profile)
            
            # Record the trade
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
            
            # Update stats (assume neutral PnL until closed)
            profile.total_trades += 1
            profile.total_volume_usd += amount_usd
            profile.avg_trade_size_usd = profile.total_volume_usd / profile.total_trades
        
        # Award points to trader for potential copy trades
        if profile.is_public:
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
            followers = session.query(CopyFollow).filter(
                CopyFollow.trader_id == trader_id,
                CopyFollow.is_active == True
            ).all()
            
            for follow in followers:
                # Create copy trade record
                copy_amount = follow.get_copy_amount(amount_usd)
                
                # Check daily limit
                if not follow.check_daily_limit(copy_amount):
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
                
                notified_users.append({
                    "user_id": follow.follower_id,
                    "copy_trade_id": copy_trade.id,
                    "copy_mode": follow.copy_mode,
                    "copy_amount": copy_amount,
                })
        
        return notified_users
    
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
            copy_trade = session.query(CopyTrade).filter(
                CopyTrade.id == copy_trade_id,
                CopyTrade.copier_id == copier_id
            ).first()
            
            if not copy_trade:
                return False, "Copy trade not found.", None
            
            if copy_trade.status not in ["pending", "notified"]:
                return False, f"Trade already {copy_trade.status}.", None
            
            # Get the original swap details
            original_swap = session.query(SwapTransaction).filter(
                SwapTransaction.id == copy_trade.original_swap_id
            ).first()
            
            if not original_swap:
                copy_trade.status = "failed"
                copy_trade.failure_reason = "Original swap not found"
                return False, "Original swap not found.", None
            
            copy_amount = custom_amount or copy_trade.copy_amount_usd
            
            # Update follow daily tracking
            follow = session.query(CopyFollow).filter(
                CopyFollow.id == copy_trade.follow_id
            ).first()
            if follow:
                follow.daily_copied_usd += copy_amount
                follow.total_copied_trades += 1
                follow.total_copied_volume += copy_amount
            
            # Update trader profile
            trader_profile = session.query(TraderProfile).filter(
                TraderProfile.user_id == copy_trade.trader_id
            ).first()
            if trader_profile:
                trader_profile.times_copied += 1
                trader_profile.total_copy_volume_usd += copy_amount
        
        # Execute the swap via swap engine
        from bot.services.swap_engine import SwapEngine
        swap_engine = SwapEngine()
        
        try:
            # Create swap request matching original
            swap_tx = await swap_engine.execute_swap(
                user_id=copier_id,
                from_token=copy_trade.from_token,
                to_token=copy_trade.to_token,
                amount=copy_amount,
                from_chain=copy_trade.from_chain,
                to_chain=copy_trade.to_chain,
                idempotency_key=f"copy_{copy_trade_id}_{copier_id}",
            )
            
            with get_session() as session:
                copy_trade = session.query(CopyTrade).filter(
                    CopyTrade.id == copy_trade_id
                ).first()
                copy_trade.copy_swap_id = swap_tx.id
                copy_trade.status = "copied"
                copy_trade.copied_at = datetime.utcnow()
            
            # Award points to copier
            points_service.award_points(
                user_id=copier_id,
                action="copy_trade",
                description=f"Copied trade from trader",
                swap_id=swap_tx.id,
            )
            
            return True, "Trade copied successfully!", swap_tx.id
            
        except Exception as e:
            logger.error(f"Copy trade failed for user {copier_id}: {e}")
            
            with get_session() as session:
                copy_trade = session.query(CopyTrade).filter(
                    CopyTrade.id == copy_trade_id
                ).first()
                copy_trade.status = "failed"
                copy_trade.failure_reason = str(e)[:255]
            
            return False, f"Copy failed: {str(e)}", None
    
    def skip_copy(self, copier_id: int, copy_trade_id: int) -> bool:
        """Mark a copy trade as skipped."""
        with get_session() as session:
            copy_trade = session.query(CopyTrade).filter(
                CopyTrade.id == copy_trade_id,
                CopyTrade.copier_id == copier_id
            ).first()
            
            if copy_trade and copy_trade.status in ["pending", "notified"]:
                copy_trade.status = "skipped"
                return True
        
        return False
    
    # ==================== Auto-Sell Mirroring ====================

    async def mirror_sell_trade(
        self,
        trader_id: int,
        swap: SwapTransaction,
        amount_usd: float,
    ) -> List[int]:
        """
        When a trader sells a token, mirror the sell for all auto-copy followers
        who have auto_sell_enabled and hold that token.

        Returns list of follower user IDs that received sell copy trades.
        """
        mirrored_users = []

        with get_session() as session:
            # Find active followers with auto copy mode and auto-sell enabled
            followers = session.query(CopyFollow).filter(
                CopyFollow.trader_id == trader_id,
                CopyFollow.is_active == True,
                CopyFollow.copy_mode == "auto",
                CopyFollow.auto_sell_enabled == True,
            ).all()

            for follow in followers:
                # Check chains filter
                if follow.chains_filter:
                    allowed_chains = [c.strip().lower() for c in follow.chains_filter.split(",")]
                    if swap.from_chain.lower() not in allowed_chains:
                        continue

                copy_amount = follow.get_copy_amount(amount_usd)

                if not follow.check_daily_limit(copy_amount):
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

                mirrored_users.append(follow.follower_id)

        return mirrored_users

    # ==================== Discovery & Leaderboard ====================

    def get_top_traders(
        self,
        limit: int = 10,
        min_trades: Optional[int] = None,
        min_win_rate: Optional[float] = None,
        chain: Optional[str] = None,
    ) -> List[dict]:
        """Get top public traders by rank score with optional filters."""
        with get_session() as session:
            query = session.query(TraderProfile, User).join(
                User, TraderProfile.user_id == User.id
            ).filter(
                TraderProfile.is_public == True,
                TraderProfile.total_trades >= (min_trades or 5),
            )

            if min_win_rate is not None:
                query = query.filter(TraderProfile.win_rate >= min_win_rate)

            if chain:
                # Filter traders who have recent trades on this chain
                query = query.filter(
                    TraderProfile.user_id.in_(
                        session.query(TraderTrade.trader_id).filter(
                            TraderTrade.from_chain == chain
                        ).distinct()
                    )
                )

            profiles = query.order_by(
                desc(TraderProfile.rank_score)
            ).limit(limit).all()

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
            profiles = session.query(TraderProfile, User).join(
                User, TraderProfile.user_id == User.id
            ).filter(
                TraderProfile.is_public == True,
                TraderProfile.display_name.ilike(f"%{query}%")
            ).limit(limit).all()
            
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
            profile = session.query(TraderProfile).filter(
                TraderProfile.user_id == trader_id
            ).first()
            
            if not profile:
                return None
            
            # Get recent trades
            recent_trades = session.query(TraderTrade).filter(
                TraderTrade.trader_id == trader_id
            ).order_by(
                desc(TraderTrade.created_at)
            ).limit(5).all()
            
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
                ]
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
            rank_emoji = "🥇" if t["rank"] == 1 else "🥈" if t["rank"] == 2 else "🥉" if t["rank"] == 3 else f"#{t['rank']}"
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
            mode_emoji = "🔔" if f["copy_mode"] == "notify" else "🤖"
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

