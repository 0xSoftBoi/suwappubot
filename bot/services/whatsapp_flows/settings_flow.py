"""Settings management flow for WhatsApp."""

import logging
from bot.services.whatsapp_flows.base import BaseWhatsAppFlow, FlowResponse
from bot.services.whatsapp_flows import register_flow
from bot.services.whatsapp_conversation import ConversationState

logger = logging.getLogger(__name__)


class SettingsFlow(BaseWhatsAppFlow):
    flow_name = "settings"
    trigger_commands = ["settings", "config"]
    steps = {
        "main_menu": "_step_main_menu",
        "set_slippage": "_step_slippage",
    }

    async def start(self, user_id: str, user_db_id: int, text: str = "") -> FlowResponse:
        await self._set_state(user_id, "main_menu", {"user_db_id": user_db_id})
        return self._show_settings_menu(user_db_id)

    def _show_settings_menu(self, user_db_id: int) -> FlowResponse:
        try:
            from database.db import get_session
            from bot.models.user import User
            with get_session() as session:
                user = session.query(User).filter(User.id == user_db_id).first()
                slippage_bps = user.default_slippage if user else 50
                notif = user.notifications_enabled if user else True
                panic = user.panic_sell_enabled if user else False
        except Exception:
            slippage_bps = 50
            notif = True
            panic = False

        slippage_pct = slippage_bps / 100
        notif_icon = "✅" if notif else "❌"
        panic_icon = "✅" if panic else "❌"

        return FlowResponse(
            text=(
                f"⚙️ *Current Settings*\n\n"
                f"Slippage: {slippage_pct}%\n"
                f"Notifications: {notif_icon}\n"
                f"Panic Sell: {panic_icon}\n\n"
                f"Select a setting to change:"
            ),
            list_button_text="Change Setting",
            list_sections=[{
                "title": "Settings",
                "rows": [
                    {"id": "set_slippage", "title": "Slippage", "description": f"Currently {slippage_pct}%"},
                    {"id": "toggle_notif", "title": "Notifications", "description": f"Currently {'on' if notif else 'off'}"},
                    {"id": "toggle_panic", "title": "Panic Sell", "description": f"Currently {'on' if panic else 'off'}"},
                ],
            }],
        )

    async def _step_main_menu(self, user_id: str, user_db_id: int, text: str, state: ConversationState) -> FlowResponse:
        db_uid = state.data.get("user_db_id") or user_db_id

        if text == "set_slippage":
            await self._update(user_id, "set_slippage")
            return FlowResponse(
                text="Enter your desired slippage percentage (e.g. `0.5` or `1`):",
            )
        elif text == "toggle_notif":
            return await self._toggle_setting(user_id, db_uid, "notifications_enabled")
        elif text == "toggle_panic":
            return await self._toggle_setting(user_id, db_uid, "panic_sell_enabled")
        else:
            return self._show_settings_menu(db_uid)

    async def _step_slippage(self, user_id: str, user_db_id: int, text: str, state: ConversationState) -> FlowResponse:
        db_uid = state.data.get("user_db_id") or user_db_id
        try:
            val = float(text.replace("%", "").strip())
            if val < 0.01 or val > 50:
                return FlowResponse("Slippage must be between 0.01% and 50%. Try again:")
            bps = int(val * 100)
        except ValueError:
            return FlowResponse("Please enter a valid number (e.g. `0.5`):")

        try:
            from database.db import get_session
            from bot.models.user import User
            with get_session() as session:
                user = session.query(User).filter(User.id == db_uid).first()
                if user:
                    user.default_slippage = bps
                    session.commit()
        except Exception as e:
            logger.error(f"Slippage update error: {e}")
            await self._clear(user_id)
            return FlowResponse("Failed to update slippage. Try again later.")

        await self._clear(user_id)
        return FlowResponse(f"✅ Slippage updated to *{val}%*")

    async def _toggle_setting(self, user_id: str, user_db_id: int, field: str) -> FlowResponse:
        await self._clear(user_id)
        try:
            from database.db import get_session
            from bot.models.user import User
            with get_session() as session:
                user = session.query(User).filter(User.id == user_db_id).first()
                if user:
                    current = getattr(user, field, False)
                    setattr(user, field, not current)
                    session.commit()
                    label = field.replace("_", " ").title()
                    return FlowResponse(f"✅ {label} {'enabled' if not current else 'disabled'}")
        except Exception as e:
            logger.error(f"Toggle {field} error: {e}")
        return FlowResponse("Failed to update setting. Try again later.")


_flow = SettingsFlow()
register_flow("settings", _flow)
