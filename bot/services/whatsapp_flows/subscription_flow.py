"""Subscription / Pro-tier flow for WhatsApp.

Shows the user's current plan and the available tiers. Crypto (x402) payment is
completed in the web dashboard — WhatsApp can't host the chain-selection +
payment UI inline — so this flow informs + links out, reusing x402_service for
the live tier.
"""

import logging

from bot.services.whatsapp_flows.base import BaseWhatsAppFlow, FlowResponse
from bot.services.whatsapp_flows import register_flow
from bot.config.settings import settings

logger = logging.getLogger(__name__)


class SubscriptionFlow(BaseWhatsAppFlow):
    """Suwappu Pro tier comparison + upgrade link."""

    flow_name = "subscription"
    trigger_commands = ["sub", "subscribe", "pro", "premium", "/sub"]

    async def start(self, user_id: str, user_db_id: int, text: str = "") -> FlowResponse:
        current = "FREE"
        try:
            from bot.services.x402_service import x402_service

            tier = await x402_service.get_tier(user_db_id)
            current = (getattr(tier, "value", None) or str(tier)).upper()
        except Exception as e:
            logger.warning(f"subscription flow: could not load tier: {e}")

        return FlowResponse(
            text=(
                "💎 *Suwappu Pro*\n\n"
                f"Your plan: *{current}*\n\n"
                "*Plans:*\n"
                "🆓 FREE — 5 swaps/day · $1k limit\n"
                "⭐ PRO — $9.99/mo · 50 swaps/day · $50k · MEV protection\n"
                "💎 PREMIUM — $29.99/mo · 500 swaps/day · $500k · priority routing\n"
                "🏢 ENTERPRISE — $99.99/mo · unlimited\n\n"
                "Upgrade and pay (crypto via x402) in the dashboard:\n"
                f"{settings.webapp_url}"
            ),
        )


_flow = SubscriptionFlow()
register_flow("subscription", _flow)
