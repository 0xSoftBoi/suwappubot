"""Price alerts flow for WhatsApp."""

import logging
from bot.services.whatsapp_flows.base import BaseWhatsAppFlow, FlowResponse
from bot.services.whatsapp_flows import register_flow
from bot.services.whatsapp_conversation import ConversationState

logger = logging.getLogger(__name__)


def _format_alert(a) -> str:
    """Format a single alert for display."""
    if a.alert_type == "price_above":
        return f"📈 {a.token_symbol} above ${a.target_price:.4f}"
    elif a.alert_type == "price_below":
        return f"📉 {a.token_symbol} below ${a.target_price:.4f}"
    else:
        return f"📊 {a.token_symbol} ±{a.percent_threshold:.1f}%"


class AlertsFlow(BaseWhatsAppFlow):
    flow_name = "alerts"
    trigger_commands = ["alerts", "alert", "/a", "a"]
    steps = {
        "main_menu": "_step_main_menu",
        "choose_token": "_step_choose_token",
        "enter_price": "_step_enter_price",
        "choose_direction": "_step_choose_direction",
        "confirm": "_step_confirm",
        "delete_select": "_step_delete_select",
    }

    async def start(self, user_id: str, user_db_id: int, text: str = "") -> FlowResponse:
        await self._set_state(user_id, "main_menu", {"user_db_id": user_db_id})
        return await self._show_alerts_menu(user_db_id)

    async def _show_alerts_menu(self, user_db_id: int) -> FlowResponse:
        from bot.services.alerts import alert_service

        alerts = alert_service.get_user_alerts(user_db_id)

        if alerts:
            lines = ["🔔 *Your Active Alerts*\n"]
            for a in alerts[:10]:
                status = "🟢" if a.is_active else "⚪"
                lines.append(f"{status} #{a.id}: {_format_alert(a)}")
            text = "\n".join(lines)
        else:
            text = "🔔 *Price Alerts*\n\nNo active alerts."

        return FlowResponse(
            text=text + "\n\nWhat would you like to do?",
            buttons=[
                {"id": "alert_create", "title": "Create Alert"},
                {"id": "alert_delete", "title": "Delete Alert"},
            ],
        )

    async def _step_main_menu(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        db_uid = state.data.get("user_db_id") or user_db_id

        if text == "alert_create":
            await self._update(user_id, "choose_token")
            tokens = ["ETH", "BTC", "SOL", "USDC", "LINK", "UNI", "AAVE", "ARB", "OP", "PEPE"]
            rows = [{"id": f"alerttk_{t}", "title": t} for t in tokens]
            return FlowResponse(
                text="Select the token to set an alert for:",
                header="🔔 New Alert",
                list_button_text="Choose Token",
                list_sections=[{"title": "Tokens", "rows": rows}],
            )
        elif text == "alert_delete":
            from bot.services.alerts import alert_service

            alerts = alert_service.get_user_alerts(db_uid)
            if not alerts:
                await self._clear(user_id)
                return FlowResponse("No active alerts to delete.")
            rows = [
                {
                    "id": f"alertdel_{a.id}",
                    "title": f"#{a.id} {a.token_symbol}",
                    "description": _format_alert(a),
                }
                for a in alerts[:10]
            ]
            await self._update(user_id, "delete_select")
            return FlowResponse(
                text="Select an alert to delete:",
                list_button_text="Choose Alert",
                list_sections=[{"title": "Active Alerts", "rows": rows}],
            )
        return await self._show_alerts_menu(db_uid)

    async def _step_choose_token(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        token = text.replace("alerttk_", "").upper()
        await self._update(user_id, "enter_price", {"token": token})
        return FlowResponse(
            text=f"Token: *{token}*\n\nEnter the target price in USD (e.g. `3500` or `0.0042`):",
        )

    async def _step_enter_price(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        try:
            price = float(text.replace("$", "").replace(",", "").strip())
            if price <= 0:
                raise ValueError
        except ValueError:
            return FlowResponse("Please enter a valid positive price:")

        await self._update(user_id, "choose_direction", {"target_price": price})
        return FlowResponse(
            text=f"Alert when price goes *above* or *below* ${price}?",
            buttons=[
                {"id": "dir_above", "title": "📈 Above"},
                {"id": "dir_below", "title": "📉 Below"},
            ],
        )

    async def _step_choose_direction(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        if "above" in text.lower():
            direction = "price_above"
        elif "below" in text.lower():
            direction = "price_below"
        else:
            return FlowResponse(
                "Please select above or below:",
                buttons=[
                    {"id": "dir_above", "title": "📈 Above"},
                    {"id": "dir_below", "title": "📉 Below"},
                ],
            )

        await self._update(user_id, "confirm", {"direction": direction})
        token = state.data.get("token", "?")
        price = state.data.get("target_price", 0)
        arrow = "📈 above" if direction == "price_above" else "📉 below"

        return FlowResponse(
            text=f"*Confirm Alert*\n\n{token} {arrow} ${price}\n\nCreate this alert?",
            buttons=[
                {"id": "alert_confirm", "title": "✅ Create"},
                {"id": "alert_cancel", "title": "❌ Cancel"},
            ],
        )

    async def _step_confirm(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        if text in ("alert_cancel", "cancel"):
            await self._clear(user_id)
            return FlowResponse("Alert creation cancelled.")

        if text not in ("alert_confirm", "confirm", "yes"):
            return FlowResponse(
                "Please confirm or cancel:",
                buttons=[
                    {"id": "alert_confirm", "title": "✅ Create"},
                    {"id": "alert_cancel", "title": "❌ Cancel"},
                ],
            )

        await self._clear(user_id)
        db_uid = state.data.get("user_db_id") or user_db_id
        token = state.data.get("token")
        price = state.data.get("target_price")
        direction = state.data.get("direction")

        try:
            from bot.services.alerts import alert_service

            alert = alert_service.create_alert(
                user_id=db_uid,
                token_symbol=token,
                alert_type=direction,
                target_price=price,
            )
            return FlowResponse(
                f"✅ *Alert Created!*\n\n"
                f"#{alert.id}: {_format_alert(alert)}\n\n"
                f"You'll be notified when the price is hit."
            )
        except Exception as e:
            logger.error(f"Alert creation failed: {e}")
            return FlowResponse("Failed to create alert. Try again later.")

    async def _step_delete_select(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        await self._clear(user_id)
        db_uid = state.data.get("user_db_id") or user_db_id
        try:
            alert_id = int(text.replace("alertdel_", ""))
            from bot.services.alerts import alert_service

            if alert_service.delete_alert(alert_id, db_uid):
                return FlowResponse(f"✅ Alert #{alert_id} deleted.")
            return FlowResponse("Alert not found or already deleted.")
        except (ValueError, TypeError):
            return FlowResponse("Invalid selection. Use *alerts* to try again.")


_flow = AlertsFlow()
register_flow("alerts", _flow)
