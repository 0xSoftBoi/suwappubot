"""Fee service for calculating and collecting swap fees.

Suwappu Competitive Pricing (Option B Hybrid):
- FREE:       1.0% swap fee
- PRO:        0.5% swap fee
- PREMIUM:    0.3% swap fee
- ENTERPRISE: 0.1% swap fee
- 30% referral rewards (aggressive growth)
- User pays gas (separate from swap fee)
"""

import logging
from typing import Dict, List, Optional, Tuple, TYPE_CHECKING
from decimal import Decimal, ROUND_DOWN
from dataclasses import dataclass
from datetime import datetime, timezone

from bot.config.settings import settings
from bot.models.fees import FeeTransaction
from bot.models.subscription import SubscriptionTier
from database.db import get_session

logger = logging.getLogger(__name__)

# ============================================
# FEE CONSTANTS - Option B Hybrid Pricing
# ============================================

# Legacy flat rate (kept for backward-compat reference only)
SWAP_FEE_PERCENTAGE = Decimal("0.8")  # 0.8% (legacy)
SWAP_FEE_DECIMAL = SWAP_FEE_PERCENTAGE / Decimal("100")  # 0.008 (legacy)

# Tier-based fee rates (as plain decimals, e.g. 0.01 = 1%)
TIER_FEE_RATES = {
    SubscriptionTier.FREE: 0.01,  # 1%
    SubscriptionTier.PRO: 0.005,  # 0.5%
    SubscriptionTier.PREMIUM: 0.003,  # 0.3%
    SubscriptionTier.ENTERPRISE: 0.001,  # 0.1%
}
DEFAULT_FEE_RATE = 0.01  # fallback if tier lookup fails

# Floor for the EFFECTIVE fee after a points-based fee_discount is applied, BEFORE
# the position-card discount. Stacking rule (see get_fee_decimal for the full
# derivation):
#   tier_after_points = max(MIN_EFFECTIVE_FEE_RATE, tier_fee − points_discount)
#   effective_fee      = tier_after_points * (1 − positions_fraction)
# We floor the points step at the ENTERPRISE rate (0.1%) so a points discount can
# match — but never beat — our best paid tier.
MIN_EFFECTIVE_FEE_RATE = TIER_FEE_RATES[SubscriptionTier.ENTERPRISE]  # 0.001 = 0.1%

# Absolute floor on the FINAL effective fee, after the proportional position-card
# discount and the referee rebate have both been applied. Its only job is the
# never-zero/never-negative guard: a zero fee would also zero the referral
# fee-share and treasury split. Deliberately below the minimum reachable rate
# (ENTERPRISE + card + referee rebate = 10bps * 0.60 * 0.90 = 5.4bps) so it is
# never the binding constraint in practice.
ABSOLUTE_FLOOR = 0.0002  # 0.0002 = 0.02% = 2 bps

# Referral rewards: 30% of fees (aggressive growth)
REFERRAL_REWARD_PERCENTAGE = Decimal("30")  # 30%
REFERRAL_REWARD_DECIMAL = REFERRAL_REWARD_PERCENTAGE / Decimal("100")  # 0.30

# Swap limits
MIN_SWAP_USD = Decimal("1")  # No barriers to entry
MAX_SWAP_USD = Decimal("100000")  # Risk management

# Fee collector address (from settings or default)
FEE_COLLECTOR_EVM = getattr(settings, "fee_collector_address", None)
FEE_COLLECTOR_SOLANA = getattr(settings, "fee_collector_solana", None)


@dataclass
class FeeCalculation:
    """Result of fee calculation."""

    swap_amount_usd: Decimal
    fee_amount_usd: Decimal
    fee_percentage: Decimal
    referral_reward_usd: Decimal
    net_fee_usd: Decimal  # Fee after referral payout

    # Token amounts (if provided)
    fee_amount_token: Optional[Decimal] = None
    token_symbol: Optional[str] = None

    # Staking pool split (40/60 of the net fee, i.e. after the referral payout)
    staking_allocation_usd: float = 0.0  # 40% of net_fee_usd
    protocol_allocation_usd: float = 0.0  # 60% of net_fee_usd

    # Referral info
    referrer_id: Optional[int] = None
    has_referrer: bool = False


class FeeService:
    """Service for calculating and collecting swap fees.

    Pricing strategy (Option B Hybrid, tier-based):
    - Swap fee by subscription tier: Free 1.0% / Pro 0.5% / Premium 0.3% / Enterprise 0.1%
    - 30% of the gross fee goes to the referrer (viral growth)
    - The remaining net fee is split 40/60 between the staking pool and protocol treasury
    """

    def __init__(self):
        self.fee_percentage = SWAP_FEE_DECIMAL
        self.referral_percentage = REFERRAL_REWARD_DECIMAL

    # ---- Single source of truth for the fee RATE -------------------------
    # Everything that needs the fee rate — the on-chain aggregator param we
    # SEND (Jupiter platformFeeBps, Li.Fi fee), the quote we DISPLAY, and the
    # amount we RECORD/pay referrers on — must derive from these, so the
    # collected fee can never drift from the recorded one.

    def _active_referee_rebate_applies(self, user_id: "Optional[int]") -> bool:
        """Return True if the user is a referee with first-5-swaps rebate remaining.

        READ-ONLY — never decrements the counter. The single decrement source of
        truth is ``referral_service.record_reward``, which is called exactly once
        per completed swap AFTER this rate is applied. This function only decides
        whether the discount appears in the quoted/charged rate.

        Returns False on any lookup failure (defensive; never breaks fee calc).
        """
        if user_id is None:
            return False
        try:
            from bot.models.referral import Referral

            with get_session() as session:
                referral = (
                    session.query(Referral)
                    .filter(
                        Referral.referee_id == user_id,
                        Referral.is_active == True,
                        Referral.referee_swap_rebate_remaining > 0,
                    )
                    .first()
                )
                return referral is not None
        except Exception as e:
            logger.warning(f"Referee rebate lookup failed for user {user_id}: {e}")
            return False

    def _active_fee_discount_decimal(self, user_id: "Optional[int]") -> float:
        """Active points fee-discount for a user, as a plain DECIMAL (0.005 = 0.5%).

        ``points_service.get_active_fee_discount`` returns PERCENTAGE POINTS
        (e.g. 0.5 == 0.5%), so we divide by 100 to match the decimal fee rate.
        Read-only + time-bound (never consumed here). GUARDRAIL: a points lookup
        failure must NEVER break fee calculation, so this swallows all errors and
        returns 0.0 (no discount). Returns 0.0 when ``user_id`` is None.
        """
        if user_id is None:
            return 0.0
        try:
            from bot.services.points_service import points_service

            pct = points_service.get_active_fee_discount(user_id)
            return max(0.0, float(pct) / 100.0)
        except Exception as e:  # pragma: no cover - defensive
            logger.warning(f"fee discount lookup failed for user {user_id}: {e}")
            return 0.0

    def _positions_discount_fraction(self, user_id: "Optional[int]") -> float:
        """Suwappu Position Cards NFT fee discount for a user, as a PROPORTIONAL
        fraction of whatever rate the user landed on after tier + points
        (0.40 == 40% off that rate), NOT a flat number of percentage points.

        Proportional, not flat, so it scales with the tier and can never invert
        or collapse the tier ladder — a flat bps subtraction floored PRO and
        PREMIUM to the same rate, because they are only 20bps apart. This is a
        pure in-memory cache read — no RPC, no DB — because it runs on the swap
        pricing path; the cache is warmed from the async swap path via
        ``position_cards_service.warm_for_user``. A cold cache yields 0.0 (no discount).

        GUARDRAIL: like the points lookup, this must NEVER break fee calculation,
        so all errors are swallowed and return 0.0. It can only ever REDUCE the
        fee, and the caller's final result is still floored at ABSOLUTE_FLOOR, so
        a bad read cannot produce a zero or negative fee.
        """
        if user_id is None:
            return 0.0
        try:
            from bot.services.position_cards_service import position_cards_service

            fraction = position_cards_service.get_cached_discount_fraction_for_user(user_id)
            return max(0.0, float(fraction))
        except Exception as e:  # pragma: no cover - defensive
            logger.warning(f"Position-card discount lookup failed for user {user_id}: {e}")
            return 0.0

    def get_fee_decimal(
        self,
        tier: "Optional[SubscriptionTier]" = None,
        user_id: "Optional[int]" = None,
    ) -> float:
        """EFFECTIVE fee rate as a plain decimal (e.g. 0.01 = 1%) for the user.

        Stacking rule (single source of truth for the charged rate):

            tier_after_points = max(MIN_EFFECTIVE_FEE_RATE, tier_fee − points_discount)
            effective_fee     = tier_after_points * (1.0 − positions_fraction)
            if referee_rebate_applies: effective_fee *= 0.90
            effective_fee     = max(ABSOLUTE_FLOOR, effective_fee)

        - ``tier_fee`` comes from TIER_FEE_RATES (subscription tier).
        - ``points_discount`` is the best ACTIVE points-redeemed fee_discount for
          this user (read-only, time-bound) — only applied when ``user_id`` is
          given. It is ABSOLUTE (percentage points) and floored at
          MIN_EFFECTIVE_FEE_RATE (the ENTERPRISE rate) so a points redemption can
          match — but never beat — our best paid tier.
        - ``positions_fraction`` is the PROPORTIONAL discount granted by holding a
          Suwappu Positions card (Robinhood Chain, chain 4663) — e.g. 0.40 means
          "40% off whatever rate the user landed on after tier + points", not a
          flat number of percentage points. Flat per holder, not per card, so
          stacking cards cannot compound it. Cache-only read, so it never adds
          latency to pricing. PROPORTIONAL rather than absolute is deliberate: a
          flat bps subtraction from unevenly-spaced tiers (FREE 100 / PRO 50 /
          PREMIUM 30 / ENTERPRISE 10) collapsed PRO and PREMIUM to the same
          floored rate, making PREMIUM worthless to a card holder. Multiplying
          instead preserves the ladder for every tier. NOT offered on
          ENTERPRISE: that tier is contracted pricing and is deliberately out of
          reach of a tradeable NFT.
        - The final result is FLOORED at ABSOLUTE_FLOOR (2 bps) so the fee can
          NEVER go negative or to zero — that would also zero the referral
          fee-share and treasury split.

        Because the on-chain bps, the displayed quote, and the recorded fee all
        derive from this method, the discount applies consistently everywhere and
        the referral fee-share (a % of the reduced fee) scales down with it.
        """
        if tier is not None:
            base = TIER_FEE_RATES.get(tier, DEFAULT_FEE_RATE)
        else:
            base = DEFAULT_FEE_RATE
        discount = self._active_fee_discount_decimal(user_id)
        # ENTERPRISE is contracted pricing, negotiated per customer — it is not
        # something a consumer NFT is allowed to move. A card bought on the open
        # market must never discount a rate that was agreed in a contract, so the
        # perk stops at PREMIUM. This is a commercial rule, not a math one: the
        # proportional discount would order fine at ENTERPRISE (10 -> 6bps), it
        # simply is not on offer there.
        if tier is SubscriptionTier.ENTERPRISE:
            positions_fraction = 0.0
        else:
            positions_fraction = self._positions_discount_fraction(user_id)

        # Absolute: floored at the ENTERPRISE rate so a points redemption can
        # match, but never beat, our best paid tier.
        tier_after_points = max(MIN_EFFECTIVE_FEE_RATE, base - discount)
        # Proportional: multiplies the post-points rate, so it scales with tier
        # and can never invert the ladder.
        effective = tier_after_points * (1.0 - positions_fraction)
        # Consumer perks may MATCH contracted pricing but never beat it. Without
        # this, excluding ENTERPRISE from the card inverts the ladder: a PREMIUM
        # holder stacking a points redemption with a card lands under the
        # ENTERPRISE rate, so the tier nobody negotiated undercuts the one that
        # was negotiated. Same floor and same reasoning as the points step above;
        # it has to be re-applied here because the card is multiplicative and
        # therefore lands BELOW a floor that was only checked before it.
        # ENTERPRISE is exempt so its own referee rebate can still bite.
        if tier is not SubscriptionTier.ENTERPRISE:
            effective = max(MIN_EFFECTIVE_FEE_RATE, effective)

        # Referral v2 — referee first-5-swaps rebate: 10% off the effective rate.
        # READ-ONLY: this never decrements referee_swap_rebate_remaining.
        # Decrement is the sole responsibility of referral_service.record_reward,
        # which is called exactly once per completed swap. That single write ensures
        # the rebate count cannot be consumed twice per swap.
        # This discount flows through to get_fee_bps (on-chain), calculate_fee
        # (recorded fee), and the displayed quote, so the referee genuinely pays
        # 10% less for their first 5 swaps everywhere.
        if self._active_referee_rebate_applies(user_id):
            effective = effective * 0.90

        return max(ABSOLUTE_FLOOR, effective)

    def get_fee_bps(
        self,
        tier: "Optional[SubscriptionTier]" = None,
        user_id: "Optional[int]" = None,
    ) -> int:
        """EFFECTIVE fee rate in basis points (e.g. 100 = 1%) for the user.

        This is the exact value passed to Jupiter as ``platformFeeBps``. Applies
        the same tier − points_discount stacking (floored) as get_fee_decimal, so
        the on-chain fee can never diverge from the displayed/recorded fee.
        """
        return int(round(self.get_fee_decimal(tier, user_id=user_id) * 10_000))

    def calculate_fee(
        self,
        swap_amount_usd: float,
        referrer_id: Optional[int] = None,
        tier: "Optional[SubscriptionTier]" = None,
        user_id: "Optional[int]" = None,
    ) -> FeeCalculation:
        """
        Calculate fee for a swap.

        Args:
            swap_amount_usd: Swap amount in USD
            referrer_id: Optional referrer user ID for reward calculation
            tier: User's subscription tier; determines fee rate. Falls back
                  to DEFAULT_FEE_RATE (1%) when None.
            user_id: When given, applies the user's active points fee_discount
                  on top of the tier rate (floored) — see get_fee_decimal. The
                  referral reward (a % of this fee) scales down with the discount.

        Returns:
            FeeCalculation with all fee details
        """
        amount = Decimal(str(swap_amount_usd))

        # Resolve EFFECTIVE fee rate (tier − points discount, floored) as Decimal
        # to avoid float arithmetic. Routed through get_fee_decimal so the
        # recorded fee uses the SAME rate we send to the aggregators on-chain.
        fee_rate = Decimal(str(self.get_fee_decimal(tier, user_id=user_id)))
        # fee_percentage_display is e.g. Decimal("1.0") meaning "1%"
        fee_percentage_display = fee_rate * Decimal("100")

        # Calculate base fee
        fee_amount = (amount * fee_rate).quantize(Decimal("0.01"), rounding=ROUND_DOWN)

        # Calculate referral reward if applicable
        has_referrer = referrer_id is not None
        referral_reward = Decimal("0")

        if has_referrer:
            referral_reward = (fee_amount * self.referral_percentage).quantize(
                Decimal("0.01"), rounding=ROUND_DOWN
            )

        # Net fee (what we keep after paying the referrer)
        net_fee = fee_amount - referral_reward

        # 40/60 split of the NET fee: staking pool vs protocol treasury.
        # Splitting net (not gross) keeps the allocation consistent —
        # referral + staking + protocol == fee_amount (otherwise a referred
        # swap would "allocate" 30% + 40% + 60% = 130% of the fee).
        staking_allocation_usd = float(net_fee) * 0.40
        protocol_allocation_usd = float(net_fee) * 0.60

        return FeeCalculation(
            swap_amount_usd=amount,
            fee_amount_usd=fee_amount,
            fee_percentage=fee_percentage_display,
            referral_reward_usd=referral_reward,
            net_fee_usd=net_fee,
            staking_allocation_usd=staking_allocation_usd,
            protocol_allocation_usd=protocol_allocation_usd,
            referrer_id=referrer_id,
            has_referrer=has_referrer,
        )

    def calculate_fee_in_token(
        self,
        swap_amount: float,
        token_price_usd: float,
        token_symbol: str,
        referrer_id: Optional[int] = None,
        tier: "Optional[SubscriptionTier]" = None,
    ) -> FeeCalculation:
        """
        Calculate fee in token terms.

        Args:
            swap_amount: Amount of tokens being swapped
            token_price_usd: Price of token in USD
            token_symbol: Token symbol
            referrer_id: Optional referrer user ID
            tier: User's subscription tier for fee rate selection

        Returns:
            FeeCalculation with token amounts
        """
        swap_amount_usd = float(swap_amount) * token_price_usd
        calc = self.calculate_fee(swap_amount_usd, referrer_id, tier=tier)

        # Calculate fee in token terms
        if token_price_usd > 0:
            fee_in_token = float(calc.fee_amount_usd) / token_price_usd
            calc.fee_amount_token = Decimal(str(fee_in_token)).quantize(
                Decimal("0.000001"), rounding=ROUND_DOWN
            )

        calc.token_symbol = token_symbol
        return calc

    async def calculate_fee_with_price(
        self,
        amount: float,
        token_symbol: str,
        tier: "Optional[SubscriptionTier]" = None,
        user_id: "Optional[int]" = None,
    ) -> Tuple[float, float, float]:
        """
        Calculate fee with automatic price lookup.

        Args:
            amount: Amount of tokens being swapped
            token_symbol: Token symbol
            tier: User's subscription tier; determines fee rate. Falls back
                  to DEFAULT_FEE_RATE (1%) when None.
            user_id: When given, applies the user's active points fee_discount on
                  top of the tier rate (floored) — see get_fee_decimal. Pass it so
                  the DISPLAYED fee matches the on-chain bps and the recorded fee.

        Returns:
            Tuple of (fee_amount_token, fee_percentage, fee_amount_usd)
            where fee_percentage is a percent-number e.g. 1.0 means 1%.
        """
        from bot.services.price_service import price_service

        # Get token price
        prices = await price_service.get_prices([token_symbol])
        token_price = prices.get(token_symbol.upper(), 1.0)

        # Calculate USD value
        amount_usd = amount * token_price

        # Calculate fee with the EFFECTIVE rate (tier − points discount, floored)
        calc = self.calculate_fee(amount_usd, tier=tier, user_id=user_id)

        # Convert fee back to token amount
        fee_amount_token = float(calc.fee_amount_usd) / token_price if token_price > 0 else 0

        return (
            fee_amount_token,
            float(calc.fee_percentage),  # already a percent-number (e.g. 1.0 = 1%)
            float(calc.fee_amount_usd),
        )

    def validate_swap_amount(self, amount_usd: float) -> Tuple[bool, str]:
        """
        Validate swap amount against limits.

        Args:
            amount_usd: Swap amount in USD

        Returns:
            Tuple of (is_valid, error_message)
        """
        amount = Decimal(str(amount_usd))

        if amount < MIN_SWAP_USD:
            return False, f"Minimum swap amount is ${MIN_SWAP_USD}"

        if amount > MAX_SWAP_USD:
            return False, f"Maximum swap amount is ${MAX_SWAP_USD:,}"

        return True, ""

    def record_fee(
        self,
        swap_id: int,
        user_id: int,
        fee_amount_usd: float,
        chain: str,
        fee_token: Optional[str] = None,
        token_symbol: Optional[str] = None,
        fee_amount_token: float = 0,
        fee_amount: float = 0,
        swap_amount: float = 0,
        fee_percentage: float = 0,
        referrer_id: Optional[int] = None,
        referral_reward_usd: float = 0,
    ) -> FeeTransaction:
        """
        Record a fee transaction in the database.

        Args:
            swap_id: Associated swap transaction ID
            user_id: User who paid the fee
            fee_amount_usd: Fee in USD
            fee_token: Token used for fee
            fee_amount_token: Fee in token amount
            chain: Blockchain chain
            referrer_id: Optional referrer for reward
            referral_reward_usd: Referral reward amount

        Returns:
            Created FeeTransaction
        """
        # Accept both fee_token and token_symbol (caller uses token_symbol)
        resolved_token = fee_token or token_symbol or "UNKNOWN"
        resolved_fee_amount = fee_amount_token or fee_amount
        resolved_fee_pct = fee_percentage or (DEFAULT_FEE_RATE * 100)  # free-tier default (1.0%)

        with get_session() as session:
            fee_tx = FeeTransaction(
                swap_id=swap_id,
                user_id=user_id,
                fee_amount=fee_amount_usd,
                fee_amount_usd=fee_amount_usd,
                token_symbol=resolved_token,
                swap_amount=swap_amount,
                fee_percentage=resolved_fee_pct,
                chain=chain,
                collected=False,
                created_at=datetime.now(timezone.utc),
                # TODO(staking): add staking_allocation_usd and protocol_allocation_usd
                # columns to FeeTransaction to persist the 40/60 net-fee split per-record.
                # The split is already computed on FeeCalculation.staking_allocation_usd /
                # FeeCalculation.protocol_allocation_usd for in-process consumers.
            )
            session.add(fee_tx)
            session.flush()

            fee_id = fee_tx.id

        logger.info(
            f"Recorded fee: ${fee_amount_usd:.2f} ({resolved_fee_amount} {resolved_token}) "
            f"for swap {swap_id}, user {user_id}"
        )

        return fee_tx

    def get_fee_summary(self, user_id: int) -> Dict[str, float]:
        """Get fee summary for a user."""
        with get_session() as session:
            from sqlalchemy import func

            fees = (
                session.query(
                    func.sum(FeeTransaction.fee_amount).label("total_fees"),
                    func.count(FeeTransaction.id).label("total_swaps"),
                )
                .filter(FeeTransaction.user_id == user_id)
                .first()
            )

            return {
                "total_fees_paid_usd": float(fees.total_fees or 0),
                "total_swaps": fees.total_swaps or 0,
            }

    def format_fee_info(self) -> str:
        """Format fee information for display."""
        return (
            "💰 *Suwappu Fee Structure*\n\n"
            "• Swap Fee by tier:\n"
            "   – Free: *1.0%*\n"
            "   – Pro: *0.5%*\n"
            "   – Premium: *0.3%*\n"
            "   – Enterprise: *0.1%*\n"
            f"• Referral Reward: *{REFERRAL_REWARD_PERCENTAGE}%* of fees\n"
            f"• Min Swap: ${MIN_SWAP_USD}\n"
            f"• Max Swap: ${MAX_SWAP_USD:,}\n\n"
            "🏆 *Why We're Competitive:*\n"
            "• Lower tiers beat Maestro (1%) and Trojan (0.9%)\n"
            "• MEV Protection included\n"
            "• Cross-chain support\n\n"
            "_Example: $1,000 swap on Free = $10 fee_"
        )

    def get_uncollected_fees(self) -> List[Dict[str, object]]:
        """
        Get all uncollected fees grouped by chain and token.

        Returns:
            List of dicts with chain, token, amount, amount_usd
        """
        from sqlalchemy import func

        with get_session() as session:
            # Group uncollected fees by chain and token
            results = (
                session.query(
                    FeeTransaction.chain,
                    FeeTransaction.token_symbol,
                    func.sum(FeeTransaction.fee_amount).label("total_amount"),
                    func.sum(FeeTransaction.fee_amount_usd).label("total_usd"),
                    func.count(FeeTransaction.id).label("tx_count"),
                )
                .filter(FeeTransaction.collected == False)
                .group_by(FeeTransaction.chain, FeeTransaction.token_symbol)
                .all()
            )

            return [
                {
                    "chain": r.chain,
                    "token": r.token_symbol,
                    "amount": float(r.total_amount or 0),
                    "amount_usd": float(r.total_usd or 0),
                    "tx_count": r.tx_count,
                }
                for r in results
            ]

    async def sweep_all_fees(self) -> List[Dict[str, object]]:
        """
        Sweep all uncollected fees to the collector address.

        Returns:
            List of sweep results with success status
        """
        uncollected = self.get_uncollected_fees()
        results = []

        for batch in uncollected:
            chain = batch["chain"]
            token = batch["token"]
            amount = batch["amount"]

            # Get collector address for this chain
            collector = FEE_COLLECTOR_SOLANA if chain == "solana" else FEE_COLLECTOR_EVM

            if not collector:
                results.append(
                    {
                        "chain": chain,
                        "token": token,
                        "amount": amount,
                        "success": False,
                        "message": f"No collector address configured for {chain}",
                    }
                )
                continue

            try:
                # NOTE: platform fees are collected ON-CHAIN by the aggregator at
                # swap time, not transferred by this function:
                #   • Li.Fi  — the FeeCollection contract forwards the integrator
                #     fee to the registered fee wallet automatically.
                #   • Jupiter — the platformFeeBps accrues to the referral token
                #     account (feeAccount); it must be CLAIMED via the Jupiter
                #     Referral Program to move it to the main treasury.
                # This pass reconciles the internal ledger (marks recorded fees as
                # accounted-for); it does NOT itself move tokens.
                with get_session() as session:
                    session.query(FeeTransaction).filter(
                        FeeTransaction.chain == chain,
                        FeeTransaction.token_symbol == token,
                        FeeTransaction.collected == False,
                    ).update({"collected": True})

                results.append(
                    {
                        "chain": chain,
                        "token": token,
                        "amount": amount,
                        "success": True,
                        "message": f"Reconciled {batch['tx_count']} fee records (on-chain collection via aggregator)",
                    }
                )

                logger.info(
                    f"Reconciled {amount} {token} on {chain} (collector={collector}); "
                    f"on-chain fee captured by aggregator at swap time"
                )

            except Exception as e:
                results.append(
                    {
                        "chain": chain,
                        "token": token,
                        "amount": amount,
                        "success": False,
                        "message": str(e),
                    }
                )
                logger.error(f"Failed to sweep {token} on {chain}: {e}")

        return results


# Global instance
fee_service = FeeService()
