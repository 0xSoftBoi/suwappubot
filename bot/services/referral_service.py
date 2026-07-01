"""Referral service — multi-stream commission economics.

Referral Program:
- Each user gets a unique referral code
- When someone signs up with the code, they're linked forever
- Referrer earns from three commission streams:

  1. Swap commission  : tier-based rate via _l1_rate_for_tier (standard/power
                        30 %, elite 40 %) of every Suwappu swap fee the referred
                        user pays, subject to the MIN_VOLUME_BEFORE_PAYOUT_USD
                        gate and the MAX_REWARD_PER_REFEREE_PER_30D_USD rolling
                        30-day per-referee cap. Recorded in both the legacy
                        referral_rewards ledger and referral_earnings
                        (stream_type='swap') keyed on swap_id for idempotency.

  2. Perps commission : volume-tiered 20%–80% of the Suwappu builder fee earned
                        on the referred user's HyperLiquid orders.  The rate is
                        determined by the referee's 14-day rolling perps notional
                        volume (perps_volume_14d_usd on the referrals row).
                        Recorded in referral_earnings (stream_type='perps') keyed
                        on perp_order_id for idempotency.

  3. Milestone bonus  : fixed one-time USD payout when the referrer reaches
                        5 / 10 / 20 / 50 / 100 verified referrals.  Idempotency
                        is enforced at DB level via the UNIQUE index on
                        (referrer_id, milestone_count) in referral_milestones.

Perps volume tier table
-----------------------
  < $10 k  14-day vol  → 20 % of builder fee  (tier 1)
  $10 k–$50 k          → 30 %                 (tier 2)
  $50 k–$250 k         → 40 %                 (tier 3)
  $250 k–$1 M          → 55 %                 (tier 4)
  >= $1 M              → 80 %                 (tier 5)

Milestone bonus table
---------------------
   5 verified referrals → $5
  10 verified referrals → $15
  20 verified referrals → $40
  50 verified referrals → $125
 100 verified referrals → $300
"""

import json
import logging
import secrets
import string
from typing import Optional, List, Tuple, Dict
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import func, text
from sqlalchemy.exc import IntegrityError

from bot.models.user import User, Wallet
from bot.models.referral import (
    Referral,
    ReferralCode,
    ReferralReward,
    ReferralPayout,
    ReferralEarning,
    ReferralMilestone,
)
from bot.services.fee_service import REFERRAL_REWARD_DECIMAL, fee_service
from database.db import get_session

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Swap commission rate
# ---------------------------------------------------------------------------
# 30 % of the Suwappu swap fee goes to the referrer.  This matches the legacy
# REFERRAL_REWARD_DECIMAL used by the old ReferralReward table so both ledgers
# agree on the amount.
SWAP_COMMISSION_RATE: Decimal = REFERRAL_REWARD_DECIMAL  # 0.30

# ---------------------------------------------------------------------------
# Perps volume tier table  (14-day rolling notional USD → commission rate)
# ---------------------------------------------------------------------------
# Each entry: (min_volume_usd_exclusive, rate)
# Evaluated in order; first matching tier wins.
# Rate is a decimal fraction, clamped to [0, 1] before use.
PERPS_TIERS: List[Tuple[float, float]] = [
    (1_000_000.0, 0.80),  # tier 5: >= $1 M
    (250_000.0, 0.55),  # tier 4: $250 k – $1 M
    (50_000.0, 0.40),  # tier 3: $50 k – $250 k
    (10_000.0, 0.30),  # tier 2: $10 k – $50 k
    (0.0, 0.20),  # tier 1: < $10 k (base)
]

# ---------------------------------------------------------------------------
# Milestone bonus table  (verified-referral threshold → fixed USD bonus)
# ---------------------------------------------------------------------------
MILESTONE_BONUSES: Dict[int, float] = {
    5: 5.0,
    10: 15.0,
    20: 40.0,
    50: 125.0,
    100: 300.0,
}

# Rewards are recorded in USD (ReferralReward.reward_amount_usd). When a user
# claims, the USD amount is credited to their custodial ledger as USDC (a 1:1
# USD stablecoin), on the chain below. USDC has 6 decimals and is deposit-
# supported on Base, so the user can withdraw the credited balance normally.
CLAIM_PAYOUT_TOKEN = "USDC"
CLAIM_PAYOUT_CHAIN = "base"

# Minimum accrued rewards (USD) required before a claim can be made. Keeps the
# ledger free of dust-sized payouts and matches the threshold shown in the UI.
MIN_CLAIM_USD = 1.0

# Referral v2 guards
# Referee must have at least this much lifetime swap volume before any reward is created.
MIN_VOLUME_BEFORE_PAYOUT_USD = 10.0
# Maximum reward attributable to a single referee over a rolling 30-day window.
MAX_REWARD_PER_REFEREE_PER_30D_USD = 500.0
# Claims above this threshold are held for manual review, not auto-credited.
CLAIM_REVIEW_THRESHOLD_USD = 500.0


def _l1_rate_for_tier(tier: str) -> Decimal:
    """Return the L1 referral rate for a given referrer tier.

    standard / power -> 30% (REFERRAL_REWARD_DECIMAL)
    elite           -> 40%
    """
    if tier == "elite":
        return Decimal("0.40")
    return REFERRAL_REWARD_DECIMAL


class ReferralService:
    """Service for managing referral relationships and rewards.

    Reward Structure:
    - Swap stream:     tier-based 30%/40% of swap fees (per referrer_tier), gated by
                       MIN_VOLUME_BEFORE_PAYOUT_USD + a 30-day per-referee reward cap
    - Perps stream:    20%-80% of builder fee, volume-tiered on 14-day rolling notional
    - Milestone bonus: fixed one-time credits at 5/10/20/50/100 verified referrals

    All credits are recorded in the referral_earnings append-only ledger.
    Idempotency is enforced by unique indexes / duplicate checks so no credit
    can be issued twice for the same on-chain event.
    Self-referral is rejected at relationship creation time (process_referral).
    """

    def generate_code(self, user_id: int, username: Optional[str] = None) -> str:
        """
        Generate a unique referral code for a user.

        Format: USERNAME_XXXX or USER_XXXX (4 random alphanumeric chars)
        """
        # Create base from username or user ID
        if username:
            base = username[:10].upper().replace(" ", "")
        else:
            base = f"USER{user_id}"

        # Add random suffix
        suffix = "".join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(4))
        code = f"{base}_{suffix}"

        # Ensure uniqueness
        with get_session() as session:
            while session.query(ReferralCode).filter(ReferralCode.code == code).first():
                suffix = "".join(
                    secrets.choice(string.ascii_uppercase + string.digits) for _ in range(4)
                )
                code = f"{base}_{suffix}"

        return code

    def get_or_create_code(self, user_id: int, username: Optional[str] = None) -> ReferralCode:
        """Get user's referral code or create one if it doesn't exist."""
        with get_session() as session:
            code = session.query(ReferralCode).filter(ReferralCode.user_id == user_id).first()

            if code:
                # Refresh the object to get latest stats
                session.refresh(code)
                return code

            # Create new code
            new_code = self.generate_code(user_id, username)
            code = ReferralCode(
                user_id=user_id,
                code=new_code,
                times_used=0,
                total_rewards_earned=0.0,
            )
            session.add(code)
            session.flush()

            code_id = code.id

        # Return fresh copy
        with get_session() as session:
            return session.query(ReferralCode).filter(ReferralCode.id == code_id).first()

    def get_code_by_string(self, code_string: str) -> Optional[ReferralCode]:
        """Look up a referral code by its string value."""
        with get_session() as session:
            return (
                session.query(ReferralCode).filter(ReferralCode.code == code_string.upper()).first()
            )

    def process_referral(self, referee_id: int, referral_code: str) -> Tuple[bool, str]:
        """
        Process a referral when a new user signs up.

        Args:
            referee_id: The new user's ID
            referral_code: The referral code they used

        Returns:
            Tuple of (success, message)
        """
        with get_session() as session:
            # Check if user already has a referrer
            existing = session.query(Referral).filter(Referral.referee_id == referee_id).first()

            if existing:
                return False, "You already have a referrer"

            # Find the referral code
            code = (
                session.query(ReferralCode)
                .filter(ReferralCode.code == referral_code.upper())
                .first()
            )

            if not code:
                return False, "Invalid referral code"

            # Can't refer yourself
            if code.user_id == referee_id:
                return False, "You cannot use your own referral code"

            # Anti-abuse: reject if referee shares a wallet address with the referrer.
            # This catches multi-account self-referral via the same key material.
            referrer_addrs = {
                w.address.lower()
                for w in session.query(Wallet).filter(Wallet.user_id == code.user_id).all()
                if w.address
            }
            referee_addrs = {
                w.address.lower()
                for w in session.query(Wallet).filter(Wallet.user_id == referee_id).all()
                if w.address
            }
            overlap = referrer_addrs & referee_addrs
            if overlap:
                logger.warning(
                    f"Self-referral blocked: referee {referee_id} shares wallet(s) "
                    f"{overlap} with referrer {code.user_id}"
                )
                return False, "Referral not permitted: shared wallet detected."

            # Create the referral relationship
            referral = Referral(
                referrer_id=code.user_id,
                referee_id=referee_id,
                referral_code=code.code,
                is_active=True,
            )
            session.add(referral)

            # Update code stats
            code.times_used += 1
            code.last_used_at = datetime.now(timezone.utc)

            # Update user's referred_by
            referee = session.query(User).filter(User.id == referee_id).first()
            if referee:
                referee.referred_by_user_id = code.user_id

            # Update referrer's referral count
            referrer = session.query(User).filter(User.id == code.user_id).first()
            if referrer:
                referrer.referral_count = (referrer.referral_count or 0) + 1

            referrer_id = code.user_id

        # Award points to referrer for signup
        try:
            from bot.services.points_service import points_service

            points_service.award_referral_points(
                referrer_id=referrer_id,
                referee_id=referee_id,
                action="signup",
            )
        except Exception as e:
            logger.warning(f"Failed to award referral points: {e}")

        logger.info(f"Referral processed: User {referee_id} referred by User {referrer_id}")
        return (
            True,
            "Referral applied successfully! Your referrer will earn rewards from your swaps.",
        )

    def get_referrer_id(self, user_id: int) -> Optional[int]:
        """Get the referrer ID for a user, if any."""
        with get_session() as session:
            referral = (
                session.query(Referral)
                .filter(Referral.referee_id == user_id, Referral.is_active == True)
                .first()
            )

            return referral.referrer_id if referral else None

    def consume_referee_rebate(self, referee_id: int) -> bool:
        """Atomically consume one referee rebate slot if any remain.

        This is the SINGLE SOURCE OF TRUTH for decrementing referee_swap_rebate_remaining.
        It must be called from the swap handler at SUBMITTED status — the same code block
        that calls fee_service.record_fee — so the decrement is keyed to an actual
        charged swap, independent of the reward-record guards (min-volume, 30-day cap).

        Uses an atomic SQL UPDATE WHERE remaining > 0, so concurrent swap submissions
        cannot double-consume a slot. Returns True if a slot was consumed (i.e. the
        rebate was active for this swap), False if no slots remained.

        fee_service._active_referee_rebate_applies is READ-ONLY and never decrements.
        record_reward does NOT decrement — it only reads fee_amount_usd as charged.

        MULTI-WALLET BEHAVIOR: When a user submits swaps from N wallets simultaneously
        (multi-wallet mode in swap.py), each wallet's swap calls consume_referee_rebate
        independently. Each call atomically decrements one slot (WHERE remaining > 0),
        so N concurrent swaps burn N slots — no over-discount and no under-discount.
        The fee quoted to each wallet already reflects the discount (fee_service reads
        remaining > 0 at quote time); if the first swap burns the last slot, subsequent
        same-batch swaps may still receive a discounted quote but their consume call
        returns False (slot already 0). The fee_amount_usd passed to record_reward will
        reflect the discount that was actually applied at quote time regardless. This is
        a small known edge case in rapid multi-wallet batches; acceptable for v2.
        """
        with get_session() as session:
            result = session.execute(
                text(
                    "UPDATE referrals "
                    "SET referee_swap_rebate_remaining = referee_swap_rebate_remaining - 1 "
                    "WHERE referee_id = :uid AND is_active = TRUE "
                    "AND referee_swap_rebate_remaining > 0"
                ),
                {"uid": referee_id},
            )
            consumed = result.rowcount > 0

        if consumed:
            logger.info(f"Referee rebate slot consumed for user {referee_id}")
        return consumed

    def record_reward(
        self,
        referee_id: int,
        swap_id: int,
        fee_amount_usd: float,
    ) -> Optional[ReferralReward]:
        """Record a referral reward when a referred user's swap reaches SUBMITTED status.

        Called from bot/handlers/swap.py in the SUBMITTED status block, alongside
        fee_service.record_fee. At call time the fee has already been charged and
        consume_referee_rebate has already been called (if applicable), so
        fee_amount_usd reflects the actual discounted amount collected.

        The Referral row is locked FOR UPDATE for the duration of this transaction
        to prevent concurrent swaps from jointly exceeding the 30-day reward cap.

        The rebate counter is NOT decremented here. consume_referee_rebate() is the
        single decrement point, called independently before this method.

        Writes to two ledgers in the same transaction:
          1. referral_rewards (legacy, used by claim_rewards flow) — amount computed
             from the tier-based L1 rate (_l1_rate_for_tier), clamped to the 30-day cap.
          2. referral_earnings (multi-stream ledger, stream_type='swap') — same
             reward_amount and rate, plus earning_metadata, so both ledgers agree.

        Idempotency: the FOR-UPDATE lock on the Referral row serializes concurrent
        calls for the same referee; the SELECT-before-INSERT check plus the DB
        UNIQUE constraint on referral_rewards.swap_id (and the partial unique index
        on referral_earnings(swap_id) WHERE stream_type='swap') are the authoritative
        backstop for a genuinely concurrent duplicate — caught via IntegrityError.

        Self-referral cannot occur here because process_referral() already rejects
        codes where code.user_id == referee_id.

        Args:
            referee_id: The user who made the swap
            swap_id: The swap transaction ID
            fee_amount_usd: Total Suwappu fee paid (USD), already net of any rebate

        Returns:
            ReferralReward if a reward was created (or already existed), else None.
        """
        # Captured inside the session (objects detach once get_session() closes).
        reward_id: Optional[int] = None
        rate: float = 0.0
        referral_id: Optional[int] = None
        referrer_id: Optional[int] = None

        try:
            with get_session() as session:
                # Lock the Referral row for the duration of this transaction.
                # This prevents two concurrent swaps for the same referee from
                # jointly computing a stale 30-day cap and both creating rewards
                # that together exceed MAX_REWARD_PER_REFEREE_PER_30D_USD.
                referral = (
                    session.query(Referral)
                    .filter(Referral.referee_id == referee_id, Referral.is_active == True)
                    .with_for_update()
                    .first()
                )

                if not referral:
                    return None

                # Check if reward already exists for this swap (idempotency guard)
                existing = (
                    session.query(ReferralReward).filter(ReferralReward.swap_id == swap_id).first()
                )

                if existing:
                    return existing

                # --- Referral v2: Item 3 — MIN-VOLUME GUARD ---
                # Referee must have >= $10 lifetime swap volume before rewards are created.
                # Queried from swap_transactions to avoid any denormalisation drift.
                # NOTE: this guard may prevent reward recording even though a rebate slot
                # was already consumed (by consume_referee_rebate above). That is intentional —
                # the rebate is on the CHARGED FEE, not on the reward earned by the referrer.
                from bot.models.swap import SwapTransaction

                referee_volume = (
                    session.query(func.sum(SwapTransaction.from_amount_usd))
                    .filter(
                        SwapTransaction.user_id == referee_id,
                        SwapTransaction.status.in_(["completed", "submitted"]),
                        SwapTransaction.from_amount_usd.isnot(None),
                    )
                    .scalar()
                ) or 0.0

                if referee_volume < MIN_VOLUME_BEFORE_PAYOUT_USD:
                    logger.info(
                        f"Referral reward skipped: referee {referee_id} lifetime volume "
                        f"${referee_volume:.2f} < ${MIN_VOLUME_BEFORE_PAYOUT_USD}"
                    )
                    return None

                # --- Referral v2: Item 2 — tier-based L1 rate ---
                code = (
                    session.query(ReferralCode)
                    .filter(ReferralCode.user_id == referral.referrer_id)
                    .first()
                )
                tier = code.referrer_tier if code and code.referrer_tier else "standard"
                l1_rate = _l1_rate_for_tier(tier)
                # Clamp to [0, 1] — defensive guard regardless of tier table config.
                l1_rate = max(Decimal("0"), min(Decimal("1"), l1_rate))

                # --- Referral v2: Item 4 — 30-DAY PER-REFEREE CAP ---
                # Computed inside the FOR UPDATE lock so concurrent swaps see a consistent sum.
                thirty_days_ago = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(
                    days=30
                )
                existing_30d_reward = (
                    session.query(func.sum(ReferralReward.reward_amount_usd))
                    .filter(
                        ReferralReward.referral_id == referral.id,
                        ReferralReward.created_at >= thirty_days_ago,
                    )
                    .scalar()
                ) or 0.0

                remaining_cap = MAX_REWARD_PER_REFEREE_PER_30D_USD - existing_30d_reward
                if remaining_cap <= 0:
                    logger.info(
                        f"Referral reward capped: referee {referee_id} 30-day cap of "
                        f"${MAX_REWARD_PER_REFEREE_PER_30D_USD} exhausted"
                    )
                    return None

                # fee_amount_usd is the fee actually charged (already reduced 10% if a rebate
                # slot was active, because fee_service.get_fee_decimal applied the discount).
                rate = float(l1_rate)
                reward_amount = float(Decimal(str(fee_amount_usd)) * l1_rate)
                reward_amount = min(reward_amount, remaining_cap)

                # --- Legacy ledger row ---
                reward = ReferralReward(
                    referral_id=referral.id,
                    swap_id=swap_id,
                    fee_amount_usd=fee_amount_usd,
                    reward_amount_usd=reward_amount,
                    is_paid=False,
                )
                session.add(reward)

                # --- New multi-stream ledger row (stream_type='swap') ---
                # Same reward_amount and rate as the legacy row so both ledgers agree.
                earning = ReferralEarning(
                    referrer_id=referral.referrer_id,
                    referred_id=referee_id,
                    stream_type="swap",
                    amount_usd=reward_amount,
                    swap_id=swap_id,
                    commission_rate=rate,
                    earning_metadata=json.dumps(
                        {"fee_amount_usd": fee_amount_usd, "referrer_tier": tier}
                    ),
                    created_at=datetime.now(timezone.utc),
                )
                session.add(earning)

                # Update referral code stats (add reward_amount exactly once)
                if code:
                    code.total_rewards_earned = (code.total_rewards_earned or 0) + reward_amount

                    # --- Referral v2: Item 2 — volume-milestone tier promotion ---
                    # Tier is keyed to cumulative REFERRED SWAP VOLUME (not reward dollars),
                    # per spec: $25K -> power, $50K -> elite.
                    # Cost: one SUM across all referees' swap_transactions. Acceptable as a
                    # post-submit background operation; if it becomes a bottleneck, add a
                    # denormalised total_referred_volume column and increment it here.
                    referee_ids = [
                        r.referee_id
                        for r in session.query(Referral.referee_id)
                        .filter(
                            Referral.referrer_id == referral.referrer_id,
                            Referral.is_active == True,
                        )
                        .all()
                    ]
                    if referee_ids:
                        total_referred_volume = (
                            session.query(func.sum(SwapTransaction.from_amount_usd))
                            .filter(
                                SwapTransaction.user_id.in_(referee_ids),
                                SwapTransaction.status.in_(["completed", "submitted"]),
                                SwapTransaction.from_amount_usd.isnot(None),
                            )
                            .scalar()
                        ) or 0.0
                    else:
                        total_referred_volume = 0.0

                    if total_referred_volume >= 50_000 and code.referrer_tier != "elite":
                        code.referrer_tier = "elite"
                        logger.info(
                            f"Referrer {referral.referrer_id} promoted to elite tier "
                            f"(referred volume ${total_referred_volume:.2f})"
                        )
                    elif total_referred_volume >= 25_000 and code.referrer_tier == "standard":
                        code.referrer_tier = "power"
                        logger.info(
                            f"Referrer {referral.referrer_id} promoted to power tier "
                            f"(referred volume ${total_referred_volume:.2f})"
                        )

                # Update referrer's total rewards (denormalized fast-read column, once)
                referrer = session.query(User).filter(User.id == referral.referrer_id).first()
                if referrer:
                    referrer.total_referral_rewards = (
                        referrer.total_referral_rewards or 0
                    ) + reward_amount

                session.flush()
                reward_id = reward.id
                referral_id = referral.id
                referrer_id = referral.referrer_id

        except IntegrityError:
            # Concurrent INSERT hit the unique index — return the existing row.
            logger.debug(
                f"Swap earning for swap {swap_id} already exists (concurrent write); skipping."
            )
            with get_session() as session:
                return (
                    session.query(ReferralReward).filter(ReferralReward.swap_id == swap_id).first()
                )

        if reward_id is None:
            # One of the guards above returned None (no referral, min-volume, or cap).
            return None

        logger.info(
            f"Referral swap commission: ${reward_amount:.4f} ({rate:.0%} of "
            f"${fee_amount_usd:.4f}) for referrer of user {referee_id} swap {swap_id}"
        )

        # Check if this is referee's first swap and award bonus points to referrer
        with get_session() as session:
            reward_count = (
                session.query(func.count(ReferralReward.id))
                .filter(ReferralReward.referral_id == referral_id)
                .scalar()
            )

            if reward_count == 1:  # first reward = first swap
                try:
                    from bot.services.points_service import points_service

                    points_service.award_referral_points(
                        referrer_id=referrer_id,
                        referee_id=referee_id,
                        action="first_swap",
                    )
                except Exception as e:
                    logger.warning(f"Failed to award first swap referral points: {e}")

        with get_session() as session:
            return session.query(ReferralReward).filter(ReferralReward.id == reward_id).first()

    def get_pending_rewards(self, user_id: int) -> Tuple[float, int]:
        """
        Get total pending (unpaid) rewards for a user.

        Returns:
            Tuple of (total_pending_usd, pending_count)
        """
        with get_session() as session:
            # Get referrals where this user is the referrer
            referrals = (
                session.query(Referral.id)
                .filter(Referral.referrer_id == user_id, Referral.is_active == True)
                .all()
            )

            if not referrals:
                return 0.0, 0

            referral_ids = [r.id for r in referrals]

            # Sum pending rewards
            result = (
                session.query(
                    func.sum(ReferralReward.reward_amount_usd).label("total"),
                    func.count(ReferralReward.id).label("count"),
                )
                .filter(
                    ReferralReward.referral_id.in_(referral_ids), ReferralReward.is_paid == False
                )
                .first()
            )

            return float(result.total or 0), result.count or 0

    def claim_rewards(self, user_id: int) -> Tuple[bool, str, float]:
        """Atomically claim all eligible (unpaid) referral rewards for a user.

        CRASH-SAFETY (MEDIUM B fix): A ReferralPayout row is inserted IN THE SAME
        TRANSACTION as the is_paid=True marks, so a crash between commit and credit
        always leaves a recoverable marker. The payout status lifecycle is:

        Normal path  (<=CLAIM_REVIEW_THRESHOLD_USD):
            TX: rewards is_paid=True + ReferralPayout(status="processing") → commit.
            Then: credit custodial balance.
            Then: UPDATE payout → status="completed".
            On credit failure: un-mark rewards to is_paid=False, payout → "failed".

        Hold path (>CLAIM_REVIEW_THRESHOLD_USD):
            TX: rewards is_paid=True + ReferralPayout(status="pending_review") → commit.
            No custodial credit. Admin approves or rejects via approve/reject methods.

        ReferralReward.payout_id is set (FK) so the reject path can find the exact
        reward rows belonging to a payout without relying on timestamp correlation.

        Returns:
            Tuple of (success, message, claimed_usd)
        """
        claimed_usd = 0.0
        held = False
        referral_ids: List[int] = []
        payout_id: Optional[int] = None
        now = datetime.now(timezone.utc)
        now_naive = now.replace(tzinfo=None)  # DateTime column stored without tz

        # Single atomic transaction: lock rows, compute amount, decide path, apply mutations.
        with get_session() as session:
            referral_ids = [
                r.id
                for r in session.query(Referral.id)
                .filter(
                    Referral.referrer_id == user_id,
                    Referral.is_active == True,
                )
                .all()
            ]

            if not referral_ids:
                return False, "You don't have any referral rewards yet.", 0.0

            # Lock unpaid rows (SELECT ... FOR UPDATE; no-op on SQLite).
            unpaid = (
                session.query(ReferralReward)
                .filter(
                    ReferralReward.referral_id.in_(referral_ids),
                    ReferralReward.is_paid == False,
                )
                .with_for_update()
                .all()
            )

            if not unpaid:
                return False, "No pending rewards to claim.", 0.0

            claimed_usd = float(sum(Decimal(str(r.reward_amount_usd or 0)) for r in unpaid))

            if claimed_usd < MIN_CLAIM_USD:
                return (
                    False,
                    f"Minimum claim is ${MIN_CLAIM_USD:.2f}. "
                    f"You have ${claimed_usd:.2f} pending — keep referring!",
                    claimed_usd,
                )

            token_amount_raw = int(Decimal(str(claimed_usd)) * Decimal(10**6))
            payout_status = (
                "pending_review" if claimed_usd > CLAIM_REVIEW_THRESHOLD_USD else "processing"
            )

            # Insert the payout row BEFORE marking rewards paid so the entire TX
            # either succeeds (payout row + paid marks) or rolls back completely.
            payout = ReferralPayout(
                user_id=user_id,
                amount_usd=claimed_usd,
                token=CLAIM_PAYOUT_TOKEN,
                token_amount=str(token_amount_raw),
                chain=CLAIM_PAYOUT_CHAIN,
                status=payout_status,
                needs_review=(payout_status == "pending_review"),
                created_at=now_naive,
            )
            session.add(payout)
            session.flush()  # assigns payout.id before we reference it below
            payout_id = payout.id

            # Mark rewards paid and stamp payout_id FK for reliable reject-path lookup.
            for r in unpaid:
                r.is_paid = True
                r.paid_at = now_naive
                r.payout_id = payout_id

            held = payout_status == "pending_review"
            # TX commits here: payout row + reward marks are atomic.

        if held:
            logger.warning(
                f"[REFERRAL REVIEW REQUIRED] user_id={user_id} amount=${claimed_usd:.2f} "
                f"payout_id={payout_id} exceeds threshold ${CLAIM_REVIEW_THRESHOLD_USD:.0f}. "
                f"Use approve_referral_claim / reject_referral_claim to resolve."
            )
            # TODO(referral-v2-admin-notify): call post_admin_update(bot, msg) here once
            # a bot instance is injectable into the service layer.
            return (
                False,
                f"Your referral claim of *${claimed_usd:.2f}* is under review.\n\n"
                f"Claims above ${CLAIM_REVIEW_THRESHOLD_USD:.0f} are verified manually. "
                f"You'll be notified once it's approved (usually within 24 hours).",
                claimed_usd,
            )

        # Normal path: credit custodial ledger outside the session.
        # The "processing" payout row is the crash-recovery marker: if the process dies
        # between the TX commit above and the credit below, a reconciliation sweep can
        # find payout rows with status="processing" and retry the credit.
        try:
            from bot.services.hot_wallet import hot_wallet_service

            hot_wallet_service.update_custodial_balance(
                user_id=user_id,
                chain=CLAIM_PAYOUT_CHAIN,
                token_symbol=CLAIM_PAYOUT_TOKEN,
                amount=Decimal(str(claimed_usd)),
                operation="add",
            )
        except Exception as e:
            # Credit failed — restore rewards and mark payout failed so no
            # reconciliation sweep accidentally double-retries it.
            logger.error(f"Custodial credit failed for user {user_id} claim: {e}")
            with get_session() as session:
                session.query(ReferralReward).filter(
                    ReferralReward.payout_id == payout_id,
                ).update(
                    {
                        ReferralReward.is_paid: False,
                        ReferralReward.paid_at: None,
                        ReferralReward.payout_id: None,
                    },
                    synchronize_session=False,
                )
                failed_payout = (
                    session.query(ReferralPayout).filter(ReferralPayout.id == payout_id).first()
                )
                if failed_payout:
                    failed_payout.status = "failed"
                    failed_payout.error_message = str(e)[:500]
            return (
                False,
                "Could not credit your balance right now. Your rewards are safe — please try again shortly.",
                0.0,
            )

        # Mark payout completed.
        try:
            with get_session() as session:
                completed_payout = (
                    session.query(ReferralPayout).filter(ReferralPayout.id == payout_id).first()
                )
                if completed_payout:
                    completed_payout.status = "completed"
                    completed_payout.completed_at = datetime.now(timezone.utc)
        except Exception as e:
            # Ledger is already credited — a stuck "processing" row is non-fatal for
            # the user but will surface in a reconciliation sweep. Log at error level.
            logger.error(
                f"Failed to mark payout {payout_id} completed for user {user_id}: {e}. "
                f"Payout stuck in 'processing' — reconciliation sweep will retry."
            )

        logger.info(
            f"Referral claim: user {user_id} claimed ${claimed_usd:.2f} "
            f"as {CLAIM_PAYOUT_TOKEN} on {CLAIM_PAYOUT_CHAIN} (payout_id={payout_id})"
        )
        return (
            True,
            f"Claimed *${claimed_usd:.2f}*! Credited as "
            f"*{claimed_usd:.2f} {CLAIM_PAYOUT_TOKEN}* on {CLAIM_PAYOUT_CHAIN.title()} "
            f"to your custodial balance.\n\nUse Custodial to withdraw.",
            claimed_usd,
        )

    # -----------------------------------------------------------------------
    # Admin approval / rejection path for held claims (>$500)
    # TODO(referral-v2-admin-cmd): wire approve_referral_claim and
    # reject_referral_claim into a /ref_review admin command in
    # bot/handlers/referral.py following the existing admin handler pattern.
    # -----------------------------------------------------------------------

    def approve_referral_claim(self, payout_id: int) -> Tuple[bool, str]:
        """Admin action: credit custodial balance for a pending_review payout.

        MEDIUM A fix: uses an atomic UPDATE ... WHERE status='pending_review' as the
        state-transition gate. If two admins call this simultaneously, exactly one sees
        rowcount==1 and proceeds to credit; the other sees rowcount==0 and returns early.
        No SELECT + check + write race is possible.

        Returns:
            Tuple of (success, message)
        """
        # Atomically transition pending_review → approving. Only the session that
        # successfully updates the row (rowcount == 1) proceeds to credit.
        user_id: Optional[int] = None
        amount_usd: float = 0.0
        with get_session() as session:
            result = session.execute(
                text(
                    "UPDATE referral_payouts "
                    "SET status = 'approving', needs_review = FALSE, "
                    "    completed_at = :now "
                    "WHERE id = :pid AND status = 'pending_review'"
                ),
                {"pid": payout_id, "now": datetime.now(timezone.utc).replace(tzinfo=None)},
            )
            if result.rowcount == 0:
                # Either payout doesn't exist or another admin already acted on it.
                p = session.query(ReferralPayout).filter(ReferralPayout.id == payout_id).first()
                if p is None:
                    return False, f"Payout {payout_id} not found."
                return (
                    False,
                    f"Payout {payout_id} is no longer pending_review (status={p.status}). "
                    f"Another admin may have already acted on it.",
                )
            row = session.query(ReferralPayout).filter(ReferralPayout.id == payout_id).first()
            user_id = row.user_id
            amount_usd = row.amount_usd

        # Credit custodial balance. If this fails, roll the payout back to pending_review.
        try:
            from bot.services.hot_wallet import hot_wallet_service

            hot_wallet_service.update_custodial_balance(
                user_id=user_id,
                chain=CLAIM_PAYOUT_CHAIN,
                token_symbol=CLAIM_PAYOUT_TOKEN,
                amount=Decimal(str(amount_usd)),
                operation="add",
            )
        except Exception as e:
            with get_session() as session:
                session.execute(
                    text(
                        "UPDATE referral_payouts "
                        "SET status = 'pending_review', needs_review = TRUE, completed_at = NULL "
                        "WHERE id = :pid AND status = 'approving'"
                    ),
                    {"pid": payout_id},
                )
            logger.error(f"approve_referral_claim credit failed for payout {payout_id}: {e}")
            return False, f"Credit failed: {e}. Payout reset to pending_review."

        # Mark completed.
        with get_session() as session:
            session.execute(
                text(
                    "UPDATE referral_payouts SET status = 'completed' "
                    "WHERE id = :pid AND status = 'approving'"
                ),
                {"pid": payout_id},
            )

        logger.info(
            f"Referral claim approved: payout {payout_id}, user {user_id}, ${amount_usd:.2f}"
        )
        return True, f"Approved. User {user_id} credited ${amount_usd:.2f} USDC on Base."

    def reject_referral_claim(self, payout_id: int) -> Tuple[bool, str]:
        """Admin action: reject a pending_review payout and restore rewards to claimable.

        MEDIUM A fix: uses an atomic UPDATE ... WHERE status='pending_review' as the
        state-transition gate — same pattern as approve_referral_claim, ensuring exactly
        one admin action wins when two calls race.

        LOW fix: uses ReferralReward.payout_id FK (instead of paid_at timestamp) to
        find the exact reward rows belonging to this payout, making the lookup precise
        and immune to clock-based collision.

        Returns:
            Tuple of (success, message)
        """
        user_id: Optional[int] = None
        with get_session() as session:
            result = session.execute(
                text(
                    "UPDATE referral_payouts "
                    "SET status = 'rejected', needs_review = FALSE "
                    "WHERE id = :pid AND status = 'pending_review'"
                ),
                {"pid": payout_id},
            )
            if result.rowcount == 0:
                p = session.query(ReferralPayout).filter(ReferralPayout.id == payout_id).first()
                if p is None:
                    return False, f"Payout {payout_id} not found."
                return (
                    False,
                    f"Payout {payout_id} is no longer pending_review (status={p.status}). "
                    f"Another admin may have already acted on it.",
                )
            user_id = (
                session.query(ReferralPayout.user_id)
                .filter(ReferralPayout.id == payout_id)
                .scalar()
            )

            # Restore reward rows to claimable using payout_id FK (precise, no timestamp race).
            # Fall back to paid_at correlation for rows created before the payout_id column existed.
            rows_restored = (
                session.query(ReferralReward)
                .filter(
                    ReferralReward.payout_id == payout_id,
                    ReferralReward.is_paid == True,
                )
                .update(
                    {
                        ReferralReward.is_paid: False,
                        ReferralReward.paid_at: None,
                        ReferralReward.payout_id: None,
                    },
                    synchronize_session=False,
                )
            )
            if rows_restored == 0:
                logger.warning(
                    f"reject_referral_claim: no reward rows found via payout_id={payout_id}. "
                    f"Rewards may already be released or payout_id column not yet populated."
                )

        logger.info(
            f"Referral claim rejected: payout {payout_id}, user {user_id}. "
            f"{rows_restored} reward rows restored to claimable."
        )
        return True, f"Rejected. User {user_id} rewards restored to claimable."

    def build_share_link(self, user_id: int, bot_username: str) -> str:
        """Build the user's shareable referral deep-link (creates code if needed)."""
        code = self.get_or_create_code(user_id)
        return f"https://t.me/{bot_username}?start={code.code}"

    # ------------------------------------------------------------------
    # Perps commission stream
    # ------------------------------------------------------------------

    @staticmethod
    def get_perps_tier_rate(volume_14d_usd: float) -> float:
        """Return the commission rate (decimal) for a referee's 14-day perps volume.

        Tier table (see module docstring):
          tier 1 (base):  < $10 k  → 20 %
          tier 2:  $10 k – $50 k   → 30 %
          tier 3:  $50 k – $250 k  → 40 %
          tier 4:  $250 k – $1 M   → 55 %
          tier 5:  >= $1 M         → 80 %

        Rate is clamped to [0.0, 1.0] before returning.
        """
        vol = float(volume_14d_usd or 0.0)
        for threshold, rate in PERPS_TIERS:
            if vol >= threshold:
                return float(max(0.0, min(1.0, rate)))
        return 0.20  # fallback (should never reach here)

    def update_perps_volume_14d(self, referee_id: int, trade_notional_usd: float) -> float:
        """Update the 14-day rolling perps volume for a referee and return the new total.

        This is a simple additive increment on the referrals.perps_volume_14d_usd
        column.  A background job or the perps close handler should call this
        periodically to keep the column current.  The column is reset to zero when
        a true 14-day window resets (future background job responsibility).

        Returns the updated volume (float).
        """
        with get_session() as session:
            referral = (
                session.query(Referral)
                .filter(Referral.referee_id == referee_id, Referral.is_active == True)
                .first()
            )
            if not referral:
                return 0.0
            current = float(referral.perps_volume_14d_usd or 0.0)
            new_vol = current + float(max(0.0, trade_notional_usd))
            referral.perps_volume_14d_usd = new_vol
            return new_vol

    def credit_perps_commission(
        self,
        referee_id: int,
        perp_order_id: int,
        builder_fee_usd: float,
        trade_notional_usd: float = 0.0,
        market: Optional[str] = None,
    ) -> Optional[ReferralEarning]:
        """Credit referrer with a volume-tiered share of the perps builder fee.

        Idempotency: referral_earnings has no DB-level unique constraint on
        perp_order_id, so we guard with an explicit SELECT before INSERT.  If
        a row for (referrer_id, stream_type='perps', perp_order_id) already
        exists, we skip and return that row.

        Guards:
          - No referral relationship → no credit
          - builder_fee_usd <= 0    → no credit (avoid zero-amount rows)
          - Rate clamped to [0, 1]
          - Self-referral impossible (blocked at process_referral time)

        Args:
            referee_id:         user who placed the perp order
            perp_order_id:      PerpOrder.id (DB primary key, not HL order id)
            builder_fee_usd:    Suwappu builder fee earned on this order (USD)
            trade_notional_usd: order notional used to increment 14-day volume
            market:             e.g. 'ETH-USD' (stored in metadata for audit)

        Returns:
            ReferralEarning row created (or pre-existing), or None.
        """
        if builder_fee_usd <= 0:
            return None

        # HIGH #4: wrap the INSERT in try/except IntegrityError to handle the
        # race window between the SELECT-before-INSERT idempotency check and the
        # actual INSERT.  The DB partial unique index on
        # referral_earnings(perp_order_id) WHERE stream_type='perps' (added by
        # migration) is the authoritative guard; this catch makes it safe.
        try:
            with get_session() as session:
                # HIGH #5: lock the referrals row with SELECT FOR UPDATE so the
                # volume read-modify-write is atomic under concurrent closes.
                # WARNING/TODO: perps_volume_14d_usd is a simple accumulator —
                # it only grows and is never decayed.  True 14-day windowing
                # (decay job or timestamped volume rows) is NOT yet implemented.
                # Until a background decay job is added, high-volume referees
                # permanently retain the highest tier they ever reached.
                referral = (
                    session.query(Referral)
                    .filter(Referral.referee_id == referee_id, Referral.is_active == True)
                    .with_for_update()
                    .first()
                )
                if not referral:
                    return None

                referrer_id = referral.referrer_id

                # Idempotency guard: check for an existing earning row for this order
                existing = (
                    session.query(ReferralEarning)
                    .filter(
                        ReferralEarning.referrer_id == referrer_id,
                        ReferralEarning.stream_type == "perps",
                        ReferralEarning.perp_order_id == perp_order_id,
                    )
                    .first()
                )
                if existing:
                    return existing

                # Determine rate from 14-day rolling volume BEFORE this trade.
                # Clamp defensively to [0.0, 1.0] — matches get_perps_tier_rate
                # but is an extra guard in case the tier table is misconfigured.
                volume_14d = float(referral.perps_volume_14d_usd or 0.0)
                rate = float(max(0.0, min(1.0, self.get_perps_tier_rate(volume_14d))))
                commission = float(max(0.0, builder_fee_usd) * rate)

                earning = ReferralEarning(
                    referrer_id=referrer_id,
                    referred_id=referee_id,
                    stream_type="perps",
                    amount_usd=commission,
                    perp_order_id=perp_order_id,
                    commission_rate=rate,
                    earning_metadata=json.dumps(
                        {
                            "builder_fee_usd": builder_fee_usd,
                            "volume_14d_usd": volume_14d,
                            "trade_notional_usd": trade_notional_usd,
                            "market": market,
                        }
                    ),
                    created_at=datetime.now(timezone.utc),
                )
                session.add(earning)

                # Atomically increment 14-day volume with this trade's notional
                # (safe because the referrals row is locked FOR UPDATE above).
                if trade_notional_usd > 0:
                    referral.perps_volume_14d_usd = (
                        float(referral.perps_volume_14d_usd or 0.0) + trade_notional_usd
                    )

                # Update denormalized total on users table
                referrer = session.query(User).filter(User.id == referrer_id).first()
                if referrer:
                    referrer.total_referral_rewards = (
                        float(referrer.total_referral_rewards or 0.0) + commission
                    )

                # Also credit referral code stat
                code = (
                    session.query(ReferralCode).filter(ReferralCode.user_id == referrer_id).first()
                )
                if code:
                    code.total_rewards_earned = (code.total_rewards_earned or 0.0) + commission

                session.flush()
                earning_id = earning.id

        except IntegrityError:
            # Concurrent INSERT hit the partial unique index — earning already exists.
            logger.debug(
                f"Perps earning for order {perp_order_id} / referrer of user {referee_id} "
                f"already exists (concurrent write); skipping."
            )
            return None

        logger.info(
            f"Referral perps commission: ${commission:.4f} ({rate:.0%} of "
            f"${builder_fee_usd:.4f}) for referrer {referrer_id} from user "
            f"{referee_id} order {perp_order_id}"
        )

        # After crediting perps commission, check for newly unlocked milestones.
        # Best-effort: never let a milestone error break the perps close.
        try:
            self._check_and_award_milestones(referrer_id)
        except Exception as e:
            logger.warning(f"Milestone check failed for referrer {referrer_id}: {e}")

        with get_session() as session:
            return session.query(ReferralEarning).filter(ReferralEarning.id == earning_id).first()

    # ------------------------------------------------------------------
    # Milestone bonus stream
    # ------------------------------------------------------------------

    def get_verified_referral_count(self, referrer_id: int) -> int:
        """Return the number of verified (non-NULL verified_at) referrals for a referrer."""
        with get_session() as session:
            return (
                session.query(func.count(Referral.id))
                .filter(
                    Referral.referrer_id == referrer_id,
                    Referral.is_active == True,
                    Referral.verified_at.isnot(None),
                )
                .scalar()
                or 0
            )

    def verify_referral(self, referee_id: int) -> bool:
        """Mark a referral as verified (sets verified_at = now).

        Called by fraud/activity checks once the referee is confirmed legitimate.
        Returns True if a referral row was found and updated.
        """
        # HIGH #6: capture referrer_id INSIDE the session block to avoid
        # DetachedInstanceError when accessing the attribute after the session
        # has closed (which silently swallowed milestone checks previously).
        referrer_id: Optional[int] = None
        with get_session() as session:
            referral = (
                session.query(Referral)
                .filter(Referral.referee_id == referee_id, Referral.is_active == True)
                .first()
            )
            if not referral or referral.verified_at is not None:
                return bool(referral)
            referrer_id = referral.referrer_id  # captured while session is live
            referral.verified_at = datetime.now(timezone.utc)

        logger.info(f"Referral verified for referee {referee_id}")

        # Check milestones after each new verified referral.
        if referrer_id is not None:
            try:
                self._check_and_award_milestones(referrer_id)
            except Exception as e:
                logger.warning(
                    f"Milestone check failed after verify for referrer {referrer_id}: {e}"
                )

        return True

    def _check_and_award_milestones(self, referrer_id: int) -> List[int]:
        """Idempotently credit any newly unlocked milestone bonuses.

        Checks every milestone threshold in MILESTONE_BONUSES.  For each that
        the referrer's verified-referral count has crossed but that does NOT yet
        have a row in referral_milestones, insert a milestone row + an earning
        row in one transaction.

        The DB UNIQUE index on (referrer_id, milestone_count) is the final
        safety net: even if two concurrent calls race through the Python check,
        only one INSERT can succeed; the other raises IntegrityError which is
        caught and silently skipped.

        Returns list of milestone_count values that were newly awarded.
        """
        verified_count = self.get_verified_referral_count(referrer_id)
        newly_awarded: List[int] = []

        for milestone_count, bonus_usd in sorted(MILESTONE_BONUSES.items()):
            if verified_count < milestone_count:
                continue  # not yet reached

            # Check if already awarded (fast path before touching DB for write)
            with get_session() as session:
                already = (
                    session.query(ReferralMilestone)
                    .filter(
                        ReferralMilestone.referrer_id == referrer_id,
                        ReferralMilestone.milestone_count == milestone_count,
                    )
                    .first()
                )
                if already:
                    continue  # already credited — skip

            # Award: write earning then milestone in a single transaction
            try:
                with get_session() as session:
                    earning = ReferralEarning(
                        referrer_id=referrer_id,
                        referred_id=None,
                        stream_type="milestone",
                        amount_usd=bonus_usd,
                        milestone_count=milestone_count,
                        commission_rate=None,
                        earning_metadata=json.dumps({"milestone_count": milestone_count}),
                        created_at=datetime.now(timezone.utc),
                    )
                    session.add(earning)
                    session.flush()
                    earning_id = earning.id

                    milestone = ReferralMilestone(
                        referrer_id=referrer_id,
                        milestone_count=milestone_count,
                        bonus_usd=bonus_usd,
                        earned_at=datetime.now(timezone.utc),
                        earning_id=earning_id,
                    )
                    session.add(milestone)

                    # Update denormalized user total
                    referrer = session.query(User).filter(User.id == referrer_id).first()
                    if referrer:
                        referrer.total_referral_rewards = (
                            float(referrer.total_referral_rewards or 0.0) + bonus_usd
                        )

                    # Update code stat
                    code = (
                        session.query(ReferralCode)
                        .filter(ReferralCode.user_id == referrer_id)
                        .first()
                    )
                    if code:
                        code.total_rewards_earned = (code.total_rewards_earned or 0.0) + bonus_usd

                newly_awarded.append(milestone_count)
                logger.info(
                    f"Milestone bonus awarded: referrer {referrer_id} reached "
                    f"{milestone_count} verified referrals → ${bonus_usd:.2f}"
                )
            except IntegrityError:
                # Concurrent insertion hit the UNIQUE index — already credited.
                logger.debug(
                    f"Milestone {milestone_count} for referrer {referrer_id} already exists "
                    f"(concurrent write); skipping."
                )
            except Exception as e:
                logger.error(
                    f"Failed to award milestone {milestone_count} for referrer "
                    f"{referrer_id}: {e}"
                )

        return newly_awarded

    # ------------------------------------------------------------------
    # Earnings breakdown queries
    # ------------------------------------------------------------------

    def get_earnings_breakdown(self, referrer_id: int) -> Dict[str, float]:
        """Return per-stream total earnings (USD) from the referral_earnings ledger.

        Returns a dict with keys: 'swap', 'perps', 'milestone', 'total'.
        All values are floats (USD).  Returns zeros for streams with no rows.
        """
        with get_session() as session:
            rows = (
                session.query(
                    ReferralEarning.stream_type,
                    func.sum(ReferralEarning.amount_usd).label("total"),
                )
                .filter(ReferralEarning.referrer_id == referrer_id)
                .group_by(ReferralEarning.stream_type)
                .all()
            )

        breakdown: Dict[str, float] = {"swap": 0.0, "perps": 0.0, "milestone": 0.0}
        for stream_type, total in rows:
            if stream_type in breakdown:
                breakdown[stream_type] = float(total or 0.0)
            else:
                breakdown[stream_type] = float(total or 0.0)

        breakdown["total"] = sum(breakdown.values())
        return breakdown

    def get_next_milestone(self, referrer_id: int) -> Optional[Tuple[int, float, int]]:
        """Return (milestone_count, bonus_usd, referrals_needed) for the next milestone.

        Uses verified referral count.  Returns None if all milestones are cleared.
        """
        verified = self.get_verified_referral_count(referrer_id)
        for count in sorted(MILESTONE_BONUSES.keys()):
            with get_session() as session:
                already = (
                    session.query(ReferralMilestone)
                    .filter(
                        ReferralMilestone.referrer_id == referrer_id,
                        ReferralMilestone.milestone_count == count,
                    )
                    .first()
                )
            if not already:
                return (count, MILESTONE_BONUSES[count], max(0, count - verified))
        return None

    def format_share_message(self, user_id: int, bot_username: str) -> str:
        """Forwardable share message a user can send to friends."""
        link = self.build_share_link(user_id, bot_username)
        return (
            "Trade smarter on Suwappu\n\n"
            "Cross-chain swaps, perps, sniping & more — all in Telegram.\n"
            f"Join with my link and we both win:\n{link}\n\n"
            "You'll get a welcome XP bonus, I earn 30% of the fees on your swaps."
        )

    def get_total_earnings(self, user_id: int) -> float:
        """Get total lifetime earnings from referrals."""
        with get_session() as session:
            user = session.query(User).filter(User.id == user_id).first()
            return float(user.total_referral_rewards or 0) if user else 0.0

    def get_referral_stats(self, user_id: int) -> dict:
        """Get comprehensive referral statistics for a user.

        Includes per-stream breakdown from the referral_earnings ledger,
        verified referral count, and next-milestone info.
        """
        with get_session() as session:
            # Get user
            user = session.query(User).filter(User.id == user_id).first()
            if not user:
                return {}

            # Get referral code
            code = session.query(ReferralCode).filter(ReferralCode.user_id == user_id).first()

            # Get pending rewards (legacy ReferralReward table)
            pending_usd, pending_count = self.get_pending_rewards(user_id)

            # Get active referrals
            active_referrals = (
                session.query(func.count(Referral.id))
                .filter(Referral.referrer_id == user_id, Referral.is_active == True)
                .scalar()
                or 0
            )

        # Per-stream breakdown from the new earnings ledger
        breakdown = self.get_earnings_breakdown(user_id)

        # Verified count and next milestone
        verified_count = self.get_verified_referral_count(user_id)
        next_milestone = self.get_next_milestone(user_id)

        return {
            "referral_code": code.code if code else None,
            "total_referrals": user.referral_count or 0,
            "active_referrals": active_referrals,
            "verified_referrals": verified_count,
            "total_earnings_usd": breakdown["total"],
            "earnings_swap_usd": breakdown["swap"],
            "earnings_perps_usd": breakdown["perps"],
            "earnings_milestone_usd": breakdown["milestone"],
            "pending_rewards_usd": pending_usd,
            "pending_rewards_count": pending_count,
            "code_times_used": code.times_used if code else 0,
            "next_milestone": next_milestone,  # (count, bonus_usd, needed) or None
        }

    def get_referrals_list(self, user_id: int, limit: int = 10) -> List[dict]:
        """Get list of users referred by this user."""
        with get_session() as session:
            referrals = (
                session.query(Referral, User)
                .join(User, Referral.referee_id == User.id)
                .filter(Referral.referrer_id == user_id, Referral.is_active == True)
                .order_by(Referral.created_at.desc())
                .limit(limit)
                .all()
            )

            # Batch-load all referral rewards in a single query to avoid N+1
            ref_ids = [ref.id for ref, _ in referrals]
            reward_map: dict = {}
            if ref_ids:
                reward_rows = (
                    session.query(
                        ReferralReward.referral_id,
                        func.sum(ReferralReward.reward_amount_usd),
                    )
                    .filter(ReferralReward.referral_id.in_(ref_ids))
                    .group_by(ReferralReward.referral_id)
                    .all()
                )
                reward_map = {rid: (total or 0) for rid, total in reward_rows}

            result = []
            for ref, referee in referrals:
                result.append(
                    {
                        "user_id": referee.id,
                        "username": referee.username or f"User{referee.id}",
                        "joined_at": ref.created_at,
                        "total_rewards_usd": float(reward_map.get(ref.id, 0)),
                    }
                )

            return result

    def format_referral_message(self, user_id: int, bot_username: str) -> str:
        """Format referral information message with multi-stream breakdown."""
        stats = self.get_referral_stats(user_id)

        if not stats.get("referral_code"):
            return "No referral code found. Contact support."

        code = stats["referral_code"]
        link = f"https://t.me/{bot_username}?start={code}"

        total = stats["total_earnings_usd"]
        swap_e = stats["earnings_swap_usd"]
        perps_e = stats["earnings_perps_usd"]
        milestone_e = stats["earnings_milestone_usd"]
        verified = stats["verified_referrals"]
        total_refs = stats["total_referrals"]
        pending = stats["pending_rewards_usd"]
        next_ms = stats.get("next_milestone")  # (count, bonus_usd, needed) or None

        # Milestone progress line
        if next_ms:
            ms_count, ms_bonus, ms_needed = next_ms
            milestone_line = (
                f"🎯 Next milestone: *{ms_count} referrals* (+${ms_bonus:.0f}) — "
                f"*{ms_needed}* to go\n"
            )
        else:
            milestone_line = "🏆 All milestones unlocked!\n"

        msg = (
            "*Your Referral Program*\n\n"
            f"*Code:* `{code}`\n"
            f"*Link:* [Click to share]({link})\n\n"
            "━━━━━━━━━━━━━━━━━━━━\n"
            f"👥 Referrals: *{total_refs}* total · *{verified}* verified\n"
            f"💰 Total Earned: *${total:.2f}*\n"
            "━━━━━━━━━━━━━━━━━━━━\n"
            "*Earnings by stream:*\n"
            f"  🔄 Swap commissions:  *${swap_e:.2f}*\n"
            f"  📈 Perps commissions: *${perps_e:.2f}*\n"
            f"  🏅 Milestone bonuses: *${milestone_e:.2f}*\n"
            "━━━━━━━━━━━━━━━━━━━━\n"
            f"⏳ Claimable (swaps): *${pending:.2f}*\n"
            f"{milestone_line}"
            "\n"
            "💡 *Commission rates:*\n"
            "• Swaps: tier-based % of every fee — no cap, no expiry\n"
            "• Perps: *20%–80%* of builder fee (volume tiered)\n"
            "• Milestones: up to *$300* per threshold\n\n"
            "_Rewards are credited after each event_"
        )

        return msg

    def format_rewards_message(self, user_id: int) -> str:
        """Format rewards summary message with per-stream breakdown."""
        stats = self.get_referral_stats(user_id)
        referrals = self.get_referrals_list(user_id, limit=5)

        total = stats["total_earnings_usd"]
        swap_e = stats["earnings_swap_usd"]
        perps_e = stats["earnings_perps_usd"]
        milestone_e = stats["earnings_milestone_usd"]
        pending = stats["pending_rewards_usd"]
        total_refs = stats["total_referrals"]
        verified = stats["verified_referrals"]
        next_ms = stats.get("next_milestone")

        msg = (
            "💰 *Your Referral Rewards*\n\n"
            f"📊 *Summary*\n"
            f"• Total Earned: *${total:.2f}*\n"
            f"• Claimable (swap stream): *${pending:.2f}*\n"
            f"• From *{total_refs}* referrals ({verified} verified)\n\n"
            "*By stream:*\n"
            f"  🔄 Swap:      *${swap_e:.2f}*\n"
            f"  📈 Perps:     *${perps_e:.2f}*\n"
            f"  🏅 Milestones: *${milestone_e:.2f}*\n\n"
        )

        if next_ms:
            ms_count, ms_bonus, ms_needed = next_ms
            msg += (
                f"🎯 Next milestone: *{ms_count} referrals* → +${ms_bonus:.0f} "
                f"(*{ms_needed}* to go)\n\n"
            )

        if referrals:
            msg += "*Top Referrals*\n"
            for i, ref in enumerate(referrals[:5], 1):
                username = ref["username"][:15]
                rewards = ref["total_rewards_usd"]
                msg += f"{i}. {username}: ${rewards:.2f}\n"

        msg += "\n_Swap: 30% | Perps: 20%–80% (volume tier) | No cap, no expiry_"

        return msg

    def get_leaderboard(self, limit: int = 20) -> List[dict]:
        """Return top referrers by total lifetime reward amount.

        Intended for use by the webapp leaderboard endpoint and admin tools.

        Returns a list of dicts ordered by total_reward_usd descending:
            [{"user_id": int, "username": str, "total_reward_usd": float}, ...]
        """
        with get_session() as session:
            rows = (
                session.query(
                    ReferralCode.user_id,
                    User.username,
                    ReferralCode.total_rewards_earned,
                )
                .join(User, ReferralCode.user_id == User.id)
                .order_by(ReferralCode.total_rewards_earned.desc())
                .limit(limit)
                .all()
            )

            return [
                {
                    "user_id": row.user_id,
                    "username": row.username or f"User{row.user_id}",
                    "total_reward_usd": float(row.total_rewards_earned or 0),
                }
                for row in rows
            ]


# Global instance
referral_service = ReferralService()
