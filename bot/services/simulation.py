"""Transaction simulation service for previewing swaps before execution."""

import logging
from typing import Dict, Optional, List
from decimal import Decimal
from dataclasses import dataclass

from bot.services.price_service import price_service
from bot.services.wallet import WalletService
from bot.config.tokens import get_token_by_symbol, get_token_decimals
from bot.utils.http_client import HttpClient

logger = logging.getLogger(__name__)


@dataclass
class SimulationResult:
    """Result of a transaction simulation."""
    success: bool
    
    # Balance changes
    balance_changes: Dict[str, Dict[str, Decimal]]  # {token: {before, after, change}}
    
    # Costs
    estimated_gas: Decimal
    estimated_gas_usd: Decimal
    
    # Warnings
    warnings: List[str]
    errors: List[str]
    
    # Additional info
    price_impact: float  # Percentage
    slippage_estimate: float
    
    # Raw simulation data
    raw_data: Optional[dict] = None


class SimulationService:
    """Service for simulating transactions before execution."""
    
    def __init__(self):
        self.wallet_service = WalletService()
    
    async def simulate_swap(
        self,
        wallet_address: str,
        from_chain: str,
        from_token: str,
        from_amount: str,
        to_chain: str,
        to_token: str,
        to_amount_expected: str,
        tx_data: dict = None,
    ) -> SimulationResult:
        """Simulate a swap transaction and predict outcomes."""
        warnings = []
        errors = []
        
        # Get current balances
        try:
            from_balance = await self._get_balance(wallet_address, from_chain, from_token)
            to_balance = await self._get_balance(wallet_address, to_chain, to_token)
        except Exception as e:
            logger.error(f"Failed to get balances: {e}")
            return SimulationResult(
                success=False,
                balance_changes={},
                estimated_gas=Decimal("0"),
                estimated_gas_usd=Decimal("0"),
                warnings=[],
                errors=[f"Failed to fetch balances: {str(e)}"],
                price_impact=0,
                slippage_estimate=0,
            )
        
        # Parse amounts
        from_amount_dec = self._parse_amount(from_amount, from_token, from_chain)
        to_amount_dec = self._parse_amount(to_amount_expected, to_token, to_chain)
        
        # Check if user has enough balance
        if from_balance < from_amount_dec:
            errors.append(f"Insufficient {from_token} balance. Have: {from_balance}, Need: {from_amount_dec}")
        
        # Estimate gas
        gas_estimate = await self._estimate_gas(from_chain, tx_data)
        gas_price_usd = await self._get_gas_price_usd(from_chain)
        gas_cost_usd = gas_estimate * gas_price_usd
        
        # Check if user has enough native token for gas
        native_balance = await self._get_native_balance(wallet_address, from_chain)
        if native_balance < gas_estimate:
            warnings.append(f"Low gas balance. May need more ETH/native token for fees.")
        
        # Calculate price impact
        price_impact = await self._calculate_price_impact(
            from_token, to_token, from_amount_dec, to_amount_dec
        )
        
        if price_impact > 5:
            warnings.append(f"High price impact: {price_impact:.2f}%")
        if price_impact > 10:
            errors.append(f"Very high price impact: {price_impact:.2f}%. Consider smaller amount.")
        
        # Estimate slippage
        slippage_estimate = min(price_impact * 0.1, 2.0)  # Rough estimate
        
        # Predict balance changes
        balance_changes = {
            from_token: {
                "before": from_balance,
                "after": from_balance - from_amount_dec,
                "change": -from_amount_dec,
            },
            to_token: {
                "before": to_balance,
                "after": to_balance + to_amount_dec,
                "change": to_amount_dec,
            },
        }
        
        # Determine success
        success = len(errors) == 0
        
        return SimulationResult(
            success=success,
            balance_changes=balance_changes,
            estimated_gas=gas_estimate,
            estimated_gas_usd=gas_cost_usd,
            warnings=warnings,
            errors=errors,
            price_impact=price_impact,
            slippage_estimate=slippage_estimate,
        )
    
    async def _get_balance(self, address: str, chain: str, token: str) -> Decimal:
        """Get token balance for address."""
        try:
            # Use wallet service to get balance
            # This is simplified - in production would call RPC
            return Decimal("1000")  # Placeholder
        except Exception:
            return Decimal("0")
    
    async def _get_native_balance(self, address: str, chain: str) -> Decimal:
        """Get native token balance (ETH, BNB, etc.)."""
        try:
            return Decimal("0.1")  # Placeholder
        except Exception:
            return Decimal("0")
    
    async def _estimate_gas(self, chain: str, tx_data: dict = None) -> Decimal:
        """Estimate gas for transaction."""
        # Default gas estimates by chain
        defaults = {
            "ethereum": Decimal("150000"),
            "polygon": Decimal("200000"),
            "bsc": Decimal("200000"),
            "arbitrum": Decimal("500000"),
            "optimism": Decimal("500000"),
            "base": Decimal("150000"),
        }
        return defaults.get(chain, Decimal("200000"))
    
    async def _get_gas_price_usd(self, chain: str) -> Decimal:
        """Get current gas price in USD."""
        # Simplified - would call RPC for actual gas price
        prices = {
            "ethereum": Decimal("0.000005"),  # ~$15 for avg tx
            "polygon": Decimal("0.0000001"),
            "bsc": Decimal("0.000001"),
            "arbitrum": Decimal("0.0000005"),
            "optimism": Decimal("0.0000005"),
            "base": Decimal("0.0000005"),
        }
        return prices.get(chain, Decimal("0.000001"))
    
    async def _calculate_price_impact(
        self,
        from_token: str,
        to_token: str,
        from_amount: Decimal,
        to_amount: Decimal,
    ) -> float:
        """Calculate price impact of the swap."""
        try:
            # Get market prices
            prices = await price_service.get_prices([from_token, to_token])
            
            from_price = Decimal(str(prices.get(from_token, 1)))
            to_price = Decimal(str(prices.get(to_token, 1)))
            
            if to_price == 0:
                return 0
            
            # Expected output at market price
            expected_to = (from_amount * from_price) / to_price
            
            if expected_to == 0:
                return 0
            
            # Price impact = (expected - actual) / expected * 100
            impact = float((expected_to - to_amount) / expected_to * 100)
            return max(0, impact)
            
        except Exception as e:
            logger.error(f"Price impact calculation error: {e}")
            return 0
    
    def _parse_amount(self, amount: str, token: str, chain: str) -> Decimal:
        """Parse amount string to Decimal."""
        try:
            decimals = get_token_decimals(token, chain)
            raw = Decimal(amount)
            return raw / Decimal(10 ** decimals)
        except (ValueError, TypeError, KeyError):
            return Decimal(amount)
    
    def format_simulation_result(self, result: SimulationResult) -> str:
        """Format simulation result for display."""
        lines = []
        
        if result.success:
            lines.append("✅ *Simulation Successful*\n")
        else:
            lines.append("❌ *Simulation Failed*\n")
        
        # Balance changes
        lines.append("*Balance Changes:*")
        for token, changes in result.balance_changes.items():
            sign = "+" if changes["change"] > 0 else ""
            lines.append(f"  {token}: {sign}{changes['change']:.4f}")
        
        # Costs
        lines.append(f"\n*Estimated Gas:* ${result.estimated_gas_usd:.2f}")
        lines.append(f"*Price Impact:* {result.price_impact:.2f}%")
        
        # Warnings
        if result.warnings:
            lines.append("\n⚠️ *Warnings:*")
            for w in result.warnings:
                lines.append(f"  • {w}")
        
        # Errors
        if result.errors:
            lines.append("\n❌ *Errors:*")
            for e in result.errors:
                lines.append(f"  • {e}")
        
        return "\n".join(lines)


# Global instance
simulation_service = SimulationService()

