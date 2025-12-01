"""Fee calculation and collection service."""

import logging
import asyncio
from typing import Optional, Tuple, List
from decimal import Decimal
from datetime import datetime, date

from bot.models.fees import FeeConfig, FeeTransaction, FeeSummary
from bot.services.price_service import price_service
from database.db import get_session

logger = logging.getLogger(__name__)


# Fee collector address (can be overridden in config)
DEFAULT_FEE_COLLECTOR = "0x6456f69215C470e1545Ed6eea4621C136B30D85d"


# Default fee configuration
DEFAULT_FEE_PERCENTAGE = 1.0  # 1%
DEFAULT_MIN_FEE_USD = 0.0
DEFAULT_MAX_FEE_USD = 1000.0


class FeeService:
    """Service for calculating and tracking swap fees."""
    
    def __init__(self):
        self._config_cache: Optional[FeeConfig] = None
        self._cache_time: Optional[datetime] = None
        self._cache_ttl = 60  # Cache for 60 seconds
    
    def get_fee_config(self) -> FeeConfig:
        """Get current fee configuration."""
        # Check cache
        if self._config_cache and self._cache_time:
            if (datetime.utcnow() - self._cache_time).seconds < self._cache_ttl:
                return self._config_cache
        
        with get_session() as session:
            config = session.query(FeeConfig).filter(
                FeeConfig.is_active == True
            ).first()
            
            if not config:
                # Create default config
                config = FeeConfig(
                    swap_fee_percentage=DEFAULT_FEE_PERCENTAGE,
                    min_fee_usd=DEFAULT_MIN_FEE_USD,
                    max_fee_usd=DEFAULT_MAX_FEE_USD,
                )
                session.add(config)
                session.flush()
            
            # Cache it
            self._config_cache = FeeConfig(
                id=config.id,
                swap_fee_percentage=config.swap_fee_percentage,
                min_fee_usd=config.min_fee_usd,
                max_fee_usd=config.max_fee_usd,
                fee_collector_address=config.fee_collector_address,
                fee_collector_chain=config.fee_collector_chain,
                is_active=config.is_active,
            )
            self._cache_time = datetime.utcnow()
            
            return self._config_cache
    
    def set_fee_config(
        self,
        fee_percentage: Optional[float] = None,
        min_fee_usd: Optional[float] = None,
        max_fee_usd: Optional[float] = None,
        fee_collector_address: Optional[str] = None,
    ) -> FeeConfig:
        """Update fee configuration."""
        with get_session() as session:
            config = session.query(FeeConfig).filter(
                FeeConfig.is_active == True
            ).first()
            
            if not config:
                config = FeeConfig()
                session.add(config)
            
            if fee_percentage is not None:
                config.swap_fee_percentage = fee_percentage
            if min_fee_usd is not None:
                config.min_fee_usd = min_fee_usd
            if max_fee_usd is not None:
                config.max_fee_usd = max_fee_usd
            if fee_collector_address is not None:
                config.fee_collector_address = fee_collector_address
            
            session.flush()
            config_id = config.id
        
        # Clear cache
        self._config_cache = None
        self._cache_time = None
        
        return self.get_fee_config()
    
    def calculate_fee(
        self,
        amount: float,
        token_symbol: str,
        token_price_usd: Optional[float] = None,
    ) -> Tuple[float, float, float]:
        """
        Calculate fee for a swap.
        
        Args:
            amount: Amount being swapped
            token_symbol: Token symbol
            token_price_usd: Optional USD price of token
            
        Returns:
            Tuple of (fee_amount, fee_percentage, fee_usd)
        """
        config = self.get_fee_config()
        
        # Calculate percentage fee
        fee_percentage = config.swap_fee_percentage
        fee_amount = amount * (fee_percentage / 100)
        
        # Calculate USD value if price available
        if token_price_usd:
            fee_usd = fee_amount * token_price_usd
            
            # Apply min/max in USD terms
            if fee_usd < config.min_fee_usd:
                # Adjust fee amount to meet minimum
                fee_usd = config.min_fee_usd
                fee_amount = fee_usd / token_price_usd if token_price_usd > 0 else fee_amount
            elif fee_usd > config.max_fee_usd:
                # Cap fee at maximum
                fee_usd = config.max_fee_usd
                fee_amount = fee_usd / token_price_usd if token_price_usd > 0 else fee_amount
        else:
            fee_usd = 0.0
        
        return fee_amount, fee_percentage, fee_usd
    
    async def calculate_fee_with_price(
        self,
        amount: float,
        token_symbol: str,
    ) -> Tuple[float, float, float]:
        """Calculate fee with automatic price lookup."""
        prices = await price_service.get_prices([token_symbol])
        price = prices.get(token_symbol, 0) or 0
        return self.calculate_fee(amount, token_symbol, price)
    
    def record_fee(
        self,
        user_id: int,
        chain: str,
        token_symbol: str,
        swap_amount: float,
        fee_amount: float,
        fee_percentage: float,
        fee_amount_usd: Optional[float] = None,
        swap_id: Optional[int] = None,
    ) -> FeeTransaction:
        """Record a fee transaction."""
        with get_session() as session:
            fee_tx = FeeTransaction(
                user_id=user_id,
                swap_id=swap_id,
                chain=chain,
                token_symbol=token_symbol,
                swap_amount=swap_amount,
                fee_percentage=fee_percentage,
                fee_amount=fee_amount,
                fee_amount_usd=fee_amount_usd,
            )
            session.add(fee_tx)
            session.flush()
            
            # Update daily summary
            self._update_summary(session, fee_amount_usd or 0, swap_amount)
            
            fee_id = fee_tx.id
        
        logger.info(
            f"Fee recorded: {fee_amount:.6f} {token_symbol} "
            f"(${fee_amount_usd:.2f}) from user {user_id}"
        )
        
        with get_session() as session:
            return session.query(FeeTransaction).filter(
                FeeTransaction.id == fee_id
            ).first()
    
    def _update_summary(
        self,
        session,
        fee_usd: float,
        volume_usd: float,
    ) -> None:
        """Update daily fee summary."""
        today = date.today().isoformat()
        
        summary = session.query(FeeSummary).filter(
            FeeSummary.period_type == "daily",
            FeeSummary.period_date == today,
        ).first()
        
        if not summary:
            summary = FeeSummary(
                period_type="daily",
                period_date=today,
            )
            session.add(summary)
        
        summary.total_swaps += 1
        summary.total_volume_usd += volume_usd
        summary.total_fees_usd += fee_usd
    
    def get_total_fees_collected(self) -> Tuple[float, int]:
        """Get total fees collected and swap count."""
        with get_session() as session:
            from sqlalchemy import func
            result = session.query(
                func.sum(FeeTransaction.fee_amount_usd),
                func.count(FeeTransaction.id)
            ).first()
            
            total_usd = result[0] or 0.0
            total_count = result[1] or 0
            
            return total_usd, total_count
    
    def get_user_fees_paid(self, user_id: int) -> Tuple[float, int]:
        """Get total fees paid by a user."""
        with get_session() as session:
            from sqlalchemy import func
            result = session.query(
                func.sum(FeeTransaction.fee_amount_usd),
                func.count(FeeTransaction.id)
            ).filter(
                FeeTransaction.user_id == user_id
            ).first()
            
            total_usd = result[0] or 0.0
            total_count = result[1] or 0
            
            return total_usd, total_count
    
    def get_daily_stats(self, days: int = 7) -> list[dict]:
        """Get daily fee stats for the last N days."""
        with get_session() as session:
            summaries = session.query(FeeSummary).filter(
                FeeSummary.period_type == "daily"
            ).order_by(FeeSummary.period_date.desc()).limit(days).all()
            
            return [
                {
                    "date": s.period_date,
                    "swaps": s.total_swaps,
                    "volume_usd": s.total_volume_usd,
                    "fees_usd": s.total_fees_usd,
                }
                for s in summaries
            ]
    
    def get_uncollected_fees(self) -> List[dict]:
        """Get fees that haven't been swept to collector yet."""
        with get_session() as session:
            uncollected = session.query(FeeTransaction).filter(
                FeeTransaction.collected == False
            ).all()
            
            # Group by chain and token
            grouped = {}
            for fee in uncollected:
                key = f"{fee.chain}:{fee.token_symbol}"
                if key not in grouped:
                    grouped[key] = {
                        "chain": fee.chain,
                        "token": fee.token_symbol,
                        "amount": 0.0,
                        "amount_usd": 0.0,
                        "count": 0,
                        "fee_ids": [],
                    }
                grouped[key]["amount"] += fee.fee_amount
                grouped[key]["amount_usd"] += fee.fee_amount_usd or 0
                grouped[key]["count"] += 1
                grouped[key]["fee_ids"].append(fee.id)
            
            return list(grouped.values())
    
    def mark_fees_collected(self, fee_ids: List[int], tx_hash: str = None) -> int:
        """Mark fees as collected/swept."""
        with get_session() as session:
            updated = session.query(FeeTransaction).filter(
                FeeTransaction.id.in_(fee_ids)
            ).update({"collected": True}, synchronize_session=False)
            
            return updated
    
    async def sweep_fees_to_collector(
        self,
        chain: str,
        token_symbol: str,
    ) -> Tuple[bool, str, Optional[str]]:
        """
        Sweep accumulated fees to the collector address.
        
        Returns:
            Tuple of (success, message, tx_hash)
        """
        from bot.services.hot_wallet import hot_wallet_service
        from bot.config.tokens import get_token_address, TOKENS
        
        config = self.get_fee_config()
        collector_address = config.fee_collector_address or DEFAULT_FEE_COLLECTOR
        
        if not collector_address:
            return False, "No fee collector address configured", None
        
        # Get uncollected fees for this chain/token
        uncollected = self.get_uncollected_fees()
        matching = [f for f in uncollected if f["chain"] == chain and f["token"] == token_symbol]
        
        if not matching:
            return False, f"No uncollected {token_symbol} fees on {chain}", None
        
        fee_data = matching[0]
        amount = Decimal(str(fee_data["amount"]))
        
        if amount <= 0:
            return False, "No fees to sweep", None
        
        # Get hot wallet
        hot_wallet = hot_wallet_service.get_deposit_wallet("evm")
        if not hot_wallet:
            return False, "No hot wallet configured", None
        
        try:
            # Check if it's native token or ERC20
            token_address = get_token_address(token_symbol, chain)
            
            if token_address == "0x0000000000000000000000000000000000000000" or not token_address:
                # Native token transfer
                tx_hash = await hot_wallet_service.send_native_token(
                    wallet=hot_wallet,
                    chain_name=chain,
                    to_address=collector_address,
                    amount=amount,
                )
            else:
                # ERC20 transfer
                decimals = TOKENS.get(token_symbol, {}).decimals if token_symbol in TOKENS else 18
                tx_hash = await hot_wallet_service.send_token(
                    wallet=hot_wallet,
                    chain_name=chain,
                    token_address=token_address,
                    to_address=collector_address,
                    amount=amount,
                    decimals=decimals,
                )
            
            # Mark fees as collected
            self.mark_fees_collected(fee_data["fee_ids"], tx_hash)
            
            logger.info(
                f"Swept {amount} {token_symbol} fees on {chain} to {collector_address}: {tx_hash}"
            )
            
            return True, f"Swept {float(amount):.6f} {token_symbol} to collector", tx_hash
            
        except Exception as e:
            logger.error(f"Fee sweep failed: {e}")
            return False, f"Sweep failed: {str(e)}", None
    
    async def sweep_all_fees(self) -> List[dict]:
        """Sweep all uncollected fees to collector."""
        results = []
        uncollected = self.get_uncollected_fees()
        
        for fee_group in uncollected:
            success, message, tx_hash = await self.sweep_fees_to_collector(
                chain=fee_group["chain"],
                token_symbol=fee_group["token"],
            )
            results.append({
                "chain": fee_group["chain"],
                "token": fee_group["token"],
                "amount": fee_group["amount"],
                "success": success,
                "message": message,
                "tx_hash": tx_hash,
            })
        
        return results


# Global instance
fee_service = FeeService()

