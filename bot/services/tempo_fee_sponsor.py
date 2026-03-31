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

# Default sponsorship config
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
        max_sponsored_txs: int = MAX_SPONSORED_TXS_PER_USER,
        daily_budget_usd: float = DAILY_SPONSOR_BUDGET_USD,
        fee_token: str = DEFAULT_FEE_TOKEN,
    ):
        self.max_sponsored_txs = max_sponsored_txs
        self.daily_budget_usd = daily_budget_usd
        self.fee_token = fee_token
        # In-memory tracking (production should use DB)
        self._user_tx_counts: dict[int, int] = {}
        self._daily_spend: float = 0.0
        self._last_reset: datetime = datetime.now(timezone.utc)

    def _reset_daily_if_needed(self):
        """Reset daily budget counter if a new day has started."""
        now = datetime.now(timezone.utc)
        if now.date() > self._last_reset.date():
            self._daily_spend = 0.0
            self._last_reset = now

    def check_sponsorship(
        self,
        user_id: int,
        tx_type: str = "swap",
        estimated_fee_usd: float = 0.001,
    ) -> SponsorshipResult:
        """Decide whether the bot should sponsor gas for this transaction.

        Args:
            user_id: Telegram user ID
            tx_type: Transaction type (swap, transfer, etc.)
            estimated_fee_usd: Estimated fee in USD
        """
        self._reset_daily_if_needed()

        user_count = self._user_tx_counts.get(user_id, 0)
        remaining = max(0, self.max_sponsored_txs - user_count)

        # Check user limit
        if user_count >= self.max_sponsored_txs:
            return SponsorshipResult(
                should_sponsor=False,
                reason=f"User has used all {self.max_sponsored_txs} sponsored transactions",
                remaining_txs=0,
                fee_token=self.fee_token,
            )

        # Check daily budget
        if self._daily_spend + estimated_fee_usd > self.daily_budget_usd:
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
        """Record that a sponsored transaction was executed."""
        self._user_tx_counts[user_id] = self._user_tx_counts.get(user_id, 0) + 1
        self._daily_spend += fee_usd
        logger.info(
            f"Sponsored tx for user {user_id}: ${fee_usd:.4f} "
            f"(total: {self._user_tx_counts[user_id]}/{self.max_sponsored_txs}, "
            f"daily: ${self._daily_spend:.2f}/${self.daily_budget_usd})"
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
