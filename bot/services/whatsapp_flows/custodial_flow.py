"""Custodial deposit/withdraw flows for WhatsApp."""

import logging
from bot.services.whatsapp_flows.base import BaseWhatsAppFlow, FlowResponse
from bot.services.whatsapp_flows import register_flow
from bot.services.whatsapp_flows.flow_errors import user_safe_error
from bot.services.whatsapp_conversation import ConversationState

logger = logging.getLogger(__name__)


class DepositFlow(BaseWhatsAppFlow):
    """Show this user's own custodial deposit address.

    The address shown here has to be the one ``deposit_watcher`` watches: a
    ``HotWallet`` carrying ``deposit_user_id``, minted by
    ``hot_wallet_service.get_or_create_user_deposit_wallet``. This flow used to
    render the user's self-custody ``Wallet.address`` instead — an address
    nothing credits. Funds sent there were not lost (the user holds the key) but
    they landed in that wallet and the custodial balance never moved, so a user
    expecting a credit saw their deposit vanish.

    EVM and allowlisted ERC-20s only, which is the whole of what the watcher
    detects: native ETH/BNB/POL emits no Transfer log, and Solana SPL is not
    scanned at all. Neither is offered here, per
    ``docs/operations/deposit-crediting.md`` ("not built yet — and deliberately
    not offered in the UI").
    """

    flow_name = "custodial_deposit"
    trigger_commands = ["deposit"]
    # One terminal response, no steps: EVM is the only family we can credit, so
    # there is nothing to choose. The chain picker is gone rather than left
    # offering a Solana branch that would never credit.
    steps: dict = {}

    async def start(self, user_id: str, user_db_id: int, text: str = "") -> FlowResponse:
        await self._clear(user_id)

        if not user_db_id:
            return FlowResponse("Send *start* first so we can set up your account.")

        try:
            from bot.config.chains import get_chain_by_name
            from bot.services.deposit_watcher import creditable_matrix, min_deposit_summary
            from bot.services.hot_wallet import hot_wallet_service

            wallet = await hot_wallet_service.get_or_create_user_deposit_wallet(
                int(user_db_id), "evm"
            )
            address = wallet.address if wallet else None
            if not address:
                return FlowResponse("Could not retrieve deposit address. Try again later.")

            def _display(chain: str) -> str:
                info = get_chain_by_name(chain)
                return info.display_name if info else chain.upper()

            accepted = "\n".join(
                f"• {', '.join(tokens)} on {', '.join(_display(c) for c in chains)}"
                for chains, tokens in creditable_matrix()
            )
            # Empty when no creditable token carries a floor; omit the sentence
            # rather than assert "Minimum  per deposit".
            floors = min_deposit_summary()
            floor_line = f"Minimum {floors} per deposit — less is not credited.\n" if floors else ""

            # QR code via public API
            qr_url = f"https://api.qrserver.com/v1/create-qr-code/?size=250x250&data={address}"

            return FlowResponse(
                text=(
                    f"📥 *Your Deposit Address*\n\n"
                    f"`{address}`\n\n"
                    f"This address is yours alone — that is how we know a deposit "
                    f"is yours, so deposits to it credit your custodial balance "
                    f"automatically.\n\n"
                    f"*Credited:*\n{accepted}\n"
                    f"{floor_line}\n"
                    f"⚠️ Send only those tokens, on those networks. Native coins "
                    f"(ETH, BNB, POL) and Solana are *not* credited yet — anything "
                    f"else sent here will not show up in your balance."
                ),
                header="📥 Deposit",
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

    async def _step_choose_token(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        token = text.replace("wdtk_", "").upper()
        await self._update(user_id, "enter_amount", {"token": token})
        return FlowResponse(text=f"Token: *{token}*\n\nEnter the amount to withdraw:")

    async def _step_enter_amount(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        try:
            amount = float(text.replace(",", "").strip())
            if amount <= 0:
                raise ValueError
        except ValueError:
            return FlowResponse("Please enter a valid positive amount:")
        await self._update(user_id, "enter_destination", {"amount": str(amount)})
        return FlowResponse(
            text=f"Amount: *{amount} {state.data.get('token', '')}*\n\nEnter the destination address:"
        )

    async def _step_enter_destination(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
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

    async def _step_confirm(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
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
                rpc_url = (
                    __import__("os").environ.get(chain_cfg.rpc_url_env, "") if chain_cfg else ""
                )

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
                    raw_amount = int(float(amount) * (10**decimals))

                    erc20_abi = [
                        {
                            "constant": False,
                            "inputs": [
                                {"name": "_to", "type": "address"},
                                {"name": "_value", "type": "uint256"},
                            ],
                            "name": "transfer",
                            "outputs": [{"name": "", "type": "bool"}],
                            "type": "function",
                        }
                    ]
                    contract = w3.eth.contract(
                        address=Web3.to_checksum_address(token_addr), abi=erc20_abi
                    )
                    tx = contract.functions.transfer(
                        Web3.to_checksum_address(destination),
                        raw_amount,
                    ).build_transaction(
                        {
                            "from": wallet.address,
                            "gas": 100000,
                            "gasPrice": w3.eth.gas_price,
                            "nonce": nonce,
                            "chainId": 1,
                        }
                    )

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
            return FlowResponse(user_safe_error(e, "withdrawal"))


_deposit_flow = DepositFlow()
_withdraw_flow = WithdrawFlow()
register_flow("custodial_deposit", _deposit_flow)
register_flow("custodial_withdraw", _withdraw_flow)
