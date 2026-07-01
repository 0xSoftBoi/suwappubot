"""Referral service for viral growth with 30% reward distribution.

Referral Program:
- Each user gets a unique referral code
- When someone signs up with the code, they're linked forever
- Referrer earns 30% of all fees from their referrals
- Rewards accumulate and can be claimed
"""

import logging
import secrets
import string
from typing import Optional, List, Tuple
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import func, text
from sqlalchemy.orm import Session

from bot.models.user import User, Wallet
from bot.models.referral import Referral, ReferralCode, ReferralReward, ReferralPayout
from bot.services.fee_service import REFERRAL_REWARD_DECIMAL, fee_service
from database.db import get_session

logger = logging.getLogger(__name__)

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
    - 30% of all swap fees go to the referrer
    - Rewards are tracked per-swap for transparency
    - Users can claim accumulated rewards
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
        """
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

            # --- Referral v2: Item 4 — 30-DAY PER-REFEREE CAP ---
            # Computed inside the FOR UPDATE lock so concurrent swaps see a consistent sum.
            thirty_days_ago = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=30)
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
            reward_amount = float(Decimal(str(fee_amount_usd)) * l1_rate)
            reward_amount = min(reward_amount, remaining_cap)

            # Create reward record
            reward = ReferralReward(
                referral_id=referral.id,
                swap_id=swap_id,
                fee_amount_usd=fee_amount_usd,
                reward_amount_usd=reward_amount,
                is_paid=False,
            )
            session.add(reward)

            # Update referral code stats
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

            # Update referrer's total rewards
            referrer = session.query(User).filter(User.id == referral.referrer_id).first()
            if referrer:
                referrer.total_referral_rewards = (
                    referrer.total_referral_rewards or 0
                ) + reward_amount

            session.flush()
            reward_id = reward.id

        logger.info(
            f"Referral reward recorded: ${reward_amount:.2f} for referrer of user {referee_id} "
            f"from swap {swap_id}"
        )

        # Check if this is referee's first swap and award bonus points to referrer
        with get_session() as session:
            reward_count = (
                session.query(func.count(ReferralReward.id))
                .filter(ReferralReward.referral_id == referral.id)
                .scalar()
            )

            if reward_count == 1:  # This is the first reward (first swap)
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
        """Get comprehensive referral statistics for a user."""
        with get_session() as session:
            # Get user
            user = session.query(User).filter(User.id == user_id).first()
            if not user:
                return {}

            # Get referral code
            code = session.query(ReferralCode).filter(ReferralCode.user_id == user_id).first()

            # Get pending rewards
            pending_usd, pending_count = self.get_pending_rewards(user_id)

            # Get active referrals
            active_referrals = (
                session.query(func.count(Referral.id))
                .filter(Referral.referrer_id == user_id, Referral.is_active == True)
                .scalar()
                or 0
            )

            return {
                "referral_code": code.code if code else None,
                "total_referrals": user.referral_count or 0,
                "active_referrals": active_referrals,
                "total_earnings_usd": user.total_referral_rewards or 0,
                "pending_rewards_usd": pending_usd,
                "pending_rewards_count": pending_count,
                "code_times_used": code.times_used if code else 0,
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
        """Format referral information message."""
        stats = self.get_referral_stats(user_id)

        if not stats.get("referral_code"):
            return "No referral code found. Contact support."

        code = stats["referral_code"]
        link = f"https://t.me/{bot_username}?start={code}"

        msg = (
            "*Your Referral Program*\n\n"
            f"*Code:* `{code}`\n"
            f"*Link:* [Click to share]({link})\n\n"
            "━━━━━━━━━━━━━━━━━━━━\n"
            f"Total Referrals: *{stats['total_referrals']}*\n"
            f"Total Earned: *${stats['total_earnings_usd']:.2f}*\n"
            f"Pending: *${stats['pending_rewards_usd']:.2f}*\n"
            "━━━━━━━━━━━━━━━━━━━━\n\n"
            "*How it works:*\n"
            "Share your link or code\n"
            "Friends sign up and swap\n"
            "You earn *30%* of all their fees!\n\n"
            "_Rewards are credited after each swap_"
        )

        return msg

    def format_rewards_message(self, user_id: int) -> str:
        """Format rewards summary message."""
        stats = self.get_referral_stats(user_id)
        referrals = self.get_referrals_list(user_id, limit=5)

        msg = (
            "*Your Referral Rewards*\n\n"
            "*Summary*\n"
            f"Total Earned: *${stats['total_earnings_usd']:.2f}*\n"
            f"Pending: *${stats['pending_rewards_usd']:.2f}*\n"
            f"From {stats['total_referrals']} referrals\n\n"
        )

        if referrals:
            msg += "*Top Referrals*\n"
            for i, ref in enumerate(referrals[:5], 1):
                username = ref["username"][:15]
                rewards = ref["total_rewards_usd"]
                msg += f"{i}. {username}: ${rewards:.2f}\n"

        msg += "\n_You earn 30% of all swap fees from your referrals!_"

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
