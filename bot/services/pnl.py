"""P&L (Profit & Loss) tracking service."""

import logging
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional
from decimal import Decimal
from collections import defaultdict

from bot.models.swap import SwapTransaction
from bot.models.advanced import UserStats, PortfolioSnapshot
from bot.models.user import User
from bot.services.price_service import price_service
from bot.services.wallet import WalletService
from bot.config.tokens import get_token_decimals
from database.db import get_session

logger = logging.getLogger(__name__)


class PnLService:
    """Service for tracking profit and loss."""

    def __init__(self):
        self.wallet_service = WalletService()

    async def calculate_swap_pnl(
        self,
        user_id: int,
        days: int = 30,
    ) -> Dict:
        """Calculate P&L from swaps over a period."""
        with get_session() as session:
            cutoff = datetime.now(timezone.utc) - timedelta(days=days)

            swaps = (
                session.query(SwapTransaction)
                .filter(
                    SwapTransaction.user_id == user_id,
                    SwapTransaction.status == "completed",
                    SwapTransaction.created_at >= cutoff,
                )
                .all()
            )

            if not swaps:
                return {
                    "total_pnl_usd": 0,
                    "total_volume_usd": 0,
                    "total_fees_usd": 0,
                    "total_gas_usd": 0,
                    "swap_count": 0,
                    "pnl_by_token": {},
                    "period_days": days,
                }

            # Track token positions
            token_buys = defaultdict(Decimal)  # Total bought
            token_sells = defaultdict(Decimal)  # Total sold
            token_spent = defaultdict(Decimal)  # USD spent
            token_received = defaultdict(Decimal)  # USD received

            total_gas = Decimal("0")
            total_fees = Decimal("0")

            # Get current prices for calculations
            tokens = set()
            for swap in swaps:
                tokens.add(swap.from_token)
                tokens.add(swap.to_token)

            prices = await price_service.get_prices(list(tokens))

            for swap in swaps:
                try:
                    from_amount = (
                        Decimal(str(swap.from_amount)) if swap.from_amount else Decimal("0")
                    )
                    to_amount = Decimal(str(swap.to_amount)) if swap.to_amount else Decimal("0")
                    from_price = Decimal(str(prices.get(swap.from_token, 0)))
                    to_price = Decimal(str(prices.get(swap.to_token, 0)))

                    # Track sells (from_token)
                    token_sells[swap.from_token] += from_amount
                    token_spent[swap.from_token] += from_amount * from_price

                    # Track buys (to_token)
                    token_buys[swap.to_token] += to_amount
                    token_received[swap.to_token] += to_amount * to_price

                    # Track costs
                    if swap.gas_cost:
                        total_gas += Decimal(str(swap.gas_cost))

                except Exception as e:
                    logger.error(f"PnL calculation error for swap {swap.id}: {e}")

            # Calculate P&L by token
            pnl_by_token = {}
            all_tokens = set(token_buys.keys()) | set(token_sells.keys())

            for token in all_tokens:
                bought = token_buys.get(token, Decimal("0"))
                sold = token_sells.get(token, Decimal("0"))
                spent = token_spent.get(token, Decimal("0"))
                received = token_received.get(token, Decimal("0"))

                net_position = bought - sold
                current_price = Decimal(str(prices.get(token, 0)))
                current_value = net_position * current_price

                pnl_by_token[token] = {
                    "bought": float(bought),
                    "sold": float(sold),
                    "net_position": float(net_position),
                    "current_value_usd": float(current_value),
                    "realized_pnl": float(received - spent),
                }

            # Total P&L
            total_pnl = sum(t["realized_pnl"] for t in pnl_by_token.values())
            total_volume = sum(
                float(token_spent.get(t, 0)) + float(token_received.get(t, 0)) for t in all_tokens
            )

            return {
                "total_pnl_usd": total_pnl - float(total_gas),
                "total_volume_usd": total_volume,
                "total_fees_usd": float(total_fees),
                "total_gas_usd": float(total_gas),
                "swap_count": len(swaps),
                "pnl_by_token": pnl_by_token,
                "period_days": days,
            }

    async def get_portfolio_value(self, user_id: int) -> Dict:
        """Get current portfolio value across all wallets."""
        wallets = self.wallet_service.get_user_wallets(user_id)

        if not wallets:
            return {
                "total_value_usd": 0,
                "by_chain": {},
                "by_token": {},
                "wallets": [],
            }

        total_value = Decimal("0")
        by_chain = defaultdict(Decimal)
        by_token = defaultdict(Decimal)
        wallet_details = []

        for wallet in wallets:
            try:
                balances = await self.wallet_service.get_all_balances(wallet.id)
                wallet_value = Decimal("0")

                for chain, tokens in balances.items():
                    for token, balance in tokens.items():
                        if balance > 0:
                            prices = await price_service.get_prices([token])
                            price = Decimal(str(prices.get(token, 0)))
                            value = balance * price

                            total_value += value
                            by_chain[chain] += value
                            by_token[token] += value
                            wallet_value += value

                wallet_details.append(
                    {
                        "address": wallet.address,
                        "chain_type": wallet.chain_type,
                        "value_usd": float(wallet_value),
                    }
                )

            except Exception as e:
                logger.error(f"Portfolio value error for wallet {wallet.id}: {e}")

        return {
            "total_value_usd": float(total_value),
            "by_chain": {k: float(v) for k, v in by_chain.items()},
            "by_token": {k: float(v) for k, v in by_token.items()},
            "wallets": wallet_details,
        }

    async def save_portfolio_snapshot(self, user_id: int) -> Optional[PortfolioSnapshot]:
        """Save a daily portfolio snapshot for historical tracking."""
        portfolio = await self.get_portfolio_value(user_id)

        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

        with get_session() as session:
            # Check if already saved today
            existing = (
                session.query(PortfolioSnapshot)
                .filter(
                    PortfolioSnapshot.user_id == user_id,
                    PortfolioSnapshot.date == today,
                )
                .first()
            )

            if existing:
                existing.total_value_usd = portfolio["total_value_usd"]
                existing.chain_values = str(portfolio["by_chain"])
                return existing

            snapshot = PortfolioSnapshot(
                user_id=user_id,
                date=today,
                total_value_usd=portfolio["total_value_usd"],
                chain_values=str(portfolio["by_chain"]),
            )
            session.add(snapshot)
            session.flush()
            return snapshot

    def get_portfolio_history(
        self,
        user_id: int,
        days: int = 30,
    ) -> List[Dict]:
        """Get portfolio value history."""
        with get_session() as session:
            cutoff_date = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")

            snapshots = (
                session.query(PortfolioSnapshot)
                .filter(
                    PortfolioSnapshot.user_id == user_id,
                    PortfolioSnapshot.date >= cutoff_date,
                )
                .order_by(PortfolioSnapshot.date)
                .all()
            )

            return [
                {
                    "date": s.date,
                    "value_usd": s.total_value_usd,
                }
                for s in snapshots
            ]

    def update_user_stats(self, user_id: int, swap: SwapTransaction) -> None:
        """Update user stats after a swap."""
        with get_session() as session:
            stats = session.query(UserStats).filter(UserStats.user_id == user_id).first()

            if not stats:
                stats = UserStats(user_id=user_id)
                session.add(stats)

            stats.total_swaps += 1

            try:
                if swap.from_amount:
                    # Estimate volume (simplified)
                    stats.total_volume_usd += float(swap.from_amount)
                if swap.gas_cost:
                    stats.total_gas_paid_usd += float(swap.gas_cost)
            except (ValueError, TypeError, AttributeError):
                pass

            # Update streak
            today = datetime.now(timezone.utc).date()
            if stats.last_swap_date:
                last_date = stats.last_swap_date.date()
                if last_date == today - timedelta(days=1):
                    stats.current_streak_days += 1
                elif last_date != today:
                    stats.current_streak_days = 1

                if stats.current_streak_days > stats.longest_streak_days:
                    stats.longest_streak_days = stats.current_streak_days
            else:
                stats.current_streak_days = 1

            stats.last_swap_date = datetime.now(timezone.utc)

            # Update tier based on volume
            volume = stats.total_volume_usd
            if volume >= 100000:
                stats.tier = "platinum"
            elif volume >= 50000:
                stats.tier = "gold"
            elif volume >= 10000:
                stats.tier = "silver"
            else:
                stats.tier = "bronze"

    def get_user_stats(self, user_id: int) -> Dict:
        """Get user statistics."""
        with get_session() as session:
            stats = session.query(UserStats).filter(UserStats.user_id == user_id).first()

            if not stats:
                return {
                    "total_swaps": 0,
                    "total_volume_usd": 0,
                    "total_fees_usd": 0,
                    "total_gas_usd": 0,
                    "current_streak": 0,
                    "longest_streak": 0,
                    "tier": "bronze",
                }

            return {
                "total_swaps": stats.total_swaps,
                "total_volume_usd": stats.total_volume_usd,
                "total_fees_usd": stats.total_fees_paid_usd,
                "total_gas_usd": stats.total_gas_paid_usd,
                "current_streak": stats.current_streak_days,
                "longest_streak": stats.longest_streak_days,
                "tier": stats.tier,
            }

    async def get_swap_pnl_data(self, swap_id: int) -> Optional[Dict]:
        """Get P&L data for a specific swap (ROI since trade)."""
        with get_session() as session:
            swap = session.query(SwapTransaction).filter(SwapTransaction.id == swap_id).first()
            if not swap or swap.status != "completed":
                return None

            # Get current price of the 'to' token
            prices = await price_service.get_prices([swap.to_token])
            current_price = prices.get(swap.to_token, 0)

            if current_price == 0:
                return None

            # Initial price (at time of swap)
            # Calculated from from_amount (USD) / to_amount
            try:
                # Use the destination token's real decimals, not a hardcoded 6.
                decimals = get_token_decimals(swap.to_token, swap.to_chain)
                to_amount = float(swap.to_amount) / (10**decimals)
                from_usd = float(swap.from_amount_usd) if swap.from_amount_usd else 0
                if to_amount == 0:
                    return None

                entry_price = from_usd / to_amount
                roi_percent = ((current_price - entry_price) / entry_price) * 100
                total_profit_usd = (current_price - entry_price) * to_amount

                return {
                    "token": swap.to_token,
                    "entry_price": entry_price,
                    "current_price": current_price,
                    "roi_percent": roi_percent,
                    "profit_usd": total_profit_usd,
                    "is_profit": roi_percent > 0,
                    "chain": swap.to_chain,
                }
            except Exception as e:
                logger.error(f"Error calculating swap PNL card: {e}")
                return None


# Global instance
pnl_service = PnLService()
