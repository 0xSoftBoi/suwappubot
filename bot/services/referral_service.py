"""Referral service — multi-stream commission economics.

Referral Program:
- Each user gets a unique referral code
- When someone signs up with the code, they're linked forever
- Referrer earns from three commission streams, with no cap and no expiry:

  1. Swap commission  : SWAP_COMMISSION_RATE (30 %) of every Suwappu swap fee
                        the referred user pays. Recorded in referral_earnings
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
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import func, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from bot.models.user import User
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


class ReferralService:
    """Service for managing referral relationships and rewards.

    Reward Structure:
    - Swap stream:     30% of all swap fees go to the referrer (no cap, no expiry)
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

    def record_reward(
        self,
        referee_id: int,
        swap_id: int,
        fee_amount_usd: float,
    ) -> Optional[ReferralReward]:
        """Record a referral reward when a referred user swaps.

        Writes to two ledgers atomically within the same session:
          1. referral_rewards (legacy, used by claim_rewards flow)
          2. referral_earnings (new multi-stream ledger, stream_type='swap')

        Idempotency: referral_rewards.swap_id has a UNIQUE constraint; if a
        duplicate call arrives for the same swap_id, the existing row is returned
        and no second earning is written.

        Self-referral cannot occur here because process_referral() already rejects
        codes where code.user_id == referee_id.

        Args:
            referee_id: The user who made the swap
            swap_id: The swap transaction ID
            fee_amount_usd: Total Suwappu fee paid (USD)

        Returns:
            ReferralReward if a reward was created (or already existed), else None.
        """
        # HIGH #4: wrap the INSERT block in try/except IntegrityError.  The
        # SELECT-before-INSERT idempotency check has a race window; the DB unique
        # constraint on referral_rewards.swap_id (and the partial unique index on
        # referral_earnings(swap_id) WHERE stream_type='swap') is the authoritative
        # guard.  On conflict, return the existing reward row.
        reward_id: Optional[int] = None
        try:
            with get_session() as session:
                # Find the referral relationship
                referral = (
                    session.query(Referral)
                    .filter(Referral.referee_id == referee_id, Referral.is_active == True)
                    .first()
                )

                if not referral:
                    return None

                # Idempotency: check if reward already exists for this swap
                existing = (
                    session.query(ReferralReward).filter(ReferralReward.swap_id == swap_id).first()
                )

                if existing:
                    return existing

                # Clamp rate to [0, 1] — defensive guard
                rate = float(max(Decimal("0"), min(Decimal("1"), SWAP_COMMISSION_RATE)))
                reward_amount = float(Decimal(str(fee_amount_usd)) * Decimal(str(rate)))

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
                earning = ReferralEarning(
                    referrer_id=referral.referrer_id,
                    referred_id=referee_id,
                    stream_type="swap",
                    amount_usd=reward_amount,
                    swap_id=swap_id,
                    commission_rate=rate,
                    earning_metadata=json.dumps({"fee_amount_usd": fee_amount_usd}),
                    created_at=datetime.now(timezone.utc),
                )
                session.add(earning)

                # Update referral code stats
                code = (
                    session.query(ReferralCode)
                    .filter(ReferralCode.user_id == referral.referrer_id)
                    .first()
                )
                if code:
                    code.total_rewards_earned = (code.total_rewards_earned or 0) + reward_amount

                # Update referrer's total rewards (denormalized fast-read column)
                referrer = session.query(User).filter(User.id == referral.referrer_id).first()
                if referrer:
                    referrer.total_referral_rewards = (
                        referrer.total_referral_rewards or 0
                    ) + reward_amount

                session.flush()
                reward_id = reward.id

        except IntegrityError:
            # Concurrent INSERT hit the unique index — return the existing row.
            logger.debug(
                f"Swap earning for swap {swap_id} already exists (concurrent write); skipping."
            )
            with get_session() as session:
                return (
                    session.query(ReferralReward).filter(ReferralReward.swap_id == swap_id).first()
                )

        logger.info(
            f"Referral swap commission: ${reward_amount:.4f} ({rate:.0%} of "
            f"${fee_amount_usd:.4f}) for referrer of user {referee_id} swap {swap_id}"
        )

        # Check if this is referee's first swap and award bonus points to referrer
        with get_session() as session:
            reward_count = (
                session.query(func.count(ReferralReward.id))
                .filter(ReferralReward.referral_id == referral.id)
                .scalar()
            )

            if reward_count == 1:  # first reward = first swap
                try:
                    from bot.services.points_service import points_service

                    points_service.award_referral_points(
                        referrer_id=referral.referrer_id,
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

        Marks the eligible ReferralReward rows ``is_paid=True`` and credits the
        claimed USD amount to the user's custodial ledger as USDC (1 USD = 1
        USDC), then records a ReferralPayout for auditability.

        The mark-paid step and the eligibility re-check happen inside a single
        DB session/transaction. A second rapid tap re-reads the unpaid rows
        inside its own transaction and finds nothing left to claim, so no
        double-credit is possible.

        Returns:
            Tuple of (success, message, claimed_usd)
        """
        # 1) Atomically select + mark the unpaid rewards as paid. The re-check is
        #    implicit: only rows still is_paid==False at update time are claimed,
        #    so a concurrent/duplicate tap claims $0.
        claimed_usd = 0.0
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

            # Lock the unpaid rows for this transaction (SELECT ... FOR UPDATE on
            # backends that support it; harmless no-op on SQLite).
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

            now = datetime.now(timezone.utc)
            for r in unpaid:
                r.is_paid = True
                r.paid_at = now
            # Session commits on context exit — rewards are now durably marked paid.

        # 2) Credit the custodial ledger. This runs AFTER the rewards are marked
        #    paid (and committed). The credit is itself an idempotent +add on a
        #    string-decimal balance, so even if it somehow ran twice the amount
        #    would just be wrong-high — but it can't, because step 1 already
        #    consumed the rows.
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
            # Crediting failed — un-mark the rewards so the user can retry. Without
            # this, a failed credit would silently burn the user's rewards.
            logger.error(f"Custodial credit failed for user {user_id} claim: {e}")
            with get_session() as session:
                session.query(ReferralReward).filter(
                    ReferralReward.referral_id.in_(referral_ids),
                    ReferralReward.is_paid == True,
                    ReferralReward.paid_at == now,
                ).update(
                    {ReferralReward.is_paid: False, ReferralReward.paid_at: None},
                    synchronize_session=False,
                )
            return (
                False,
                "⚠️ Could not credit your balance right now. Your rewards are safe — please try again shortly.",
                0.0,
            )

        # 3) Record the payout for auditability (USDC, 6 decimals).
        try:
            with get_session() as session:
                token_amount_raw = int(Decimal(str(claimed_usd)) * Decimal(10**6))
                payout = ReferralPayout(
                    user_id=user_id,
                    amount_usd=claimed_usd,
                    token=CLAIM_PAYOUT_TOKEN,
                    token_amount=str(token_amount_raw),
                    chain=CLAIM_PAYOUT_CHAIN,
                    status="completed",
                    completed_at=datetime.now(timezone.utc),
                )
                session.add(payout)
        except Exception as e:
            # The ledger is already credited — a missing audit row is non-fatal.
            logger.warning(f"Failed to record ReferralPayout for user {user_id}: {e}")

        logger.info(
            f"Referral claim: user {user_id} claimed ${claimed_usd:.2f} "
            f"as {CLAIM_PAYOUT_TOKEN} on {CLAIM_PAYOUT_CHAIN}"
        )
        return (
            True,
            f"✅ Claimed *${claimed_usd:.2f}*! Credited as "
            f"*{claimed_usd:.2f} {CLAIM_PAYOUT_TOKEN}* on {CLAIM_PAYOUT_CHAIN.title()} "
            f"to your custodial balance.\n\nUse 🏦 Custodial to withdraw.",
            claimed_usd,
        )

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
            "🌸 *Trade smarter on Suwappu*\n\n"
            "Cross-chain swaps, perps, sniping & more — all in Telegram.\n"
            f"Join with my link and we both win:\n{link}\n\n"
            "_You'll get a welcome XP bonus, I earn 30% of the fees on your swaps._"
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
            return "❌ No referral code found. Contact support."

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
            "🎁 *Your Referral Program*\n\n"
            f"📋 *Code:* `{code}`\n"
            f"🔗 *Link:* [Click to share]({link})\n\n"
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
            "• Swaps: *30%* of every fee — no cap, no expiry\n"
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
            msg += "👥 *Top Referrals*\n"
            for i, ref in enumerate(referrals[:5], 1):
                username = ref["username"][:15]
                rewards = ref["total_rewards_usd"]
                msg += f"{i}. {username}: ${rewards:.2f}\n"

        msg += "\n_Swap: 30% | Perps: 20%–80% (volume tier) | No cap, no expiry_"

        return msg


# Global instance
referral_service = ReferralService()
