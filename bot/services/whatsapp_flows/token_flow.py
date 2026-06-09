"""SUWP token and staking flow for WhatsApp."""

import logging
from decimal import Decimal

from bot.services.whatsapp_flows.base import BaseWhatsAppFlow, FlowResponse
from bot.services.whatsapp_flows import register_flow
from bot.services.whatsapp_conversation import ConversationState

logger = logging.getLogger(__name__)


class TokenFlow(BaseWhatsAppFlow):
    flow_name = "token"
    trigger_commands = ["token", "suwp", "staking", "/token"]
    steps = {
        "show_menu": "_step_show_menu",
        "enter_wallet": "_step_enter_wallet",
        "enter_claim_amount": "_step_enter_claim_amount",
        "enter_stake_amount": "_step_enter_stake_amount",
        "show_rewards": "_step_show_rewards",
    }

    async def start(self, user_id: str, user_db_id: int, text: str = "") -> FlowResponse:
        await self._set_state(user_id, "show_menu", {"user_db_id": user_db_id})
        return await self._build_dashboard(user_db_id)

    async def _step_show_menu(
        self,
        user_id: str,
        user_db_id: int,
        text: str,
        state: ConversationState,
    ) -> FlowResponse:
        db_id = state.data.get("user_db_id") or user_db_id

        if text == "token_claim":
            # Fetch points, then advance to wallet entry
            from database.db import get_session
            from bot.models.points import UserPoints
            from bot.services.staking_service import POINTS_PER_SUWP

            with get_session() as session:
                user_pts = session.query(UserPoints).filter(UserPoints.user_id == db_id).first()
                current_points = getattr(user_pts, "current_points", 0) or 0

            max_suwp = current_points // POINTS_PER_SUWP
            if max_suwp < 1:
                return FlowResponse(
                    text=(
                        "*Claim SUWP*\n\n"
                        f"You have *{current_points:,} points* -- not enough to claim.\n"
                        f"_(Minimum: {POINTS_PER_SUWP:,} points = 1 SUWP)_"
                    ),
                )

            await self._set_state(
                user_id,
                "enter_wallet",
                {"action": "claim", "user_db_id": db_id, "current_points": current_points},
            )
            return FlowResponse(
                text=(
                    f"*Claim SUWP Tokens*\n\n"
                    f"You have *{current_points:,} points* -> up to *{max_suwp} SUWP*\n\n"
                    f"Enter your Base wallet address to receive SUWP:\n"
                    f"_(SUWP is distributed weekly -- pending claims are batched)_"
                ),
            )

        elif text == "token_stake":
            await self._set_state(
                user_id,
                "enter_wallet",
                {"action": "stake", "user_db_id": db_id},
            )
            return FlowResponse(
                text=(
                    "*Stake SUWP*\n\n"
                    "To stake:\n"
                    "1. Get SUWP on Base (from claim or DEX)\n"
                    "2. Send your SUWP staking amount and wallet address here\n\n"
                    "Enter your Base wallet address that holds SUWP:"
                ),
            )

        elif text == "token_unstake":
            return await self._build_unstake_info(user_id, db_id)

        elif text == "token_rewards":
            await self._set_state(user_id, "show_rewards", {"user_db_id": db_id})
            return await self._build_rewards_info(db_id)

        else:
            # Unknown input -- redisplay the dashboard
            return await self._build_dashboard(db_id)

    async def _step_enter_wallet(
        self,
        user_id: str,
        user_db_id: int,
        text: str,
        state: ConversationState,
    ) -> FlowResponse:
        db_id = state.data.get("user_db_id") or user_db_id
        action = state.data.get("action", "claim")

        wallet = text.strip()
        if not (wallet.startswith("0x") and len(wallet) == 42):
            return FlowResponse(
                "Invalid Base wallet address. Must start with 0x and be 42 characters."
            )

        if action == "claim":
            from bot.services.staking_service import POINTS_PER_SUWP

            current_points = state.data.get("current_points", 0)
            if not current_points:
                from database.db import get_session
                from bot.models.points import UserPoints

                with get_session() as session:
                    user_pts = session.query(UserPoints).filter(UserPoints.user_id == db_id).first()
                    current_points = getattr(user_pts, "current_points", 0) or 0

            max_suwp = current_points // POINTS_PER_SUWP
            await self._set_state(
                user_id,
                "enter_claim_amount",
                {"wallet": wallet, "user_db_id": db_id, "current_points": current_points},
            )
            return FlowResponse(
                text=(
                    f"How many points to convert?\n"
                    f"_(multiples of {POINTS_PER_SUWP:,})_\n\n"
                    f"Max: {current_points:,} pts -> {max_suwp} SUWP\n\n"
                    f"Enter number of points (e.g. 5000 = 5 SUWP):"
                ),
            )

        else:
            # stake
            await self._set_state(
                user_id,
                "enter_stake_amount",
                {"wallet": wallet, "user_db_id": db_id},
            )
            return FlowResponse(
                text=(
                    "How many SUWP to register as staked?\n"
                    "_(You must hold them in your wallet on Base)_\n\n"
                    "Enter amount (e.g. 100):"
                ),
            )

    async def _step_enter_claim_amount(
        self,
        user_id: str,
        user_db_id: int,
        text: str,
        state: ConversationState,
    ) -> FlowResponse:
        db_id = state.data.get("user_db_id") or user_db_id
        wallet = state.data.get("wallet", "")

        try:
            points = int(text.strip().replace(",", ""))
            if points <= 0:
                raise ValueError
        except ValueError:
            return FlowResponse("Please enter a whole positive number of points:")

        from bot.services.staking_service import staking_service

        try:
            claim = await staking_service.claim_points_for_suwp(db_id, points, wallet)
            suwp = float(claim.suwp_amount)
            await self._clear(user_id)
            return FlowResponse(
                text=(
                    f"*Claim submitted!*\n\n"
                    f"Burning {claim.points_burned:,} points -> {suwp:.2f} SUWP\n"
                    f"Wallet: {wallet}\n\n"
                    f"SUWP will be sent to your wallet in the next weekly distribution."
                ),
                header="Claim Submitted",
            )
        except ValueError as exc:
            return FlowResponse(text=str(exc))

    async def _step_enter_stake_amount(
        self,
        user_id: str,
        user_db_id: int,
        text: str,
        state: ConversationState,
    ) -> FlowResponse:
        db_id = state.data.get("user_db_id") or user_db_id
        wallet = state.data.get("wallet", "")

        try:
            amount = Decimal(text.strip().replace(",", ""))
            if amount <= 0:
                raise ValueError("Amount must be positive")
        except Exception:
            return FlowResponse("Enter a positive number (e.g. 100):")

        from bot.services.staking_service import staking_service

        try:
            pos = staking_service.register_stake(db_id, wallet, amount)
            await self._clear(user_id)
            return FlowResponse(
                text=(
                    f"*Staking position registered!*\n\n"
                    f"Staked: {float(pos.suwp_staked):,.2f} SUWP\n"
                    f"Wallet: {wallet}\n\n"
                    f"You'll earn USDC + SUWP rewards each week proportional to your stake."
                ),
                header="Staking Registered",
            )
        except ValueError as exc:
            return FlowResponse(text=str(exc))

    async def _step_show_rewards(
        self,
        user_id: str,
        user_db_id: int,
        text: str,
        state: ConversationState,
    ) -> FlowResponse:
        db_id = state.data.get("user_db_id") or user_db_id
        if text == "token_back":
            await self._set_state(user_id, "show_menu", {"user_db_id": db_id})
            return await self._build_dashboard(db_id)
        return await self._build_rewards_info(db_id)

    # -- Helpers -------------------------------------------------------

    async def _build_dashboard(self, db_id: int) -> FlowResponse:
        from database.db import get_session
        from bot.models.points import UserPoints
        from bot.services.staking_service import staking_service, POINTS_PER_SUWP

        with get_session() as session:
            user_pts = session.query(UserPoints).filter(UserPoints.user_id == db_id).first()
            current_points = getattr(user_pts, "current_points", 0) or 0

        claimable_suwp = current_points // POINTS_PER_SUWP

        pos = staking_service.get_staking_position(db_id)
        staked = float(pos.suwp_staked) if pos else 0.0

        stats = staking_service.get_staking_stats()
        total_staked = stats["total_suwp_staked"]
        share_pct = (staked / total_staked * 100) if total_staked > 0 else 0.0

        pending_rewards = staking_service.get_pending_rewards(db_id)
        pending_usdc = sum(float(r.usdc_reward) for r in pending_rewards)
        pending_suwp_bonus = sum(float(r.suwp_bonus) for r in pending_rewards)

        text = (
            "*SUWP Token Dashboard*\n\n"
            f"*Your Points:* {current_points:,} pts\n"
            f"*Claimable SUWP:* {claimable_suwp:,} SUWP\n"
            f"_(1,000 pts = 1 SUWP)_\n\n"
            f"*Staking Position*\n"
            f"Staked: {staked:,.2f} SUWP\n"
            f"Pool share: {share_pct:.2f}%\n"
            f"Total pool: {total_staked:,.0f} SUWP\n\n"
            f"*Pending Rewards*\n"
            f"USDC: ${pending_usdc:.4f}\n"
            f"SUWP bonus: {pending_suwp_bonus:.2f} SUWP\n\n"
            f"_Rewards distribute weekly from 20% of protocol fees_"
        )

        rows = [
            {
                "id": "token_stake",
                "title": "Stake SUWP",
                "description": "Register a staking position",
            },
            {"id": "token_unstake", "title": "Unstake", "description": "Information on unstaking"},
            {
                "id": "token_rewards",
                "title": "Claim Rewards",
                "description": f"${pending_usdc:.4f} USDC pending",
            },
        ]
        if claimable_suwp > 0:
            rows.insert(
                0,
                {
                    "id": "token_claim",
                    "title": f"Claim {claimable_suwp} SUWP",
                    "description": f"Convert {claimable_suwp * POINTS_PER_SUWP:,} pts to SUWP",
                },
            )

        return FlowResponse(
            text=text,
            header="SUWP Token",
            list_button_text="Choose Action",
            list_sections=[{"title": "Token Actions", "rows": rows}],
        )

    async def _build_unstake_info(self, user_id: str, db_id: int) -> FlowResponse:
        from bot.services.staking_service import staking_service

        pos = staking_service.get_staking_position(db_id)
        staked = float(pos.suwp_staked) if pos else 0.0

        await self._clear(user_id)

        if staked <= 0:
            return FlowResponse(text="You have no active staking position to unstake.")

        return FlowResponse(
            text=(
                f"*Unstake SUWP*\n\n"
                f"Currently staked: *{staked:,.2f} SUWP*\n\n"
                f"On-chain unstaking is processed via the weekly batch settlement. "
                f"Contact support or use the staking contract directly on Base to initiate unstaking."
            ),
        )

    async def _build_rewards_info(self, db_id: int) -> FlowResponse:
        from bot.services.staking_service import staking_service

        pending_rewards = staking_service.get_pending_rewards(db_id)
        pending_usdc = sum(float(r.usdc_reward) for r in pending_rewards)
        pending_suwp_bonus = sum(float(r.suwp_bonus) for r in pending_rewards)

        if not pending_rewards:
            return FlowResponse(
                text="No pending rewards at this time. Rewards are distributed weekly.",
                buttons=[{"id": "token_back", "title": "Back to Menu"}],
            )

        return FlowResponse(
            text=(
                f"*Claim Rewards*\n\n"
                f"Pending USDC: *${pending_usdc:.4f}*\n"
                f"Pending SUWP bonus: *{pending_suwp_bonus:.2f} SUWP*\n\n"
                f"Rewards are settled on-chain weekly to your registered staking wallet. "
                f"No action required -- they will be sent automatically at the next epoch distribution."
            ),
            buttons=[{"id": "token_back", "title": "Back to Menu"}],
        )


_flow = TokenFlow()
register_flow("token", _flow)
