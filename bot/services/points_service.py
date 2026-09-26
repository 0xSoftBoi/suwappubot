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

from sqlalchemy import func, desc
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from bot.models.user import User
from bot.models.points import (
    UserPoints,
    PointTransaction,
    PointRedemption,
    Milestone,
    UserMilestone,
    Reward,
    LEVELS,
    POINT_ACTIONS,
    DEFAULT_MILESTONES,
    DEFAULT_REWARDS,
)
from database.db import get_session

logger = logging.getLogger(__name__)


class PointsService:
    """Service for managing user points, XP, and rewards."""

    def _get_locked_points_account(
        self, session: Session, user_id: int, create: bool = False
    ) -> Optional[UserPoints]:
        """Fetch a user's UserPoints row with ``SELECT ... FOR UPDATE`` held
        for the rest of the caller's transaction.

        MONEY-PATH LOCK RATIONALE: every method in this file that reads a
        balance field (current_points / total_points_earned / xp /
        total_swaps / total_volume_usd / daily_streak / longest_streak /
        last_checkin / last_swap_date) and then writes it back MUST hold this
        lock for the lifetime of its ``with get_session()`` block. Without
        it, two concurrent calls for the same user — e.g. spend_points racing
        award_points, or two redeem taps racing each other — can both read
        the same pre-write balance, both pass their own check, and one
        silently clobbers the other's update once its UPDATE lands (a lost
        update / double-spend). ``.with_for_update()`` is a no-op on SQLite
        (the engine already serializes writes via its single-writer file
        lock) and a real row lock on Postgres in prod. This exact bug class
        (H6, NEW-8, and the award_points BLOCKER) was previously reintroduced
        because each method hand-rolled its own lock query and a new
        read-modify-write site could be added without anyone remembering to
        add the lock — see tests/test_points_concurrency.py for the full
        history. Centralizing the query here makes forgetting harder.

        Args:
            session: the caller's active session. The lock is scoped to this
                session's transaction — never pass a different/new session.
            user_id: the user whose UserPoints row to lock.
            create: when True and no row exists yet, create + flush a fresh
                ``UserPoints(user_id=user_id)`` (still inside the caller's
                transaction) and return it. When False (default), returns
                None if no row exists — use this for callers that treat "no
                account yet" as a distinct outcome (e.g. spend_points's "No
                points account found").

        Returns:
            The locked UserPoints row, a newly created one (create=True), or
            None (create=False, no existing row).
        """
        account = (
            session.query(UserPoints)
            .filter(UserPoints.user_id == user_id)
            .with_for_update()
            .first()
        )
        if not account and create:
            account = UserPoints(user_id=user_id)
            session.add(account)
            session.flush()
        return account

    def get_or_create_points_account(self, user_id: int) -> UserPoints:
        """Get or create a points account for a user."""
        with get_session() as session:
            account = session.query(UserPoints).filter(UserPoints.user_id == user_id).first()

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

        # Resolve the active season id once to stamp on the transaction (audit).
        # Lazy import avoids a circular import (seasons_service imports nothing
        # from this module, but keep symmetry with the accrual hook below).
        active_season_id = None
        try:
            from bot.services.seasons_service import seasons_service

            active_season_id = seasons_service.get_active_season_id()
        except Exception:
            active_season_id = None

        with get_session() as session:
            # BLOCKER fix: this was a plain (unlocked) SELECT, so a concurrent
            # spend_points/redeem_* call (which DOES hold the lock) could read
            # the still-committed pre-spend balance here, compute its new
            # total off that stale value, and then overwrite the spend's
            # debit once its own UPDATE finally lands — a lost update that
            # hands the user back the points they just spent. See
            # `_get_locked_points_account`'s docstring for the full rationale
            # (this is the same lock, applied on the earn side so the two
            # paths can never race each other).
            account = self._get_locked_points_account(session, user_id, create=True)

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
                season_id=active_season_id,
            )
            session.add(tx)

        logger.info(f"Awarded {points} points to user {user_id} for {action}")

        if new_level:
            logger.info(f"User {user_id} leveled up to {new_level}!")

        # Accrue convertible season points (never fails the award path — the
        # service wraps its own body in try/except and returns 0 on error).
        try:
            from bot.services.seasons_service import seasons_service

            seasons_service.accrue_season_points(
                user_id,
                action,
                points,
                swap_amount_usd=(metadata.get("amount_usd") if metadata else None),
                fee_usd=(metadata.get("fee_usd") if metadata else None),
            )
        except Exception as e:
            logger.warning(f"Season accrual hook failed for user {user_id} ({action}): {e}")

        return points, new_level

    # Ceiling on the Position-card XP multiplier, as a hard backstop independent
    # of whatever the contract reports. House desk is 3500 bps (+35%); anything
    # above means a bad read or a wrong contract, and XP feeds season standings,
    # so it is clamped rather than trusted.
    MAX_TICKER_BOOST_BPS = 3500

    def award_swap_points(
        self,
        user_id: int,
        swap_amount_usd: float,
        swap_id: int,
        fee_usd: Optional[float] = None,
        ticker_boost_bps: int = 0,
    ) -> Tuple[int, bool, Optional[str]]:
        """
        Award points for completing a swap.

        ``fee_usd`` (the platform fee paid on this swap, in USD) is forwarded
        into the convertible-points season accrual so swap season points are
        denominated in fees paid (wash-proof), not raw volume. Default None
        keeps the legacy volume-based behavior.

        ``ticker_boost_bps`` is the Suwappu Position-card bonus for swapping a
        ticker the user holds a card on (see position_cards_service). It is
        resolved by the ASYNC caller and passed in, because this method must not
        do I/O — the same split the fee path uses. It multiplies the BASE volume
        points only, never the daily-streak bonus, so the boost scales with
        trading rather than with logging in. Clamped to MAX_TICKER_BOOST_BPS and
        floored at 0, so a bad read can never mint XP.

        Returns:
            Tuple of (points_awarded, is_first_swap_today, new_level)
        """
        # Calculate points: 1 point per $10
        base_points = int(swap_amount_usd / 10)
        if base_points < 1:
            base_points = 1  # Minimum 1 point

        # Position-card ticker boost applies to the volume component only.
        boost = max(0, min(int(ticker_boost_bps or 0), self.MAX_TICKER_BOOST_BPS))
        if boost:
            base_points += (base_points * boost) // 10_000

        total_points = base_points
        is_first_today = False

        with get_session() as session:
            # Audit fix (same class as the award_points blocker): this method
            # reads-then-writes UserPoints.total_swaps/total_volume_usd/
            # last_swap_date. Lock it too (see `_get_locked_points_account`)
            # so two concurrent swaps for the same user (e.g. Telegram +
            # mobile racing) can't lose one's stat update.
            account = self._get_locked_points_account(session, user_id, create=True)

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
            description=f"Swap ${swap_amount_usd:.2f}"
            + (" + daily bonus" if is_first_today else ""),
            swap_id=swap_id,
            metadata={
                "amount_usd": swap_amount_usd,
                "first_today": is_first_today,
                "fee_usd": fee_usd,
                "ticker_boost_bps": boost,
            },
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
        # Resolve the active season id once to stamp on the transaction (audit),
        # mirroring award_points — done outside the lock since it's read-only.
        active_season_id = None
        try:
            from bot.services.seasons_service import seasons_service

            active_season_id = seasons_service.get_active_season_id()
        except Exception:
            active_season_id = None

        with get_session() as session:
            # NEW-8 fix: lock the row for the "already checked in today" guard.
            # Without this, two concurrent taps on POST /v1/mobile/points/checkin
            # (now reachable — the previous bug awaited a sync method and 400'd
            # every call) could both read `last_checkin` before either commits,
            # both pass the date-equality guard, and both award + bump the
            # streak (double award + inflated streak). The row lock (see
            # `_get_locked_points_account`) makes the second call block until
            # the first commits, then re-read the now-updated `last_checkin`
            # and correctly no-op.
            account = self._get_locked_points_account(session, user_id, create=True)

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

            # Credit points directly on the locked account (mirrors
            # award_points) instead of calling award_points, which would open
            # a second session/transaction outside this lock and reintroduce
            # the race between the guard and the credit.
            account.total_points_earned += total_points
            account.current_points += total_points
            account.xp += total_points

            new_level = account.check_level_up()

            tx = PointTransaction(
                user_id=user_id,
                amount=total_points,
                action="checkin",
                description=f"Day {account.daily_streak} check-in",
                extra_data={"streak": account.daily_streak},
                season_id=active_season_id,
            )
            session.add(tx)

            current_streak = account.daily_streak

        logger.info(f"Awarded {total_points} points to user {user_id} for checkin")
        if new_level:
            logger.info(f"User {user_id} leveled up to {new_level}!")

        # Accrue convertible season points (best-effort, mirrors award_points —
        # never fails the check-in path).
        try:
            from bot.services.seasons_service import seasons_service

            seasons_service.accrue_season_points(
                user_id,
                "checkin",
                total_points,
                swap_amount_usd=None,
                fee_usd=None,
            )
        except Exception as e:
            logger.warning(f"Season accrual hook failed for user {user_id} (checkin): {e}")

        # Check streak milestones
        self._check_milestones(user_id)

        return total_points, current_streak, streak_continued, new_level

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
        duration_days: Optional[int] = None,
        idempotency_key: Optional[str] = None,
    ) -> Tuple[bool, str]:
        """
        Spend points on a reward.

        ``duration_days``, when provided (e.g. a ``fee_discount`` reward's
        ``Reward.duration_days``), sets ``PointRedemption.expires_at`` so
        time-bound rewards actually expire — otherwise ``get_active_fee_discount``
        treats a NULL ``expires_at`` as "never expires".

        ``idempotency_key``, when provided, is stamped on the PointRedemption
        row. A UNIQUE(user_id, idempotency_key) partial index (see
        database/db.py `_add_point_redemption_idempotency_key`) makes a
        retried call with the SAME key conflict at commit time instead of
        double-charging points — caught below and replayed as the original
        success (H6 durable guard; the in-process cache in mobile.py is the
        fast path, this is the durable one that survives worker restarts).

        Returns:
            Tuple of (success, message)
        """
        if reward_type in ("partner_transfer", "miles", "cashout", "stablecoin"):
            return False, "That reward isn't available — partner redemptions aren't live yet."

        try:
            with get_session() as session:
                # H6 fix: lock the row for the lifetime of this transaction so two
                # concurrent spend_points calls for the same user CANNOT both read
                # the same current_points and both pass the balance check (double
                # spend). See `_get_locked_points_account` for the full rationale
                # — same no-guard pattern already used by community_service /
                # battle_service / airdrop_campaign_service.
                account = self._get_locked_points_account(session, user_id, create=False)

                if not account:
                    return False, "No points account found"

                if account.current_points < amount:
                    return (
                        False,
                        f"Not enough points. You have {account.current_points}, need {amount}",
                    )

                # Deduct points
                account.current_points -= amount
                account.points_spent += amount

                expires_at = None
                if duration_days is not None:
                    expires_at = datetime.now(timezone.utc) + timedelta(days=duration_days)

                # Record redemption
                redemption = PointRedemption(
                    user_id=user_id,
                    points_spent=amount,
                    reward_type=reward_type,
                    reward_value=reward_value,
                    status="completed",
                    completed_at=datetime.now(timezone.utc),
                    expires_at=expires_at,
                    idempotency_key=idempotency_key,
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
        except IntegrityError:
            success, message, _redemption = self._replay_idempotent_redemption(
                user_id, idempotency_key, amount
            )
            return success, message

        logger.info(f"User {user_id} spent {amount} points on {reward_type}")
        return True, f"Successfully redeemed {reward_type}!"

    def _replay_idempotent_redemption(
        self, user_id: int, idempotency_key: Optional[str], expected_amount: Optional[int] = None
    ) -> Tuple[bool, str, Optional[PointRedemption]]:
        """Look up the original PointRedemption for a (user_id, idempotency_key)
        that just conflicted on the durable UNIQUE index, and replay ITS
        outcome instead of re-charging points.

        A conflict with no key (idempotency_key is None — the index is
        partial and never matches NULLs) is a genuine unexpected integrity
        error, not a replay; surface it as a failure rather than mask it.

        Returns ``(success, message, matched_redemption_or_None)`` so callers
        that need more than a bool/message (marketplace order id, subscription
        expiry) can resolve the ORIGINAL outcome instead of returning a
        fabricated/None value on replay.

        ``expected_amount``, when given, is cross-checked against the matched
        row's ``points_spent``. A mismatch means the conflicting key was
        (implausibly) reused for a different-cost redemption — refuse rather
        than replay the wrong outcome.
        """
        if not idempotency_key:
            logger.error(
                f"spend_points IntegrityError for user {user_id} with no idempotency_key "
                "(not a replay) — surfacing as failure"
            )
            return False, "Redemption failed — your points were not spent.", None
        try:
            with get_session() as session:
                existing = (
                    session.query(PointRedemption)
                    .filter(
                        PointRedemption.user_id == user_id,
                        PointRedemption.idempotency_key == idempotency_key,
                    )
                    .order_by(PointRedemption.id.desc())
                    .first()
                )
        except Exception as e:
            logger.error(f"Idempotent replay lookup failed for user {user_id}: {e}")
            return False, "Redemption failed — your points were not spent.", None

        if not existing:
            # Should be unreachable (the conflict means a row with this key
            # exists) but never fabricate a success if it somehow isn't there.
            logger.error(
                f"spend_points IntegrityError for user {user_id} key={idempotency_key} "
                "but no matching row found on replay lookup"
            )
            return False, "Redemption failed — your points were not spent.", None

        if expected_amount is not None and existing.points_spent != expected_amount:
            logger.error(
                f"Idempotent replay mismatch for user {user_id} key={idempotency_key}: "
                f"expected {expected_amount} points but matched redemption spent "
                f"{existing.points_spent} — refusing to replay a mismatched outcome"
            )
            return (
                False,
                "Redemption failed — a conflicting redemption already used this request.",
                None,
            )

        if existing.status == "completed":
            return True, f"Successfully redeemed {existing.reward_type}! (replayed)", existing
        return False, "Redemption failed — your points were not spent.", existing

    # ------------------------------------------------------------------
    # Redemption EFFECTS (money path) — applied at swap time.
    #
    # fee_discount: time-bound, READ-ONLY. We never consume it on read — it
    #   stays valid until expires_at, and may apply to many swaps in its window.
    # gas_rebate: one-shot. Consumed EXACTLY ONCE via an atomic status flip
    #   (completed -> applied) so a single redemption can only ever rebate one
    #   swap, even under concurrent confirms.
    #
    # GUARDRAIL: a lookup failure here must NEVER break a swap. Both methods
    # swallow exceptions and fall back to "no discount / no rebate" (0.0).
    # ------------------------------------------------------------------

    def get_active_fee_discount(self, user_id: int) -> float:
        """Best ACTIVE fee-discount for a user, as PERCENTAGE POINTS (read-only).

        Returns e.g. ``0.5`` meaning "subtract 0.5 percentage points from the
        tier fee" (reward_value "0.5" == 0.5%). Picks the LARGEST active discount
        when several are live. Returns ``0.0`` when there is none.

        Active == reward_type 'fee_discount', status 'completed', and not expired
        (expires_at IS NULL OR expires_at > now). This does NOT consume the
        redemption — fee discounts are time-bound and apply to every swap in
        their window. Never raises: any DB/parse error falls back to 0.0 so a
        swap is never blocked by the points lookup.
        """
        try:
            now = datetime.now(timezone.utc)
            with get_session() as session:
                rows = (
                    session.query(PointRedemption)
                    .filter(
                        PointRedemption.user_id == user_id,
                        PointRedemption.reward_type == "fee_discount",
                        PointRedemption.status == "completed",
                    )
                    .all()
                )

                best = 0.0
                for r in rows:
                    # Expiry check (treat naive timestamps as UTC).
                    exp = r.expires_at
                    if exp is not None:
                        if exp.tzinfo is None:
                            exp = exp.replace(tzinfo=timezone.utc)
                        if exp <= now:
                            continue  # expired
                    try:
                        pct = float(r.reward_value)
                    except (TypeError, ValueError):
                        continue
                    if pct > best:
                        best = pct
                return best
        except Exception as e:
            logger.warning(f"get_active_fee_discount failed for user {user_id}: {e}")
            return 0.0

    def consume_gas_rebate(self, user_id: int) -> float:
        """Consume ONE unused gas-rebate and return its $ value (one-shot).

        Finds the oldest unused gas_rebate redemption (reward_type 'gas_rebate',
        status 'completed') and atomically marks it 'applied' so it is used
        EXACTLY once. Returns the rebate's USD value (e.g. ``5.0``), or ``0.0``
        when the user has none.

        The status flip is done with a single conditional UPDATE (WHERE id=? AND
        status='completed'); we only honor the rebate if that UPDATE actually
        flipped a row, so two concurrent swaps can never both claim the same
        redemption. Never raises: any error falls back to 0.0 (no rebate) so a
        swap is never blocked by the points lookup.
        """
        try:
            now = datetime.now(timezone.utc)
            with get_session() as session:
                redemption = (
                    session.query(PointRedemption)
                    .filter(
                        PointRedemption.user_id == user_id,
                        PointRedemption.reward_type == "gas_rebate",
                        PointRedemption.status == "completed",
                    )
                    .order_by(PointRedemption.id.asc())
                    .first()
                )
                if not redemption:
                    return 0.0

                try:
                    value = float(redemption.reward_value)
                except (TypeError, ValueError):
                    value = 0.0
                if value <= 0:
                    return 0.0

                # Atomic claim: only flip if STILL 'completed'. rowcount tells us
                # whether THIS call won the race (exactly-once guarantee).
                rows_updated = (
                    session.query(PointRedemption)
                    .filter(
                        PointRedemption.id == redemption.id,
                        PointRedemption.status == "completed",
                    )
                    .update(
                        {"status": "applied", "completed_at": now},
                        synchronize_session=False,
                    )
                )
                if rows_updated != 1:
                    # Lost the race — another concurrent swap claimed it.
                    return 0.0

            logger.info(f"Consumed ${value:.2f} gas rebate for user {user_id}")
            return value
        except Exception as e:
            logger.warning(f"consume_gas_rebate failed for user {user_id}: {e}")
            return 0.0

    def redeem_subscription_reward(
        self, user_id: int, reward_id: int, idempotency_key: Optional[str] = None
    ) -> Tuple[bool, str, Optional[str]]:
        """Atomically redeem current_points for a subscription tier grant/extension.

        MONEY PATH — all-or-nothing: the points deduction and the subscription grant
        happen in ONE DB transaction, so any failure rolls back both (no lost points,
        no free/partial subscription). EXTENDS an existing subscription
        (expiry = max(now, current_expiry) + duration) and keeps the HIGHER of the
        current vs redeemed tier. Spends ONLY current_points — never season points.

        Returns (success, message, expiry_iso).
        """
        from bot.models.subscription import Subscription, SubscriptionTier
        from bot.models.points import Reward

        tier_order = [
            SubscriptionTier.FREE,
            SubscriptionTier.PRO,
            SubscriptionTier.PREMIUM,
            SubscriptionTier.ENTERPRISE,
        ]

        def _coerce_tier(value) -> Optional[SubscriptionTier]:
            if isinstance(value, SubscriptionTier):
                return value
            try:
                return SubscriptionTier(str(value).lower())
            except ValueError:
                return None

        try:
            with get_session() as session:
                reward = (
                    session.query(Reward)
                    .filter(Reward.id == reward_id, Reward.is_active == True)  # noqa: E712
                    .first()
                )
                if not reward or reward.reward_type != "subscription":
                    return False, "That reward isn't available.", None

                reward_name = reward.name
                reward_cost = reward.points_cost
                reward_value = reward.reward_value
                duration = reward.duration_days or 30

                target_tier = _coerce_tier(reward_value)
                if target_tier is None or target_tier == SubscriptionTier.FREE:
                    return False, "Unknown subscription tier.", None

                # H6 fix: FOR UPDATE — see `_get_locked_points_account` for the
                # full rationale.
                account = self._get_locked_points_account(session, user_id, create=False)
                if not account or account.current_points < reward_cost:
                    have = account.current_points if account else 0
                    return (
                        False,
                        f"Not enough points. You have {have:,}, need {reward_cost:,}.",
                        None,
                    )

                now = datetime.now(timezone.utc)

                # --- deduct points (same transaction as the grant below) ---
                account.current_points -= reward_cost
                account.points_spent += reward_cost

                # --- grant / EXTEND subscription ---
                sub = session.query(Subscription).filter(Subscription.user_id == user_id).first()
                if not sub:
                    sub = Subscription(user_id=user_id)
                    session.add(sub)

                base = now
                if sub.expires_at is not None:
                    current_exp = sub.expires_at
                    if current_exp.tzinfo is None:
                        current_exp = current_exp.replace(tzinfo=timezone.utc)
                    if current_exp > now:
                        base = current_exp
                new_exp = base + timedelta(days=duration)

                current_tier = _coerce_tier(sub.tier) or SubscriptionTier.FREE
                if tier_order.index(target_tier) >= tier_order.index(current_tier):
                    sub.tier = target_tier  # keep the higher tier
                if sub.started_at is None:
                    sub.started_at = now
                sub.expires_at = new_exp

                granted_tier = (
                    sub.tier.value if isinstance(sub.tier, SubscriptionTier) else str(sub.tier)
                ).upper()
                expiry_iso = new_exp.date().isoformat()

                # --- record redemption + ledger entry (same transaction) ---
                session.add(
                    PointRedemption(
                        user_id=user_id,
                        points_spent=reward_cost,
                        reward_type="subscription",
                        reward_value=reward_value,
                        status="completed",
                        completed_at=now,
                        idempotency_key=idempotency_key,
                    )
                )
                session.add(
                    PointTransaction(
                        user_id=user_id,
                        amount=-reward_cost,
                        action="redemption",
                        description=f"Redeemed: {reward_name}",
                        extra_data={"reward_type": "subscription", "tier": reward_value},
                    )
                )

            logger.info(
                f"User {user_id} redeemed {reward_cost} pts -> {granted_tier} until {expiry_iso}"
            )
            return True, f"{granted_tier} active until {expiry_iso}", expiry_iso
        except IntegrityError:
            # H6 durable replay: the retried INSERT conflicted on
            # UNIQUE(user_id, idempotency_key) — replay the original outcome
            # instead of surfacing a spurious failure or double-granting.
            success, message, redemption = self._replay_idempotent_redemption(
                user_id, idempotency_key, expected_amount=None
            )
            expiry_iso = None
            if success and redemption is not None:
                # Finding 5: resolve the REAL expiry instead of returning None.
                # The subscription row is per-user (not per-redemption), so on
                # replay we read its current expires_at — that reflects the
                # grant the original (already-committed) redemption made. Best
                # effort only: never fabricate a value if the lookup fails.
                try:
                    with get_session() as session:
                        sub = (
                            session.query(Subscription)
                            .filter(Subscription.user_id == user_id)
                            .first()
                        )
                        if sub is not None and sub.expires_at is not None:
                            expiry_iso = sub.expires_at.date().isoformat()
                except Exception as e:
                    logger.error(f"Idempotent replay expiry lookup failed for user {user_id}: {e}")
            return success, message, expiry_iso
        except Exception as e:
            logger.error(f"redeem_subscription_reward failed for user {user_id}: {e}")
            return False, "Redemption failed — your points were not spent.", None

    def redeem_marketplace_reward(
        self, user_id: int, reward_id: int, idempotency_key: Optional[str] = None
    ) -> Tuple[bool, str, Optional[int]]:
        """Atomically redeem points for an ASYNC marketplace reward (gift card, travel,
        merch, donation, experience).

        MONEY PATH — all-or-nothing in ONE DB transaction:
          1. validate the reward is active and an async marketplace category,
          2. debit current_points (+ PointRedemption + PointTransaction),
          3. create a RedemptionOrder(status='pending'),
          4. call the category's provider.fulfill(),
          5a. fulfilled  → mark order 'fulfilled' + fulfilled_at, commit (points spent),
          5b. failed/disabled → REFUND: re-credit current_points, mark the order
              'refunded' and the PointRedemption 'refunded', commit (net spend 0).

        Because the debit, the order, the provider call, and the refund all share the
        SAME ``session`` transaction, a disabled or failing provider can NEVER lose a
        user's points: either the whole thing commits as 'fulfilled', or the points are
        re-credited and the order lands as 'refunded'. Any unexpected exception rolls the
        whole transaction back (no debit persisted) via get_session()'s rollback.

        Returns ``(success, message, order_id)``. order_id may be present even on
        failure (the refunded order), so callers can surface a tracking id.
        """
        from bot.models.points import Reward
        from bot.models.rewards_marketplace import RedemptionOrder
        from bot.services.reward_providers import (
            ASYNC_CATEGORIES,
            get_provider_for_category,
        )

        refund_message = "That reward isn't available yet — your points were not spent."

        try:
            with get_session() as session:
                reward = (
                    session.query(Reward)
                    .filter(Reward.id == reward_id, Reward.is_active == True)  # noqa: E712
                    .first()
                )
                if not reward:
                    return False, "That reward isn't available.", None

                category = getattr(reward, "reward_category", None) or "own_product"
                if category not in ASYNC_CATEGORIES:
                    # Not a marketplace reward — caller should route own_product paths.
                    return False, "That reward isn't a marketplace reward.", None

                provider = get_provider_for_category(category)
                if provider is None:
                    return False, refund_message, None

                reward_cost = reward.points_cost
                reward_name = reward.name
                reward_value = reward.reward_value

                # H6 fix: FOR UPDATE — see `_get_locked_points_account` for the
                # full rationale.
                account = self._get_locked_points_account(session, user_id, create=False)
                if not account or account.current_points < reward_cost:
                    have = account.current_points if account else 0
                    return (
                        False,
                        f"Not enough points. You have {have:,}, need {reward_cost:,}.",
                        None,
                    )

                now = datetime.now(timezone.utc)

                # --- (2) debit points (same transaction as everything below) ---
                account.current_points -= reward_cost
                account.points_spent += reward_cost

                redemption = PointRedemption(
                    user_id=user_id,
                    points_spent=reward_cost,
                    reward_type=category,
                    reward_value=reward_value,
                    status="completed",
                    completed_at=now,
                    idempotency_key=idempotency_key,
                )
                session.add(redemption)

                session.add(
                    PointTransaction(
                        user_id=user_id,
                        amount=-reward_cost,
                        action="redemption",
                        description=f"Redeemed: {reward_name}",
                        extra_data={"reward_type": category, "reward_value": reward_value},
                    )
                )

                # --- (3) create the fulfillment order (pending) ---
                order = RedemptionOrder(
                    user_id=user_id,
                    reward_id=reward_id,
                    category=category,
                    points_spent=reward_cost,
                    status="pending",
                    provider=provider.name,
                    payload={"reward_name": reward_name, "reward_value": reward_value},
                    # Finding 5: stamp the SAME idempotency_key used on the
                    # PointRedemption row so a replay can resolve THIS
                    # specific order precisely (unique index enforces it),
                    # instead of guessing "most recent order for this user
                    # + reward" which breaks if the user redeems the same
                    # reward again legitimately.
                    idempotency_key=idempotency_key,
                )
                session.add(order)
                # Materialize order.id so the provider (and provider_ref) can use it,
                # without ending the transaction.
                session.flush()
                order_id = order.id

                # --- (4) call the provider ---
                # TODO(redemption): move fulfill outside the debit txn — a slow/
                # blocking provider.fulfill() call currently holds the points-debit
                # row lock (and the whole DB transaction) open for its duration.
                # Pre-existing behavior, out of scope for this fix.
                try:
                    status, provider_ref, error = provider.fulfill(order, order.payload)
                except Exception as pe:  # treat any provider crash as a failure -> refund
                    logger.warning(
                        f"provider.fulfill crashed for order {order_id} (user {user_id}): {pe}"
                    )
                    status, provider_ref, error = ("failed", None, "provider error")

                if status == "fulfilled":
                    # --- (5a) success: points stay spent, order fulfilled ---
                    order.status = "fulfilled"
                    order.provider_ref = provider_ref
                    order.fulfilled_at = now
                    order.error = None
                    logger.info(
                        f"User {user_id} redeemed {reward_cost} pts -> {category} "
                        f"order {order_id} fulfilled ({provider_ref})"
                    )
                    return (
                        True,
                        f"{reward_name} is on its way — order #{order_id}.",
                        order_id,
                    )

                # --- (5b) failed/disabled: REFUND inside the SAME transaction ---
                account.current_points += reward_cost
                account.points_spent -= reward_cost
                redemption.status = "refunded"
                order.status = "refunded"
                order.provider_ref = provider_ref
                order.error = (error or "provider not configured")[:255]
                session.add(
                    PointTransaction(
                        user_id=user_id,
                        amount=reward_cost,
                        action="redemption_refund",
                        description=f"Refund: {reward_name}",
                        extra_data={
                            "reward_type": category,
                            "order_id": order_id,
                            "reason": order.error,
                        },
                    )
                )
                logger.info(
                    f"User {user_id} marketplace redemption refunded "
                    f"(order {order_id}, {reward_cost} pts, reason={order.error})"
                )
                return False, refund_message, order_id
        except IntegrityError:
            # H6 durable replay: the retried INSERT/flush conflicted on
            # UNIQUE(user_id, idempotency_key) — replay the original outcome
            # instead of surfacing a spurious failure or double-fulfilling.
            success, message, redemption = self._replay_idempotent_redemption(
                user_id, idempotency_key, expected_amount=None
            )
            order_id = None
            if redemption is not None:
                # Finding 5: resolve the REAL order_id via the idempotency_key
                # we now stamp on RedemptionOrder too (unique index), instead
                # of always returning None on replay.
                try:
                    with get_session() as session:
                        order = (
                            session.query(RedemptionOrder)
                            .filter(RedemptionOrder.idempotency_key == idempotency_key)
                            .first()
                        )
                        if order is not None:
                            order_id = order.id
                            if success and order.status not in ("fulfilled", "refunded"):
                                # Order row hasn't reached a terminal state yet
                                # (rare race) — never fabricate certainty.
                                message = f"{message} (order #{order_id} pending)"
                except Exception as e:
                    logger.error(f"Idempotent replay order lookup failed for user {user_id}: {e}")
            return success, message, order_id
        except Exception as e:
            # Any unexpected error rolls the whole transaction back (no debit persisted).
            logger.error(f"redeem_marketplace_reward failed for user {user_id}: {e}")
            return False, refund_message, None

    def get_leaderboard(self, limit: int = 10) -> List[dict]:
        """Get top users by XP."""
        with get_session() as session:
            results = (
                session.query(UserPoints, User)
                .join(User, UserPoints.user_id == User.id)
                .order_by(desc(UserPoints.xp))
                .limit(limit)
                .all()
            )

            leaderboard = []
            for i, (points, user) in enumerate(results, 1):
                level_info = LEVELS.get(points.level, LEVELS["bronze"])
                leaderboard.append(
                    {
                        "rank": i,
                        "user_id": user.id,
                        "username": user.username or f"User{user.id}",
                        "xp": points.xp,
                        "level": points.level,
                        "level_emoji": level_info["emoji"],
                        "total_volume": points.total_volume_usd,
                    }
                )

            return leaderboard

    def get_user_rank(self, user_id: int) -> int:
        """Get user's rank on the leaderboard."""
        with get_session() as session:
            account = session.query(UserPoints).filter(UserPoints.user_id == user_id).first()

            if not account:
                return 0

            rank = (
                session.query(func.count(UserPoints.id)).filter(UserPoints.xp > account.xp).scalar()
            )

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
            # ROADMAP value only — NOT the charged rate. The actual fee comes from
            # the subscription tier (fee_service.TIER_FEE_RATES), independent of XP
            # level. format_stats_message renders this as "coming soon", not a live
            # rate. Do not display this number as the user's current fee.
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
            # Audit fix: this method reads-then-writes total_points_earned/
            # current_points/xp when a milestone is achieved — same balance
            # fields the spend paths lock. Lock it too (see
            # `_get_locked_points_account`).
            account = self._get_locked_points_account(session, user_id, create=False)

            if not account:
                return achieved

            # Get user's referral count
            from bot.models.user import User

            user = session.query(User).filter(User.id == user_id).first()
            referral_count = user.referral_count if user else 0

            # Get all milestones
            milestones = (
                session.query(Milestone).filter(Milestone.is_active == True).all()  # noqa: E712
            )  # noqa: E712

            # Get already achieved milestones
            achieved_ids = set(
                m.milestone_id
                for m in session.query(UserMilestone).filter(UserMilestone.user_id == user_id).all()
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
            rewards = (
                session.query(Reward)
                .filter(Reward.is_active == True)  # noqa: E712
                .order_by(Reward.points_cost)
                .all()
            )

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
            f"• Level fee discounts: _coming soon_\n"
        )

        msg += self._format_season_block(user_id)

        return msg

    def _format_season_block(self, user_id: int) -> str:
        """Render the active-season block for /xp stats. Returns "" on error/no season."""
        try:
            from bot.services.seasons_service import seasons_service

            standing = seasons_service.get_user_season_standing(user_id)
            season = standing.get("season")
            if not season:
                return ""

            rank = standing.get("rank")
            rank_text = f"#{rank}" if rank else "—"
            days = standing.get("days_remaining")
            days_text = f"{days}d left" if days is not None else "—"
            mult = standing.get("multiplier", 1.0)

            # Emission line — "Season 1/8 · 8.33% of supply · −25%/season"
            emission = standing.get("emission") or {}
            idx = emission.get("season_index", season.get("season_index", 1))
            total_seasons = emission.get("total_seasons", 8)
            pool_pct = emission.get("pool_pct_of_supply", 0.0) * 100
            decay_pct = emission.get("decay_per_season", 0.25) * 100
            emission_line = (
                f"• Season {idx}/{total_seasons} · "
                f"{pool_pct:.2f}% of supply · −{decay_pct:.0f}%/season\n"
            )

            # Weather emoji by season; header shows weather name + official quarter.
            weather = season.get("weather", "")
            weather_emoji = {"Summer": "☀️", "Fall": "🍂", "Winter": "❄️", "Spring": "🌱"}.get(
                weather, "☀️"
            )
            quarter = season.get("quarter", "")
            header = f"{weather_emoji} *{season['name']}*" + (f"  ·  {quarter}" if quarter else "")

            return (
                f"\n{header}\n"
                f"{emission_line}"
                f"• Season points: *{int(round(standing.get('points', 0))):,}*  (rank {rank_text})\n"
                f"• Points = 100 × fees paid _(wash-proof)_\n"
                f"• Est. {standing.get('token_symbol', 'SUWP')}: "
                f"~{standing.get('estimated_tokens', 0):,.0f}\n"
                f"• Multiplier: *x{mult:.2f}*\n"
                f"• {days_text} · _estimate, final at season end_\n"
            )
        except Exception as e:
            logger.debug(f"_format_season_block failed for user {user_id}: {e}")
            return ""

    def format_leaderboard_message(self) -> str:
        """Format leaderboard for display."""
        leaders = self.get_leaderboard(10)

        if not leaders:
            return "🏆 *Leaderboard*\n\nNo data yet. Start swapping to earn XP!"

        msg = "🏆 *XP Leaderboard*\n\n"

        for entry in leaders:
            rank_emoji = (
                "🥇"
                if entry["rank"] == 1
                else (
                    "🥈"
                    if entry["rank"] == 2
                    else "🥉" if entry["rank"] == 3 else f"#{entry['rank']}"
                )
            )
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
                existing = session.query(Milestone).filter(Milestone.name == m["name"]).first()
                if not existing:
                    milestone = Milestone(**m)
                    session.add(milestone)

            # Seed rewards
            for r in DEFAULT_REWARDS:
                existing = session.query(Reward).filter(Reward.name == r["name"]).first()
                if not existing:
                    reward = Reward(**r)
                    session.add(reward)
                elif existing.description != r["description"]:
                    # Seeding is insert-only, so a corrected DESCRIPTION would
                    # never reach a row that already exists — every production
                    # user would keep reading the old copy forever. That bit us:
                    # "0.5% fee for 24 hours" described a discount that is now
                    # proportional, and was already wrong for anyone on PREMIUM
                    # (0.3%), for whom "0.5% fee" reads as an increase.
                    #
                    # Deliberately description ONLY. points_cost and
                    # reward_value are economics — silently repricing a live
                    # reward on every boot is exactly the kind of change that
                    # should require a migration and a decision, not a redeploy.
                    existing.description = r["description"]

        logger.info("Seeded default milestones and rewards")


# Global instance
points_service = PointsService()
