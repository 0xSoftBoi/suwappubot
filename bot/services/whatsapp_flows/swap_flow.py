"""Full swap flow for WhatsApp."""

import logging
import re
from typing import Optional

from bot.services.whatsapp_flows.base import BaseWhatsAppFlow, FlowResponse
from bot.services.whatsapp_flows import register_flow
from bot.services.whatsapp_flows.flow_errors import user_safe_error
from bot.services.whatsapp_conversation import ConversationState

logger = logging.getLogger(__name__)

# Top-level chains shown in swap selection (most popular first)
_POPULAR_EVM = ["ethereum", "arbitrum", "base", "polygon", "optimism", "bsc", "avalanche"]
_ALL_CHAINS = _POPULAR_EVM + ["solana"]


def _chain_display(name: str) -> str:
    from bot.config.chains import CHAINS

    cfg = CHAINS.get(name)
    if cfg:
        return f"{cfg.logo_emoji} {cfg.display_name}"
    return name.capitalize()


def _build_chain_sections() -> list:
    """Build List Message sections for chain selection."""
    from bot.config.chains import CHAINS

    evm_rows = []
    for cn in _POPULAR_EVM:
        cfg = CHAINS.get(cn)
        if cfg:
            evm_rows.append(
                {
                    "id": f"chain_{cn}",
                    "title": f"{cfg.logo_emoji} {cfg.display_name}",
                    "description": cfg.name.capitalize(),
                }
            )
    sol_rows = [
        {
            "id": "chain_solana",
            "title": "🟢 SOL",
            "description": "Solana",
        }
    ]
    return [
        {"title": "EVM Chains", "rows": evm_rows},
        {"title": "Non-EVM", "rows": sol_rows},
    ]


def _build_token_sections(chain_name: str) -> list:
    """Build List Message sections for tokens available on a chain."""
    from bot.config.tokens import get_tokens_for_chain

    token_configs = get_tokens_for_chain(chain_name)
    if not token_configs:
        # Fallback common tokens
        fallback = [("ETH", "Ethereum"), ("USDC", "USD Coin"), ("USDT", "Tether")]
        rows = [{"id": f"token_{sym}", "title": sym, "description": name} for sym, name in fallback]
        return [{"title": "Tokens", "rows": rows}]
    rows = []
    for tc in token_configs[:10]:
        rows.append(
            {
                "id": f"token_{tc.symbol}",
                "title": f"{tc.logo_emoji} {tc.symbol}"[:24],
                "description": tc.name[:72],
            }
        )
    return [{"title": "Tokens", "rows": rows}]


class SwapFlow(BaseWhatsAppFlow):
    flow_name = "swap"
    trigger_commands = ["/s", "s", "swap"]
    steps = {
        "select_from_chain": "_step_from_chain",
        "select_from_token": "_step_from_token",
        "select_to_chain": "_step_to_chain",
        "select_to_token": "_step_to_token",
        "enter_amount": "_step_amount",
        "confirm": "_step_confirm",
    }

    async def start(self, user_id: str, user_db_id: int, text: str = "") -> FlowResponse:
        # Quick swap parse: "s 100 USDC ETH"
        parts = text.strip().split()
        if len(parts) >= 4 and parts[0].lower() in ("s", "swap"):
            return await self._quick_swap(user_id, user_db_id, parts)

        await self._set_state(user_id, "select_from_chain", {"user_db_id": user_db_id})
        return FlowResponse(
            text="Select the chain you want to swap *from*:",
            header="🔄 New Swap",
            list_button_text="Choose Chain",
            list_sections=_build_chain_sections(),
        )

    async def _quick_swap(self, user_id: str, user_db_id: int, parts: list) -> FlowResponse:
        """Handle 's 100 USDC ETH' shorthand."""
        try:
            amount = parts[1]
            from_token = parts[2].upper()
            to_token = parts[3].upper()
            float(amount)  # validate
        except (IndexError, ValueError):
            return FlowResponse(
                "Invalid quick swap format. Use: *s <amount> <from_token> <to_token>*"
            )

        # Default to same-chain ethereum swap
        data = {
            "user_db_id": user_db_id,
            "from_chain": "ethereum",
            "from_token": from_token,
            "to_chain": "ethereum",
            "to_token": to_token,
            "amount": amount,
        }
        await self._set_state(user_id, "confirm", data)
        return await self._build_confirm_prompt(user_id, user_db_id, data)

    # -- Step handlers ---------------------------------------------------

    async def _step_from_chain(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        chain = text.replace("chain_", "").lower()
        from bot.config.chains import CHAINS

        if chain not in CHAINS:
            return FlowResponse(
                text="Please select a valid chain from the list.",
                list_button_text="Choose Chain",
                list_sections=_build_chain_sections(),
            )
        await self._update(
            user_id, "select_from_token", {"from_chain": chain, "user_db_id": user_db_id}
        )
        return FlowResponse(
            text=f"Chain: *{_chain_display(chain)}*\n\nNow pick the token you want to swap *from*:",
            header="🔄 From Token",
            list_button_text="Choose Token",
            list_sections=_build_token_sections(chain),
        )

    async def _step_from_token(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        token = text.replace("token_", "").upper()
        await self._update(user_id, "select_to_chain", {"from_token": token})
        return FlowResponse(
            text=f"From: *{token}* on *{_chain_display(state.data.get('from_chain', ''))}*\n\nSelect destination chain:",
            header="🔄 To Chain",
            list_button_text="Choose Chain",
            list_sections=_build_chain_sections(),
        )

    async def _step_to_chain(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        chain = text.replace("chain_", "").lower()
        from bot.config.chains import CHAINS

        if chain not in CHAINS:
            return FlowResponse(
                text="Please select a valid chain from the list.",
                list_button_text="Choose Chain",
                list_sections=_build_chain_sections(),
            )
        await self._update(user_id, "select_to_token", {"to_chain": chain})
        return FlowResponse(
            text=f"To chain: *{_chain_display(chain)}*\n\nPick the token you want to receive:",
            header="🔄 To Token",
            list_button_text="Choose Token",
            list_sections=_build_token_sections(chain),
        )

    async def _step_to_token(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        token = text.replace("token_", "").upper()
        await self._update(user_id, "enter_amount", {"to_token": token})
        from_token = state.data.get("from_token", "?")
        return FlowResponse(
            text=(
                f"Swap: *{from_token}* → *{token}*\n\n"
                "Enter the amount to swap (e.g. `100` or `0.5`):"
            ),
            buttons=[
                {"id": "amt_25", "title": "25%"},
                {"id": "amt_50", "title": "50%"},
                {"id": "amt_max", "title": "Max"},
            ],
        )

    async def _step_amount(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        # Handle percentage buttons
        if text in ("amt_25", "amt_50", "amt_max"):
            pct = {"amt_25": 0.25, "amt_50": 0.50, "amt_max": 1.0}[text]
            amount = await self._get_balance_amount(
                state.data.get("user_db_id", user_db_id),
                state.data.get("from_chain", "ethereum"),
                state.data.get("from_token", "ETH"),
                pct,
            )
            if amount is None:
                return FlowResponse(
                    "Could not determine your balance. Please enter amount manually:"
                )
            text = str(amount)

        # Validate numeric
        clean = text.replace(",", "").strip()
        try:
            val = float(clean)
            if val <= 0:
                raise ValueError
        except ValueError:
            return FlowResponse("Please enter a valid positive number.")

        await self._update(user_id, "confirm", {"amount": clean})
        data = (await self._get_state_data(user_id)) or state.data
        data["amount"] = clean
        return await self._build_confirm_prompt(user_id, user_db_id, data)

    async def _step_confirm(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        if text.lower() in ("confirm", "yes", "confirm_swap"):
            return await self._execute_swap(user_id, user_db_id, state.data)
        if text.lower() in ("no", "decline", "cancel_swap"):
            await self._clear(user_id)
            return FlowResponse("Swap cancelled.")
        return FlowResponse(
            "Please confirm or cancel the swap.",
            buttons=[
                {"id": "confirm_swap", "title": "✅ Confirm"},
                {"id": "cancel_swap", "title": "❌ Cancel"},
            ],
        )

    # -- Helpers ---------------------------------------------------------

    async def _build_confirm_prompt(
        self, user_id: str, user_db_id: int, data: dict
    ) -> FlowResponse:
        from bot.services.whatsapp_service import whatsapp_service as _wa

        from_chain = data.get("from_chain", "ethereum")
        to_chain = data.get("to_chain", "ethereum")
        from_token = data.get("from_token", "?")
        to_token = data.get("to_token", "?")
        amount = data.get("amount", "0")

        # Send interim feedback before the potentially slow quote fetch
        await _wa.send_text_message(user_id, "⏳ Getting your quote...")

        # Try to get a quote
        quote_text = ""
        try:
            from bot.services.swap_engine import SwapEngine
            from bot.services.wallet import WalletService
            from database.db import get_session

            ws = WalletService()
            with get_session() as session:
                from bot.models.user import User

                user = (
                    session.query(User)
                    .filter(User.id == (data.get("user_db_id") or user_db_id))
                    .first()
                )
                wallet = next((w for w in user.wallets if w.is_active), None) if user else None

            if wallet:
                se = SwapEngine()
                quote = await se.get_quote(
                    from_chain=from_chain,
                    to_chain=to_chain,
                    from_token=from_token,
                    to_token=to_token,
                    amount=float(amount),
                    from_address=wallet.address,
                )
                if quote:
                    quote_text = (
                        f"\n\n*Quote:*\n"
                        f"You receive: ~{quote.to_amount_human:.6f} {to_token}\n"
                        f"Rate: 1 {from_token} = {quote.exchange_rate:.6f} {to_token}\n"
                        f"Gas: ~${quote.gas_cost_usd:.2f}\n"
                        f"Fee: ~${quote.fee_cost_usd:.2f}\n"
                        f"Provider: {quote.provider}\n"
                        f"Est. time: ~{quote.estimated_time}s"
                    )
        except Exception as e:
            logger.warning(f"Quote fetch failed: {e}")
            quote_text = "\n\n_Could not fetch quote. Swap will use best available route._"

        text = (
            f"*Swap Summary*\n\n"
            f"From: {amount} {from_token} on {_chain_display(from_chain)}\n"
            f"To: {to_token} on {_chain_display(to_chain)}"
            f"{quote_text}"
        )

        return FlowResponse(
            text=text,
            header="🔄 Confirm Swap",
            buttons=[
                {"id": "confirm_swap", "title": "✅ Confirm"},
                {"id": "cancel_swap", "title": "❌ Cancel"},
            ],
        )

    async def _execute_swap(self, user_id: str, user_db_id: int, data: dict) -> FlowResponse:
        """Actually execute the swap via SwapEngine."""
        from bot.services.whatsapp_service import whatsapp_service as _wa

        await _wa.send_text_message(user_id, "⏳ Submitting your swap...")
        await self._clear(user_id)

        from_chain = data.get("from_chain", "ethereum")
        to_chain = data.get("to_chain", "ethereum")
        from_token = data.get("from_token")
        to_token = data.get("to_token")
        amount = data.get("amount")
        db_user_id = data.get("user_db_id") or user_db_id

        try:
            from bot.services.swap_engine import SwapEngine
            from bot.services.wallet import WalletService
            from bot.services.fee_service import fee_service
            from database.db import get_session
            from bot.models.user import User

            ws = WalletService()
            with get_session() as session:
                user = session.query(User).filter(User.id == db_user_id).first()
                wallet = next((w for w in user.wallets if w.is_active), None) if user else None

            if not wallet:
                return FlowResponse("No active wallet found. Use *wallets* to create one first.")

            se = SwapEngine()
            quote = await se.get_quote(
                from_chain=from_chain,
                to_chain=to_chain,
                from_token=from_token,
                to_token=to_token,
                amount=float(amount),
                from_address=wallet.address,
            )

            if not quote:
                return FlowResponse("Could not get a swap quote. Try again or adjust parameters.")

            import uuid

            idempotency_key = f"wa:{user_id}:{uuid.uuid4().hex[:8]}"

            swap_tx = await se.execute_swap(
                quote=quote,
                wallet_id=wallet.id,
                user_id=db_user_id,
                idempotency_key=idempotency_key,
            )

            if swap_tx and swap_tx.tx_hash:
                from bot.utils.formatters import format_tx_link

                tx_link = format_tx_link(swap_tx.tx_hash, from_chain)
                return FlowResponse(
                    f"✅ *Swap Submitted!*\n\n"
                    f"{amount} {from_token} → {to_token}\n"
                    f"Tx: {tx_link}\n"
                    f"Status: {swap_tx.status}\n\n"
                    f"Track progress with *history*."
                )
            elif swap_tx:
                return FlowResponse(
                    f"⏳ *Swap Processing*\n\n"
                    f"Status: {swap_tx.status}\n"
                    f"Check back with *history*."
                )
            else:
                return FlowResponse(
                    "Swap submission returned no result. Check *history* for updates."
                )

        except Exception as e:
            return FlowResponse(user_safe_error(e, "swap"))

    async def _get_balance_amount(
        self, user_db_id: int, chain: str, token: str, pct: float
    ) -> Optional[float]:
        """Get user's balance for a token and return pct of it."""
        try:
            from bot.services.wallet import WalletService
            from database.db import get_session
            from bot.models.user import User

            ws = WalletService()
            with get_session() as session:
                user = session.query(User).filter(User.id == user_db_id).first()
                wallet = next((w for w in user.wallets if w.is_active), None) if user else None
            if not wallet:
                return None
            balances = await ws.get_balances_by_address(wallet.address, wallet.chain_type)
            chain_bals = balances.get(chain, {})
            bal = chain_bals.get(token, 0)
            return round(bal * pct, 8) if bal else None
        except Exception:
            return None

    async def _get_state_data(self, user_id: str) -> Optional[dict]:
        from bot.services.whatsapp_conversation import conversation_manager

        state = await conversation_manager.get_state(user_id)
        return state.data if state else None


_flow = SwapFlow()
register_flow("swap", _flow)
