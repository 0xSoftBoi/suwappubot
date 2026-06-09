"""Dashboard / web-app link flow for WhatsApp.

WhatsApp can't embed a Mini App like Telegram, so this surfaces the web
dashboard URL as a tappable link — the closest equivalent on this platform.
"""

import logging

from bot.services.whatsapp_flows.base import BaseWhatsAppFlow, FlowResponse
from bot.services.whatsapp_flows import register_flow
from bot.config.settings import settings

logger = logging.getLogger(__name__)


class DashboardFlow(BaseWhatsAppFlow):
    """Open the Suwappu web dashboard."""

    flow_name = "dashboard"
    trigger_commands = ["dashboard", "app", "/dashboard"]

    async def start(self, user_id: str, user_db_id: int, text: str = "") -> FlowResponse:
        url = settings.webapp_url
        return FlowResponse(
            text=(
                "📊 *Suwappu Dashboard*\n\n"
                "Open the full web dashboard for live charts, your portfolio, and "
                "advanced tools:\n\n"
                f"{url}\n\n"
                "_Tip: bookmark it for quick access._"
            ),
        )


_flow = DashboardFlow()
register_flow("dashboard", _flow)
