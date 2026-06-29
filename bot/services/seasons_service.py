"""Seasons / convertible-points service.

Owns the season-point accrual funnel, season standings, leaderboard,
settlement (pro-rata token allocation), and idempotent first-season seeding.

Season points are a per-season convertible currency that converts to tokens
pro-rata at TGE. This is separate from XP / spendable points (see
``points_service.py``). Accrual is invoked from the points award path and must
NEVER throw into it — every public entry point that runs inside an award is
wrapped so a season failure cannot fail the XP/points write.
"""

import logging
from typing import Optional, List
from datetime import datetime, timezone

from sqlalchemy import func, desc

from bot.models.user import User
from bot.models.points import UserPoints
from bot.models.seasons import (
    Season,
    SeasonPoints,
    SeasonSnapshot,
    MIN_SWAP_USD_FOR_SEASON_POINTS,
    DAILY_SEASON_POINT_CAP,
    REFERRAL_SEASON_POINT_CAP,
    SEASON_POINT_ACTION_ALLOWLIST,
    REFERRAL_SEASON_ACTIONS,
    FEE_DENOMINATED_SEASON_ACTIONS,
    SEASON_POINTS_PER_FEE_USD,
    SEASON_COUNT_N,
    TOKEN_MAX_SUPPLY,
    EMISSION_DECAY_DELTA,
    PROGRAM_ALLOCATION_PCT,
    combined_multiplier,
    season_pool,
    season_inflation,
    season_schedule,
    weather_for_index,
    quarter_label_for_index,
)
from database.db import get_session

logger = logging.getLogger(__name__)


# First-season seed: Summer 2026 == Q3 2026, from the committed quarter schedule.
# Each season is one fiscal quarter; weather name lives in ``name``, the official
# reporting label in ``quarter``. token_pool comes from season_pool(1).
_SEED_SEASON = {
    **season_schedule(
        1
    ),  # name "Summer 2026", slug "2026-q3-summer", quarter "Q3 2026", Q3 window, pool
    "status": "active",
    "description": (
        "Summer 2026 (Q1 FY26) — first convertible points season. "
        "Points convert to SUWP pro-rata after TGE."
    ),
}
# Legacy placeholder slug from the pre-quarter build; migrated in place by ensure_seed.
_LEGACY_FIRST_SLUG = "summer-beta-2026"


class SeasonsService:
    """Manage seasons, season-point accrual, and settlement."""

    # -- reads -------------------------------------------------------------

    def get_active_season(self, session) -> Optional[Season]:
        """Return the single active season (status == 'active'), or None."""
        return (
            session.query(Season)
            .filter(Season.status == "active")
            .order_by(desc(Season.starts_at))
            .first()
        )

    def get_active_season_id(self) -> Optional[int]:
        """Return the active season id, or None. Own session; never raises."""
        try:
            with get_session() as session:
                season = self.get_active_season(session)
                return season.id if season else None
        except Exception as e:  # pragma: no cover - defensive
            logger.debug(f"get_active_season_id failed: {e}")
            return None

    # -- accrual funnel ----------------------------------------------------

    def accrue_season_points(
        self,
        user_id: int,
        action: str,
        base_amount: float,
        swap_amount_usd: Optional[float] = None,
        fee_usd: Optional[float] = None,
    ) -> float:
        """Accrue season points for an allowlisted action.

        Implements the funnel from SEASONS_SPEC.md plus the fee-denominated swap
        rule from the econ addendum: when ``action == 'swap'`` and ``fee_usd`` is
        provided, the base is overridden to ``SEASON_POINTS_PER_FEE_USD * fee_usd``
        (wash-proof — points scale with fees paid, not raw volume). The engagement
        multiplier still applies afterward. If ``fee_usd`` is None the legacy
        volume-derived base_amount is used so nothing breaks.

        Returns the float points credited (0 if no active season or gated out).
        NEVER raises — any error is logged and 0 returned, so the caller's
        XP/points write always succeeds even if season accrual fails.
        """
        try:
            base_amount = float(base_amount or 0)

            # 2. allowlist gate
            if action not in SEASON_POINT_ACTION_ALLOWLIST:
                return 0.0

            # 3. min-swap volume gate (kills dust wash trades)
            if action == "swap" and float(swap_amount_usd or 0) < MIN_SWAP_USD_FOR_SEASON_POINTS:
                return 0.0

            # Fee-denominated base (the core Tullock fix). Applies to swaps AND the
            # whole-product trading actions (perps/predict/p2p) whenever the award
            # carries fee_usd — points scale with fees paid, not raw notional, so
            # wash trading earns nothing. The first_swap_daily bonus and predict_win
            # stay flat engagement grants and are NOT fee-based.
            fee_amount = None
            if action in FEE_DENOMINATED_SEASON_ACTIONS and fee_usd is not None:
                fee_amount = max(0.0, float(fee_usd))
                base_amount = SEASON_POINTS_PER_FEE_USD * fee_amount

            if base_amount <= 0:
                return 0.0

            today_utc = datetime.now(timezone.utc).strftime("%Y-%m-%d")

            with get_session() as session:
                # 1. active season gate
                season = self.get_active_season(session)
                if season is None or season.status != "active":
                    return 0.0

                # 4. upsert the per-user-per-season row
                row = (
                    session.query(SeasonPoints)
                    .filter(
                        SeasonPoints.season_id == season.id,
                        SeasonPoints.user_id == user_id,
                    )
                    .first()
                )
                if row is None:
                    row = SeasonPoints(
                        season_id=season.id,
                        user_id=user_id,
                        points=0,
                        base_points=0,
                        swap_volume_usd=0,
                        referral_points=0,
                        daily_points_awarded=0,
                        daily_window_date=today_utc,
                    )
                    session.add(row)
                    session.flush()

                # daily counter reset on UTC date rollover
                if row.daily_window_date != today_utc:
                    row.daily_points_awarded = 0
                    row.daily_window_date = today_utc

                # 5. engagement multiplier from the user's level + streak
                level, streak = self._read_level_streak(session, user_id)
                multiplier = combined_multiplier(level, streak)

                # 6. base credit
                credit = base_amount * multiplier

                # 7. daily cap clamp
                daily_remaining = max(0.0, DAILY_SEASON_POINT_CAP - float(row.daily_points_awarded))
                credit = min(credit, daily_remaining)

                # 8. referral cap clamp
                if action in REFERRAL_SEASON_ACTIONS:
                    ref_remaining = max(0.0, REFERRAL_SEASON_POINT_CAP - float(row.referral_points))
                    credit = min(credit, ref_remaining)

                # 9. nothing left to credit
                if credit <= 0:
                    return 0.0

                # 10. apply
                row.points = float(row.points) + credit
                row.base_points = float(row.base_points) + base_amount
                row.daily_points_awarded = float(row.daily_points_awarded) + credit
                # Track traded volume + fee revenue for swaps and the whole-product
                # fee-bearing trading actions (perps/predict/p2p). swap_volume_usd is
                # the cross-product traded-volume column; fee_paid_usd backs the
                # season revenue audit / pro-rata denominator.
                if action in FEE_DENOMINATED_SEASON_ACTIONS:
                    row.swap_volume_usd = float(row.swap_volume_usd) + float(swap_amount_usd or 0)
                    if fee_amount is not None:
                        row.fee_paid_usd = float(row.fee_paid_usd or 0) + fee_amount
                if action in REFERRAL_SEASON_ACTIONS:
                    row.referral_points = float(row.referral_points) + credit
                row.updated_at = datetime.utcnow()

                return credit
        except Exception as e:
            # Accrual must never break the award path.
            logger.warning(f"accrue_season_points failed for user {user_id} ({action}): {e}")
            return 0.0

    def _read_level_streak(self, session, user_id: int):
        """Read the user's level + daily_streak from UserPoints (defaults if absent)."""
        account = session.query(UserPoints).filter(UserPoints.user_id == user_id).first()
        if not account:
            return "bronze", 0
        return (account.level or "bronze"), int(account.daily_streak or 0)

    # -- standings / leaderboard ------------------------------------------

    def get_user_season_standing(self, user_id: int) -> dict:
        """Return the user's standing in the active season + estimated allocation."""
        empty = {
            "season": None,
            "points": 0.0,
            "base_points": 0.0,
            "rank": None,
            "swap_volume_usd": 0.0,
            "referral_points": 0.0,
            "total_season_points": 0.0,
            "estimated_tokens": 0.0,
            "pool_share": 0.0,
            "token_symbol": "SUWP",
            "multiplier": 1.0,
            "level": "bronze",
            "daily_streak": 0,
            "days_remaining": None,
            "fee_paid_usd": 0.0,
            "emission": None,
        }
        try:
            with get_session() as session:
                season = self.get_active_season(session)
                if season is None:
                    return empty

                row = (
                    session.query(SeasonPoints)
                    .filter(
                        SeasonPoints.season_id == season.id,
                        SeasonPoints.user_id == user_id,
                    )
                    .first()
                )

                points = float(row.points) if row else 0.0
                base_points = float(row.base_points) if row else 0.0
                swap_volume_usd = float(row.swap_volume_usd) if row else 0.0
                referral_points = float(row.referral_points) if row else 0.0
                fee_paid_usd = float(row.fee_paid_usd or 0) if row else 0.0

                # denominator across all positive accruals
                total = (
                    session.query(func.coalesce(func.sum(SeasonPoints.points), 0.0))
                    .filter(
                        SeasonPoints.season_id == season.id,
                        SeasonPoints.points > 0,
                    )
                    .scalar()
                    or 0.0
                )
                total = float(total)

                # rank: number of users with strictly more points + 1
                rank = None
                if points > 0:
                    higher = (
                        session.query(func.count(SeasonPoints.id))
                        .filter(
                            SeasonPoints.season_id == season.id,
                            SeasonPoints.points > points,
                        )
                        .scalar()
                        or 0
                    )
                    rank = int(higher) + 1

                pool_share = (points / total) if total > 0 else 0.0
                estimated_tokens = pool_share * float(season.token_pool or 0)

                level, streak = self._read_level_streak(session, user_id)
                mult = combined_multiplier(level, streak)

                season_index = int(season.season_index or 1)
                emission = self._emission_block(season_index, float(season.token_pool or 0))

                return {
                    "season": {
                        "id": season.id,
                        "name": season.name,
                        "slug": season.slug,
                        "status": season.status,
                        "season_index": season_index,
                        "quarter": season.quarter or quarter_label_for_index(season_index),
                        "weather": weather_for_index(season_index),
                        "starts_at": season.starts_at,
                        "ends_at": season.ends_at,
                        "token_pool": float(season.token_pool or 0),
                        "token_symbol": season.token_symbol,
                        "description": season.description,
                    },
                    "points": points,
                    "base_points": base_points,
                    "rank": rank,
                    "swap_volume_usd": swap_volume_usd,
                    "referral_points": referral_points,
                    "fee_paid_usd": fee_paid_usd,
                    "total_season_points": total,
                    "estimated_tokens": estimated_tokens,
                    "pool_share": pool_share,
                    "token_symbol": season.token_symbol,
                    "multiplier": mult,
                    "level": level,
                    "daily_streak": streak,
                    "days_remaining": self._days_remaining(season),
                    "emission": emission,
                }
        except Exception as e:
            logger.warning(f"get_user_season_standing failed for user {user_id}: {e}")
            return empty

    @staticmethod
    def _emission_block(season_index: int, token_pool: float) -> dict:
        """Build the committed-emission descriptor for a season (addendum CHANGE 4)."""
        pool_tokens = float(token_pool or 0)
        # circ_prev = sum of pools for seasons 1..k-1
        circ_prev = sum(season_pool(j) for j in range(1, season_index)) if season_index > 1 else 0.0
        return {
            "season_index": season_index,
            "total_seasons": SEASON_COUNT_N,
            "season_pool_tokens": pool_tokens,
            "pool_pct_of_supply": (pool_tokens / TOKEN_MAX_SUPPLY) if TOKEN_MAX_SUPPLY else 0.0,
            "decay_per_season": 1 - EMISSION_DECAY_DELTA,
            "program_allocation_pct": PROGRAM_ALLOCATION_PCT,
            "inflation_rate": season_inflation(season_index, circ_prev),
            "committed": True,
        }

    @staticmethod
    def _days_remaining(season: Season) -> Optional[int]:
        if not season or not season.ends_at:
            return None
        try:
            ends = season.ends_at
            if ends.tzinfo is None:
                ends = ends.replace(tzinfo=timezone.utc)
            delta = ends - datetime.now(timezone.utc)
            return max(0, delta.days)
        except Exception:
            return None

    def get_season_leaderboard(self, season_id: int, limit: int = 20) -> List[dict]:
        """Top users in a season by season points, with estimated token allocation."""
        try:
            with get_session() as session:
                season = session.query(Season).filter(Season.id == season_id).first()
                if season is None:
                    return []

                total = (
                    session.query(func.coalesce(func.sum(SeasonPoints.points), 0.0))
                    .filter(
                        SeasonPoints.season_id == season_id,
                        SeasonPoints.points > 0,
                    )
                    .scalar()
                    or 0.0
                )
                total = float(total)
                pool = float(season.token_pool or 0)

                rows = (
                    session.query(SeasonPoints, User)
                    .join(User, SeasonPoints.user_id == User.id)
                    .filter(
                        SeasonPoints.season_id == season_id,
                        SeasonPoints.points > 0,
                    )
                    .order_by(desc(SeasonPoints.points))
                    .limit(limit)
                    .all()
                )

                board = []
                for i, (sp, user) in enumerate(rows, 1):
                    pts = float(sp.points)
                    share = (pts / total) if total > 0 else 0.0
                    board.append(
                        {
                            "rank": i,
                            "user_id": user.id,
                            "username": user.username or f"User{user.id}",
                            "points": pts,
                            "estimated_tokens": share * pool,
                            "pool_share": share,
                        }
                    )
                return board
        except Exception as e:
            logger.warning(f"get_season_leaderboard failed for season {season_id}: {e}")
            return []

    # -- settlement (money path, idempotent) ------------------------------

    def settle_season(self, season_id: int) -> List[dict]:
        """Settle a season: snapshot every positive accrual with pro-rata allocation.

        Idempotent: if already 'settled', returns existing snapshots and writes
        nothing. Per-row INSERTs are guarded (pre-check) so re-running cannot
        double-allocate. Allocations sum to <= token_pool by construction
        (each = points/total*pool, sum(points)==total).
        """
        with get_session() as session:
            season = session.query(Season).filter(Season.id == season_id).first()
            if season is None:
                logger.warning(f"settle_season: season {season_id} not found")
                return []

            # 1. already settled → return existing snapshots, write nothing.
            if season.status == "settled":
                existing = (
                    session.query(SeasonSnapshot)
                    .filter(SeasonSnapshot.season_id == season_id)
                    .order_by(SeasonSnapshot.rank.asc())
                    .all()
                )
                return [self._snapshot_dict(s) for s in existing]

            pool = float(season.token_pool or 0)

            # 2. total = SUM(points) over positive accruals
            rows = (
                session.query(SeasonPoints)
                .filter(
                    SeasonPoints.season_id == season_id,
                    SeasonPoints.points > 0,
                )
                .order_by(desc(SeasonPoints.points))
                .all()
            )
            total = float(sum(float(r.points) for r in rows))

            # 3. record denominator
            season.total_points_snapshot = total

            # record realized fee revenue (SUM of season fees paid) for transparency
            realized_fee = (
                session.query(func.coalesce(func.sum(SeasonPoints.fee_paid_usd), 0.0))
                .filter(SeasonPoints.season_id == season_id)
                .scalar()
                or 0.0
            )
            season.realized_fee_revenue_usd = float(realized_fee)

            # pre-load existing snapshot user_ids for idempotent insert
            existing_user_ids = {
                uid
                for (uid,) in session.query(SeasonSnapshot.user_id)
                .filter(SeasonSnapshot.season_id == season_id)
                .all()
            }

            # 4. snapshot each positive accrual, ranked desc
            for rank, r in enumerate(rows, 1):
                if r.user_id in existing_user_ids:
                    continue  # idempotent guard (ON CONFLICT DO NOTHING equivalent)
                pts = float(r.points)
                allocation = (pts / total * pool) if total > 0 else 0.0
                snap = SeasonSnapshot(
                    season_id=season_id,
                    user_id=r.user_id,
                    final_points=pts,
                    rank=rank,
                    total_points=total,
                    token_pool=pool,
                    token_allocation=allocation,
                    token_symbol=season.token_symbol,
                    claimed=False,
                )
                session.add(snap)

            # 5. mark settled
            season.status = "settled"
            season.settled_at = datetime.utcnow()
            session.flush()

            settled = (
                session.query(SeasonSnapshot)
                .filter(SeasonSnapshot.season_id == season_id)
                .order_by(SeasonSnapshot.rank.asc())
                .all()
            )
            result = [self._snapshot_dict(s) for s in settled]

        logger.info(f"Settled season {season_id}: {len(result)} snapshots, pool={pool}")
        return result

    @staticmethod
    def _snapshot_dict(s: SeasonSnapshot) -> dict:
        return {
            "season_id": s.season_id,
            "user_id": s.user_id,
            "final_points": float(s.final_points),
            "rank": s.rank,
            "total_points": float(s.total_points),
            "token_pool": float(s.token_pool),
            "token_allocation": float(s.token_allocation),
            "token_symbol": s.token_symbol,
            "claimed": bool(s.claimed),
        }

    # -- seed --------------------------------------------------------------

    def ensure_seed(self) -> None:
        """Ensure the first season (Summer 2026 / Q3) exists with its committed
        quarter identity. Idempotent and self-healing: migrates the legacy
        ``summer-beta-2026`` placeholder in place so we never end up with two
        active first seasons, and backfills name/quarter/dates on an existing row.
        """
        try:
            sched = season_schedule(1)
            with get_session() as session:
                row = (
                    session.query(Season)
                    .filter(Season.slug.in_([sched["slug"], _LEGACY_FIRST_SLUG]))
                    .first()
                )
                if row is None:
                    session.add(Season(**_SEED_SEASON))
                    logger.info(f"Seeded first season '{sched['slug']}'")
                    return
                # Self-heal identity/schedule fields without disturbing accrued data
                # (status, settled_at, totals) or operator overrides of status.
                row.slug = sched["slug"]
                row.name = sched["name"]
                row.quarter = sched["quarter"]
                row.season_index = sched["season_index"]
                row.starts_at = sched["starts_at"]
                row.ends_at = sched["ends_at"]
                row.token_pool = sched["token_pool"]
                row.token_symbol = sched["token_symbol"]
                if not row.description:
                    row.description = _SEED_SEASON["description"]
        except Exception as e:
            logger.warning(f"ensure_seed failed: {e}")


# Global instance
seasons_service = SeasonsService()
