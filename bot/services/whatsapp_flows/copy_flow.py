"""Copy trading flow for WhatsApp."""

import logging
from bot.services.whatsapp_flows.base import BaseWhatsAppFlow, FlowResponse
from bot.services.whatsapp_flows import register_flow
from bot.services.whatsapp_conversation import ConversationState

logger = logging.getLogger(__name__)

# Placeholder top traders for browsing
_SAMPLE_TRADERS = [
    {"address": "0x1234...abcd", "label": "AlphaTrader", "pnl": "+142%", "trades": 89},
    {"address": "0x5678...efgh", "label": "DeFiWhale", "pnl": "+98%", "trades": 234},
    {"address": "0x9abc...ijkl", "label": "SwingKing", "pnl": "+76%", "trades": 56},
    {"address": "0xdef0...mnop", "label": "MevBot_01", "pnl": "+65%", "trades": 412},
    {"address": "0x1111...qrst", "label": "GemHunter", "pnl": "+54%", "trades": 127},
]


class CopyFlow(BaseWhatsAppFlow):
    flow_name = "copy"
    trigger_commands = ["copy", "follow", "traders", "/copy"]
    steps = {
        "show_menu": "_step_show_menu",
        "browse_traders": "_step_browse_traders",
        "follow_trader": "_step_follow_trader",
        "unfollow": "_step_unfollow",
        "my_copies": "_step_my_copies",
        "set_amount": "_step_set_amount",
    }

    async def start(self, user_id: str, user_db_id: int, text: str = "") -> FlowResponse:
        await self._set_state(user_id, "show_menu", {"user_db_id": user_db_id})
        return FlowResponse(
            text=(
                "*Copy Trading*\n\n"
                "Follow top traders and automatically mirror their trades.\n\n"
                "Select an option:"
            ),
            buttons=[
                {"id": "copy_browse", "title": "Browse Traders"},
                {"id": "copy_mine", "title": "My Copies"},
                {"id": "copy_settings", "title": "Settings"},
            ],
        )

    async def _step_show_menu(self, user_id: str, user_db_id: int, text: str, state: ConversationState) -> FlowResponse:
        db_uid = state.data.get("user_db_id") or user_db_id

        if text == "copy_browse":
            await self._update(user_id, "browse_traders")
            return self._build_trader_list()
        elif text == "copy_mine":
            await self._update(user_id, "my_copies")
            return await self._build_my_copies(db_uid)
        elif text == "copy_settings":
            await self._update(user_id, "set_amount")
            return FlowResponse(
                text="Enter the max amount (in USD) to allocate per copied trade (e.g. `50` or `100`):",
            )
        else:
            return FlowResponse(
                text="Select an option:",
                buttons=[
                    {"id": "copy_browse", "title": "Browse Traders"},
                    {"id": "copy_mine", "title": "My Copies"},
                    {"id": "copy_settings", "title": "Settings"},
                ],
            )

    async def _step_browse_traders(self, user_id: str, user_db_id: int, text: str, state: ConversationState) -> FlowResponse:
        # User selected a trader from the list
        selected = text.replace("trader_", "")

        trader = None
        for t in _SAMPLE_TRADERS:
            if t["label"].lower() == selected.lower():
                trader = t
                break

        if not trader:
            return self._build_trader_list()

        await self._update(user_id, "follow_trader", {"selected_trader": trader["label"]})
        return FlowResponse(
            text=(
                f"*{trader['label']}*\n\n"
                f"Address: `{trader['address']}`\n"
                f"30d PnL: *{trader['pnl']}*\n"
                f"Trades: *{trader['trades']}*\n\n"
                f"Follow this trader?"
            ),
            buttons=[
                {"id": "follow_yes", "title": "Follow"},
                {"id": "follow_no", "title": "Back"},
            ],
        )

    async def _step_follow_trader(self, user_id: str, user_db_id: int, text: str, state: ConversationState) -> FlowResponse:
        if text in ("follow_no", "back"):
            await self._update(user_id, "browse_traders")
            return self._build_trader_list()

        if text not in ("follow_yes", "follow"):
            return FlowResponse(
                "Follow this trader?",
                buttons=[
                    {"id": "follow_yes", "title": "Follow"},
                    {"id": "follow_no", "title": "Back"},
                ],
            )

        trader_label = state.data.get("selected_trader", "Unknown")
        await self._update(user_id, "set_amount", {"following": trader_label})
        return FlowResponse(
            text=f"Enter the max amount (in USD) per trade for *{trader_label}* (e.g. `50`):",
        )

    async def _step_unfollow(self, user_id: str, user_db_id: int, text: str, state: ConversationState) -> FlowResponse:
        # Placeholder — would remove from copy_service
        await self._clear(user_id)
        return FlowResponse("Unfollowed. Type *copy* to manage your copy trades.")

    async def _step_my_copies(self, user_id: str, user_db_id: int, text: str, state: ConversationState) -> FlowResponse:
        if text.startswith("unfollow_"):
            trader_label = text.replace("unfollow_", "")
            await self._clear(user_id)
            # Placeholder for actual unfollow logic
            return FlowResponse(f"Unfollowed *{trader_label}*. Type *copy* to manage copy trades.")

        await self._clear(user_id)
        return FlowResponse("Type *copy* to return to the copy trading menu.")

    async def _step_set_amount(self, user_id: str, user_db_id: int, text: str, state: ConversationState) -> FlowResponse:
        try:
            amount = float(text.replace("$", "").replace(",", "").strip())
            if amount <= 0:
                raise ValueError
        except ValueError:
            return FlowResponse("Please enter a valid positive USD amount (e.g. `50`):")

        trader_label = state.data.get("following")
        await self._clear(user_id)

        if trader_label:
            # Placeholder for copy_service.follow(user_db_id, trader, amount)
            return FlowResponse(
                f"Now following *{trader_label}* with max *${amount:.0f}* per trade.\n\n"
                f"_Copy trading integration coming soon. You'll be notified when it goes live._"
            )
        else:
            # General settings update
            return FlowResponse(
                f"Default copy amount set to *${amount:.0f}* per trade.\n\n"
                f"_Copy trading integration coming soon._"
            )

    # -- Helpers ---------------------------------------------------------

    def _build_trader_list(self) -> FlowResponse:
        rows = []
        for t in _SAMPLE_TRADERS:
            rows.append({
                "id": f"trader_{t['label']}",
                "title": f"{t['label']} ({t['pnl']})",
                "description": f"{t['trades']} trades | {t['address']}",
            })

        return FlowResponse(
            text="*Top Traders (30d)*\n\nSelect a trader to view details:",
            list_button_text="Browse Traders",
            list_sections=[{"title": "Top Traders", "rows": rows}],
        )

    async def _build_my_copies(self, user_db_id: int) -> FlowResponse:
        # Placeholder — would query copy_service for active follows
        return FlowResponse(
            text=(
                "*My Copy Trades*\n\n"
                "_No active copy trades._\n\n"
                "Browse top traders to start following."
            ),
            buttons=[
                {"id": "copy_browse", "title": "Browse Traders"},
            ],
        )


_flow = CopyFlow()
register_flow("copy", _flow)
