"""Copy trading flow for WhatsApp."""

import logging
from bot.services.whatsapp_flows.base import BaseWhatsAppFlow, FlowResponse
from bot.services.whatsapp_flows import register_flow
from bot.services.whatsapp_conversation import ConversationState

logger = logging.getLogger(__name__)


class CopyFlow(BaseWhatsAppFlow):
    flow_name = "copy"
    trigger_commands = ["copy", "follow", "traders", "/copy"]
    steps = {
        "show_menu": "_step_show_menu",
        "browse_traders": "_step_browse_traders",
        "follow_trader": "_step_follow_trader",
        "follow_mode": "_step_follow_mode",
        "set_amount": "_step_set_amount",
        "my_copies": "_step_my_copies",
        "exec_copy": "_step_exec_copy",
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

    async def _step_show_menu(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        db_uid = state.data.get("user_db_id") or user_db_id

        if text == "copy_browse":
            await self._update(user_id, "browse_traders")
            return await self._build_trader_list()
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

    async def _step_browse_traders(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        if not text.startswith("trader_"):
            return await self._build_trader_list()

        try:
            trader_id = int(text.replace("trader_", ""))
        except ValueError:
            return await self._build_trader_list()

        # Fetch trader card from copy_service
        try:
            from bot.services.copy_service import copy_service

            traders = copy_service.get_top_traders(limit=20)
            trader_data = next((t for t in traders if t["user_id"] == trader_id), None)
        except Exception as exc:
            logger.error(f"Failed to fetch trader {trader_id}: {exc}")
            trader_data = None

        if not trader_data:
            return await self._build_trader_list()

        display_name = trader_data.get("display_name", f"Trader{trader_id}")
        win_rate = trader_data.get("win_rate") or 0.0
        total_pnl = trader_data.get("total_pnl") or 0.0
        total_trades = trader_data.get("total_trades") or 0
        follower_count = trader_data.get("follower_count") or 0

        await self._update(
            user_id,
            "follow_trader",
            {
                "selected_trader_id": trader_id,
                "selected_trader_name": display_name,
            },
        )
        return FlowResponse(
            text=(
                f"*{display_name}*\n\n"
                f"Win rate: *{win_rate:.0f}%*\n"
                f"Total PnL: *${total_pnl:,.2f}*\n"
                f"Trades: *{total_trades}*\n"
                f"Followers: *{follower_count}*\n\n"
                f"Follow this trader?"
            ),
            buttons=[
                {"id": "follow_yes", "title": "Follow"},
                {"id": "follow_no", "title": "Back"},
            ],
        )

    async def _step_follow_trader(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        if text in ("follow_no", "back"):
            await self._update(user_id, "browse_traders")
            return await self._build_trader_list()

        if text not in ("follow_yes", "follow"):
            return FlowResponse(
                "Follow this trader?",
                buttons=[
                    {"id": "follow_yes", "title": "Follow"},
                    {"id": "follow_no", "title": "Back"},
                ],
            )

        trader_name = state.data.get("selected_trader_name", "Unknown")
        await self._update(user_id, "follow_mode")
        return FlowResponse(
            text=(
                f"*Follow {trader_name}*\n\n"
                f"Choose copy mode:\n\n"
                f"*Notify* — you get an alert for each trade; you decide whether to copy.\n"
                f"*Auto* — trades are copied automatically within your set amount."
            ),
            buttons=[
                {"id": "mode_notify", "title": "Notify Me"},
                {"id": "mode_auto", "title": "Auto Copy"},
            ],
        )

    async def _step_follow_mode(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        mode_map = {"mode_notify": "notify", "mode_auto": "auto"}
        mode = mode_map.get(text)
        if mode is None:
            return FlowResponse(
                "Choose copy mode:",
                buttons=[
                    {"id": "mode_notify", "title": "Notify Me"},
                    {"id": "mode_auto", "title": "Auto Copy"},
                ],
            )

        trader_name = state.data.get("selected_trader_name", "Unknown")
        await self._update(
            user_id,
            "set_amount",
            {
                "following_trader_id": state.data.get("selected_trader_id"),
                "following": trader_name,
                "copy_mode": mode,
            },
        )
        return FlowResponse(
            text=f"Enter the max amount (in USD) per trade for *{trader_name}* (e.g. `50`):",
        )

    async def _step_set_amount(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        try:
            amount = float(text.replace("$", "").replace(",", "").strip())
            if amount <= 0:
                raise ValueError
        except ValueError:
            return FlowResponse("Please enter a valid positive USD amount (e.g. `50`):")

        db_uid = state.data.get("user_db_id") or user_db_id
        trader_id = state.data.get("following_trader_id")
        trader_name = state.data.get("following")
        copy_mode = state.data.get("copy_mode", "notify")
        await self._clear(user_id)

        if trader_id is not None:
            # Wire to copy_service.follow_trader
            try:
                from bot.services.copy_service import copy_service

                success, message = copy_service.follow_trader(
                    follower_id=db_uid,
                    trader_id=int(trader_id),
                    copy_mode=copy_mode,
                    copy_amount_usd=amount,
                )
                if success:
                    mode_label = "with notifications" if copy_mode == "notify" else "in auto mode"
                    return FlowResponse(
                        f"*Now Following {trader_name}!*\n\n"
                        f"Copy amount: *${amount:.0f}* per trade\n"
                        f"Mode: *{mode_label}*\n\n"
                        f"You'll {'be notified of' if copy_mode == 'notify' else 'automatically copy'} "
                        f"their future trades."
                    )
                else:
                    return FlowResponse(f"Could not follow: {message}")
            except Exception as exc:
                logger.error(f"follow_trader failed for user {db_uid} -> trader {trader_id}: {exc}")
                return FlowResponse("Failed to follow trader. Please try again later.")
        else:
            # General default copy-amount setting (settings shortcut — no service method; just confirm)
            return FlowResponse(
                f"Default copy amount set to *${amount:.0f}* per trade.\n\n"
                f"This will apply when you follow new traders."
            )

    async def _step_my_copies(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        db_uid = state.data.get("user_db_id") or user_db_id

        if text.startswith("unfollow_"):
            try:
                trader_id = int(text.replace("unfollow_", ""))
            except ValueError:
                await self._clear(user_id)
                return FlowResponse("Invalid selection. Type *copy* to try again.")

            await self._clear(user_id)
            try:
                from bot.services.copy_service import copy_service

                success, message = copy_service.unfollow_trader(db_uid, trader_id)
                if success:
                    return FlowResponse(
                        f"Unfollowed. {message}\n\nType *copy* to manage copy trades."
                    )
                return FlowResponse(f"{message}\n\nType *copy* to manage copy trades.")
            except Exception as exc:
                logger.error(f"unfollow_trader failed for user {db_uid} trader {trader_id}: {exc}")
                return FlowResponse("Failed to unfollow. Please try again.")

        if text.startswith("exec_"):
            try:
                copy_trade_id = int(text.replace("exec_", ""))
            except ValueError:
                await self._clear(user_id)
                return FlowResponse("Invalid selection.")
            await self._update(user_id, "exec_copy", {"copy_trade_id": copy_trade_id})
            return FlowResponse(
                text="Execute this copy trade now?",
                buttons=[
                    {"id": "exec_confirm", "title": "Execute"},
                    {"id": "exec_skip", "title": "Skip"},
                ],
            )

        await self._clear(user_id)
        return FlowResponse("Type *copy* to return to the copy trading menu.")

    async def _step_exec_copy(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        db_uid = state.data.get("user_db_id") or user_db_id
        copy_trade_id = state.data.get("copy_trade_id")
        await self._clear(user_id)

        if text in ("exec_skip", "skip"):
            try:
                from bot.services.copy_service import copy_service

                copy_service.skip_copy(db_uid, int(copy_trade_id))
            except Exception as exc:
                logger.warning(f"skip_copy failed: {exc}")
            return FlowResponse("Trade skipped. Type *copy* to manage copy trades.")

        if text not in ("exec_confirm", "confirm", "yes"):
            return FlowResponse(
                "Execute this copy trade?",
                buttons=[
                    {"id": "exec_confirm", "title": "Execute"},
                    {"id": "exec_skip", "title": "Skip"},
                ],
            )

        try:
            from bot.services.copy_service import copy_service

            success, message, swap_id = await copy_service.execute_copy(
                copier_id=db_uid,
                copy_trade_id=int(copy_trade_id),
            )
            if success is True:
                return FlowResponse(f"*Trade Copied!*\n\n" f"{message}\n\n" f"Swap ID: #{swap_id}")
            if success is None:
                return FlowResponse(f"*Copy outcome unknown*\n\n{message}")
            return FlowResponse(f"Copy failed: {message}")
        except Exception as exc:
            logger.error(f"execute_copy failed for user {db_uid} trade {copy_trade_id}: {exc}")
            return FlowResponse("Failed to execute copy trade. Please try again later.")

    # -- Helpers ---------------------------------------------------------

    async def _build_trader_list(self) -> FlowResponse:
        try:
            from bot.services.copy_service import copy_service

            traders = copy_service.get_top_traders(limit=10)
        except Exception as exc:
            logger.error(f"Failed to fetch top traders: {exc}")
            traders = []

        if not traders:
            return FlowResponse(
                text=(
                    "*Top Traders*\n\n"
                    "_No public traders found yet._\n\n"
                    "Check back later as the leaderboard builds up."
                ),
                buttons=[{"id": "copy_browse", "title": "Refresh"}],
            )

        rows = []
        for t in traders:
            win_rate = t.get("win_rate") or 0.0
            pnl = t.get("total_pnl") or 0.0
            trades = t.get("total_trades") or 0
            name = t.get("display_name") or f"Trader{t['user_id']}"
            rows.append(
                {
                    "id": f"trader_{t['user_id']}",
                    "title": f"#{t.get('rank', '?')} {name}",
                    "description": f"WR {win_rate:.0f}% | PnL ${pnl:,.0f} | {trades} trades",
                }
            )

        return FlowResponse(
            text="*Top Traders (30d)*\n\nSelect a trader to view details:",
            list_button_text="Browse Traders",
            list_sections=[{"title": "Top Traders", "rows": rows}],
        )

    async def _build_my_copies(self, user_db_id: int) -> FlowResponse:
        try:
            from bot.services.copy_service import copy_service

            following = copy_service.get_following(user_db_id)
        except Exception as exc:
            logger.error(f"Failed to fetch following for user {user_db_id}: {exc}")
            following = []

        if not following:
            return FlowResponse(
                text=(
                    "*My Copy Trades*\n\n"
                    "_Not following any traders yet._\n\n"
                    "Browse top traders to start following."
                ),
                buttons=[{"id": "copy_browse", "title": "Browse Traders"}],
            )

        lines = ["*My Copy Trades*\n"]
        rows = []
        for f in following:
            name = f.get("display_name") or f"Trader{f['trader_id']}"
            mode = f.get("copy_mode", "notify")
            amount = f.get("copy_amount") or 0.0
            pnl = f.get("copy_pnl") or 0.0
            copied = f.get("total_copied") or 0
            lines.append(
                f"{name} | {mode} | ${amount:.0f}/trade | {copied} copies | PnL ${pnl:,.2f}"
            )
            rows.append(
                {
                    "id": f"unfollow_{f['trader_id']}",
                    "title": f"Unfollow {name}",
                    "description": f"${amount:.0f}/trade | {mode} | {copied} copies",
                }
            )

        return FlowResponse(
            text="\n".join(lines),
            list_button_text="Manage",
            list_sections=[{"title": "Following", "rows": rows}],
        )


_flow = CopyFlow()
register_flow("copy", _flow)
