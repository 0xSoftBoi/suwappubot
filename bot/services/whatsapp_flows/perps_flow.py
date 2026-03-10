"""Perpetual futures trading flow for WhatsApp."""

import logging
from bot.services.whatsapp_flows.base import BaseWhatsAppFlow, FlowResponse
from bot.services.whatsapp_flows import register_flow
from bot.services.whatsapp_conversation import ConversationState

logger = logging.getLogger(__name__)

_PERP_ASSETS = ["ETH", "BTC", "SOL", "ARB", "OP", "AVAX", "MATIC", "LINK", "DOGE", "PEPE"]


class PerpsFlow(BaseWhatsAppFlow):
    flow_name = "perps"
    trigger_commands = ["perps", "futures", "long", "short", "/perps", "/long", "/short"]
    steps = {
        "show_menu": "_step_show_menu",
        "select_asset": "_step_select_asset",
        "select_side": "_step_select_side",
        "select_leverage": "_step_select_leverage",
        "enter_size": "_step_enter_size",
        "confirm": "_step_confirm",
        "show_positions": "_step_show_positions",
        "close_position": "_step_close_position",
    }

    async def start(self, user_id: str, user_db_id: int, text: str = "") -> FlowResponse:
        cmd = text.strip().lower()

        # Shortcut: "long" or "short" skips to asset selection with side pre-set
        if cmd in ("long", "/long"):
            await self._set_state(user_id, "select_asset", {"user_db_id": user_db_id, "side": "long"})
            return self._build_asset_list("long")
        elif cmd in ("short", "/short"):
            await self._set_state(user_id, "select_asset", {"user_db_id": user_db_id, "side": "short"})
            return self._build_asset_list("short")

        await self._set_state(user_id, "show_menu", {"user_db_id": user_db_id})
        return FlowResponse(
            text=(
                "*Perpetual Futures*\n\n"
                "Trade perpetual contracts with leverage.\n\n"
                "Select an option:"
            ),
            buttons=[
                {"id": "perps_open", "title": "Open Position"},
                {"id": "perps_positions", "title": "My Positions"},
            ],
        )

    async def _step_show_menu(self, user_id: str, user_db_id: int, text: str, state: ConversationState) -> FlowResponse:
        if text == "perps_open":
            await self._update(user_id, "select_asset")
            return self._build_asset_list()
        elif text == "perps_positions":
            await self._update(user_id, "show_positions")
            return await self._build_positions(state.data.get("user_db_id") or user_db_id)
        else:
            return FlowResponse(
                text="Select an option:",
                buttons=[
                    {"id": "perps_open", "title": "Open Position"},
                    {"id": "perps_positions", "title": "My Positions"},
                ],
            )

    async def _step_select_asset(self, user_id: str, user_db_id: int, text: str, state: ConversationState) -> FlowResponse:
        asset = text.replace("perp_asset_", "").upper()
        if asset not in _PERP_ASSETS:
            return self._build_asset_list(state.data.get("side"))

        await self._update(user_id, "select_side", {"asset": asset})

        # If side was already set via shortcut, skip to leverage
        side = state.data.get("side")
        if side:
            await self._update(user_id, "select_leverage", {"asset": asset, "side": side})
            return FlowResponse(
                text=f"*{side.upper()} {asset}*\n\nSelect leverage:",
                buttons=[
                    {"id": "lev_1", "title": "1x"},
                    {"id": "lev_5", "title": "5x"},
                    {"id": "lev_10", "title": "10x"},
                ],
            )

        return FlowResponse(
            text=f"Asset: *{asset}*\n\nSelect direction:",
            buttons=[
                {"id": "side_long", "title": "Long"},
                {"id": "side_short", "title": "Short"},
            ],
        )

    async def _step_select_side(self, user_id: str, user_db_id: int, text: str, state: ConversationState) -> FlowResponse:
        if "long" in text.lower():
            side = "long"
        elif "short" in text.lower():
            side = "short"
        else:
            return FlowResponse(
                "Select direction:",
                buttons=[
                    {"id": "side_long", "title": "Long"},
                    {"id": "side_short", "title": "Short"},
                ],
            )

        asset = state.data.get("asset", "?")
        await self._update(user_id, "select_leverage", {"side": side})
        return FlowResponse(
            text=f"*{side.upper()} {asset}*\n\nSelect leverage:",
            buttons=[
                {"id": "lev_1", "title": "1x"},
                {"id": "lev_5", "title": "5x"},
                {"id": "lev_10", "title": "10x"},
            ],
        )

    async def _step_select_leverage(self, user_id: str, user_db_id: int, text: str, state: ConversationState) -> FlowResponse:
        lev_map = {"lev_1": 1, "lev_5": 5, "lev_10": 10}
        leverage = lev_map.get(text)

        if leverage is None:
            # Try parsing raw number
            try:
                leverage = int(text.replace("x", "").strip())
                if leverage < 1 or leverage > 100:
                    raise ValueError
            except ValueError:
                return FlowResponse(
                    "Select leverage:",
                    buttons=[
                        {"id": "lev_1", "title": "1x"},
                        {"id": "lev_5", "title": "5x"},
                        {"id": "lev_10", "title": "10x"},
                    ],
                )

        asset = state.data.get("asset", "?")
        side = state.data.get("side", "?")
        await self._update(user_id, "enter_size", {"leverage": leverage})
        return FlowResponse(
            text=(
                f"*{side.upper()} {asset} @ {leverage}x*\n\n"
                f"Enter position size in USD (e.g. `100` or `500`):"
            ),
        )

    async def _step_enter_size(self, user_id: str, user_db_id: int, text: str, state: ConversationState) -> FlowResponse:
        try:
            size = float(text.replace("$", "").replace(",", "").strip())
            if size <= 0:
                raise ValueError
        except ValueError:
            return FlowResponse("Please enter a valid positive USD amount:")

        await self._update(user_id, "confirm", {"size": size})
        data = state.data
        asset = data.get("asset", "?")
        side = data.get("side", "?")
        leverage = data.get("leverage", 1)
        notional = size * leverage

        return FlowResponse(
            text=(
                f"*Position Summary*\n\n"
                f"Asset: *{asset}*\n"
                f"Side: *{side.upper()}*\n"
                f"Margin: *${size:.2f}*\n"
                f"Leverage: *{leverage}x*\n"
                f"Notional: *${notional:.2f}*\n\n"
                f"Confirm this position?"
            ),
            header="Confirm Position",
            buttons=[
                {"id": "perps_confirm", "title": "Open Position"},
                {"id": "perps_cancel", "title": "Cancel"},
            ],
        )

    async def _step_confirm(self, user_id: str, user_db_id: int, text: str, state: ConversationState) -> FlowResponse:
        if text in ("perps_cancel", "cancel", "no"):
            await self._clear(user_id)
            return FlowResponse("Position cancelled.")

        if text not in ("perps_confirm", "confirm", "yes"):
            return FlowResponse(
                "Please confirm or cancel:",
                buttons=[
                    {"id": "perps_confirm", "title": "Open Position"},
                    {"id": "perps_cancel", "title": "Cancel"},
                ],
            )

        await self._clear(user_id)
        data = state.data
        asset = data.get("asset", "?")
        side = data.get("side", "?")
        leverage = data.get("leverage", 1)
        size = data.get("size", 0)

        # Placeholder for HyperLiquidClient integration
        return FlowResponse(
            f"*Position Submitted*\n\n"
            f"{side.upper()} {asset} @ {leverage}x\n"
            f"Margin: ${size:.2f}\n\n"
            f"_HyperLiquid integration coming soon. "
            f"You'll be notified when perps trading goes live._"
        )

    async def _step_show_positions(self, user_id: str, user_db_id: int, text: str, state: ConversationState) -> FlowResponse:
        if text.startswith("close_"):
            await self._update(user_id, "close_position", {"position_id": text.replace("close_", "")})
            return FlowResponse(
                text="Close this position?",
                buttons=[
                    {"id": "close_confirm", "title": "Close Position"},
                    {"id": "close_cancel", "title": "Cancel"},
                ],
            )

        await self._clear(user_id)
        return FlowResponse("Type *perps* to return to the futures menu.")

    async def _step_close_position(self, user_id: str, user_db_id: int, text: str, state: ConversationState) -> FlowResponse:
        if text in ("close_cancel", "cancel"):
            await self._clear(user_id)
            return FlowResponse("Cancelled. Type *perps* to view positions.")

        if text not in ("close_confirm", "confirm", "yes"):
            return FlowResponse(
                "Close this position?",
                buttons=[
                    {"id": "close_confirm", "title": "Close Position"},
                    {"id": "close_cancel", "title": "Cancel"},
                ],
            )

        await self._clear(user_id)
        position_id = state.data.get("position_id", "?")
        # Placeholder for HyperLiquidClient close
        return FlowResponse(
            f"Position #{position_id} close submitted.\n\n"
            f"_HyperLiquid integration coming soon._"
        )

    # -- Helpers ---------------------------------------------------------

    def _build_asset_list(self, side: str = None) -> FlowResponse:
        rows = []
        for asset in _PERP_ASSETS:
            rows.append({
                "id": f"perp_asset_{asset}",
                "title": asset,
                "description": f"Perpetual contract",
            })

        prefix = f"{side.upper()} — " if side else ""
        return FlowResponse(
            text=f"*{prefix}Select Asset*\n\nChoose the asset to trade:",
            list_button_text="Choose Asset",
            list_sections=[{"title": "Perpetual Assets", "rows": rows}],
        )

    async def _build_positions(self, user_db_id: int) -> FlowResponse:
        # Placeholder — would query HyperLiquidClient for open positions
        return FlowResponse(
            text=(
                "*Open Positions*\n\n"
                "_No open positions._\n\n"
                "Open a new position to get started."
            ),
            buttons=[
                {"id": "perps_open", "title": "Open Position"},
            ],
        )


_flow = PerpsFlow()
register_flow("perps", _flow)
