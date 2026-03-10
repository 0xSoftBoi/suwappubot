"""Flow-aware message router for WhatsApp webhook.

Replaces the direct unified_bot_service.handle_command() call in the webhook
handler.  Routes messages through the existing WhatsApp conversation flows
(swap, wallet, alerts, etc.) and only falls back to the unified service for
simple stateless commands.
"""

import logging
from typing import Optional

from bot.services.whatsapp_conversation import conversation_manager
from bot.services.whatsapp_flows import get_flow, get_all_flows
from bot.services.whatsapp_flows.base import FlowResponse
from bot.services.whatsapp_service import WhatsAppMessage, whatsapp_service
from bot.services.unified_bot_service import unified_bot_service, UnifiedResponse
from bot.models.user import User
from database.db import get_session

logger = logging.getLogger(__name__)

# Commands handled directly by unified_bot_service (no flow needed)
_SIMPLE_COMMANDS = {
    "/start", "start", "hi", "hello",
    "/help", "help",
    "/b", "b", "balance",
    "/p", "p", "portfolio",
    "/hx", "hx", "history",
    "/w", "w", "wallet", "wallets",
    "/g", "g", "gas",
    "accept", "i accept", "agree",
}


class WhatsAppRouter:
    """Routes incoming WhatsApp messages to flows or the unified service."""

    async def route(self, message: WhatsAppMessage) -> None:
        """Main entry point — decide where to send a message and respond."""
        user_id = message.from_number
        text = (message.button_payload or message.list_reply_id or message.text or "").strip()

        if not text:
            await whatsapp_service.send_text_message(user_id, "Send a text message or tap a button to interact.")
            return

        # 1. Check for active conversation state → dispatch to flow.handle()
        state = await conversation_manager.get_state(user_id)
        if state:
            flow = get_flow(state.flow)
            if flow:
                db_user_id = await self._get_user_db_id(user_id)
                response = await flow.handle(user_id, db_user_id, text, state)
                if response:
                    await self._send_flow_response(user_id, response)
                    return

        # 2. Check if text matches any flow's trigger_commands → call flow.start()
        text_lower = text.lower()
        for _name, flow in get_all_flows().items():
            triggers = [flow.flow_name] + (flow.trigger_commands or [])
            if text_lower in [t.lower() for t in triggers]:
                db_user_id = await self._get_user_db_id(user_id)
                if db_user_id is None:
                    # User doesn't exist yet — let unified service handle /start
                    break
                response = await flow.start(user_id, db_user_id, text)
                if response:
                    await self._send_flow_response(user_id, response)
                    return

        # 3. Fall back to unified_bot_service for simple commands
        unified_resp = await unified_bot_service.handle_command(
            platform="whatsapp",
            user_id=user_id,
            text=text,
        )
        await self._send_unified_response(user_id, unified_resp)

    async def _get_user_db_id(self, whatsapp_id: str) -> Optional[int]:
        """Look up the internal DB user ID from a WhatsApp phone number."""
        with get_session() as session:
            user = session.query(User).filter(User.whatsapp_id == whatsapp_id).first()
            return user.id if user else None

    # === Response rendering ===

    async def _send_flow_response(self, to: str, resp: FlowResponse) -> None:
        """Render a FlowResponse using the appropriate WhatsApp message type."""
        # Document
        if resp.document:
            await whatsapp_service.send_document(
                to,
                media_url=resp.document.get("url", ""),
                filename=resp.document.get("filename", "file"),
                caption=resp.document.get("caption"),
            )
            return

        # Image
        if resp.image:
            await whatsapp_service.send_image(to, media_url=resp.image, caption=resp.text)
            return

        # List message
        if resp.list_sections and resp.list_button_text:
            await whatsapp_service.send_interactive_list(
                to,
                body_text=resp.text,
                button_text=resp.list_button_text,
                sections=resp.list_sections,
                header=resp.header,
                footer=resp.footer,
            )
            return

        # Buttons
        if resp.buttons:
            await whatsapp_service.send_interactive_buttons(
                to,
                body_text=resp.text,
                buttons=resp.buttons,
                header=resp.header,
                footer=resp.footer,
            )
            return

        # Plain text
        await whatsapp_service.send_text_message(to, resp.text)

    async def _send_unified_response(self, to: str, resp: UnifiedResponse) -> None:
        """Render a UnifiedResponse (from the legacy service)."""
        if resp.buttons:
            await whatsapp_service.send_interactive_buttons(
                to,
                body_text=resp.text,
                buttons=resp.buttons,
                header=resp.header,
            )
        else:
            await whatsapp_service.send_text_message(to, resp.text)


# Singleton
whatsapp_router = WhatsAppRouter()
