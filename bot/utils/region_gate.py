"""Region gating for compliance-restricted features (perps + prediction markets).

Mirrors ``polymarket_region_allowed`` in ``bot/handlers/predict.py``: same
User/session lookup, same fail-open behavior for unknown regions and lookup
errors — we only hard-refuse users we positively know are in a restricted
region. Swap, bridge, and every other feature are untouched by this gate.
"""

import logging

from bot.config.settings import settings
from bot.models.user import User
from database.db import get_session

logger = logging.getLogger(__name__)


def _derivatives_restricted_regions() -> set:
    """Regions where perps + prediction market trading are geo-blocked.

    Defaults to the US-only fallback when no explicit setting is configured.
    """
    raw = getattr(settings, "derivatives_restricted_regions", None)
    if raw is None:
        raw = "US"
    return {r.strip().upper() for r in str(raw).split(",") if r.strip()}


def derivatives_region_allowed(telegram_id: int) -> bool:
    """Whether futures/perps and prediction-market trading may be offered.

    A KNOWN region not in the restricted set is allowed; an unknown region is
    allowed too (fail-open) — we only hard-refuse users we positively know
    are restricted.
    """
    try:
        with get_session() as session:
            user = session.query(User).filter(User.telegram_id == telegram_id).first()
            region = (user.region or "").strip().upper() if user else ""
        if not region:
            return True  # unknown — do not block
        return region not in _derivatives_restricted_regions()
    except Exception as e:  # noqa: BLE001 — never break the feature on a region read
        logger.warning("derivatives region lookup failed for %s: %s", telegram_id, e)
        return True


def derivatives_blocked_message() -> str:
    """User-facing message shown when derivatives trading is geo-blocked."""
    return (
        "⛔ Futures and prediction markets are not available in your region "
        "for regulatory reasons. Swapping and bridging remain fully available."
    )
