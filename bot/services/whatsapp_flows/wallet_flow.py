"""Wallet management flow for WhatsApp."""

import logging
from bot.services.whatsapp_flows.base import BaseWhatsAppFlow, FlowResponse
from bot.services.whatsapp_flows import register_flow
from bot.services.whatsapp_conversation import ConversationState

logger = logging.getLogger(__name__)


class WalletFlow(BaseWhatsAppFlow):
    flow_name = "wallet"
    trigger_commands = ["wallet", "wallets", "wallet_create", "wallet_import"]
    steps = {
        "choose_action": "_step_choose_action",
        "choose_chain_type": "_step_chain_type",
        "import_key": "_step_import_key",
    }

    async def start(self, user_id: str, user_db_id: int, text: str = "") -> FlowResponse:
        # Direct entry from button payloads
        if text in ("wallet_create", "wallet_import"):
            await self._set_state(user_id, "choose_chain_type", {
                "user_db_id": user_db_id,
                "action": "create" if text == "wallet_create" else "import",
            })
            return FlowResponse(
                text="Select the wallet type:",
                header="👛 Wallet Type",
                buttons=[
                    {"id": "chain_evm", "title": "🔷 EVM"},
                    {"id": "chain_solana", "title": "🟢 Solana"},
                ],
            )

        await self._set_state(user_id, "choose_action", {"user_db_id": user_db_id})
        return FlowResponse(
            text="What would you like to do?",
            header="👛 Wallet Management",
            buttons=[
                {"id": "wallet_create", "title": "Create Wallet"},
                {"id": "wallet_import", "title": "Import Wallet"},
            ],
        )

    async def _step_choose_action(self, user_id: str, user_db_id: int, text: str, state: ConversationState) -> FlowResponse:
        action = "create" if "create" in text.lower() else "import" if "import" in text.lower() else None
        if not action:
            return FlowResponse(
                text="Please choose an action:",
                buttons=[
                    {"id": "wallet_create", "title": "Create Wallet"},
                    {"id": "wallet_import", "title": "Import Wallet"},
                ],
            )
        await self._update(user_id, "choose_chain_type", {"action": action})
        return FlowResponse(
            text="Select the wallet type:",
            header="👛 Wallet Type",
            buttons=[
                {"id": "chain_evm", "title": "🔷 EVM"},
                {"id": "chain_solana", "title": "🟢 Solana"},
            ],
        )

    async def _step_chain_type(self, user_id: str, user_db_id: int, text: str, state: ConversationState) -> FlowResponse:
        chain_type = None
        if "evm" in text.lower():
            chain_type = "evm"
        elif "solana" in text.lower() or "sol" in text.lower():
            chain_type = "solana"
        if not chain_type:
            return FlowResponse(
                text="Please select EVM or Solana:",
                buttons=[
                    {"id": "chain_evm", "title": "🔷 EVM"},
                    {"id": "chain_solana", "title": "🟢 Solana"},
                ],
            )

        action = state.data.get("action", "create")
        db_uid = state.data.get("user_db_id") or user_db_id

        if action == "create":
            return await self._create_wallet(user_id, db_uid, chain_type)
        else:
            await self._update(user_id, "import_key", {"chain_type": chain_type})
            return FlowResponse(
                text=(
                    f"⚠️ *Security Notice*\n\n"
                    f"WhatsApp Cloud API messages are stored by Meta and are *not* end-to-end encrypted "
                    f"between you and the bot server.\n\n"
                    f"For maximum security, import wallets via the web dashboard instead.\n\n"
                    f"To proceed here, send your *{chain_type.upper()}* private key now:"
                ),
            )

    async def _step_import_key(self, user_id: str, user_db_id: int, text: str, state: ConversationState) -> FlowResponse:
        await self._clear(user_id)
        chain_type = state.data.get("chain_type", "evm")
        db_uid = state.data.get("user_db_id") or user_db_id
        private_key = text.strip()

        try:
            from bot.services.wallet import WalletService
            ws = WalletService()

            if chain_type == "evm":
                if not private_key.startswith("0x"):
                    private_key = "0x" + private_key
                from web3 import Account
                acct = Account.from_key(private_key)
                address = acct.address
            else:
                # Basic length validation for Solana
                if len(private_key) < 32:
                    return FlowResponse("Invalid Solana private key. Please try again with *wallets*.")
                address = None  # WalletService will derive

            wallet = ws.import_wallet(
                address=address,
                private_key=private_key,
                user_id=db_uid,
                chain_type=chain_type,
                name=f"WhatsApp {chain_type.upper()}",
            )

            if wallet:
                display_addr = wallet.address[:6] + "..." + wallet.address[-4:]
                return FlowResponse(
                    f"✅ *Wallet Imported!*\n\n"
                    f"Type: {chain_type.upper()}\n"
                    f"Address: `{display_addr}`"
                )
            return FlowResponse("Failed to import wallet. Check the key and try again.")
        except Exception as e:
            logger.error(f"Wallet import failed: {e}")
            return FlowResponse(f"Import failed: {str(e)[:150]}")

    async def _create_wallet(self, user_id: str, user_db_id: int, chain_type: str) -> FlowResponse:
        await self._clear(user_id)
        try:
            from bot.services.wallet import WalletService
            from database.db import get_session
            from bot.models.user import User, Wallet

            ws = WalletService()
            if chain_type == "evm":
                address, private_key = ws.create_evm_wallet()
            else:
                address, private_key = ws.create_solana_wallet()

            # Save wallet
            with get_session() as session:
                wallet = Wallet(
                    user_id=user_db_id,
                    address=address,
                    chain_type=chain_type,
                    name=f"WhatsApp {chain_type.upper()}",
                    is_active=True,
                )
                # Encrypt and store private key
                from bot.utils.encryption import encrypt_private_key
                wallet.encrypted_private_key = encrypt_private_key(private_key)
                session.add(wallet)
                session.commit()

            display_addr = address[:6] + "..." + address[-4:]
            return FlowResponse(
                f"✅ *Wallet Created!*\n\n"
                f"Type: {chain_type.upper()}\n"
                f"Address: `{display_addr}`\n\n"
                f"Your wallet is ready. Use *balance* to check it."
            )
        except Exception as e:
            logger.error(f"Wallet creation failed: {e}")
            return FlowResponse(f"Wallet creation failed: {str(e)[:150]}")


_flow = WalletFlow()
register_flow("wallet", _flow)
