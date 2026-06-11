"""Panic sell flow for WhatsApp — sells all non-stablecoin tokens."""

import logging
from bot.services.whatsapp_flows.base import BaseWhatsAppFlow, FlowResponse
from bot.services.whatsapp_flows import register_flow
from bot.services.whatsapp_flows.flow_errors import user_safe_error
from bot.services.whatsapp_conversation import ConversationState

logger = logging.getLogger(__name__)

_STABLECOINS = {"USDC", "USDT", "DAI", "BUSD", "TUSD", "FRAX", "LUSD", "crvUSD"}


class PanicFlow(BaseWhatsAppFlow):
    flow_name = "panic"
    trigger_commands = ["panic", "emergency", "sell_all", "/panic"]
    steps = {
        "confirm_first": "_step_confirm_first",
        "confirm_final": "_step_confirm_final",
    }

    async def start(self, user_id: str, user_db_id: int, text: str = "") -> FlowResponse:
        await self._set_state(user_id, "confirm_first", {"user_db_id": user_db_id})
        return FlowResponse(
            text=(
                "*PANIC SELL*\n\n"
                "This will sell *ALL* non-stablecoin tokens across all your wallets into USDC.\n\n"
                "This action cannot be undone.\n\n"
                "Are you sure?"
            ),
            header="Emergency Sell",
            buttons=[
                {"id": "panic_confirm", "title": "Yes, Sell All"},
                {"id": "panic_cancel", "title": "Cancel"},
            ],
        )

    async def _step_confirm_first(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        if text in ("panic_cancel", "cancel", "no"):
            await self._clear(user_id)
            return FlowResponse("Panic sell cancelled.")

        if text not in ("panic_confirm", "yes"):
            return FlowResponse(
                "Please confirm or cancel:",
                buttons=[
                    {"id": "panic_confirm", "title": "Yes, Sell All"},
                    {"id": "panic_cancel", "title": "Cancel"},
                ],
            )

        await self._update(user_id, "confirm_final")
        return FlowResponse(
            text=(
                "*Final Confirmation*\n\n"
                "Type *CONFIRM* to proceed with selling ALL tokens to USDC.\n\n"
                "Type anything else to cancel."
            ),
        )

    async def _step_confirm_final(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        if text.strip().upper() != "CONFIRM":
            await self._clear(user_id)
            return FlowResponse("Panic sell cancelled.")

        await self._clear(user_id)
        db_uid = state.data.get("user_db_id") or user_db_id
        return await self._execute_panic_sell(user_id, db_uid)

    async def _execute_panic_sell(self, user_id: str, user_db_id: int) -> FlowResponse:
        try:
            from bot.services.wallet import WalletService
            from bot.services.swap_engine import SwapEngine
            from bot.services.whatsapp_service import whatsapp_service as _wa
            from database.db import get_session
            from bot.models.user import User

            ws = WalletService()
            se = SwapEngine()

            # Loading feedback — this loop can take a while
            await _wa.send_text_message(
                user_id, "⏳ Starting emergency sell — this may take a minute..."
            )

            with get_session() as session:
                user = session.query(User).filter(User.id == user_db_id).first()
                if not user:
                    return FlowResponse("User not found.")
                wallets = [w for w in user.wallets if w.is_active]

            if not wallets:
                return FlowResponse("No active wallets found.")

            sold = []
            errors = []

            for wallet in wallets:
                try:
                    balances = await ws.get_balances_by_address(wallet.address, wallet.chain_type)
                    for chain_name, chain_bals in balances.items():
                        for token_symbol, balance in chain_bals.items():
                            if token_symbol.upper() in _STABLECOINS:
                                continue
                            if balance <= 0:
                                continue

                            try:
                                import uuid

                                idempotency_key = f"panic:{user_db_id}:{uuid.uuid4().hex[:8]}"

                                quote = await se.get_quote(
                                    from_chain=chain_name,
                                    to_chain=chain_name,
                                    from_token=token_symbol,
                                    to_token="USDC",
                                    amount=float(balance),
                                    from_address=wallet.address,
                                )

                                if quote:
                                    swap_tx = await se.execute_swap(
                                        quote=quote,
                                        wallet_id=wallet.id,
                                        user_id=user_db_id,
                                        idempotency_key=idempotency_key,
                                    )
                                    if swap_tx:
                                        sold.append(f"{balance} {token_symbol} on {chain_name}")
                                    else:
                                        errors.append(f"{token_symbol} on {chain_name}: no result")
                                else:
                                    errors.append(f"{token_symbol} on {chain_name}: no quote")
                            except Exception as e:
                                user_safe_error(
                                    e, context=f"panic_token:{token_symbol}:{chain_name}"
                                )
                                errors.append(f"{token_symbol} on {chain_name}: could not sell")
                except Exception as e:
                    user_safe_error(e, context=f"panic_wallet:{wallet.address[:8]}")
                    errors.append(f"Wallet {wallet.address[:8]}...: could not process")

            lines = ["*Panic Sell Results*\n"]
            if sold:
                lines.append("*Sold:*")
                for s in sold:
                    lines.append(f"  {s}")
            if errors:
                lines.append("\n*Errors:*")
                for e in errors:
                    lines.append(f"  {e}")
            if not sold and not errors:
                lines.append("No non-stablecoin tokens found to sell.")

            lines.append("\nCheck *history* for transaction details.")
            return FlowResponse("\n".join(lines))

        except Exception as e:
            return FlowResponse(f"{user_safe_error(e, context='panic_sell')}\n\nPlease try again.")


_flow = PanicFlow()
register_flow("panic", _flow)
