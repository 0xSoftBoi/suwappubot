"""VIP service — cross-line effective tier calculation.

Computes the user's *effective* tier as the better of:
  1. Their paid subscription tier (from x402_service / Stripe)
  2. The activity band earned from cumulative season trading volume
     across all product lines (swaps, perps, predict, P2P).

The activity bands (USD season volume thresholds):
  free     →  $0
  pro      →  $10,000
  premium  →  $50,000
  enterprise → $250,000
"""

import logging
from typing import Any

from bot.config.settings import settings

logger = logging.getLogger(__name__)

_TIER_ORDER = ["free", "pro", "premium", "enterprise"]

# Season volume thresholds (USD) to earn each activity tier
_ACTIVITY_THRESHOLDS: dict[str, float] = {
    "pro": 10_000.0,
    "premium": 50_000.0,
    "enterprise": 250_000.0,
}

# Points multiplier per tier
_MULTIPLIERS: dict[str, float] = {
    "free": 1.0,
    "pro": 1.5,
    "premium": 2.0,
    "enterprise": 3.0,
}


def _tier_rank(tier: str) -> int:
    try:
        return _TIER_ORDER.index(tier.lower())
    except ValueError:
        return 0


def _activity_tier(season_volume_usd: float) -> str:
    """Return the activity band for a given season volume."""
    if season_volume_usd >= _ACTIVITY_THRESHOLDS["enterprise"]:
        return "enterprise"
    if season_volume_usd >= _ACTIVITY_THRESHOLDS["premium"]:
        return "premium"
    if season_volume_usd >= _ACTIVITY_THRESHOLDS["pro"]:
        return "pro"
    return "free"


def _next_tier(current: str) -> tuple[str | None, float | None]:
    """Return (next_tier, volume_threshold) or (None, None) if already at top."""
    rank = _tier_rank(current)
    next_tiers = [t for t, thresh in _ACTIVITY_THRESHOLDS.items() if _tier_rank(t) > rank]
    if not next_tiers:
        return None, None
    nxt = min(next_tiers, key=lambda t: _ACTIVITY_THRESHOLDS[t])
    return nxt, _ACTIVITY_THRESHOLDS[nxt]


class VipService:
    def get_status(self, user_id: int, paid_tier: str) -> dict[str, Any]:
        """Return VIP status dict for the given user.

        Args:
            user_id: Internal DB user id (used for season volume lookup).
            paid_tier: The user's current paid subscription tier (from x402_service).

        Returns a dict with keys:
            effective_tier, paid_tier, activity_tier, point_multiplier,
            season_volume_usd, is_boosted_by_activity, next_tier,
            volume_to_next_usd, enabled.
        """
        enabled = getattr(settings, "vip_activity_enabled", True)

        # Fetch season volume — fall back to 0 on any error so VIP never breaks the bot
        season_volume_usd = 0.0
        try:
            season_volume_usd = self._get_season_volume(user_id)
        except Exception as exc:
            logger.warning("VIP season volume lookup failed for user %s: %s", user_id, exc)

        paid_tier = (paid_tier or "free").lower()
        act_tier = _activity_tier(season_volume_usd) if enabled else "free"

        # Effective tier = best of paid vs activity
        effective_tier = paid_tier if _tier_rank(paid_tier) >= _tier_rank(act_tier) else act_tier
        is_boosted = _tier_rank(act_tier) > _tier_rank(paid_tier)

        nxt, nxt_thresh = _next_tier(act_tier)
        volume_to_next = (nxt_thresh - season_volume_usd) if nxt_thresh is not None else None

        return {
            "effective_tier": effective_tier,
            "paid_tier": paid_tier,
            "activity_tier": act_tier,
            "point_multiplier": _MULTIPLIERS.get(effective_tier, 1.0),
            "season_volume_usd": season_volume_usd,
            "is_boosted_by_activity": is_boosted,
            "next_tier": nxt,
            "volume_to_next_usd": volume_to_next,
            "enabled": enabled,
        }

    def _get_season_volume(self, user_id: int) -> float:
        """Sum trading volume for the current season from the DB."""
        try:
            from database.db import get_session
            from bot.models.seasons import SeasonPoints

            with get_session() as session:
                # season_volume_usd is a denormalised column updated by the swap engine
                row = (
                    session.query(SeasonPoints)
                    .filter(SeasonPoints.user_id == user_id)
                    .order_by(SeasonPoints.season_id.desc())
                    .first()
                )
                if row and hasattr(row, "season_volume_usd"):
                    return float(row.season_volume_usd or 0)
        except Exception as exc:
            logger.debug("Season volume DB fetch failed: %s", exc)
        return 0.0


vip_service = VipService()
