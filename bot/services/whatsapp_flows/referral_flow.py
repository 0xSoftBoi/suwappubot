"""Referral and XP flow for WhatsApp."""

import logging
from bot.services.whatsapp_flows.base import BaseWhatsAppFlow, FlowResponse
from bot.services.whatsapp_flows import register_flow
from bot.services.whatsapp_conversation import ConversationState

logger = logging.getLogger(__name__)


class ReferralFlow(BaseWhatsAppFlow):
    flow_name = "referral"
    trigger_commands = ["ref", "referral", "xp", "/ref", "/xp"]
    steps = {
        "show_menu": "_step_show_menu",
        "show_referral_link": "_step_show_referral_link",
        "show_xp": "_step_show_xp",
        "daily_checkin": "_step_daily_checkin",
    }

    async def start(self, user_id: str, user_db_id: int, text: str = "") -> FlowResponse:
        await self._set_state(user_id, "show_menu", {"user_db_id": user_db_id})
        return FlowResponse(
            text=(
                "*Referral & XP*\n\n"
                "Earn rewards by inviting friends and staying active.\n\n"
                "What would you like to do?"
            ),
            buttons=[
                {"id": "ref_link", "title": "My Referral Link"},
                {"id": "ref_xp", "title": "My XP"},
                {"id": "ref_checkin", "title": "Daily Check-in"},
            ],
        )

    async def _step_show_menu(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        db_uid = state.data.get("user_db_id") or user_db_id

        if text == "ref_link":
            await self._update(user_id, "show_referral_link")
            return await self._build_referral_link(db_uid)
        elif text == "ref_xp":
            await self._update(user_id, "show_xp")
            return await self._build_xp_summary(db_uid)
        elif text == "ref_checkin":
            await self._update(user_id, "daily_checkin")
            return await self._do_daily_checkin(user_id, db_uid)
        else:
            return FlowResponse(
                text="Select an option:",
                buttons=[
                    {"id": "ref_link", "title": "My Referral Link"},
                    {"id": "ref_xp", "title": "My XP"},
                    {"id": "ref_checkin", "title": "Daily Check-in"},
                ],
            )

    async def _step_show_referral_link(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        await self._clear(user_id)
        return FlowResponse("Type *ref* to return to the referral menu.")

    async def _step_show_xp(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        await self._clear(user_id)
        return FlowResponse("Type *ref* to return to the referral menu.")

    async def _step_daily_checkin(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        await self._clear(user_id)
        return FlowResponse("Type *ref* to return to the referral menu.")

    # -- Helpers ---------------------------------------------------------

    async def _build_referral_link(self, user_db_id: int) -> FlowResponse:
        try:
            from bot.config.settings import settings
            from database.db import get_session
            from bot.models.user import User

            with get_session() as session:
                user = session.query(User).filter(User.id == user_db_id).first()
                if not user:
                    return FlowResponse("User not found. Try again later.")

                # Generate referral code from user ID
                ref_code = f"REF{user.id:06d}"
                business_phone = settings.whatsapp_business_phone
                if business_phone:
                    link = f"https://wa.me/{business_phone}?text=ref_{ref_code}"
                    link_section = f"{link}\n\nShare this link with friends. When they sign up and trade, you both earn rewards!"
                else:
                    link_section = (
                        f"Referral links will be available once we launch — "
                        f"your referral code is *{ref_code}*"
                    )

                return FlowResponse(
                    text=(
                        f"*Your Referral Link*\n\n"
                        f"{link_section}\n\n"
                        f"Referrals so far: *{user.referral_count or 0}*\n"
                        f"Total earned: *${user.total_referral_rewards or 0:.2f}*"
                    ),
                )
        except Exception as e:
            logger.error(f"Referral link error: {e}")
            return FlowResponse("Failed to generate referral link. Try again later.")

    async def _build_xp_summary(self, user_db_id: int) -> FlowResponse:
        try:
            from database.db import get_session
            from bot.models.user import User

            with get_session() as session:
                user = session.query(User).filter(User.id == user_db_id).first()
                if not user:
                    return FlowResponse("User not found.")

                referral_count = user.referral_count or 0
                referral_rewards = user.total_referral_rewards or 0.0

                return FlowResponse(
                    text=(
                        f"*Your XP Summary*\n\n"
                        f"Referrals: *{referral_count}*\n"
                        f"Referral Rewards: *${referral_rewards:.2f}*\n\n"
                        f"_More XP features coming soon: trading volume, "
                        f"streaks, and leaderboards._"
                    ),
                )
        except Exception as e:
            logger.error(f"XP summary error: {e}")
            return FlowResponse("Failed to load XP. Try again later.")

    async def _do_daily_checkin(self, user_id: str, user_db_id: int) -> FlowResponse:
        await self._clear(user_id)
        # Placeholder for daily check-in points system
        return FlowResponse(
            text=(
                "*Daily Check-in*\n\n"
                "You checked in today! Keep your streak going.\n\n"
                "_Points system coming soon. Check in daily to build your streak._"
            ),
        )


_flow = ReferralFlow()
register_flow("referral", _flow)
