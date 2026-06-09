"""XP / points flow for WhatsApp."""

import logging

from bot.services.whatsapp_flows.base import BaseWhatsAppFlow, FlowResponse
from bot.services.whatsapp_flows import register_flow
from bot.services.whatsapp_conversation import ConversationState

logger = logging.getLogger(__name__)


class PointsFlow(BaseWhatsAppFlow):
    flow_name = "points"
    trigger_commands = ["xp", "points", "leaderboard", "checkin", "/xp", "/lb", "/checkin"]
    steps = {
        "show_menu": "_step_show_menu",
        "show_leaderboard": "_step_show_leaderboard",
        "show_rewards": "_step_show_rewards",
        "confirm_redeem": "_step_confirm_redeem",
    }

    async def start(self, user_id: str, user_db_id: int, text: str = "") -> FlowResponse:
        cmd = text.strip().lower()

        # Direct routing for checkin and leaderboard shortcuts
        if cmd in ("checkin", "/checkin"):
            return await self._do_checkin(user_id, user_db_id)

        if cmd in ("leaderboard", "/lb"):
            await self._set_state(user_id, "show_leaderboard", {"user_db_id": user_db_id})
            return self._build_leaderboard()

        # Default: show XP stats menu
        await self._set_state(user_id, "show_menu", {"user_db_id": user_db_id})
        return self._build_stats_menu(user_db_id)

    async def _step_show_menu(
        self,
        user_id: str,
        user_db_id: int,
        text: str,
        state: ConversationState,
    ) -> FlowResponse:
        db_id = state.data.get("user_db_id") or user_db_id

        if text == "xp_checkin":
            return await self._do_checkin(user_id, db_id)

        elif text == "xp_leaderboard":
            await self._set_state(user_id, "show_leaderboard", {"user_db_id": db_id})
            return self._build_leaderboard()

        elif text == "xp_rewards":
            await self._set_state(user_id, "show_rewards", {"user_db_id": db_id})
            return self._build_rewards_menu(db_id)

        else:
            return self._build_stats_menu(db_id)

    async def _step_show_leaderboard(
        self,
        user_id: str,
        user_db_id: int,
        text: str,
        state: ConversationState,
    ) -> FlowResponse:
        db_id = state.data.get("user_db_id") or user_db_id

        if text == "xp_stats":
            await self._set_state(user_id, "show_menu", {"user_db_id": db_id})
            return self._build_stats_menu(db_id)

        # Any other input: redisplay leaderboard
        return self._build_leaderboard()

    async def _step_show_rewards(
        self,
        user_id: str,
        user_db_id: int,
        text: str,
        state: ConversationState,
    ) -> FlowResponse:
        db_id = state.data.get("user_db_id") or user_db_id

        if text == "xp_stats":
            await self._set_state(user_id, "show_menu", {"user_db_id": db_id})
            return self._build_stats_menu(db_id)

        if text.startswith("xp_redeem_"):
            # Parse reward id from button id
            try:
                reward_id = int(text.split("_")[-1])
            except ValueError:
                return self._build_rewards_menu(db_id)

            from bot.services.points_service import points_service

            rewards = points_service.get_available_rewards()
            reward = next((r for r in rewards if r["id"] == reward_id), None)
            if not reward:
                return FlowResponse(
                    text="Reward not found.", buttons=[{"id": "xp_rewards", "title": "Back"}]
                )

            await self._set_state(
                user_id,
                "confirm_redeem",
                {
                    "user_db_id": db_id,
                    "reward_id": reward_id,
                    "reward_name": reward["name"],
                    "reward_cost": reward["cost"],
                },
            )
            return FlowResponse(
                text=(
                    f"*Redeem Reward*\n\n"
                    f"Reward: *{reward['name']}*\n"
                    f"Cost: {reward['cost']:,} points\n\n"
                    f"Confirm redemption?"
                ),
                buttons=[
                    {"id": "xp_confirm_redeem", "title": "Confirm"},
                    {"id": "xp_cancel_redeem", "title": "Cancel"},
                ],
            )

        return self._build_rewards_menu(db_id)

    async def _step_confirm_redeem(
        self,
        user_id: str,
        user_db_id: int,
        text: str,
        state: ConversationState,
    ) -> FlowResponse:
        db_id = state.data.get("user_db_id") or user_db_id

        if text in ("xp_cancel_redeem", "cancel", "no"):
            await self._set_state(user_id, "show_rewards", {"user_db_id": db_id})
            return self._build_rewards_menu(db_id)

        if text not in ("xp_confirm_redeem", "confirm", "yes"):
            return FlowResponse(
                "Please confirm or cancel:",
                buttons=[
                    {"id": "xp_confirm_redeem", "title": "Confirm"},
                    {"id": "xp_cancel_redeem", "title": "Cancel"},
                ],
            )

        reward_id = state.data.get("reward_id")
        reward_name = state.data.get("reward_name", "")
        reward_cost = state.data.get("reward_cost", 0)

        from bot.services.points_service import points_service
        from database.db import get_session
        from bot.models.points import Reward

        with get_session() as session:
            reward_obj = session.query(Reward).filter(Reward.id == reward_id).first()
            if not reward_obj:
                await self._clear(user_id)
                return FlowResponse(text="Reward no longer available.")
            reward_type = reward_obj.reward_type
            reward_value = reward_obj.reward_value

        success, message = points_service.spend_points(
            user_id=db_id,
            amount=reward_cost,
            reward_type=reward_type,
            reward_value=reward_value,
        )

        await self._clear(user_id)

        if success:
            return FlowResponse(
                text=(
                    f"*Reward Redeemed!*\n\n"
                    f"You got: *{reward_name}*\n"
                    f"Cost: {reward_cost:,} points\n\n"
                    f"_{message}_"
                ),
                header="Redeemed",
            )

        return FlowResponse(text=f"Could not redeem: {message}")

    # -- Helpers -------------------------------------------------------

    def _build_stats_menu(self, db_id: int) -> FlowResponse:
        from bot.services.points_service import points_service

        msg = points_service.format_stats_message(db_id)
        return FlowResponse(
            text=msg,
            header="Your XP",
            buttons=[
                {"id": "xp_checkin", "title": "Daily Check-In"},
                {"id": "xp_leaderboard", "title": "Leaderboard"},
                {"id": "xp_rewards", "title": "Rewards"},
            ],
        )

    def _build_leaderboard(self) -> FlowResponse:
        from bot.services.points_service import points_service

        msg = points_service.format_leaderboard_message()
        return FlowResponse(
            text=msg,
            header="Leaderboard",
            buttons=[{"id": "xp_stats", "title": "My Stats"}],
        )

    def _build_rewards_menu(self, db_id: int) -> FlowResponse:
        from bot.services.points_service import points_service

        stats = points_service.get_user_stats(db_id)
        rewards = points_service.get_available_rewards()
        current_points = stats.get("current_points", 0)

        if not rewards:
            return FlowResponse(
                text=f"*Rewards Store*\n\nYour Points: *{current_points:,}*\n\n_No rewards available yet._",
                buttons=[{"id": "xp_stats", "title": "My Stats"}],
            )

        text_lines = [f"*Rewards Store*\n\nYour Points: *{current_points:,}*\n"]
        for r in rewards:
            affordable = "available" if current_points >= r["cost"] else "locked"
            duration = f" ({r['duration']}d)" if r.get("duration") else ""
            text_lines.append(
                f"*{r['name']}*{duration} -- {r['cost']:,} pts [{affordable}]\n"
                f"  {r['description']}"
            )

        rows = []
        for r in rewards[:9]:  # Max 9 reward rows + 1 "My Stats" row = 10 total (WhatsApp limit)
            affordable = current_points >= r["cost"]
            rows.append(
                {
                    "id": f"xp_redeem_{r['id']}",
                    "title": r["name"],
                    "description": f"{r['cost']:,} pts{'  (locked)' if not affordable else ''}",
                }
            )

        rows.append(
            {"id": "xp_stats", "title": "My Stats", "description": "Back to your XP overview"}
        )

        return FlowResponse(
            text="\n".join(text_lines),
            list_button_text="Choose Reward",
            list_sections=[{"title": "Available Rewards", "rows": rows}],
        )

    async def _do_checkin(self, user_id: str, db_id: int) -> FlowResponse:
        from bot.services.points_service import points_service
        from bot.models.points import LEVELS

        points, streak, continued, new_level = points_service.daily_checkin(db_id)

        await self._clear(user_id)

        if points == 0:
            return FlowResponse(
                text=(
                    f"You've already checked in today!\n\n"
                    f"Current streak: *{streak} days*\n\n"
                    f"_Come back tomorrow!_"
                ),
            )

        level_up_msg = ""
        if new_level:
            level_info = LEVELS.get(new_level, {})
            level_up_msg = (
                f"\n\n*LEVEL UP!*\n"
                f"You're now *{level_info.get('name', new_level)}*!\n"
                f"New fee rate: {level_info.get('fee', 0.8)}%"
            )

        streak_label = "Streak continued!" if continued else "New streak started!"

        return FlowResponse(
            text=(
                f"*Daily Check-In Complete!*\n\n"
                f"+*{points}* points earned!\n"
                f"Streak: *{streak} days* -- {streak_label}"
                f"{level_up_msg}\n\n"
                f"_Keep checking in for bonus points!_"
            ),
            header="Check-In",
        )


_flow = PointsFlow()
register_flow("points", _flow)
