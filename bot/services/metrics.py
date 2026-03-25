"""Admin metrics and analytics service."""

import logging
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional
from decimal import Decimal
from collections import defaultdict

from bot.models.user import User
from bot.models.swap import SwapTransaction
from bot.models.custodial import CustodialBalance, CustodialTransaction, HotWallet
from bot.models.fees import FeeTransaction
from database.db import get_session

logger = logging.getLogger(__name__)


class MetricsService:
    """Service for collecting and analyzing platform metrics."""
    
    def get_overview(self) -> dict:
        """Get platform overview metrics."""
        with get_session() as session:
            # User counts
            total_users = session.query(User).count()
            
            today = datetime.now(timezone.utc).date()
            active_today = session.query(User).filter(
                User.updated_at >= datetime(today.year, today.month, today.day)
            ).count()
            
            week_ago = datetime.now(timezone.utc) - timedelta(days=7)
            active_week = session.query(User).filter(
                User.updated_at >= week_ago
            ).count()
            
            # Transaction counts
            total_swaps = session.query(SwapTransaction).count()
            completed_swaps = session.query(SwapTransaction).filter(
                SwapTransaction.status == "completed"
            ).count()
            failed_swaps = session.query(SwapTransaction).filter(
                SwapTransaction.status == "failed"
            ).count()
            
            # Today's swaps
            today_swaps = session.query(SwapTransaction).filter(
                SwapTransaction.created_at >= datetime(today.year, today.month, today.day)
            ).count()
            
            # Custodial users
            custodial_users = session.query(CustodialBalance.user_id).distinct().count()
            
            return {
                "users": {
                    "total": total_users,
                    "active_today": active_today,
                    "active_week": active_week,
                    "custodial": custodial_users,
                },
                "swaps": {
                    "total": total_swaps,
                    "completed": completed_swaps,
                    "failed": failed_swaps,
                    "today": today_swaps,
                    "success_rate": (completed_swaps / total_swaps * 100) if total_swaps > 0 else 0,
                },
            }
    
    def get_volume_stats(self, days: int = 30) -> dict:
        """Get volume statistics."""
        with get_session() as session:
            cutoff = datetime.now(timezone.utc) - timedelta(days=days)
            
            transactions = session.query(SwapTransaction).filter(
                SwapTransaction.created_at >= cutoff,
                SwapTransaction.status == "completed",
            ).all()
            
            total_volume = Decimal("0")
            volume_by_chain = defaultdict(Decimal)
            volume_by_token = defaultdict(Decimal)
            volume_by_day = defaultdict(Decimal)
            
            for tx in transactions:
                try:
                    amount = Decimal(str(tx.from_amount)) if tx.from_amount else Decimal("0")
                    total_volume += amount
                    volume_by_chain[tx.from_chain] += amount
                    volume_by_token[tx.from_token] += amount
                    
                    day = tx.created_at.strftime("%Y-%m-%d")
                    volume_by_day[day] += amount
                except (ValueError, TypeError, AttributeError) as e:
                    logger.warning(f"Error parsing volume for tx {getattr(tx, 'id', '?')}: {e}")
                    pass
            
            return {
                "total_volume": float(total_volume),
                "by_chain": {k: float(v) for k, v in volume_by_chain.items()},
                "by_token": {k: float(v) for k, v in sorted(volume_by_token.items(), 
                                                            key=lambda x: x[1], reverse=True)[:10]},
                "by_day": dict(sorted(volume_by_day.items())),
                "period_days": days,
            }
    
    def get_fee_stats(self, days: int = 30) -> dict:
        """Get fee collection statistics."""
        with get_session() as session:
            cutoff = datetime.now(timezone.utc) - timedelta(days=days)
            
            fees = session.query(FeeTransaction).filter(
                FeeTransaction.created_at >= cutoff,
            ).all()
            
            total_collected = Decimal("0")
            total_swept = Decimal("0")
            pending = Decimal("0")
            by_chain = defaultdict(Decimal)
            by_token = defaultdict(Decimal)
            
            for fee in fees:
                try:
                    amount = Decimal(str(fee.fee_amount))
                    total_collected += amount
                    by_chain[fee.chain] += amount
                    by_token[fee.token_symbol] += amount
                    
                    if fee.is_collected:
                        total_swept += amount
                    else:
                        pending += amount
                except (ValueError, TypeError, AttributeError) as e:
                    logger.warning(f"Error parsing fee for fee {getattr(fee, 'id', '?')}: {e}")
                    pass
            
            return {
                "total_collected": float(total_collected),
                "total_swept": float(total_swept),
                "pending": float(pending),
                "by_chain": {k: float(v) for k, v in by_chain.items()},
                "by_token": {k: float(v) for k, v in by_token.items()},
                "period_days": days,
            }
    
    def get_hot_wallet_status(self) -> List[dict]:
        """Get status of all hot wallets."""
        with get_session() as session:
            wallets = session.query(HotWallet).all()
            
            result = []
            for wallet in wallets:
                result.append({
                    "id": wallet.id,
                    "name": wallet.name,
                    "chain": wallet.chain,
                    "address": wallet.address,
                    "is_active": wallet.is_active,
                    "created_at": wallet.created_at.isoformat() if wallet.created_at else None,
                })
            
            return result
    
    def get_top_users(self, limit: int = 10) -> List[dict]:
        """Get top users by volume."""
        with get_session() as session:
            # Get swap counts per user
            users_data = {}
            
            transactions = session.query(SwapTransaction).filter(
                SwapTransaction.status == "completed"
            ).all()
            
            for tx in transactions:
                if tx.user_id not in users_data:
                    users_data[tx.user_id] = {
                        "user_id": tx.user_id,
                        "swap_count": 0,
                        "volume": Decimal("0"),
                    }
                
                users_data[tx.user_id]["swap_count"] += 1
                try:
                    amount = Decimal(str(tx.from_amount)) if tx.from_amount else Decimal("0")
                    users_data[tx.user_id]["volume"] += amount
                except (ValueError, TypeError, AttributeError):
                    pass
            
            # Sort by volume
            sorted_users = sorted(
                users_data.values(),
                key=lambda x: x["volume"],
                reverse=True
            )[:limit]
            
            # Get usernames
            result = []
            for data in sorted_users:
                user = session.query(User).filter(User.id == data["user_id"]).first()
                result.append({
                    "user_id": data["user_id"],
                    "username": user.username if user else "Unknown",
                    "swap_count": data["swap_count"],
                    "volume": float(data["volume"]),
                })
            
            return result
    
    def get_chain_health(self) -> dict:
        """Get health metrics for each chain."""
        with get_session() as session:
            # Get recent transactions by chain
            cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
            
            transactions = session.query(SwapTransaction).filter(
                SwapTransaction.created_at >= cutoff
            ).all()
            
            chain_stats = defaultdict(lambda: {
                "total": 0, "completed": 0, "failed": 0, "pending": 0
            })
            
            for tx in transactions:
                chain_stats[tx.from_chain]["total"] += 1
                if tx.status == "completed":
                    chain_stats[tx.from_chain]["completed"] += 1
                elif tx.status == "failed":
                    chain_stats[tx.from_chain]["failed"] += 1
                else:
                    chain_stats[tx.from_chain]["pending"] += 1
            
            result = {}
            for chain, stats in chain_stats.items():
                success_rate = (stats["completed"] / stats["total"] * 100) if stats["total"] > 0 else 100
                result[chain] = {
                    **stats,
                    "success_rate": round(success_rate, 1),
                    "status": "healthy" if success_rate > 95 else "degraded" if success_rate > 80 else "unhealthy",
                }
            
            return result
    
    def get_recent_errors(self, limit: int = 20) -> List[dict]:
        """Get recent failed transactions."""
        with get_session() as session:
            failed = session.query(SwapTransaction).filter(
                SwapTransaction.status == "failed"
            ).order_by(SwapTransaction.created_at.desc()).limit(limit).all()
            
            return [
                {
                    "id": tx.id,
                    "user_id": tx.user_id,
                    "from_chain": tx.from_chain,
                    "to_chain": tx.to_chain,
                    "from_token": tx.from_token,
                    "to_token": tx.to_token,
                    "error": tx.error_message,
                    "created_at": tx.created_at.isoformat() if tx.created_at else None,
                }
                for tx in failed
            ]


# Global instance
metrics_service = MetricsService()

