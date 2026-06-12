"""Points/XP system database models for gamified growth.

Level System (XP thresholds → cosmetic level + future perks):
- Bronze   (0 XP)
- Silver   (1,000 XP)
- Gold     (5,000 XP)
- Platinum (25,000 XP)
- Diamond  (100,000 XP) + revenue share (planned)

NOTE on the per-level ``fee`` field below: this is an ASPIRATIONAL roadmap
target, NOT the fee actually charged. The fee charged on a swap is resolved
from the user's *subscription tier* (FREE/PRO/PREMIUM/ENTERPRISE) in
``bot/services/fee_service.py`` (TIER_FEE_RATES), which is the single source of
truth applied on-chain. The XP level is independent of subscription tier and is
NOT wired into the fee calculation, so these numbers must NOT be displayed to
users as their current fee rate (that would be a false promise). See
``points_service.get_user_stats`` / ``format_stats_message`` — XP-level fee
discounts are shown as "coming soon", not as an active rate.
"""

from datetime import datetime
from sqlalchemy import (
    Column,
    Integer,
    String,
    Float,
    Boolean,
    DateTime,
    ForeignKey,
    Text,
    JSON,
    Index,
)
from sqlalchemy.orm import relationship

from database.db import Base


# Level thresholds and perks.
# ``fee`` is an ASPIRATIONAL roadmap target, NOT the charged rate. The fee
# actually charged comes from the subscription tier in fee_service.TIER_FEE_RATES.
# Do not display these as a user's active fee rate — see module docstring.
LEVELS = {
    "bronze": {"xp": 0, "fee": 0.8, "name": "Bronze", "emoji": "🥉"},
    "silver": {"xp": 1000, "fee": 0.7, "name": "Silver", "emoji": "🥈"},
    "gold": {"xp": 5000, "fee": 0.6, "name": "Gold", "emoji": "🥇"},
    "platinum": {"xp": 25000, "fee": 0.5, "name": "Platinum", "emoji": "💎"},
    "diamond": {"xp": 100000, "fee": 0.4, "name": "Diamond", "emoji": "👑"},
}

# Point earning actions
POINT_ACTIONS = {
    "checkin": {"points": 10, "description": "Daily check-in"},
    "swap": {"points": 1, "per": 10, "description": "1 point per $10 swapped"},
    "first_swap_daily": {"points": 50, "description": "First swap of the day bonus"},
    "referral_signup": {"points": 500, "description": "Friend signs up with your code"},
    "referral_first_swap": {"points": 200, "description": "Referral completes first swap"},
    "twitter_share": {"points": 25, "description": "Share on Twitter"},
    "level_up": {"points": 100, "description": "Level up bonus"},
    "milestone": {"points": 100, "description": "Achieve a milestone"},
    "streak_bonus": {"points": 5, "per_day": True, "description": "Streak bonus per day"},
    "copy_trade": {"points": 10, "description": "Copy a trade"},
    "get_copied": {"points": 5, "description": "Someone copies your trade"},
}


class UserPoints(Base):
    """Tracks user's points, XP, and level progression."""

    __tablename__ = "user_points"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, unique=True, index=True)

    # Points (spendable currency)
    total_points_earned = Column(Integer, default=0)  # Lifetime total
    current_points = Column(Integer, default=0)  # Available to spend
    points_spent = Column(Integer, default=0)  # Total spent

    # XP and Level (permanent progression)
    xp = Column(Integer, default=0)
    level = Column(String(20), default="bronze")

    # Streaks and engagement
    daily_streak = Column(Integer, default=0)
    longest_streak = Column(Integer, default=0)
    last_checkin = Column(DateTime, nullable=True)
    last_swap_date = Column(DateTime, nullable=True)  # For first swap of day bonus

    # Stats
    total_swaps = Column(Integer, default=0)
    total_volume_usd = Column(Float, default=0.0)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationship
    user = relationship("User", backref="points_account")

    def get_level_info(self) -> dict:
        """Get current level information."""
        return LEVELS.get(self.level, LEVELS["bronze"])

    def get_fee_discount(self) -> float:
        """ASPIRATIONAL XP-level fee % — NOT the charged rate. UNUSED.

        WARNING: do not wire this into fee calculation. The fee actually charged
        is resolved from the subscription tier in
        ``fee_service.get_fee_bps(tier)`` (TIER_FEE_RATES), which is independent
        of XP level. Returning this here for a real fee would diverge the charged
        fee from what every other surface computes. Kept only for the level-info
        roadmap display ("coming soon"). See module docstring.
        """
        return self.get_level_info()["fee"]

    def xp_to_next_level(self) -> int:
        """Calculate XP needed for next level."""
        level_order = ["bronze", "silver", "gold", "platinum", "diamond"]
        current_idx = level_order.index(self.level)

        if current_idx >= len(level_order) - 1:
            return 0  # Max level

        next_level = level_order[current_idx + 1]
        return LEVELS[next_level]["xp"] - self.xp

    def check_level_up(self) -> str:
        """Check if user should level up and return new level if so."""
        level_order = ["bronze", "silver", "gold", "platinum", "diamond"]

        for level_name in reversed(level_order):
            if self.xp >= LEVELS[level_name]["xp"]:
                if level_name != self.level:
                    old_level = self.level
                    self.level = level_name
                    return level_name
                break

        return None


class PointTransaction(Base):
    """Records all point earning and spending transactions."""

    __tablename__ = "point_transactions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    # Transaction details
    amount = Column(Integer, nullable=False)  # Positive = earn, Negative = spend
    action = Column(String(50), nullable=False)  # "checkin", "swap", "referral", etc.
    description = Column(String(255), nullable=True)

    # Related entities
    swap_id = Column(Integer, ForeignKey("swap_transactions.id"), nullable=True)
    referral_id = Column(Integer, nullable=True)

    # Additional data
    extra_data = Column(JSON, nullable=True)  # Extra info like swap amount, etc.

    # Timestamp
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    # Indexes for efficient queries
    __table_args__ = (
        Index("ix_point_transactions_user_action", "user_id", "action"),
        Index("ix_point_transactions_user_date", "user_id", "created_at"),
    )


class PointRedemption(Base):
    """Records point redemptions for rewards."""

    __tablename__ = "point_redemptions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    # Redemption details
    points_spent = Column(Integer, nullable=False)
    reward_type = Column(String(50), nullable=False)  # "fee_discount", "gas_rebate", "raffle", etc.
    reward_value = Column(String(255), nullable=False)  # Details of the reward

    # Status
    status = Column(String(20), default="completed")  # "pending", "completed", "failed"

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)

    # Optional: expiry for temporary rewards
    expires_at = Column(DateTime, nullable=True)


class Milestone(Base):
    """Defines achievement milestones users can unlock."""

    __tablename__ = "milestones"

    id = Column(Integer, primary_key=True, autoincrement=True)

    # Milestone definition
    name = Column(String(100), nullable=False, unique=True)
    description = Column(String(255), nullable=False)
    emoji = Column(String(10), default="🏆")

    # Requirements
    requirement_type = Column(String(50), nullable=False)  # "swaps", "volume", "streak", etc.
    requirement_value = Column(Integer, nullable=False)

    # Reward
    points_reward = Column(Integer, default=100)

    # Active status
    is_active = Column(Boolean, default=True)


class UserMilestone(Base):
    """Tracks which milestones users have achieved."""

    __tablename__ = "user_milestones"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    milestone_id = Column(Integer, ForeignKey("milestones.id"), nullable=False)

    # Achievement details
    achieved_at = Column(DateTime, default=datetime.utcnow)
    points_awarded = Column(Integer, nullable=False)

    # Unique constraint: one milestone per user
    __table_args__ = (Index("ix_user_milestones_unique", "user_id", "milestone_id", unique=True),)


class Reward(Base):
    """Defines rewards available in the points store."""

    __tablename__ = "rewards"

    id = Column(Integer, primary_key=True, autoincrement=True)

    # Reward definition
    name = Column(String(100), nullable=False)
    description = Column(String(255), nullable=False)
    emoji = Column(String(10), default="🎁")

    # Cost and type
    points_cost = Column(Integer, nullable=False)
    reward_type = Column(String(50), nullable=False)  # "fee_discount", "gas_rebate", "raffle"
    reward_value = Column(String(255), nullable=False)  # "0.5" for 0.5% fee, "5" for $5 gas, etc.

    # Availability
    is_active = Column(Boolean, default=True)
    stock = Column(Integer, nullable=True)  # NULL = unlimited

    # Duration (for temporary rewards)
    duration_days = Column(Integer, nullable=True)  # NULL = permanent


# Default milestones to seed
DEFAULT_MILESTONES = [
    {
        "name": "First Swap",
        "description": "Complete your first swap",
        "requirement_type": "swaps",
        "requirement_value": 1,
        "points_reward": 100,
        "emoji": "🎉",
    },
    {
        "name": "Swap Apprentice",
        "description": "Complete 10 swaps",
        "requirement_type": "swaps",
        "requirement_value": 10,
        "points_reward": 200,
        "emoji": "📈",
    },
    {
        "name": "Swap Master",
        "description": "Complete 50 swaps",
        "requirement_type": "swaps",
        "requirement_value": 50,
        "points_reward": 500,
        "emoji": "🔥",
    },
    {
        "name": "Swap Legend",
        "description": "Complete 100 swaps",
        "requirement_type": "swaps",
        "requirement_value": 100,
        "points_reward": 1000,
        "emoji": "⚡",
    },
    {
        "name": "Volume Starter",
        "description": "Swap $1,000 total volume",
        "requirement_type": "volume",
        "requirement_value": 1000,
        "points_reward": 150,
        "emoji": "💰",
    },
    {
        "name": "Volume Pro",
        "description": "Swap $10,000 total volume",
        "requirement_type": "volume",
        "requirement_value": 10000,
        "points_reward": 400,
        "emoji": "💎",
    },
    {
        "name": "Volume Whale",
        "description": "Swap $100,000 total volume",
        "requirement_type": "volume",
        "requirement_value": 100000,
        "points_reward": 2000,
        "emoji": "🐋",
    },
    {
        "name": "Streak Starter",
        "description": "7-day check-in streak",
        "requirement_type": "streak",
        "requirement_value": 7,
        "points_reward": 100,
        "emoji": "🔥",
    },
    {
        "name": "Streak Champion",
        "description": "30-day check-in streak",
        "requirement_type": "streak",
        "requirement_value": 30,
        "points_reward": 500,
        "emoji": "🏆",
    },
    {
        "name": "Referral Rookie",
        "description": "Refer 3 friends",
        "requirement_type": "referrals",
        "requirement_value": 3,
        "points_reward": 300,
        "emoji": "👥",
    },
    {
        "name": "Referral Pro",
        "description": "Refer 10 friends",
        "requirement_type": "referrals",
        "requirement_value": 10,
        "points_reward": 1000,
        "emoji": "🌟",
    },
]

# Default rewards to seed
DEFAULT_REWARDS = [
    {
        "name": "Fee Discount 24h",
        "description": "0.5% fee for 24 hours",
        "points_cost": 500,
        "reward_type": "fee_discount",
        "reward_value": "0.5",
        "duration_days": 1,
        "emoji": "💸",
    },
    {
        "name": "Fee Discount 7d",
        "description": "0.5% fee for 7 days",
        "points_cost": 2500,
        "reward_type": "fee_discount",
        "reward_value": "0.5",
        "duration_days": 7,
        "emoji": "💰",
    },
    {
        "name": "Gas Rebate $5",
        "description": "$5 gas rebate on next swap",
        "points_cost": 1000,
        "reward_type": "gas_rebate",
        "reward_value": "5",
        "emoji": "⛽",
    },
    {
        "name": "Gas Rebate $20",
        "description": "$20 gas rebate on next swap",
        "points_cost": 3500,
        "reward_type": "gas_rebate",
        "reward_value": "20",
        "emoji": "🚀",
    },
    {
        "name": "Raffle Ticket",
        "description": "Entry to monthly prize draw",
        "points_cost": 200,
        "reward_type": "raffle",
        "reward_value": "1",
        "emoji": "🎟️",
    },
]
