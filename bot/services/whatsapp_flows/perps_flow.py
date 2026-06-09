"""Perpetual futures trading flow for WhatsApp."""

import logging
from bot.services.whatsapp_flows.base import BaseWhatsAppFlow, FlowResponse
from bot.services.whatsapp_flows import register_flow
from bot.services.whatsapp_conversation import ConversationState

logger = logging.getLogger(__name__)

_PERP_ASSETS = ["ETH", "BTC", "SOL", "ARB", "OP", "AVAX", "MATIC", "LINK", "DOGE", "PEPE"]


class PerpsFlow(BaseWhatsAppFlow):
    flow_name = "perps"
    trigger_commands = [
        "perps",
        "futures",
        "long",
        "short",
        "/perps",
        "/long",
        "/short",
        "tpsl",
        "/tpsl",
    ]
    steps = {
        "show_menu": "_step_show_menu",
        "select_asset": "_step_select_asset",
        "select_side": "_step_select_side",
        "select_leverage": "_step_select_leverage",
        "enter_size": "_step_enter_size",
        "confirm": "_step_confirm",
        "show_positions": "_step_show_positions",
        "close_position": "_step_close_position",
        # TP/SL on existing positions
        "tpsl_select_position": "_step_tpsl_select_position",
        "tpsl_select_type": "_step_tpsl_select_type",
        "tpsl_enter_price": "_step_tpsl_enter_price",
        "tpsl_confirm": "_step_tpsl_confirm",
    }

    async def start(self, user_id: str, user_db_id: int, text: str = "") -> FlowResponse:
        cmd = text.strip().lower()

        # Shortcut: "long" or "short" skips to asset selection with side pre-set
        if cmd in ("long", "/long"):
            await self._set_state(
                user_id, "select_asset", {"user_db_id": user_db_id, "side": "long"}
            )
            return self._build_asset_list("long")
        elif cmd in ("short", "/short"):
            await self._set_state(
                user_id, "select_asset", {"user_db_id": user_db_id, "side": "short"}
            )
            return self._build_asset_list("short")
        elif cmd in ("tpsl", "/tpsl"):
            await self._set_state(user_id, "tpsl_select_position", {"user_db_id": user_db_id})
            return await self._build_tpsl_position_list(user_db_id)

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
                {"id": "perps_tpsl", "title": "Set TP / SL"},
            ],
        )

    async def _step_show_menu(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        db_uid = state.data.get("user_db_id") or user_db_id
        if text == "perps_open":
            await self._update(user_id, "select_asset")
            return self._build_asset_list()
        elif text == "perps_positions":
            await self._update(user_id, "show_positions")
            return await self._build_positions(db_uid)
        elif text == "perps_tpsl":
            await self._update(user_id, "tpsl_select_position")
            return await self._build_tpsl_position_list(db_uid)
        else:
            return FlowResponse(
                text="Select an option:",
                buttons=[
                    {"id": "perps_open", "title": "Open Position"},
                    {"id": "perps_positions", "title": "My Positions"},
                    {"id": "perps_tpsl", "title": "Set TP / SL"},
                ],
            )

    async def _step_select_asset(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
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

    async def _step_select_side(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
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

    async def _step_select_leverage(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
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

    async def _step_enter_size(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
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

    async def _step_confirm(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
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

    async def _step_show_positions(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        if text.startswith("close_"):
            await self._update(
                user_id, "close_position", {"position_id": text.replace("close_", "")}
            )
            return FlowResponse(
                text="Close this position?",
                buttons=[
                    {"id": "close_confirm", "title": "Close Position"},
                    {"id": "close_cancel", "title": "Cancel"},
                ],
            )

        await self._clear(user_id)
        return FlowResponse("Type *perps* to return to the futures menu.")

    async def _step_close_position(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
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

    # -- TP/SL on existing positions ------------------------------------

    async def _step_tpsl_select_position(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        db_uid = state.data.get("user_db_id") or user_db_id
        if text.startswith("tpslpos_"):
            try:
                position_id = int(text.replace("tpslpos_", ""))
            except ValueError:
                return await self._build_tpsl_position_list(db_uid)

            await self._update(user_id, "tpsl_select_type", {"position_id": position_id})
            return FlowResponse(
                text=f"*Position #{position_id}*\n\nWhat would you like to set?",
                buttons=[
                    {"id": "tpsl_tp", "title": "Take Profit"},
                    {"id": "tpsl_sl", "title": "Stop Loss"},
                    {"id": "tpsl_both", "title": "Both"},
                ],
            )
        return await self._build_tpsl_position_list(db_uid)

    async def _step_tpsl_select_type(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        if text not in ("tpsl_tp", "tpsl_sl", "tpsl_both"):
            return FlowResponse(
                "Select what to set:",
                buttons=[
                    {"id": "tpsl_tp", "title": "Take Profit"},
                    {"id": "tpsl_sl", "title": "Stop Loss"},
                    {"id": "tpsl_both", "title": "Both"},
                ],
            )
        tpsl_type = text.replace("tpsl_", "")  # "tp", "sl", or "both"
        await self._update(
            user_id, "tpsl_enter_price", {"tpsl_type": tpsl_type, "prices_entered": []}
        )
        label = {"tp": "take profit", "sl": "stop loss", "both": "take profit"}[tpsl_type]
        return FlowResponse(text=f"Enter the *{label}* price in USD:")

    async def _step_tpsl_enter_price(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        try:
            price = float(text.replace("$", "").replace(",", "").strip())
            if price <= 0:
                raise ValueError
        except ValueError:
            return FlowResponse("Please enter a valid positive price in USD:")

        tpsl_type = state.data.get("tpsl_type", "tp")
        prices_entered = list(state.data.get("prices_entered") or [])
        prices_entered.append(price)

        if tpsl_type == "both" and len(prices_entered) < 2:
            await self._update(user_id, "tpsl_enter_price", {"prices_entered": prices_entered})
            return FlowResponse(
                text="Take profit price noted. Now enter the *stop loss* price in USD:"
            )

        # Assign prices
        if tpsl_type == "tp":
            tp_price = prices_entered[0]
            sl_price = None
        elif tpsl_type == "sl":
            tp_price = None
            sl_price = prices_entered[0]
        else:  # both
            tp_price = prices_entered[0]
            sl_price = prices_entered[1]

        position_id = state.data.get("position_id")
        lines = [f"*Position #{position_id}*\n"]
        if tp_price is not None:
            lines.append(f"Take Profit: *${tp_price:,.4f}*")
        if sl_price is not None:
            lines.append(f"Stop Loss: *${sl_price:,.4f}*")
        lines.append("\nConfirm?")

        await self._update(
            user_id,
            "tpsl_confirm",
            {"tp_price": tp_price, "sl_price": sl_price, "prices_entered": prices_entered},
        )
        return FlowResponse(
            text="\n".join(lines),
            buttons=[
                {"id": "tpsl_confirm_yes", "title": "Confirm"},
                {"id": "tpsl_confirm_no", "title": "Cancel"},
            ],
        )

    async def _step_tpsl_confirm(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        if text in ("tpsl_confirm_no", "cancel", "no"):
            await self._clear(user_id)
            return FlowResponse("Cancelled. Type *perps* to return.")

        if text not in ("tpsl_confirm_yes", "confirm", "yes"):
            return FlowResponse(
                "Confirm or cancel:",
                buttons=[
                    {"id": "tpsl_confirm_yes", "title": "Confirm"},
                    {"id": "tpsl_confirm_no", "title": "Cancel"},
                ],
            )

        await self._clear(user_id)
        db_uid = state.data.get("user_db_id") or user_db_id
        position_id = state.data.get("position_id")
        tp_price = state.data.get("tp_price")
        sl_price = state.data.get("sl_price")

        try:
            from bot.services.perps_service import perps_service

            await perps_service.modify_tp_sl(
                user_id=db_uid,
                position_id=int(position_id),
                tp_price=float(tp_price) if tp_price is not None else None,
                sl_price=float(sl_price) if sl_price is not None else None,
            )
            parts = []
            if tp_price is not None:
                parts.append(f"TP at ${float(tp_price):,.4f}")
            if sl_price is not None:
                parts.append(f"SL at ${float(sl_price):,.4f}")
            return FlowResponse(
                f"*Updated!*\n\n"
                f"Position #{position_id}: {' | '.join(parts)}\n\n"
                f"You'll be alerted when either level is hit."
            )
        except ValueError as exc:
            return FlowResponse(f"Could not update: {exc}")
        except Exception as exc:
            logger.error(f"TP/SL update failed for user {db_uid} pos {position_id}: {exc}")
            return FlowResponse("Failed to update TP/SL. Please try again later.")

    # -- Helpers ---------------------------------------------------------

    def _build_asset_list(self, side: str = None) -> FlowResponse:
        rows = []
        for asset in _PERP_ASSETS:
            rows.append(
                {
                    "id": f"perp_asset_{asset}",
                    "title": asset,
                    "description": f"Perpetual contract",
                }
            )

        prefix = f"{side.upper()} — " if side else ""
        return FlowResponse(
            text=f"*{prefix}Select Asset*\n\nChoose the asset to trade:",
            list_button_text="Choose Asset",
            list_sections=[{"title": "Perpetual Assets", "rows": rows}],
        )

    async def _build_positions(self, user_db_id: int) -> FlowResponse:
        try:
            from bot.services.perps_service import perps_service

            positions = perps_service.get_positions(user_db_id, status="open")
        except Exception as exc:
            logger.error(f"Failed to fetch positions for user {user_db_id}: {exc}")
            positions = []

        if not positions:
            return FlowResponse(
                text="*Open Positions*\n\n_No open positions._\n\nOpen a new position to get started.",
                buttons=[{"id": "perps_open", "title": "Open Position"}],
            )

        lines = ["*Open Positions*\n"]
        rows = []
        for p in positions[:10]:
            tp_str = f" | TP ${float(p.tp_price):,.2f}" if p.tp_price else ""
            sl_str = f" | SL ${float(p.sl_price):,.2f}" if p.sl_price else ""
            lines.append(
                f"#{p.id} {p.side.upper()} {p.market} @ ${float(p.entry_price):,.2f} x{p.leverage}{tp_str}{sl_str}"
            )
            rows.append(
                {
                    "id": f"close_{p.id}",
                    "title": f"#{p.id} {p.side.upper()} {p.market}",
                    "description": f"${float(p.entry_price):,.2f} x{p.leverage}{tp_str}{sl_str}",
                }
            )

        if len(positions) > 3:
            return FlowResponse(
                text="\n".join(lines),
                list_button_text="Select Position",
                list_sections=[{"title": "Open Positions", "rows": rows}],
            )

        buttons = [{"id": f"close_{p.id}", "title": f"Close #{p.id}"} for p in positions[:3]]
        return FlowResponse(text="\n".join(lines), buttons=buttons)

    async def _build_tpsl_position_list(self, user_db_id: int) -> FlowResponse:
        try:
            from bot.services.perps_service import perps_service

            positions = perps_service.get_positions(user_db_id, status="open")
        except Exception as exc:
            logger.error(f"Failed to fetch positions for TP/SL for user {user_db_id}: {exc}")
            positions = []

        if not positions:
            await self._clear(str(user_db_id))
            return FlowResponse(
                text="*Set TP / SL*\n\n_No open positions._\n\nOpen a position first.",
                buttons=[{"id": "perps_open", "title": "Open Position"}],
            )

        rows = []
        for p in positions[:10]:
            tp_str = f"TP ${float(p.tp_price):,.2f}" if p.tp_price else "No TP"
            sl_str = f"SL ${float(p.sl_price):,.2f}" if p.sl_price else "No SL"
            rows.append(
                {
                    "id": f"tpslpos_{p.id}",
                    "title": f"#{p.id} {p.side.upper()} {p.market}",
                    "description": f"{tp_str} | {sl_str}",
                }
            )

        if len(positions) <= 3:
            buttons = [
                {"id": f"tpslpos_{p.id}", "title": f"#{p.id} {p.market}"} for p in positions[:3]
            ]
            return FlowResponse(
                text="*Set TP / SL*\n\nSelect a position to update:",
                buttons=buttons,
            )

        return FlowResponse(
            text="*Set TP / SL*\n\nSelect a position to update:",
            list_button_text="Choose Position",
            list_sections=[{"title": "Open Positions", "rows": rows}],
        )


_flow = PerpsFlow()
register_flow("perps", _flow)
