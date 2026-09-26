"""Tax export service for generating CSV/PDF reports."""

import csv
import io
import logging
from datetime import datetime
from typing import List
from decimal import Decimal

from bot.models.swap import SwapTransaction
from database.db import get_session

logger = logging.getLogger(__name__)


class TaxExportService:
    """Service for generating tax reports."""

    def get_user_transactions(
        self,
        user_id: int,
        year: int = None,
        start_date: datetime = None,
        end_date: datetime = None,
    ) -> List[SwapTransaction]:
        """Get user transactions for a time period."""
        with get_session() as session:
            query = session.query(SwapTransaction).filter(
                SwapTransaction.user_id == user_id,
                SwapTransaction.status == "completed",
            )

            if year:
                start = datetime(year, 1, 1)
                end = datetime(year, 12, 31, 23, 59, 59)
                query = query.filter(
                    SwapTransaction.created_at >= start,
                    SwapTransaction.created_at <= end,
                )
            elif start_date and end_date:
                query = query.filter(
                    SwapTransaction.created_at >= start_date,
                    SwapTransaction.created_at <= end_date,
                )

            return query.order_by(SwapTransaction.created_at).all()

    def generate_csv(
        self,
        user_id: int,
        year: int = None,
        format_type: str = "standard",
    ) -> io.StringIO:
        """Generate CSV export of transactions."""
        transactions = self.get_user_transactions(user_id, year=year)

        output = io.StringIO()

        if format_type == "koinly":
            # Koinly format
            writer = csv.writer(output)
            writer.writerow(
                [
                    "Date",
                    "Sent Amount",
                    "Sent Currency",
                    "Received Amount",
                    "Received Currency",
                    "Fee Amount",
                    "Fee Currency",
                    "Net Worth Amount",
                    "Net Worth Currency",
                    "Label",
                    "Description",
                    "TxHash",
                ]
            )

            for tx in transactions:
                writer.writerow(
                    [
                        tx.created_at.strftime("%Y-%m-%d %H:%M:%S UTC"),
                        tx.from_amount,
                        tx.from_token,
                        tx.to_amount or "",
                        tx.to_token,
                        tx.gas_cost or "",
                        "USD",
                        "",
                        "",
                        "swap",
                        f"{tx.from_chain} to {tx.to_chain}",
                        tx.tx_hash or "",
                    ]
                )

        elif format_type == "cointracker":
            # CoinTracker format
            writer = csv.writer(output)
            writer.writerow(
                [
                    "Date",
                    "Type",
                    "Received Quantity",
                    "Received Currency",
                    "Sent Quantity",
                    "Sent Currency",
                    "Fee Amount",
                    "Fee Currency",
                    "Exchange/Wallet",
                    "Tag",
                ]
            )

            for tx in transactions:
                writer.writerow(
                    [
                        tx.created_at.strftime("%m/%d/%Y %H:%M"),
                        "Trade",
                        tx.to_amount or "",
                        tx.to_token,
                        tx.from_amount,
                        tx.from_token,
                        tx.gas_cost or "",
                        "USD",
                        f"Suwappu ({tx.from_chain})",
                        "",
                    ]
                )

        else:
            # Standard format
            writer = csv.writer(output)
            writer.writerow(
                [
                    "Date",
                    "Time",
                    "Type",
                    "From Chain",
                    "From Token",
                    "From Amount",
                    "To Chain",
                    "To Token",
                    "To Amount",
                    "Gas (USD)",
                    "Fee (USD)",
                    "TX Hash",
                    "Status",
                ]
            )

            for tx in transactions:
                writer.writerow(
                    [
                        tx.created_at.strftime("%Y-%m-%d"),
                        tx.created_at.strftime("%H:%M:%S"),
                        "Swap",
                        tx.from_chain,
                        tx.from_token,
                        tx.from_amount,
                        tx.to_chain,
                        tx.to_token,
                        tx.to_amount or "",
                        tx.gas_cost or "",
                        "",
                        tx.tx_hash or "",
                        tx.status,
                    ]
                )

        output.seek(0)
        return output

    def generate_summary(
        self,
        user_id: int,
        year: int = None,
    ) -> dict:
        """Generate summary statistics for transactions."""
        transactions = self.get_user_transactions(user_id, year=year)

        if not transactions:
            return {
                "total_transactions": 0,
                "total_volume_usd": 0,
                "total_gas_usd": 0,
                "total_fees_usd": 0,
                "chains_used": [],
                "tokens_traded": [],
                "first_trade": None,
                "last_trade": None,
                "year": year or datetime.now().year,
            }

        # Calculate stats
        total_volume = Decimal("0")
        total_gas = Decimal("0")
        chains = set()
        tokens = set()

        for tx in transactions:
            # Estimate volume (simplified)
            try:
                amount = Decimal(str(tx.from_amount)) if tx.from_amount else Decimal("0")
                total_volume += amount
            except (ValueError, TypeError):
                pass

            if tx.gas_cost:
                try:
                    total_gas += Decimal(str(tx.gas_cost))
                except (ValueError, TypeError):
                    pass

            chains.add(tx.from_chain)
            chains.add(tx.to_chain)
            tokens.add(tx.from_token)
            tokens.add(tx.to_token)

        return {
            "total_transactions": len(transactions),
            "total_volume_usd": float(total_volume),
            "total_gas_usd": float(total_gas),
            "total_fees_usd": float(total_gas) * 0.01,  # Estimate
            "chains_used": list(chains),
            "tokens_traded": list(tokens),
            "first_trade": transactions[0].created_at if transactions else None,
            "last_trade": transactions[-1].created_at if transactions else None,
            "year": year or datetime.now().year,
        }

    def get_available_years(self, user_id: int) -> List[int]:
        """Get list of years with transactions."""
        with get_session() as session:
            transactions = (
                session.query(SwapTransaction)
                .filter(
                    SwapTransaction.user_id == user_id,
                )
                .all()
            )

            years = set()
            for tx in transactions:
                if tx.created_at:
                    years.add(tx.created_at.year)

            return sorted(years, reverse=True)


# Global instance
tax_export_service = TaxExportService()
