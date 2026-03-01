"""P&L (Profit & Loss) tracking service with average cost basis."""

import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional
from decimal import Decimal
from collections import defaultdict

from bot.models.swap import SwapTransaction
from bot.models.pnl import TokenPosition
from bot.models.advanced import UserStats, PortfolioSnapshot
from bot.models.user import User
from bot.services.price_service import price_service
from bot.services.wallet import WalletService
from bot.config.tokens import get_token_address
from database.db import get_session

logger = logging.getLogger(__name__)


class PnLService:
    """Service for tracking profit and loss with average cost basis."""

    def __init__(self):
        self.wallet_service = WalletService()

    def record_swap_pnl(
        self,
        user_id: int,
        swap_tx: SwapTransaction,
    ) -> Optional[Dict]:
        """Record PnL data after a completed swap.

        Updates TokenPosition for both the sold and bought tokens using
        the average cost basis method.

        Returns dict with realized_pnl if a position was sold, else None.
        """
        try:
            from_amount = float(swap_tx.from_amount) if swap_tx.from_amount else 0.0
            to_amount = float(swap_tx.to_amount) if swap_tx.to_amount else 0.0

            # Use per-token prices if available, fall back to USD amounts
            from_price = swap_tx.from_token_price_usd
            to_price = swap_tx.to_token_price_usd

            if not from_price and swap_tx.from_amount_usd and from_amount > 0:
                from_price = swap_tx.from_amount_usd / from_amount
            if not to_price and swap_tx.to_amount_usd and to_amount > 0:
                to_price = swap_tx.to_amount_usd / to_amount

            if not from_price or not to_price:
                logger.debug("record_swap_pnl skipped: missing price data for swap %d", swap_tx.id)
                return None

            realized_pnl = 0.0

            with get_session() as session:
                # --- Update SOLD position (from_token) ---
                from_addr = get_token_address(swap_tx.from_token, swap_tx.from_chain) or swap_tx.from_token
                sold_pos = session.query(TokenPosition).filter(
                    TokenPosition.user_id == user_id,
                    TokenPosition.chain == swap_tx.from_chain,
                    TokenPosition.token_address == from_addr,
                ).first()

                if sold_pos:
                    # Realized PnL = (sell_price - avg_buy_price) * amount_sold
                    realized_pnl = (from_price - (sold_pos.avg_buy_price_usd or 0)) * from_amount
                    sold_pos.total_sold = (sold_pos.total_sold or 0) + from_amount
                    sold_pos.total_proceeds_usd = (sold_pos.total_proceeds_usd or 0) + (from_amount * from_price)
                    sold_pos.realized_pnl_usd = (sold_pos.realized_pnl_usd or 0) + realized_pnl
                else:
                    # Selling a token we don't have a buy record for (pre-existing holding)
                    sold_pos = TokenPosition(
                        user_id=user_id,
                        chain=swap_tx.from_chain,
                        token_symbol=swap_tx.from_token,
                        token_address=from_addr,
                        total_sold=from_amount,
                        total_proceeds_usd=from_amount * from_price,
                        avg_buy_price_usd=from_price,  # Assume current price as cost basis
                    )
                    session.add(sold_pos)

                # --- Update BOUGHT position (to_token) ---
                to_addr = get_token_address(swap_tx.to_token, swap_tx.to_chain) or swap_tx.to_token
                bought_pos = session.query(TokenPosition).filter(
                    TokenPosition.user_id == user_id,
                    TokenPosition.chain == swap_tx.to_chain,
                    TokenPosition.token_address == to_addr,
                ).first()

                if bought_pos:
                    # Recalculate weighted average buy price
                    old_cost = (bought_pos.total_bought or 0) * (bought_pos.avg_buy_price_usd or 0)
                    new_cost = to_amount * to_price
                    total_tokens = (bought_pos.total_bought or 0) + to_amount

                    bought_pos.total_bought = total_tokens
                    bought_pos.total_cost_usd = (bought_pos.total_cost_usd or 0) + new_cost
                    bought_pos.avg_buy_price_usd = (old_cost + new_cost) / total_tokens if total_tokens > 0 else 0
                else:
                    bought_pos = TokenPosition(
                        user_id=user_id,
                        chain=swap_tx.to_chain,
                        token_symbol=swap_tx.to_token,
                        token_address=to_addr,
                        total_bought=to_amount,
                        total_cost_usd=to_amount * to_price,
                        avg_buy_price_usd=to_price,
                    )
                    session.add(bought_pos)

            if realized_pnl != 0:
                return {
                    "token": swap_tx.from_token,
                    "amount_sold": from_amount,
                    "sell_price": from_price,
                    "avg_cost": sold_pos.avg_buy_price_usd if sold_pos else from_price,
                    "realized_pnl": realized_pnl,
                    "is_profit": realized_pnl > 0,
                }
            return None

        except Exception as e:
            logger.error(f"record_swap_pnl error for swap {swap_tx.id}: {e}", exc_info=True)
            return None

    async def get_unrealized_pnl(
        self,
        user_id: int,
        chain: Optional[str] = None,
    ) -> Dict:
        """Calculate unrealized PnL for open positions.

        For each token position with holdings > 0, fetches current price
        and compares against average buy price.
        """
        with get_session() as session:
            query = session.query(TokenPosition).filter(
                TokenPosition.user_id == user_id,
            )
            if chain:
                query = query.filter(TokenPosition.chain == chain)

            positions = query.all()

        if not positions:
            return {"total_unrealized_pnl": 0.0, "positions": []}

        # Collect tokens that have holdings
        active = []
        tokens_to_price = set()
        for pos in positions:
            holdings = pos.current_holdings
            if holdings > 0.0001:  # Skip dust
                active.append(pos)
                tokens_to_price.add(pos.token_symbol)

        if not active:
            return {"total_unrealized_pnl": 0.0, "positions": []}

        prices = await price_service.get_prices(list(tokens_to_price))

        total_unrealized = 0.0
        position_details = []

        for pos in active:
            current_price = prices.get(pos.token_symbol, 0)
            if not current_price:
                continue

            holdings = pos.current_holdings
            unrealized = (current_price - (pos.avg_buy_price_usd or 0)) * holdings
            total_unrealized += unrealized

            pnl_pct = 0.0
            if pos.avg_buy_price_usd and pos.avg_buy_price_usd > 0:
                pnl_pct = ((current_price - pos.avg_buy_price_usd) / pos.avg_buy_price_usd) * 100

            position_details.append({
                "token": pos.token_symbol,
                "chain": pos.chain,
                "holdings": holdings,
                "avg_cost": pos.avg_buy_price_usd or 0,
                "current_price": current_price,
                "current_value_usd": holdings * current_price,
                "unrealized_pnl": unrealized,
                "pnl_pct": pnl_pct,
                "is_profit": unrealized > 0,
            })

        return {
            "total_unrealized_pnl": total_unrealized,
            "positions": sorted(position_details, key=lambda x: abs(x["unrealized_pnl"]), reverse=True),
        }

    def get_pnl_summary(self, user_id: int) -> Dict:
        """Get overall PnL summary from token positions."""
        with get_session() as session:
            positions = session.query(TokenPosition).filter(
                TokenPosition.user_id == user_id,
            ).all()

        if not positions:
            return {
                "total_realized_pnl": 0.0,
                "total_cost_basis": 0.0,
                "total_proceeds": 0.0,
                "positions_count": 0,
                "winning_trades": 0,
                "losing_trades": 0,
            }

        total_realized = sum(p.realized_pnl_usd or 0 for p in positions)
        total_cost = sum(p.total_cost_usd or 0 for p in positions)
        total_proceeds = sum(p.total_proceeds_usd or 0 for p in positions)
        winning = sum(1 for p in positions if (p.realized_pnl_usd or 0) > 0)
        losing = sum(1 for p in positions if (p.realized_pnl_usd or 0) < 0)

        return {
            "total_realized_pnl": total_realized,
            "total_cost_basis": total_cost,
            "total_proceeds": total_proceeds,
            "positions_count": len(positions),
            "winning_trades": winning,
            "losing_trades": losing,
            "win_rate": (winning / (winning + losing) * 100) if (winning + losing) > 0 else 0,
        }

    async def calculate_swap_pnl(
        self,
        user_id: int,
        days: int = 30,
    ) -> Dict:
        """Calculate P&L from swaps over a period (legacy method, uses positions now)."""
        summary = self.get_pnl_summary(user_id)
        unrealized = await self.get_unrealized_pnl(user_id)

        return {
            "total_pnl_usd": summary["total_realized_pnl"] + unrealized["total_unrealized_pnl"],
            "realized_pnl_usd": summary["total_realized_pnl"],
            "unrealized_pnl_usd": unrealized["total_unrealized_pnl"],
            "total_volume_usd": summary["total_cost_basis"] + summary["total_proceeds"],
            "total_fees_usd": 0,
            "total_gas_usd": 0,
            "swap_count": summary["positions_count"],
            "positions": unrealized["positions"],
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

                wallet_details.append({
                    "address": wallet.address,
                    "chain_type": wallet.chain_type,
                    "value_usd": float(wallet_value),
                })

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

        today = datetime.utcnow().strftime("%Y-%m-%d")

        with get_session() as session:
            existing = session.query(PortfolioSnapshot).filter(
                PortfolioSnapshot.user_id == user_id,
                PortfolioSnapshot.date == today,
            ).first()

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
            cutoff_date = (datetime.utcnow() - timedelta(days=days)).strftime("%Y-%m-%d")

            snapshots = session.query(PortfolioSnapshot).filter(
                PortfolioSnapshot.user_id == user_id,
                PortfolioSnapshot.date >= cutoff_date,
            ).order_by(PortfolioSnapshot.date).all()

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
            stats = session.query(UserStats).filter(
                UserStats.user_id == user_id
            ).first()

            if not stats:
                stats = UserStats(user_id=user_id)
                session.add(stats)

            stats.total_swaps += 1

            try:
                if swap.from_amount:
                    stats.total_volume_usd += float(swap.from_amount)
                if swap.gas_cost:
                    stats.total_gas_paid_usd += float(swap.gas_cost)
            except (ValueError, TypeError, AttributeError):
                pass

            # Update streak
            today = datetime.utcnow().date()
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

            stats.last_swap_date = datetime.utcnow()

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
            stats = session.query(UserStats).filter(
                UserStats.user_id == user_id
            ).first()

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

            # Use stored price if available
            entry_price = swap.to_token_price_usd

            # Get current price of the 'to' token
            prices = await price_service.get_prices([swap.to_token])
            current_price = prices.get(swap.to_token, 0)

            if current_price == 0:
                return None

            try:
                to_amount = float(swap.to_amount) / (10**6)  # Simplified decimals
                if to_amount == 0:
                    return None

                # Prefer stored price, fall back to computed
                if not entry_price:
                    from_usd = float(swap.from_amount_usd) if swap.from_amount_usd else 0
                    if from_usd == 0:
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
