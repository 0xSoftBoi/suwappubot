"""DB-backed spending-limit enforcement for swap execution.

The enforcement point is ``SwapEngine.execute_swap`` — the single choke point
that every swap entry path (Telegram, WhatsApp, agent API, limit orders, copy
trading) funnels through. Handlers may additionally pre-check for friendlier
UX before prompting for 2FA.

Spend windows are computed from the ``spend_events`` table rather than
``swap_transactions.from_amount_usd`` (which historically held token amounts,
not USD) or the in-memory ``SpendingTracker`` (which forgets on restart).
"""

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Optional, Tuple

from sqlalchemy import func

from bot.models.favorites import UserSettings
from bot.models.security import SpendEvent
from bot.models.user import User
from database.db import get_session

logger = logging.getLogger(__name__)

DEFAULT_PER_SWAP_LIMIT_USD = 5000.0
DEFAULT_DAILY_LIMIT_USD = 50000.0
DEFAULT_2FA_THRESHOLD_USD = 1000.0


@dataclass
class UserLimits:
    """Effective spending limits for a user."""

    per_swap_usd: float = DEFAULT_PER_SWAP_LIMIT_USD
    daily_usd: float = DEFAULT_DAILY_LIMIT_USD
    twofa_above_usd: float = DEFAULT_2FA_THRESHOLD_USD


class SpendingLimitService:
    """Check and record USD outflow against per-user limits."""

    def get_limits(self, user_id: int) -> UserLimits:
        """Load the user's limits from UserSettings, falling back to defaults."""
        with get_session() as session:
            us = session.query(UserSettings).filter(UserSettings.user_id == user_id).first()
            if not us:
                return UserLimits()
            return UserLimits(
                per_swap_usd=(
                    us.per_swap_limit_usd
                    if us.per_swap_limit_usd is not None
                    else DEFAULT_PER_SWAP_LIMIT_USD
                ),
                daily_usd=(
                    us.daily_limit_usd
                    if us.daily_limit_usd is not None
                    else DEFAULT_DAILY_LIMIT_USD
                ),
                twofa_above_usd=(
                    us.require_2fa_above_usd
                    if us.require_2fa_above_usd is not None
                    else DEFAULT_2FA_THRESHOLD_USD
                ),
            )

    def get_spent_usd(self, user_id: int, hours: float = 24.0) -> float:
        """Total recorded USD outflow for the trailing window."""
        cutoff = datetime.utcnow() - timedelta(hours=hours)
        with get_session() as session:
            total = (
                session.query(func.coalesce(func.sum(SpendEvent.amount_usd), 0.0))
                .filter(SpendEvent.user_id == user_id, SpendEvent.created_at >= cutoff)
                .scalar()
            )
            return float(total or 0.0)

    def check(self, user_id: int, amount_usd: float) -> Tuple[bool, Optional[str]]:
        """Return (allowed, reason). Reason is a user-facing message when blocked."""
        limits = self.get_limits(user_id)

        if amount_usd > limits.per_swap_usd:
            return False, (
                f"Amount (${amount_usd:,.0f}) exceeds your per-swap limit of "
                f"${limits.per_swap_usd:,.0f}. Adjust it in /set → Limits."
            )

        daily_spent = self.get_spent_usd(user_id, hours=24.0)
        if daily_spent + amount_usd > limits.daily_usd:
            remaining = max(0.0, limits.daily_usd - daily_spent)
            return False, (
                f"This swap would exceed your 24h limit of ${limits.daily_usd:,.0f} "
                f"(${remaining:,.0f} remaining). Adjust it in /set → Limits."
            )

        return True, None

    def record(self, user_id: int, amount_usd: float, swap_id: int = None, kind: str = "swap"):
        """Record a USD outflow event (call at submission time)."""
        with get_session() as session:
            session.add(
                SpendEvent(user_id=user_id, amount_usd=amount_usd, swap_id=swap_id, kind=kind)
            )

    def effective_2fa_threshold(self, user_id: int) -> float:
        """The USD amount at/above which a swap requires a 2FA code.

        Two thresholds exist historically (users.two_fa_threshold from the 2FA
        service, user_settings.require_2fa_above_usd from the settings UI).
        Take the lower of the two — the most protective interpretation — so
        neither surface silently weakens what the other promised the user.
        """
        threshold = self.get_limits(user_id).twofa_above_usd
        with get_session() as session:
            user = session.query(User).filter(User.id == user_id).first()
            if user and user.two_fa_threshold is not None:
                threshold = min(threshold, float(user.two_fa_threshold))
        return threshold

    async def usd_value(self, token_symbol: str, amount: float) -> Optional[float]:
        """Best-effort USD value of a token amount; None when the price is unknown."""
        try:
            from bot.services.price_service import price_service

            price = await price_service.get_price(token_symbol)
            if price is None or price <= 0:
                return None
            return amount * price
        except Exception as e:
            logger.warning(f"USD price lookup failed for {token_symbol}: {e}")
            return None


# Global instance
spending_limit_service = SpendingLimitService()
