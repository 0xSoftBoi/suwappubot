"""Limit orders and DCA flow for WhatsApp."""

import logging
from bot.services.whatsapp_flows.base import BaseWhatsAppFlow, FlowResponse
from bot.services.whatsapp_flows import register_flow
from bot.services.whatsapp_conversation import ConversationState

logger = logging.getLogger(__name__)


def _format_order(o) -> str:
    return f"{o.from_token} → {o.to_token} @ ${o.trigger_price:.4f} ({o.order_type})"


def _format_dca(d) -> str:
    return f"{d.from_token} → {d.to_token} every {d.interval_hours}h ({d.executions_completed}/{d.max_executions or '∞'})"


class OrdersFlow(BaseWhatsAppFlow):
    flow_name = "orders"
    trigger_commands = ["orders", "order", "/o", "o"]
    steps = {
        "main_menu": "_step_main_menu",
        "lo_order_type": "_step_lo_order_type",
        "lo_pair": "_step_lo_pair",
        "lo_trigger": "_step_lo_trigger",
        "lo_amount": "_step_lo_amount",
        "lo_confirm": "_step_lo_confirm",
        "cancel_select": "_step_cancel_select",
    }

    async def start(self, user_id: str, user_db_id: int, text: str = "") -> FlowResponse:
        await self._set_state(user_id, "main_menu", {"user_db_id": user_db_id})
        return await self._show_orders_menu(user_db_id)

    async def _show_orders_menu(self, user_db_id: int) -> FlowResponse:
        from bot.services.orders import order_service

        orders = order_service.get_user_orders(user_db_id)
        dca_orders = order_service.get_user_dca_orders(user_db_id)

        lines = ["📋 *Your Orders*\n"]
        if orders:
            lines.append("*Limit Orders:*")
            for o in orders[:5]:
                status = "🟢" if o.status == "pending" else "⏳"
                lines.append(f"{status} #{o.id}: {_format_order(o)}")
        if dca_orders:
            lines.append("\n*DCA Orders:*")
            for d in dca_orders[:5]:
                lines.append(f"🔄 #{d.id}: {_format_dca(d)}")
        if not orders and not dca_orders:
            lines.append("No active orders.")

        return FlowResponse(
            text="\n".join(lines),
            buttons=[
                {"id": "order_create", "title": "New Limit Order"},
                {"id": "order_cancel", "title": "Cancel Order"},
            ],
        )

    async def _step_main_menu(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        db_uid = state.data.get("user_db_id") or user_db_id

        if text == "order_create":
            await self._update(user_id, "lo_order_type")
            return FlowResponse(
                text="*New Order*\n\nSelect the order type:",
                buttons=[
                    {"id": "otype_limit_buy", "title": "Limit Buy"},
                    {"id": "otype_limit_sell", "title": "Limit Sell"},
                    {"id": "otype_stop_loss", "title": "Stop Loss"},
                ],
            )
        elif text == "order_cancel":
            from bot.services.orders import order_service

            orders = order_service.get_user_orders(db_uid)
            if not orders:
                await self._clear(user_id)
                return FlowResponse("No active orders to cancel.")
            rows = [
                {"id": f"orderdel_{o.id}", "title": f"#{o.id}", "description": _format_order(o)}
                for o in orders[:10]
            ]
            await self._update(user_id, "cancel_select")
            return FlowResponse(
                text="Select an order to cancel:",
                list_button_text="Choose Order",
                list_sections=[{"title": "Active Orders", "rows": rows}],
            )
        return await self._show_orders_menu(db_uid)

    async def _step_lo_order_type(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        _ORDER_TYPE_MAP = {
            "otype_limit_buy": "limit_buy",
            "otype_limit_sell": "limit_sell",
            "otype_stop_loss": "stop_loss",
        }
        order_type = _ORDER_TYPE_MAP.get(text)
        if order_type is None:
            return FlowResponse(
                "Select the order type:",
                buttons=[
                    {"id": "otype_limit_buy", "title": "Limit Buy"},
                    {"id": "otype_limit_sell", "title": "Limit Sell"},
                    {"id": "otype_stop_loss", "title": "Stop Loss"},
                ],
            )

        await self._update(user_id, "lo_pair", {"order_type": order_type})
        pairs = [
            ("ETH/USDC", "eth_usdc"),
            ("BTC/USDC", "btc_usdc"),
            ("SOL/USDC", "sol_usdc"),
            ("ARB/USDC", "arb_usdc"),
            ("LINK/USDC", "link_usdc"),
            ("UNI/USDC", "uni_usdc"),
            ("OP/USDC", "op_usdc"),
            ("AAVE/USDC", "aave_usdc"),
        ]
        rows = [{"id": f"pair_{pid}", "title": name} for name, pid in pairs]
        type_label = {
            "limit_buy": "Limit Buy",
            "limit_sell": "Limit Sell",
            "stop_loss": "Stop Loss",
        }[order_type]
        return FlowResponse(
            text=f"*{type_label}*\n\nSelect the trading pair:",
            list_button_text="Choose Pair",
            list_sections=[{"title": "Pairs", "rows": rows}],
        )

    async def _step_lo_pair(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        pair_id = text.replace("pair_", "")
        parts = pair_id.split("_")
        if len(parts) != 2:
            return FlowResponse("Invalid pair selection. Please try again with *orders*.")
        from_token, to_token = parts[0].upper(), parts[1].upper()
        await self._update(user_id, "lo_trigger", {"from_token": from_token, "to_token": to_token})
        return FlowResponse(
            text=f"Pair: *{from_token}/{to_token}*\n\nEnter the trigger price in USD:",
        )

    async def _step_lo_trigger(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        try:
            price = float(text.replace("$", "").replace(",", "").strip())
            if price <= 0:
                raise ValueError
        except ValueError:
            return FlowResponse("Please enter a valid positive price in USD:")
        await self._update(user_id, "lo_amount", {"trigger_price": price})
        order_type = state.data.get("order_type", "limit_sell")
        type_label = {"limit_buy": "buy", "limit_sell": "sell", "stop_loss": "stop"}.get(
            order_type, "trigger"
        )
        from_token = state.data.get("from_token", "tokens")
        return FlowResponse(
            text=f"{type_label.capitalize()} trigger: *${price}*\n\nEnter the amount of {from_token} to swap:"
        )

    async def _step_lo_amount(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        try:
            amount = float(text.replace(",", "").strip())
            if amount <= 0:
                raise ValueError
        except ValueError:
            return FlowResponse("Please enter a valid positive amount:")

        await self._update(user_id, "lo_confirm", {"amount": str(amount)})
        from_token = state.data.get("from_token", "?")
        to_token = state.data.get("to_token", "?")
        trigger = state.data.get("trigger_price", 0)
        order_type = state.data.get("order_type", "limit_sell")
        type_label = {
            "limit_buy": "Limit Buy",
            "limit_sell": "Limit Sell",
            "stop_loss": "Stop Loss",
        }.get(order_type, "Limit Order")
        action = "Buy" if order_type == "limit_buy" else "Sell"

        return FlowResponse(
            text=(
                f"*Confirm {type_label}*\n\n"
                f"{action} {amount} {from_token} → {to_token}\n"
                f"When {from_token} hits ${trigger}\n\n"
                f"Confirm?"
            ),
            buttons=[
                {"id": "lo_confirm_yes", "title": "Create"},
                {"id": "lo_confirm_no", "title": "Cancel"},
            ],
        )

    async def _step_lo_confirm(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        if text in ("lo_confirm_no", "cancel"):
            await self._clear(user_id)
            return FlowResponse("Order cancelled.")

        if text not in ("lo_confirm_yes", "confirm", "yes"):
            return FlowResponse(
                "Please confirm or cancel:",
                buttons=[
                    {"id": "lo_confirm_yes", "title": "Create"},
                    {"id": "lo_confirm_no", "title": "Cancel"},
                ],
            )

        await self._clear(user_id)
        db_uid = state.data.get("user_db_id") or user_db_id
        order_type = state.data.get("order_type", "limit_sell")

        try:
            from bot.services.orders import order_service
            from database.db import get_session
            from bot.models.user import User

            with get_session() as session:
                user = session.query(User).filter(User.id == db_uid).first()
                wallet = next((w for w in user.wallets if w.is_active), None) if user else None

            if not wallet:
                return FlowResponse("No active wallet. Use *wallets* to create one first.")

            # MONEY-PATH: freeze the quoted fee terms at creation (see
            # bot/services/fee_snapshot.py) so the order settles at the rate the
            # user agreed to, not the tier they hold whenever it fills.
            from bot.services.fee_snapshot import snapshot_fee_terms

            fee_bps, fee_tier, referrer_id = await snapshot_fee_terms(db_uid)

            order = order_service.create_limit_order(
                user_id=db_uid,
                wallet_id=wallet.id,
                order_type=order_type,
                from_chain="ethereum",
                from_token=state.data.get("from_token"),
                to_chain="ethereum",
                to_token=state.data.get("to_token"),
                amount=state.data.get("amount"),
                trigger_price=state.data.get("trigger_price"),
                fee_bps=fee_bps,
                fee_tier=fee_tier,
                referrer_id=referrer_id,
            )
            type_label = {
                "limit_buy": "Limit Buy",
                "limit_sell": "Limit Sell",
                "stop_loss": "Stop Loss",
            }.get(order_type, "Order")
            return FlowResponse(
                f"*{type_label} Created!*\n\n"
                f"#{order.id}: {_format_order(order)}\n\n"
                f"You'll be notified when it executes."
            )
        except Exception as e:
            logger.error(f"Order creation failed: {e}")
            return FlowResponse("Failed to create order. Try again later.")

    async def _step_cancel_select(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        await self._clear(user_id)
        db_uid = state.data.get("user_db_id") or user_db_id
        try:
            order_id = int(text.replace("orderdel_", ""))
            from bot.services.orders import order_service

            if order_service.cancel_order(order_id, db_uid):
                return FlowResponse(f"✅ Order #{order_id} cancelled.")
            return FlowResponse("Order not found or already cancelled.")
        except (ValueError, TypeError):
            return FlowResponse("Invalid selection. Use *orders* to try again.")


# === DCA Flow ===


class DCAFlow(BaseWhatsAppFlow):
    flow_name = "dca"
    trigger_commands = ["dca"]
    steps = {
        "main_menu": "_step_main_menu",
        "dca_pair": "_step_dca_pair",
        "dca_amount": "_step_dca_amount",
        "dca_interval": "_step_dca_interval",
        "dca_confirm": "_step_dca_confirm",
        "dca_manage_select": "_step_dca_manage_select",
    }

    async def start(self, user_id: str, user_db_id: int, text: str = "") -> FlowResponse:
        await self._set_state(user_id, "main_menu", {"user_db_id": user_db_id})
        return await self._show_dca_menu(user_db_id)

    async def _show_dca_menu(self, user_db_id: int) -> FlowResponse:
        from bot.services.orders import order_service

        dca_orders = order_service.get_user_dca_orders(user_db_id)

        if dca_orders:
            lines = ["🔄 *Your DCA Orders*\n"]
            for d in dca_orders[:5]:
                status = "🟢" if d.status == "active" else "⏸️"
                lines.append(f"{status} #{d.id}: {_format_dca(d)}")
            text = "\n".join(lines)
        else:
            text = "🔄 *DCA Orders*\n\nNo active DCA orders."

        return FlowResponse(
            text=text,
            buttons=[
                {"id": "dca_create", "title": "New DCA"},
                {"id": "dca_manage", "title": "Manage DCA"},
            ],
        )

    async def _step_main_menu(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        db_uid = state.data.get("user_db_id") or user_db_id

        if text == "dca_create":
            await self._update(user_id, "dca_pair")
            pairs = [
                ("USDC → ETH", "usdc_eth"),
                ("USDC → BTC", "usdc_btc"),
                ("USDC → SOL", "usdc_sol"),
                ("USDC → LINK", "usdc_link"),
                ("USDC → ARB", "usdc_arb"),
                ("USDC → OP", "usdc_op"),
            ]
            rows = [{"id": f"dcapair_{pid}", "title": name} for name, pid in pairs]
            return FlowResponse(
                text="Select the DCA pair (buy schedule):",
                header="🔄 New DCA",
                list_button_text="Choose Pair",
                list_sections=[{"title": "DCA Pairs", "rows": rows}],
            )
        elif text == "dca_manage":
            from bot.services.orders import order_service

            dca_orders = order_service.get_user_dca_orders(db_uid)
            if not dca_orders:
                await self._clear(user_id)
                return FlowResponse("No active DCA orders to manage.")
            rows = [
                {"id": f"dcamgr_{d.id}", "title": f"#{d.id}", "description": _format_dca(d)}
                for d in dca_orders[:10]
            ]
            await self._update(user_id, "dca_manage_select")
            return FlowResponse(
                text="Select a DCA to pause/cancel:",
                list_button_text="Choose DCA",
                list_sections=[{"title": "DCA Orders", "rows": rows}],
            )
        return await self._show_dca_menu(db_uid)

    async def _step_dca_pair(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        pair_id = text.replace("dcapair_", "")
        parts = pair_id.split("_")
        if len(parts) != 2:
            return FlowResponse("Invalid pair. Please try again with *dca*.")
        from_token, to_token = parts[0].upper(), parts[1].upper()
        await self._update(user_id, "dca_amount", {"from_token": from_token, "to_token": to_token})
        return FlowResponse(
            text=f"Pair: *{from_token} → {to_token}*\n\nEnter the amount of {from_token} per execution:"
        )

    async def _step_dca_amount(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        try:
            amount = float(text.replace(",", "").strip())
            if amount <= 0:
                raise ValueError
        except ValueError:
            return FlowResponse("Please enter a valid positive amount:")

        await self._update(user_id, "dca_interval", {"amount": str(amount)})
        return FlowResponse(
            text=f"Amount: *{amount} {state.data.get('from_token', '')}*\n\nHow often?",
            buttons=[
                {"id": "dca_daily", "title": "📅 Daily"},
                {"id": "dca_weekly", "title": "📆 Weekly"},
                {"id": "dca_monthly", "title": "🗓️ Monthly"},
            ],
        )

    async def _step_dca_interval(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        interval_map = {
            "dca_daily": 24,
            "dca_weekly": 168,
            "dca_monthly": 720,
            "daily": 24,
            "weekly": 168,
            "monthly": 720,
        }
        hours = interval_map.get(text.lower())
        if hours is None:
            return FlowResponse(
                "Please select an interval:",
                buttons=[
                    {"id": "dca_daily", "title": "📅 Daily"},
                    {"id": "dca_weekly", "title": "📆 Weekly"},
                    {"id": "dca_monthly", "title": "🗓️ Monthly"},
                ],
            )
        label = {24: "Daily", 168: "Weekly", 720: "Monthly"}[hours]
        await self._update(
            user_id, "dca_confirm", {"interval_hours": hours, "interval_label": label}
        )

        from_token = state.data.get("from_token", "?")
        to_token = state.data.get("to_token", "?")
        amount = state.data.get("amount", "0")

        return FlowResponse(
            text=(
                f"*Confirm DCA Order*\n\n"
                f"Buy {to_token} with {amount} {from_token}\n"
                f"Frequency: {label}\n\n"
                f"Create?"
            ),
            buttons=[
                {"id": "dca_yes", "title": "✅ Create"},
                {"id": "dca_no", "title": "❌ Cancel"},
            ],
        )

    async def _step_dca_confirm(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        if text in ("dca_no", "cancel"):
            await self._clear(user_id)
            return FlowResponse("DCA order cancelled.")

        if text not in ("dca_yes", "confirm", "yes"):
            return FlowResponse(
                "Please confirm or cancel:",
                buttons=[
                    {"id": "dca_yes", "title": "✅ Create"},
                    {"id": "dca_no", "title": "❌ Cancel"},
                ],
            )

        await self._clear(user_id)
        db_uid = state.data.get("user_db_id") or user_db_id

        try:
            from bot.services.orders import order_service
            from bot.services.wallet import WalletService
            from database.db import get_session
            from bot.models.user import User

            ws = WalletService()
            with get_session() as session:
                user = session.query(User).filter(User.id == db_uid).first()
                wallet = next((w for w in user.wallets if w.is_active), None) if user else None

            if not wallet:
                return FlowResponse("No active wallet. Use *wallets* to create one first.")

            # MONEY-PATH: freeze fee terms once, at plan creation — every future
            # leg of this DCA plan settles against this snapshot.
            from bot.services.fee_snapshot import snapshot_fee_terms

            fee_bps, fee_tier, referrer_id = await snapshot_fee_terms(db_uid)

            dca = order_service.create_dca_order(
                user_id=db_uid,
                wallet_id=wallet.id,
                from_chain="ethereum",
                from_token=state.data.get("from_token"),
                to_chain="ethereum",
                to_token=state.data.get("to_token"),
                amount_per_execution=state.data.get("amount"),
                interval_hours=state.data.get("interval_hours"),
                fee_bps=fee_bps,
                fee_tier=fee_tier,
                referrer_id=referrer_id,
            )
            return FlowResponse(
                f"✅ *DCA Order Created!*\n\n"
                f"#{dca.id}: {_format_dca(dca)}\n\n"
                f"First execution starts immediately."
            )
        except Exception as e:
            logger.error(f"DCA creation failed: {e}")
            return FlowResponse("Failed to create DCA order. Try again later.")

    async def _step_dca_manage_select(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        await self._clear(user_id)
        db_uid = state.data.get("user_db_id") or user_db_id
        try:
            dca_id = int(text.replace("dcamgr_", ""))
            from bot.services.orders import order_service

            # Toggle pause/resume or cancel
            if order_service.pause_dca(dca_id, db_uid):
                return FlowResponse(f"⏸️ DCA #{dca_id} paused.")
            elif order_service.cancel_dca(dca_id, db_uid):
                return FlowResponse(f"❌ DCA #{dca_id} cancelled.")
            return FlowResponse("DCA not found or already inactive.")
        except (ValueError, TypeError):
            return FlowResponse("Invalid selection. Use *dca* to try again.")


_orders_flow = OrdersFlow()
_dca_flow = DCAFlow()
register_flow("orders", _orders_flow)
register_flow("dca", _dca_flow)
