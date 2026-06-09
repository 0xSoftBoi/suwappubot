"""Points/XP service for gamified user engagement.

Handles:
- Point earning (swaps, check-ins, referrals, etc.)
- Level progression
- Reward redemption
- Leaderboards
- Milestone tracking
"""

import logging
from typing import Optional, List, Tuple
from datetime import datetime, timezone, timedelta
from decimal import Decimal

from sqlalchemy import func, desc
from sqlalchemy.orm import Session

from bot.models.user import User
from bot.models.points import (
    UserPoints, PointTransaction, PointRedemption, Milestone, UserMilestone, Reward,
    LEVELS, POINT_ACTIONS, DEFAULT_MILESTONES, DEFAULT_REWARDS
)
from database.db import get_session

logger = logging.getLogger(__name__)


class PointsService:
    """Service for managing user points, XP, and rewards."""
    
    def get_or_create_points_account(self, user_id: int) -> UserPoints:
        """Get or create a points account for a user."""
        with get_session() as session:
            account = session.query(UserPoints).filter(
                UserPoints.user_id == user_id
            ).first()
            
            if account:
                return account
            
            # Create new account
            account = UserPoints(
                user_id=user_id,
                total_points_earned=0,
                current_points=0,
                xp=0,
                level="bronze",
                daily_streak=0,
            )
            session.add(account)
            session.flush()
            account_id = account.id
        
        with get_session() as session:
            return session.query(UserPoints).filter(UserPoints.id == account_id).first()
    
    def award_points(
        self,
        user_id: int,
        action: str,
        amount: Optional[int] = None,
        description: Optional[str] = None,
        swap_id: Optional[int] = None,
        referral_id: Optional[int] = None,
        metadata: Optional[dict] = None,
    ) -> Tuple[int, Optional[str]]:
        """
        Award points to a user for an action.
        
        Args:
            user_id: User to award points to
            action: Action type (from POINT_ACTIONS)
            amount: Override default amount (optional)
            description: Custom description (optional)
            swap_id: Related swap ID (optional)
            referral_id: Related referral ID (optional)
            metadata: Additional data (optional)
            
        Returns:
            Tuple of (points_awarded, new_level_if_leveled_up)
        """
        action_info = POINT_ACTIONS.get(action, {})
        points = amount if amount is not None else action_info.get("points", 0)
        
        if points <= 0:
            return 0, None
        
        with get_session() as session:
            # Get or create account
            account = session.query(UserPoints).filter(
                UserPoints.user_id == user_id
            ).first()
            
            if not account:
                account = UserPoints(user_id=user_id)
                session.add(account)
                session.flush()
            
            # Update points
            account.total_points_earned += points
            account.current_points += points
            account.xp += points
            
            # Check for level up
            new_level = account.check_level_up()
            
            # Record transaction
            tx = PointTransaction(
                user_id=user_id,
                amount=points,
                action=action,
                description=description or action_info.get("description", action),
                swap_id=swap_id,
                referral_id=referral_id,
                extra_data=metadata,
            )
            session.add(tx)
        
        logger.info(f"Awarded {points} points to user {user_id} for {action}")
        
        if new_level:
            logger.info(f"User {user_id} leveled up to {new_level}!")
        
        return points, new_level
    
    def award_swap_points(
        self,
        user_id: int,
        swap_amount_usd: float,
        swap_id: int,
    ) -> Tuple[int, bool, Optional[str]]:
        """
        Award points for completing a swap.
        
        Returns:
            Tuple of (points_awarded, is_first_swap_today, new_level)
        """
        # Calculate points: 1 point per $10
        base_points = int(swap_amount_usd / 10)
        if base_points < 1:
            base_points = 1  # Minimum 1 point
        
        total_points = base_points
        is_first_today = False
        
        with get_session() as session:
            account = session.query(UserPoints).filter(
                UserPoints.user_id == user_id
            ).first()
            
            if not account:
                account = UserPoints(user_id=user_id)
                session.add(account)
                session.flush()
            
            # Check if first swap of the day
            today = datetime.now(timezone.utc).date()
            if account.last_swap_date is None or account.last_swap_date.date() < today:
                is_first_today = True
                total_points += POINT_ACTIONS["first_swap_daily"]["points"]
            
            # Update account stats
            account.last_swap_date = datetime.now(timezone.utc)
            account.total_swaps += 1
            account.total_volume_usd += swap_amount_usd
        
        # Award points
        _, new_level = self.award_points(
            user_id=user_id,
            action="swap",
            amount=total_points,
            description=f"Swap ${swap_amount_usd:.2f}" + (" + daily bonus" if is_first_today else ""),
            swap_id=swap_id,
            metadata={"amount_usd": swap_amount_usd, "first_today": is_first_today},
        )
        
        # Check milestones
        self._check_milestones(user_id)
        
        return total_points, is_first_today, new_level
    
    def daily_checkin(self, user_id: int) -> Tuple[int, int, bool, Optional[str]]:
        """
        Process daily check-in.
        
        Returns:
            Tuple of (points_earned, current_streak, streak_continued, new_level)
        """
        with get_session() as session:
            account = session.query(UserPoints).filter(
                UserPoints.user_id == user_id
            ).first()
            
            if not account:
                account = UserPoints(user_id=user_id)
                session.add(account)
                session.flush()
            
            today = datetime.now(timezone.utc).date()
            yesterday = today - timedelta(days=1)
            
            # Check if already checked in today
            if account.last_checkin and account.last_checkin.date() == today:
                return 0, account.daily_streak, False, None
            
            # Calculate streak
            streak_continued = False
            if account.last_checkin and account.last_checkin.date() == yesterday:
                account.daily_streak += 1
                streak_continued = True
            else:
                account.daily_streak = 1
            
            # Update longest streak
            if account.daily_streak > account.longest_streak:
                account.longest_streak = account.daily_streak
            
            account.last_checkin = datetime.now(timezone.utc)
        
        # Calculate points (base + streak bonus)
        base_points = POINT_ACTIONS["checkin"]["points"]
        streak_bonus = account.daily_streak * POINT_ACTIONS["streak_bonus"]["points"]
        total_points = base_points + streak_bonus
        
        # Award points
        _, new_level = self.award_points(
            user_id=user_id,
            action="checkin",
            amount=total_points,
            description=f"Day {account.daily_streak} check-in",
            metadata={"streak": account.daily_streak},
        )
        
        # Check streak milestones
        self._check_milestones(user_id)
        
        return total_points, account.daily_streak, streak_continued, new_level
    
    def award_referral_points(
        self,
        referrer_id: int,
        referee_id: int,
        action: str,  # "signup" or "first_swap"
    ) -> Tuple[int, Optional[str]]:
        """Award points for referral actions."""
        if action == "signup":
            points = POINT_ACTIONS["referral_signup"]["points"]
            desc = "Referral signed up"
        elif action == "first_swap":
            points = POINT_ACTIONS["referral_first_swap"]["points"]
            desc = "Referral completed first swap"
        else:
            return 0, None
        
        return self.award_points(
            user_id=referrer_id,
            action=f"referral_{action}",
            amount=points,
            description=desc,
            referral_id=referee_id,
        )
    
    def spend_points(
        self,
        user_id: int,
        amount: int,
        reward_type: str,
        reward_value: str,
    ) -> Tuple[bool, str]:
        """
        Spend points on a reward.
        
        Returns:
            Tuple of (success, message)
        """
        with get_session() as session:
            account = session.query(UserPoints).filter(
                UserPoints.user_id == user_id
            ).first()
            
            if not account:
                return False, "No points account found"
            
            if account.current_points < amount:
                return False, f"Not enough points. You have {account.current_points}, need {amount}"
            
            # Deduct points
            account.current_points -= amount
            account.points_spent += amount
            
            # Record redemption
            redemption = PointRedemption(
                user_id=user_id,
                points_spent=amount,
                reward_type=reward_type,
                reward_value=reward_value,
                status="completed",
                completed_at=datetime.now(timezone.utc),
            )
            session.add(redemption)
            
            # Record transaction (negative)
            tx = PointTransaction(
                user_id=user_id,
                amount=-amount,
                action="redemption",
                description=f"Redeemed: {reward_type}",
                extra_data={"reward_type": reward_type, "reward_value": reward_value},
            )
            session.add(tx)
        
        logger.info(f"User {user_id} spent {amount} points on {reward_type}")
        return True, f"Successfully redeemed {reward_type}!"
    
    def get_leaderboard(self, limit: int = 10) -> List[dict]:
        """Get top users by XP."""
        with get_session() as session:
            results = session.query(
                UserPoints, User
            ).join(
                User, UserPoints.user_id == User.id
            ).order_by(
                desc(UserPoints.xp)
            ).limit(limit).all()
            
            leaderboard = []
            for i, (points, user) in enumerate(results, 1):
                level_info = LEVELS.get(points.level, LEVELS["bronze"])
                leaderboard.append({
                    "rank": i,
                    "user_id": user.id,
                    "username": user.username or f"User{user.id}",
                    "xp": points.xp,
                    "level": points.level,
                    "level_emoji": level_info["emoji"],
                    "total_volume": points.total_volume_usd,
                })
            
            return leaderboard
    
    def get_user_rank(self, user_id: int) -> int:
        """Get user's rank on the leaderboard."""
        with get_session() as session:
            account = session.query(UserPoints).filter(
                UserPoints.user_id == user_id
            ).first()
            
            if not account:
                return 0
            
            rank = session.query(func.count(UserPoints.id)).filter(
                UserPoints.xp > account.xp
            ).scalar()
            
            return rank + 1
    
    def get_user_stats(self, user_id: int) -> dict:
        """Get comprehensive stats for a user."""
        account = self.get_or_create_points_account(user_id)
        rank = self.get_user_rank(user_id)
        level_info = LEVELS.get(account.level, LEVELS["bronze"])
        
        return {
            "current_points": account.current_points,
            "total_points_earned": account.total_points_earned,
            "xp": account.xp,
            "level": account.level,
            "level_name": level_info["name"],
            "level_emoji": level_info["emoji"],
            "fee_rate": level_info["fee"],
            "xp_to_next": account.xp_to_next_level(),
            "daily_streak": account.daily_streak,
            "longest_streak": account.longest_streak,
            "total_swaps": account.total_swaps,
            "total_volume": account.total_volume_usd,
            "rank": rank,
            "last_checkin": account.last_checkin,
        }
    
    def _check_milestones(self, user_id: int) -> List[str]:
        """Check and award any new milestones."""
        achieved = []
        
        with get_session() as session:
            account = session.query(UserPoints).filter(
                UserPoints.user_id == user_id
            ).first()
            
            if not account:
                return achieved
            
            # Get user's referral count
            from bot.models.user import User
            user = session.query(User).filter(User.id == user_id).first()
            referral_count = user.referral_count if user else 0
            
            # Get all milestones
            milestones = session.query(Milestone).filter(
                Milestone.is_active == True
            ).all()
            
            # Get already achieved milestones
            achieved_ids = set(
                m.milestone_id for m in session.query(UserMilestone).filter(
                    UserMilestone.user_id == user_id
                ).all()
            )
            
            for milestone in milestones:
                if milestone.id in achieved_ids:
                    continue
                
                # Check if milestone is achieved
                achieved_now = False
                if milestone.requirement_type == "swaps":
                    achieved_now = account.total_swaps >= milestone.requirement_value
                elif milestone.requirement_type == "volume":
                    achieved_now = account.total_volume_usd >= milestone.requirement_value
                elif milestone.requirement_type == "streak":
                    achieved_now = account.longest_streak >= milestone.requirement_value
                elif milestone.requirement_type == "referrals":
                    achieved_now = referral_count >= milestone.requirement_value
                
                if achieved_now:
                    # Award milestone
                    user_milestone = UserMilestone(
                        user_id=user_id,
                        milestone_id=milestone.id,
                        points_awarded=milestone.points_reward,
                    )
                    session.add(user_milestone)
                    
                    # Award points
                    account.total_points_earned += milestone.points_reward
                    account.current_points += milestone.points_reward
                    account.xp += milestone.points_reward
                    
                    # Record transaction
                    tx = PointTransaction(
                        user_id=user_id,
                        amount=milestone.points_reward,
                        action="milestone",
                        description=f"🏆 {milestone.name}",
                        extra_data={"milestone": milestone.name},
                    )
                    session.add(tx)
                    
                    achieved.append(milestone.name)
                    logger.info(f"User {user_id} achieved milestone: {milestone.name}")
        
        return achieved
    
    def get_available_rewards(self) -> List[dict]:
        """Get list of available rewards in the store."""
        with get_session() as session:
            rewards = session.query(Reward).filter(
                Reward.is_active == True
            ).order_by(Reward.points_cost).all()
            
            return [
                {
                    "id": r.id,
                    "name": r.name,
                    "description": r.description,
                    "emoji": r.emoji,
                    "cost": r.points_cost,
                    "type": r.reward_type,
                    "value": r.reward_value,
                    "duration": r.duration_days,
                }
                for r in rewards
            ]
    
    def format_stats_message(self, user_id: int) -> str:
        """Format user stats for display."""
        stats = self.get_user_stats(user_id)
        
        # Progress bar for next level
        if stats["xp_to_next"] > 0:
            level_order = ["bronze", "silver", "gold", "platinum", "diamond"]
            try:
                current_idx = level_order.index(stats["level"])
            except ValueError:
                current_idx = 0
            if current_idx < len(level_order) - 1:
                next_level = level_order[current_idx + 1]
                current_threshold = LEVELS[stats["level"]]["xp"]
                next_threshold = LEVELS[next_level]["xp"]
                progress = (stats["xp"] - current_threshold) / (next_threshold - current_threshold)
                bar_length = 10
                filled = int(progress * bar_length)
                bar = "█" * filled + "░" * (bar_length - filled)
                progress_text = f"\n{bar} {int(progress*100)}%"
            else:
                progress_text = "\n🏆 MAX LEVEL!"
        else:
            progress_text = "\n🏆 MAX LEVEL!"
        
        # Streak info
        streak_text = ""
        if stats["daily_streak"] > 0:
            streak_text = f"\n🔥 Streak: *{stats['daily_streak']} days*"
        
        msg = (
            f"📊 *Your Stats*\n\n"
            f"{stats['level_emoji']} *Level:* {stats['level_name']}\n"
            f"⭐ *XP:* {stats['xp']:,}\n"
            f"💰 *Points:* {stats['current_points']:,}\n"
            f"📈 *Rank:* #{stats['rank']}{progress_text}{streak_text}\n\n"
            f"*Trading Stats:*\n"
            f"• Swaps: {stats['total_swaps']}\n"
            f"• Volume: ${stats['total_volume']:,.2f}\n"
            f"• Fee Rate: {stats['fee_rate']}%\n"
        )
        
        return msg
    
    def format_leaderboard_message(self) -> str:
        """Format leaderboard for display."""
        leaders = self.get_leaderboard(10)
        
        if not leaders:
            return "🏆 *Leaderboard*\n\nNo data yet. Start swapping to earn XP!"
        
        msg = "🏆 *XP Leaderboard*\n\n"
        
        for entry in leaders:
            rank_emoji = "🥇" if entry["rank"] == 1 else "🥈" if entry["rank"] == 2 else "🥉" if entry["rank"] == 3 else f"#{entry['rank']}"
            msg += (
                f"{rank_emoji} {entry['level_emoji']} *{entry['username']}*\n"
                f"    {entry['xp']:,} XP • ${entry['total_volume']:,.0f} volume\n"
            )
        
        msg += "\n_Updated in real-time_"
        
        return msg
    
    def seed_milestones_and_rewards(self):
        """Seed default milestones and rewards."""
        with get_session() as session:
            # Seed milestones
            for m in DEFAULT_MILESTONES:
                existing = session.query(Milestone).filter(
                    Milestone.name == m["name"]
                ).first()
                if not existing:
                    milestone = Milestone(**m)
                    session.add(milestone)
            
            # Seed rewards
            for r in DEFAULT_REWARDS:
                existing = session.query(Reward).filter(
                    Reward.name == r["name"]
                ).first()
                if not existing:
                    reward = Reward(**r)
                    session.add(reward)
        
        logger.info("Seeded default milestones and rewards")


# Global instance
points_service = PointsService()

