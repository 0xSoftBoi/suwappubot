"""Tempo fee sponsorship for gasless transactions.

On Tempo, transaction fees are paid in TIP-20 stablecoins.
Fee sponsorship allows the bot to pay gas on behalf of users
for their first few transactions (onboarding UX).
"""

import logging
from dataclasses import dataclass
from typing import Optional
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# Default sponsorship config (used only as a hard fallback if settings are
# unavailable; the constructor prefers values from bot.config.settings).
MAX_SPONSORED_TXS_PER_USER = 3
DAILY_SPONSOR_BUDGET_USD = 100.0
DEFAULT_FEE_TOKEN = "pathUSD"


@dataclass
class SponsorshipResult:
    """Result of a sponsorship check."""

    should_sponsor: bool
    reason: str
    remaining_txs: int
    fee_token: str


class TempoFeeSponsor:
    """Manages fee sponsorship for Tempo transactions.

    Sponsors gas for new users' first few transactions to improve
    onboarding UX. Gas on Tempo is paid in TIP-20 stablecoins,
    so sponsorship cost is predictable (sub-$0.001 per tx).
    """

    def __init__(
        self,
        max_sponsored_txs: Optional[int] = None,
        daily_budget_usd: Optional[float] = None,
        fee_token: str = DEFAULT_FEE_TOKEN,
    ):
        # Prefer values from settings; fall back to module constants if either
        # the caller passed explicit values or settings is unavailable.
        if max_sponsored_txs is None or daily_budget_usd is None:
            try:
                from bot.config.settings import settings

                if max_sponsored_txs is None:
                    max_sponsored_txs = settings.tempo_sponsor_max_txs
                if daily_budget_usd is None:
                    daily_budget_usd = settings.tempo_sponsor_daily_budget_usd
            except Exception:
                pass

        self.max_sponsored_txs = (
            max_sponsored_txs if max_sponsored_txs is not None else MAX_SPONSORED_TXS_PER_USER
        )
        self.daily_budget_usd = (
            daily_budget_usd if daily_budget_usd is not None else DAILY_SPONSOR_BUDGET_USD
        )
        self.fee_token = fee_token

    def _get_daily_spend(self) -> float:
        """Sum today's (UTC) sponsored spend across all users.

        The daily budget is global, so we aggregate every user's daily_spend_usd
        for rows whose ``day`` is today. Rows from prior days are treated as 0
        (lazy reset happens on write in record_sponsored_tx).
        """
        from database.db import get_session
        from bot.models.tempo import TempoSponsorship

        today = datetime.now(timezone.utc).date()
        with get_session() as session:
            rows = (
                session.query(TempoSponsorship.daily_spend_usd)
                .filter(TempoSponsorship.day == today)
                .all()
            )
        return float(sum((r[0] or 0.0) for r in rows))

    def check_sponsorship(
        self,
        user_id: int,
        tx_type: str = "swap",
        estimated_fee_usd: float = 0.001,
    ) -> SponsorshipResult:
        """Decide whether the bot should sponsor gas for this transaction.

        Reads the per-user count and global daily spend from the DB so limits
        hold across restarts/replicas.

        Args:
            user_id: Telegram user ID
            tx_type: Transaction type (swap, transfer, etc.)
            estimated_fee_usd: Estimated fee in USD
        """
        from database.db import get_session
        from bot.models.tempo import TempoSponsorship

        today = datetime.now(timezone.utc).date()
        with get_session() as session:
            row = (
                session.query(TempoSponsorship).filter(TempoSponsorship.user_id == user_id).first()
            )
            user_count = row.tx_count if row else 0

        remaining = max(0, self.max_sponsored_txs - user_count)

        # Check user limit
        if user_count >= self.max_sponsored_txs:
            return SponsorshipResult(
                should_sponsor=False,
                reason=f"User has used all {self.max_sponsored_txs} sponsored transactions",
                remaining_txs=0,
                fee_token=self.fee_token,
            )

        # Check daily budget (global, today only)
        daily_spend = self._get_daily_spend()
        if daily_spend + estimated_fee_usd > self.daily_budget_usd:
            return SponsorshipResult(
                should_sponsor=False,
                reason="Daily sponsorship budget exhausted",
                remaining_txs=remaining,
                fee_token=self.fee_token,
            )

        return SponsorshipResult(
            should_sponsor=True,
            reason=f"Sponsored tx {user_count + 1}/{self.max_sponsored_txs}",
            remaining_txs=remaining - 1,
            fee_token=self.fee_token,
        )

    def record_sponsored_tx(self, user_id: int, fee_usd: float):
        """Record that a sponsored transaction was executed (DB-backed).

        Upserts the per-user row, increments tx_count, and adds to today's
        daily_spend_usd. If the stored ``day`` is older than today (UTC), the
        daily_spend resets before this fee is added.
        """
        from database.db import get_session
        from bot.models.tempo import TempoSponsorship

        today = datetime.now(timezone.utc).date()
        with get_session() as session:
            row = (
                session.query(TempoSponsorship).filter(TempoSponsorship.user_id == user_id).first()
            )
            if row is None:
                row = TempoSponsorship(
                    user_id=user_id,
                    tx_count=0,
                    daily_spend_usd=0.0,
                    day=today,
                )
                session.add(row)

            # Daily reset: stored day older than today -> reset daily_spend.
            if row.day != today:
                row.daily_spend_usd = 0.0
                row.day = today

            row.tx_count = (row.tx_count or 0) + 1
            row.daily_spend_usd = (row.daily_spend_usd or 0.0) + fee_usd
            new_count = row.tx_count
            new_daily = row.daily_spend_usd

        logger.info(
            f"Sponsored tx for user {user_id}: ${fee_usd:.4f} "
            f"(total: {new_count}/{self.max_sponsored_txs}, "
            f"daily: ${new_daily:.2f}/${self.daily_budget_usd})"
        )

    def build_sponsored_tx(
        self,
        tx: dict,
        sponsor_address: str,
        fee_token_address: Optional[str] = None,
    ) -> dict:
        """Wrap a transaction with fee sponsorship metadata.

        On Tempo, fee sponsorship is done by setting the feePayer field
        in the transaction to the sponsor's address.

        Args:
            tx: Original transaction dict
            sponsor_address: Address that will pay the fee
            fee_token_address: TIP-20 token address to pay fee in
        """
        # T2 breaking change: fee payer cannot equal sender
        sender = tx.get("from", "")
        if sender and sponsor_address.lower() == sender.lower():
            raise ValueError("Tempo T2: fee payer cannot equal sender")

        sponsored = dict(tx)
        sponsored["feePayer"] = sponsor_address
        if fee_token_address:
            sponsored["feeToken"] = fee_token_address
        return sponsored


# Global instance
tempo_fee_sponsor = TempoFeeSponsor()
