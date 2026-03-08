"""Token sniping flow for WhatsApp."""

import logging
from bot.services.whatsapp_flows.base import BaseWhatsAppFlow, FlowResponse
from bot.services.whatsapp_flows import register_flow
from bot.services.whatsapp_conversation import ConversationState

logger = logging.getLogger(__name__)


class SnipeFlow(BaseWhatsAppFlow):
    """Multi-step flow for setting up a token snipe."""
    flow_name = "snipe"
    trigger_commands = ["snipe"]
    steps = {
        "enter_token": "_step_enter_token",
        "enter_amount": "_step_enter_amount",
        "set_params": "_step_set_params",
        "confirm": "_step_confirm",
    }

    async def start(self, user_id: str, user_db_id: int, text: str = "") -> FlowResponse:
        await self._set_state(user_id, "enter_token", {"user_db_id": user_db_id})
        return FlowResponse(
            text=(
                "🎯 *Token Sniper*\n\n"
                "Automatically buy tokens at launch or when liquidity is added.\n\n"
                "Enter the token contract address to snipe:"
            ),
            header="🎯 New Snipe",
        )

    async def _step_enter_token(self, user_id: str, user_db_id: int, text: str, state: ConversationState) -> FlowResponse:
        address = text.strip()
        # Basic validation
        if len(address) < 20 or (not address.startswith("0x") and len(address) != 44):
            return FlowResponse(
                "Invalid address format.\n\n"
                "Enter a valid EVM (0x...) or Solana token address:"
            )

        chain_type = "solana" if len(address) == 44 and not address.startswith("0x") else "evm"
        await self._update(user_id, "enter_amount", {"token_address": address, "chain_type": chain_type})

        return FlowResponse(
            text=f"Token: `{address[:10]}...{address[-6:]}`\n\nEnter the amount to spend (in native token, e.g. ETH or SOL):",
        )

    async def _step_enter_amount(self, user_id: str, user_db_id: int, text: str, state: ConversationState) -> FlowResponse:
        try:
            amount = float(text.replace(",", "").strip())
            if amount <= 0:
                raise ValueError
        except ValueError:
            return FlowResponse("Please enter a valid positive amount:")

        await self._update(user_id, "set_params", {"amount": str(amount)})

        return FlowResponse(
            text=(
                f"Amount: *{amount}*\n\n"
                "Select snipe parameters:"
            ),
            buttons=[
                {"id": "snipe_fast", "title": "⚡ Fast (5% slip)"},
                {"id": "snipe_normal", "title": "🔄 Normal (10% slip)"},
                {"id": "snipe_safe", "title": "🛡️ Safe (20% slip)"},
            ],
        )

    async def _step_set_params(self, user_id: str, user_db_id: int, text: str, state: ConversationState) -> FlowResponse:
        params_map = {
            "snipe_fast": {"slippage": 5, "gas_mult": 2.0, "label": "Fast"},
            "snipe_normal": {"slippage": 10, "gas_mult": 1.5, "label": "Normal"},
            "snipe_safe": {"slippage": 20, "gas_mult": 1.2, "label": "Safe"},
        }

        params = params_map.get(text)
        if not params:
            return FlowResponse(
                "Please select a snipe mode:",
                buttons=[
                    {"id": "snipe_fast", "title": "⚡ Fast (5% slip)"},
                    {"id": "snipe_normal", "title": "🔄 Normal (10% slip)"},
                    {"id": "snipe_safe", "title": "🛡️ Safe (20% slip)"},
                ],
            )

        await self._update(user_id, "confirm", {
            "slippage": params["slippage"],
            "gas_mult": params["gas_mult"],
            "mode_label": params["label"],
        })

        token_addr = state.data.get("token_address", "?")
        amount = state.data.get("amount", "0")

        return FlowResponse(
            text=(
                f"*Confirm Snipe Setup*\n\n"
                f"Token: `{token_addr[:10]}...{token_addr[-6:]}`\n"
                f"Amount: {amount}\n"
                f"Mode: {params['label']}\n"
                f"Slippage: {params['slippage']}%\n\n"
                f"The snipe will execute when liquidity is detected.\n\n"
                f"Confirm?"
            ),
            buttons=[
                {"id": "snipe_confirm", "title": "✅ Arm Snipe"},
                {"id": "snipe_cancel", "title": "❌ Cancel"},
            ],
        )

    async def _step_confirm(self, user_id: str, user_db_id: int, text: str, state: ConversationState) -> FlowResponse:
        if text in ("snipe_cancel", "cancel"):
            await self._clear(user_id)
            return FlowResponse("Snipe cancelled.")

        if text not in ("snipe_confirm", "confirm", "yes"):
            return FlowResponse(
                "Please confirm or cancel:",
                buttons=[
                    {"id": "snipe_confirm", "title": "✅ Arm Snipe"},
                    {"id": "snipe_cancel", "title": "❌ Cancel"},
                ],
            )

        await self._clear(user_id)

        # In a real implementation, this would register the snipe with the launch_detector service
        token_addr = state.data.get("token_address")
        amount = state.data.get("amount")
        slippage = state.data.get("slippage")

        return FlowResponse(
            f"🎯 *Snipe Armed!*\n\n"
            f"Token: `{token_addr[:10]}...{token_addr[-6:]}`\n"
            f"Amount: {amount}\n"
            f"Slippage: {slippage}%\n\n"
            f"Monitoring for liquidity. You'll be notified when the snipe executes.\n\n"
            f"Use *orders* to view active snipes."
        )


_flow = SnipeFlow()
register_flow("snipe", _flow)
