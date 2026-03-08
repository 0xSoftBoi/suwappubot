"""Custodial deposit/withdraw flows for WhatsApp."""

import logging
from bot.services.whatsapp_flows.base import BaseWhatsAppFlow, FlowResponse
from bot.services.whatsapp_flows import register_flow
from bot.services.whatsapp_conversation import ConversationState

logger = logging.getLogger(__name__)


class DepositFlow(BaseWhatsAppFlow):
    """Show deposit address and optionally a QR code."""
    flow_name = "custodial_deposit"
    trigger_commands = ["deposit"]
    steps = {
        "choose_chain": "_step_choose_chain",
    }

    async def start(self, user_id: str, user_db_id: int, text: str = "") -> FlowResponse:
        await self._set_state(user_id, "choose_chain", {"user_db_id": user_db_id})
        return FlowResponse(
            text="Select the chain to deposit on:",
            header="📥 Deposit",
            buttons=[
                {"id": "dep_evm", "title": "🔷 EVM"},
                {"id": "dep_solana", "title": "🟢 Solana"},
            ],
        )

    async def _step_choose_chain(self, user_id: str, user_db_id: int, text: str, state: ConversationState) -> FlowResponse:
        await self._clear(user_id)
        db_uid = state.data.get("user_db_id") or user_db_id

        chain_type = "evm" if "evm" in text.lower() else "solana" if "solana" in text.lower() or "sol" in text.lower() else None
        if not chain_type:
            return FlowResponse(
                "Please select EVM or Solana:",
                buttons=[
                    {"id": "dep_evm", "title": "🔷 EVM"},
                    {"id": "dep_solana", "title": "🟢 Solana"},
                ],
            )

        try:
            from database.db import get_session
            from bot.models.user import User
            with get_session() as session:
                user = session.query(User).filter(User.id == db_uid).first()
                wallet = next(
                    (w for w in user.wallets if w.chain_type == chain_type and w.is_active),
                    None,
                ) if user else None

            if not wallet:
                return FlowResponse(
                    f"No {chain_type.upper()} wallet found.\n"
                    f"Use *wallets* to create one first."
                )

            address = wallet.address
            # QR code via public API
            qr_url = f"https://api.qrserver.com/v1/create-qr-code/?size=250x250&data={address}"

            return FlowResponse(
                text=(
                    f"📥 *Deposit Address*\n\n"
                    f"Chain: {chain_type.upper()}\n"
                    f"Address:\n`{address}`\n\n"
                    f"Send tokens to this address. Only send {chain_type.upper()}-compatible tokens."
                ),
                image=qr_url,
            )
        except Exception as e:
            logger.error(f"Deposit flow error: {e}")
            return FlowResponse("Could not retrieve deposit address. Try again later.")


class WithdrawFlow(BaseWhatsAppFlow):
    """Multi-step withdrawal: token -> amount -> destination -> confirm."""
    flow_name = "custodial_withdraw"
    trigger_commands = ["withdraw"]
    steps = {
        "choose_token": "_step_choose_token",
        "enter_amount": "_step_enter_amount",
        "enter_destination": "_step_enter_destination",
        "confirm": "_step_confirm",
    }

    async def start(self, user_id: str, user_db_id: int, text: str = "") -> FlowResponse:
        await self._set_state(user_id, "choose_token", {"user_db_id": user_db_id})
        tokens = ["ETH", "USDC", "USDT", "SOL", "MATIC", "ARB", "OP", "LINK"]
        rows = [{"id": f"wdtk_{t}", "title": t} for t in tokens]
        return FlowResponse(
            text="Select the token to withdraw:",
            header="📤 Withdraw",
            list_button_text="Choose Token",
            list_sections=[{"title": "Tokens", "rows": rows}],
        )

    async def _step_choose_token(self, user_id: str, user_db_id: int, text: str, state: ConversationState) -> FlowResponse:
        token = text.replace("wdtk_", "").upper()
        await self._update(user_id, "enter_amount", {"token": token})
        return FlowResponse(text=f"Token: *{token}*\n\nEnter the amount to withdraw:")

    async def _step_enter_amount(self, user_id: str, user_db_id: int, text: str, state: ConversationState) -> FlowResponse:
        try:
            amount = float(text.replace(",", "").strip())
            if amount <= 0:
                raise ValueError
        except ValueError:
            return FlowResponse("Please enter a valid positive amount:")
        await self._update(user_id, "enter_destination", {"amount": str(amount)})
        return FlowResponse(text=f"Amount: *{amount} {state.data.get('token', '')}*\n\nEnter the destination address:")

    async def _step_enter_destination(self, user_id: str, user_db_id: int, text: str, state: ConversationState) -> FlowResponse:
        address = text.strip()
        # Basic validation
        if len(address) < 20:
            return FlowResponse("Invalid address. Please enter a valid blockchain address:")
        await self._update(user_id, "confirm", {"destination": address})
        token = state.data.get("token", "?")
        amount = state.data.get("amount", "0")
        short_addr = address[:8] + "..." + address[-6:]
        return FlowResponse(
            text=(
                f"*Confirm Withdrawal*\n\n"
                f"Token: {token}\n"
                f"Amount: {amount}\n"
                f"To: `{short_addr}`\n\n"
                f"Confirm?"
            ),
            buttons=[
                {"id": "wd_confirm", "title": "✅ Confirm"},
                {"id": "wd_cancel", "title": "❌ Cancel"},
            ],
        )

    async def _step_confirm(self, user_id: str, user_db_id: int, text: str, state: ConversationState) -> FlowResponse:
        if text in ("wd_cancel", "cancel"):
            await self._clear(user_id)
            return FlowResponse("Withdrawal cancelled.")

        if text not in ("wd_confirm", "confirm", "yes"):
            return FlowResponse(
                "Please confirm or cancel:",
                buttons=[
                    {"id": "wd_confirm", "title": "✅ Confirm"},
                    {"id": "wd_cancel", "title": "❌ Cancel"},
                ],
            )

        await self._clear(user_id)
        db_uid = state.data.get("user_db_id") or user_db_id
        token = state.data.get("token")
        amount = state.data.get("amount")
        destination = state.data.get("destination")

        try:
            from bot.services.wallet import WalletService
            from bot.services.swap_engine import SwapEngine
            from database.db import get_session
            from bot.models.user import User

            with get_session() as session:
                user = session.query(User).filter(User.id == db_uid).first()
                wallet = next((w for w in user.wallets if w.is_active), None) if user else None

            if not wallet:
                return FlowResponse("No active wallet found. Use *wallets* to create one first.")

            ws = WalletService()

            # Build and sign a transfer transaction
            # This is a simplified version - real implementation would handle
            # ERC20 transfers, native transfers, Solana SPL transfers etc.
            if wallet.chain_type == "evm":
                from web3 import Web3
                from bot.config.chains import CHAINS
                chain_cfg = CHAINS.get("ethereum")
                rpc_url = __import__("os").environ.get(chain_cfg.rpc_url_env, "") if chain_cfg else ""

                if not rpc_url:
                    return FlowResponse("RPC not configured. Please try again later.")

                w3 = Web3(Web3.HTTPProvider(rpc_url))
                nonce = w3.eth.get_transaction_count(wallet.address)

                if token in ("ETH", "MATIC", "BNB", "AVAX", "FTM"):
                    # Native transfer
                    tx = {
                        "to": destination,
                        "value": w3.to_wei(float(amount), "ether"),
                        "gas": 21000,
                        "gasPrice": w3.eth.gas_price,
                        "nonce": nonce,
                        "chainId": 1,
                    }
                else:
                    # ERC20 transfer - simplified
                    from bot.config.tokens import get_token_address, get_token_decimals
                    token_addr = get_token_address(token, "ethereum")
                    decimals = get_token_decimals(token, "ethereum")
                    raw_amount = int(float(amount) * (10 ** decimals))

                    erc20_abi = [{"constant": False, "inputs": [{"name": "_to", "type": "address"}, {"name": "_value", "type": "uint256"}], "name": "transfer", "outputs": [{"name": "", "type": "bool"}], "type": "function"}]
                    contract = w3.eth.contract(address=Web3.to_checksum_address(token_addr), abi=erc20_abi)
                    tx = contract.functions.transfer(
                        Web3.to_checksum_address(destination),
                        raw_amount,
                    ).build_transaction({
                        "from": wallet.address,
                        "gas": 100000,
                        "gasPrice": w3.eth.gas_price,
                        "nonce": nonce,
                        "chainId": 1,
                    })

                signed = await ws.sign_transaction(wallet.id, tx)
                tx_hash = w3.eth.send_raw_transaction(signed)
                tx_hash_hex = tx_hash.hex()

                from bot.utils.formatters import format_tx_link
                tx_link = format_tx_link(tx_hash_hex, "ethereum")
                return FlowResponse(
                    f"✅ *Withdrawal Submitted!*\n\n"
                    f"{amount} {token} → `{destination[:8]}...{destination[-6:]}`\n"
                    f"Tx: {tx_link}"
                )
            else:
                return FlowResponse(
                    "Solana withdrawals are currently being finalized.\n"
                    "Please use the web dashboard for Solana withdrawals."
                )

        except Exception as e:
            logger.error(f"Withdrawal failed: {e}")
            return FlowResponse(f"Withdrawal failed: {str(e)[:200]}\n\nPlease try again.")


_deposit_flow = DepositFlow()
_withdraw_flow = WithdrawFlow()
register_flow("custodial_deposit", _deposit_flow)
register_flow("custodial_withdraw", _withdraw_flow)
