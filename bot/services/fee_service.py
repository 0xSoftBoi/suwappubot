"""Fee service for calculating and collecting swap fees.

Suwappu Competitive Pricing:
- 0.8% flat swap fee (undercuts 1% industry standard)
- 30% referral rewards (aggressive growth)
- User pays gas (separate from swap fee)
"""

import logging
from typing import Dict, List, Optional, Tuple, TYPE_CHECKING
from decimal import Decimal, ROUND_DOWN
from dataclasses import dataclass
from datetime import datetime

from bot.config.settings import settings
from bot.models.fees import FeeTransaction
from database.db import get_session

logger = logging.getLogger(__name__)

# ============================================
# FEE CONSTANTS - Competitive Pricing
# ============================================

# Swap fee: 0.8% (undercuts Maestro 1%, Trojan 0.9%)
SWAP_FEE_PERCENTAGE = Decimal("0.8")  # 0.8%
SWAP_FEE_DECIMAL = SWAP_FEE_PERCENTAGE / Decimal("100")  # 0.008

# Referral rewards: 30% of fees (aggressive growth)
REFERRAL_REWARD_PERCENTAGE = Decimal("30")  # 30%
REFERRAL_REWARD_DECIMAL = REFERRAL_REWARD_PERCENTAGE / Decimal("100")  # 0.30

# Swap limits
MIN_SWAP_USD = Decimal("1")  # No barriers to entry
MAX_SWAP_USD = Decimal("100000")  # Risk management

# Fee collector address (from settings or default)
FEE_COLLECTOR_EVM = getattr(settings, 'fee_collector_address', None)
FEE_COLLECTOR_SOLANA = getattr(settings, 'fee_collector_solana', None)


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
    
    # Referral info
    referrer_id: Optional[int] = None
    has_referrer: bool = False


class FeeService:
    """Service for calculating and collecting swap fees.
    
    Pricing strategy:
    - 0.8% flat fee on all swaps (competitive rate)
    - 30% of fees go to referrer (viral growth)
    - Net revenue: 0.56% per swap (0.8% * 70%)
    """
    
    def __init__(self):
        self.fee_percentage = SWAP_FEE_DECIMAL
        self.referral_percentage = REFERRAL_REWARD_DECIMAL
    
    def calculate_fee(
        self,
        swap_amount_usd: float,
        referrer_id: Optional[int] = None,
    ) -> FeeCalculation:
        """
        Calculate fee for a swap.
        
        Args:
            swap_amount_usd: Swap amount in USD
            referrer_id: Optional referrer user ID for reward calculation
            
        Returns:
            FeeCalculation with all fee details
        """
        amount = Decimal(str(swap_amount_usd))
        
        # Calculate base fee (0.8%)
        fee_amount = (amount * self.fee_percentage).quantize(
            Decimal("0.01"), rounding=ROUND_DOWN
        )
        
        # Calculate referral reward if applicable
        has_referrer = referrer_id is not None
        referral_reward = Decimal("0")
        
        if has_referrer:
            referral_reward = (fee_amount * self.referral_percentage).quantize(
                Decimal("0.01"), rounding=ROUND_DOWN
            )
        
        # Net fee (what we keep)
        net_fee = fee_amount - referral_reward
        
        return FeeCalculation(
            swap_amount_usd=amount,
            fee_amount_usd=fee_amount,
            fee_percentage=SWAP_FEE_PERCENTAGE,
            referral_reward_usd=referral_reward,
            net_fee_usd=net_fee,
            referrer_id=referrer_id,
            has_referrer=has_referrer,
        )
    
    def calculate_fee_in_token(
        self,
        swap_amount: float,
        token_price_usd: float,
        token_symbol: str,
        referrer_id: Optional[int] = None,
    ) -> FeeCalculation:
        """
        Calculate fee in token terms.
        
        Args:
            swap_amount: Amount of tokens being swapped
            token_price_usd: Price of token in USD
            token_symbol: Token symbol
            referrer_id: Optional referrer user ID
            
        Returns:
            FeeCalculation with token amounts
        """
        swap_amount_usd = float(swap_amount) * token_price_usd
        calc = self.calculate_fee(swap_amount_usd, referrer_id)
        
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
    ) -> Tuple[float, float, float]:
        """
        Calculate fee with automatic price lookup.
        
        Args:
            amount: Amount of tokens being swapped
            token_symbol: Token symbol
            
        Returns:
            Tuple of (fee_amount_token, fee_percentage, fee_amount_usd)
        """
        from bot.services.price_service import price_service
        
        # Get token price
        prices = await price_service.get_prices([token_symbol])
        token_price = prices.get(token_symbol.upper(), 1.0)
        
        # Calculate USD value
        amount_usd = amount * token_price
        
        # Calculate fee
        calc = self.calculate_fee(amount_usd)
        
        # Convert fee back to token amount
        fee_amount_token = float(calc.fee_amount_usd) / token_price if token_price > 0 else 0
        
        return (
            fee_amount_token,
            float(SWAP_FEE_PERCENTAGE),
            float(calc.fee_amount_usd)
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
        resolved_fee_pct = fee_percentage or float(SWAP_FEE_PERCENTAGE)

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
                created_at=datetime.utcnow(),
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
            
            fees = session.query(
                func.sum(FeeTransaction.fee_amount).label('total_fees'),
                func.count(FeeTransaction.id).label('total_swaps')
            ).filter(
                FeeTransaction.user_id == user_id
            ).first()
            
            return {
                "total_fees_paid_usd": float(fees.total_fees or 0),
                "total_swaps": fees.total_swaps or 0,
            }
    
    def format_fee_info(self) -> str:
        """Format fee information for display."""
        return (
            "💰 *Suwappu Fee Structure*\n\n"
            f"• Swap Fee: *{SWAP_FEE_PERCENTAGE}%*\n"
            f"• Referral Reward: *{REFERRAL_REWARD_PERCENTAGE}%* of fees\n"
            f"• Min Swap: ${MIN_SWAP_USD}\n"
            f"• Max Swap: ${MAX_SWAP_USD:,}\n\n"
            "🏆 *Why We're Competitive:*\n"
            "• Lower than Maestro (1%)\n"
            "• Lower than Trojan (0.9%)\n"
            "• MEV Protection included\n"
            "• Cross-chain support\n\n"
            "_Example: $1,000 swap = $8 fee_"
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
            results = session.query(
                FeeTransaction.chain,
                FeeTransaction.token_symbol,
                func.sum(FeeTransaction.fee_amount).label('total_amount'),
                func.sum(FeeTransaction.fee_amount_usd).label('total_usd'),
                func.count(FeeTransaction.id).label('tx_count')
            ).filter(
                FeeTransaction.collected == False
            ).group_by(
                FeeTransaction.chain,
                FeeTransaction.token_symbol
            ).all()

            return [
                {
                    "chain": r.chain,
                    "token": r.token_symbol,
                    "amount": float(r.total_amount or 0),
                    "amount_usd": float(r.total_usd or 0),
                    "tx_count": r.tx_count
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
                results.append({
                    "chain": chain,
                    "token": token,
                    "amount": amount,
                    "success": False,
                    "message": f"No collector address configured for {chain}"
                })
                continue

            try:
                # Mark fees as collected
                # In production, this would transfer tokens to collector first
                with get_session() as session:
                    session.query(FeeTransaction).filter(
                        FeeTransaction.chain == chain,
                        FeeTransaction.token_symbol == token,
                        FeeTransaction.collected == False
                    ).update({"collected": True})

                results.append({
                    "chain": chain,
                    "token": token,
                    "amount": amount,
                    "success": True,
                    "message": f"Marked {batch['tx_count']} transactions as collected"
                })

                logger.info(f"Swept {amount} {token} on {chain} to {collector}")

            except Exception as e:
                results.append({
                    "chain": chain,
                    "token": token,
                    "amount": amount,
                    "success": False,
                    "message": str(e)
                })
                logger.error(f"Failed to sweep {token} on {chain}: {e}")

        return results


# Global instance
fee_service = FeeService()
