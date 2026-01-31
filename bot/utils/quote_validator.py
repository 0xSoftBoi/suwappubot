"""Quote validation utilities with C++ acceleration."""

import logging
import calendar
from datetime import datetime, timedelta
from typing import Optional, TYPE_CHECKING
from decimal import Decimal

from bot.utils.exceptions import SwapError

# Use TYPE_CHECKING to avoid circular imports
if TYPE_CHECKING:
    from bot.services.swap_engine import SwapQuote

logger = logging.getLogger(__name__)

# Try to import C++ core for performance
try:
    import suwappu_core
    USE_CPP_CORE = True
    logger.info("Using C++ core for high-performance validation")
except ImportError:
    USE_CPP_CORE = False
    logger.info("C++ core not available, using Python fallback")


class QuoteValidator:
    """Validates swap quotes before execution."""
    
    DEFAULT_EXPIRY_SECONDS = 90  # Quotes expire in 90 seconds
    
    @staticmethod
    def validate_quote_freshness(quote: "SwapQuote", max_age_seconds: int = None) -> bool:
        """
        Check if quote is still fresh.
        
        Args:
            quote: SwapQuote to validate
            max_age_seconds: Maximum age in seconds (defaults to DEFAULT_EXPIRY_SECONDS)
            
        Returns:
            True if quote is fresh, False otherwise
            
        Raises:
            SwapError: If quote is expired
        """
        if max_age_seconds is None:
            max_age_seconds = QuoteValidator.DEFAULT_EXPIRY_SECONDS
        
        # Check if quote has timestamp
        if not hasattr(quote, 'timestamp') or quote.timestamp is None:
            # If no timestamp, assume it's fresh (backward compatibility)
            return True
        
        # Use C++ core if available
        if USE_CPP_CORE:
            try:
                # Use calendar.timegm for proper UTC timestamp conversion
                # (datetime.timestamp() treats naive datetimes as local time)
                timestamp_seconds = calendar.timegm(quote.timestamp.timetuple())
                return suwappu_core.NativeQuoteValidator.validate_freshness(
                    timestamp_seconds, max_age_seconds
                )
            except suwappu_core.SwapError as e:
                raise SwapError(str(e))
        
        # Python fallback
        age_seconds = (datetime.utcnow() - quote.timestamp).total_seconds()
        
        if age_seconds > max_age_seconds:
            raise SwapError(
                f"Quote expired. Quote is {age_seconds:.0f} seconds old "
                f"(max {max_age_seconds}s). Please get a new quote."
            )
        
        return True
    
    @staticmethod
    async def validate_balance(
        wallet_id: int,
        quote: "SwapQuote",
        wallet_service,
        buffer_percent: float = 0.0,
    ) -> bool:
        """
        Validate user has sufficient balance for swap.
        
        Args:
            wallet_id: Wallet ID to check
            quote: SwapQuote with amount needed
            wallet_service: WalletService instance
            buffer_percent: Additional buffer percentage (e.g., 0.05 for 5%)
            
        Returns:
            True if balance is sufficient
            
        Raises:
            SwapError: If balance is insufficient
        """
        from database.db import get_session
        from bot.models.user import Wallet
        
        # Get wallet
        with get_session() as session:
            wallet = session.query(Wallet).filter(Wallet.id == wallet_id).first()
            if not wallet:
                raise SwapError("Wallet not found")
        
        # Get balance for the specific token on the chain
        if wallet.chain_type == "evm":
            if quote.from_token in ["ETH", "BNB", "MATIC", "AVAX"]:
                balance = await wallet_service.get_evm_native_balance(
                    quote.from_chain, wallet.address
                )
            else:
                balance = await wallet_service.get_evm_token_balance(
                    quote.from_chain, quote.from_token, wallet.address
                )
        else:  # solana
            if quote.from_token == "SOL":
                balance = await wallet_service.get_solana_native_balance(wallet.address)
            else:
                balance = await wallet_service.get_solana_token_balance(
                    quote.from_token, wallet.address
                )
        
        required = float(quote.from_amount_human)
        if buffer_percent > 0:
            required = required * (1 + buffer_percent)
        
        # Use C++ core for fast validation if available
        if USE_CPP_CORE:
            try:
                return suwappu_core.NativeQuoteValidator.validate_balance(
                    balance, required, quote.from_token
                )
            except suwappu_core.SwapError as e:
                raise SwapError(str(e))
        
        # Python fallback
        if balance < required:
            raise SwapError(
                f"Insufficient {quote.from_token} balance. "
                f"Have: {balance:.4f}, Need: {required:.4f}"
            )
        
        return True
    
    @staticmethod
    async def validate_gas(
        wallet_address: str,
        quote: "SwapQuote",
        wallet_service,
        buffer_multiplier: float = 1.2,
    ) -> bool:
        """
        Validate user has sufficient native token for gas.
        
        Args:
            wallet_address: Wallet address
            quote: SwapQuote with gas estimate
            wallet_service: WalletService instance
            buffer_multiplier: Multiplier for gas estimate (e.g., 1.2 for 20% buffer)
            
        Returns:
            True if gas is sufficient
            
        Raises:
            SwapError: If gas is insufficient
        """
        from bot.config.chains import get_chain_by_name
        
        chain_config = get_chain_by_name(quote.from_chain)
        
        # Get native token balance
        if chain_config.chain_type.value == "evm":
            native_balance = await wallet_service.get_evm_native_balance(
                quote.from_chain, wallet_address
            )
        else:  # solana
            native_balance = await wallet_service.get_solana_native_balance(wallet_address)
        
        # Estimate gas needed (use quote gas cost or default)
        gas_estimate_usd = quote.gas_cost_usd or 0.01  # Default $0.01
        
        # Use C++ core for fast validation if available
        if USE_CPP_CORE:
            try:
                return suwappu_core.NativeQuoteValidator.validate_gas(
                    native_balance, gas_estimate_usd, quote.from_chain, buffer_multiplier
                )
            except suwappu_core.SwapError as e:
                raise SwapError(str(e))
        
        # Python fallback - Convert USD estimate to native token
        if quote.from_chain == "ethereum":
            required_gas = Decimal(str(gas_estimate_usd / 2000 * buffer_multiplier))
        elif quote.from_chain == "polygon":
            required_gas = Decimal(str(gas_estimate_usd / 1 * buffer_multiplier))
        elif quote.from_chain == "bsc":
            required_gas = Decimal(str(gas_estimate_usd / 300 * buffer_multiplier))
        else:
            required_gas = Decimal("0.001") * Decimal(str(buffer_multiplier))
        
        if native_balance < float(required_gas):
            native_token = chain_config.native_token
            raise SwapError(
                f"Insufficient gas. Need more {native_token} "
                f"for transaction fees. "
                f"Estimated: {required_gas:.6f} {native_token}"
            )
        
        return True
    
    @staticmethod
    def validate_slippage(slippage_bps: int, max_slippage_bps: int = 1000) -> bool:
        """
        Validate slippage tolerance is reasonable.
        
        Args:
            slippage_bps: Slippage in basis points (e.g., 50 = 0.5%)
            max_slippage_bps: Maximum allowed slippage (default 10%)
            
        Returns:
            True if slippage is acceptable
            
        Raises:
            SwapError: If slippage is too high
        """
        # Use C++ core if available
        if USE_CPP_CORE:
            try:
                return suwappu_core.NativeQuoteValidator.validate_slippage(
                    slippage_bps, max_slippage_bps
                )
            except suwappu_core.SwapError as e:
                raise SwapError(str(e))
        
        # Python fallback
        if slippage_bps > max_slippage_bps:
            slippage_pct = slippage_bps / 100
            raise SwapError(
                f"Slippage tolerance too high ({slippage_pct}%). "
                f"Maximum allowed: {max_slippage_bps / 100}%. "
                f"This protects you from bad trades."
            )
        
        return True
    
    @staticmethod
    async def validate_all(
        quote: "SwapQuote",
        wallet_id: int,
        wallet_address: str,
        wallet_service,
        slippage_bps: int = 50,
    ) -> bool:
        """
        Run all validations.
        
        Returns:
            True if all validations pass
            
        Raises:
            SwapError: If any validation fails
        """
        # Check quote freshness
        QuoteValidator.validate_quote_freshness(quote)
        
        # Check balance
        await QuoteValidator.validate_balance(wallet_id, quote, wallet_service)
        
        # Check gas
        await QuoteValidator.validate_gas(wallet_address, quote, wallet_service)
        
        # Check slippage
        QuoteValidator.validate_slippage(slippage_bps)
        
        return True


# Global instance
quote_validator = QuoteValidator()
