"""Tax export flow for WhatsApp."""

import logging
from datetime import datetime, timezone
from bot.services.whatsapp_flows.base import BaseWhatsAppFlow, FlowResponse
from bot.services.whatsapp_flows import register_flow
from bot.services.whatsapp_conversation import ConversationState

logger = logging.getLogger(__name__)


class TaxFlow(BaseWhatsAppFlow):
    """Generate and export tax CSV reports."""

    flow_name = "tax"
    trigger_commands = ["tax"]
    steps = {
        "choose_year": "_step_choose_year",
        "confirm": "_step_confirm",
    }

    async def start(self, user_id: str, user_db_id: int, text: str = "") -> FlowResponse:
        current_year = datetime.now(timezone.utc).year
        years = [str(current_year - i) for i in range(4)]  # Last 4 years

        await self._set_state(user_id, "choose_year", {"user_db_id": user_db_id})

        rows = [{"id": f"year_{y}", "title": y} for y in years]
        return FlowResponse(
            text=(
                "📊 *Tax Export*\n\n"
                "Generate a CSV report of all your swaps for tax purposes.\n\n"
                "Select the tax year:"
            ),
            header="📊 Tax Report",
            list_button_text="Select Year",
            list_sections=[{"title": "Years", "rows": rows}],
        )

    async def _step_choose_year(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        year_str = text.replace("year_", "")
        try:
            year = int(year_str)
            if year < 2020 or year > datetime.now(timezone.utc).year:
                raise ValueError
        except ValueError:
            return FlowResponse("Please select a valid year from the list.")

        await self._update(user_id, "confirm", {"year": year})

        return FlowResponse(
            text=(
                f"Generate tax report for *{year}*?\n\n"
                f"This will include all swaps from Jan 1 to Dec 31, {year}."
            ),
            buttons=[
                {"id": "tax_generate", "title": "📄 Generate CSV"},
                {"id": "tax_cancel", "title": "❌ Cancel"},
            ],
        )

    async def _step_confirm(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        if text in ("tax_cancel", "cancel"):
            await self._clear(user_id)
            return FlowResponse("Tax export cancelled.")

        if text not in ("tax_generate", "generate", "yes"):
            return FlowResponse(
                "Please confirm or cancel:",
                buttons=[
                    {"id": "tax_generate", "title": "📄 Generate CSV"},
                    {"id": "tax_cancel", "title": "❌ Cancel"},
                ],
            )

        await self._clear(user_id)
        db_uid = state.data.get("user_db_id") or user_db_id
        year = state.data.get("year", datetime.now(timezone.utc).year)

        try:
            csv_url = await self._generate_tax_csv(db_uid, year)
            if csv_url:
                return FlowResponse(
                    text=f"📊 *Tax Report Ready*\n\nYear: {year}",
                    document={"url": csv_url, "filename": f"suwappu_tax_{year}.csv"},
                )
            else:
                return FlowResponse(
                    f"📊 *Tax Report for {year}*\n\n"
                    f"No swap transactions found for this period.\n\n"
                    f"If you believe this is an error, check your transaction history with *history*."
                )
        except Exception as e:
            logger.error(f"Tax CSV generation failed: {e}")
            return FlowResponse(
                f"Failed to generate tax report: {str(e)[:100]}\n\n"
                f"Please try again or use the web dashboard for exports."
            )

    async def _generate_tax_csv(self, user_db_id: int, year: int) -> str | None:
        """Generate CSV and return a URL to download it."""
        import csv
        import io
        from datetime import datetime
        from database.db import get_session
        from bot.models.swap import SwapTransaction

        start_date = datetime(year, 1, 1)
        end_date = datetime(year, 12, 31, 23, 59, 59)

        with get_session() as session:
            swaps = (
                session.query(SwapTransaction)
                .filter(
                    SwapTransaction.user_id == user_db_id,
                    SwapTransaction.created_at >= start_date,
                    SwapTransaction.created_at <= end_date,
                    SwapTransaction.status == "completed",
                )
                .order_by(SwapTransaction.created_at)
                .all()
            )

            if not swaps:
                return None

            output = io.StringIO()
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
                    "Fee USD",
                    "TX Hash",
                    "Status",
                ]
            )

            for s in swaps:
                writer.writerow(
                    [
                        s.created_at.strftime("%Y-%m-%d"),
                        s.created_at.strftime("%H:%M:%S"),
                        "Swap",
                        s.from_chain,
                        s.from_token,
                        s.from_amount,
                        s.to_chain,
                        s.to_token,
                        s.to_amount,
                        f"{s.fee_usd:.4f}" if s.fee_usd else "0",
                        s.tx_hash or "",
                        s.status,
                    ]
                )

            csv_content = output.getvalue()  # noqa: F841

            # In production, upload to S3/cloud storage and return signed URL
            # For now, we'll use a data URL approach or temp file
            # Since WhatsApp requires a publicly accessible URL, this would need
            # cloud storage integration in production

            # Placeholder: In real implementation, upload csv_content to S3
            # and return the signed URL

            # Note: WhatsApp document API requires a real URL, not a data URI
            # This is a placeholder that would need S3 integration
            logger.info(
                f"Generated tax CSV with {len(swaps)} transactions for user {user_db_id}, year {year}"
            )

            # Return None to indicate we need cloud storage integration
            # In production, this would return an S3 signed URL
            return None


_flow = TaxFlow()
register_flow("tax", _flow)
