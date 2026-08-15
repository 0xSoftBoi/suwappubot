"""Two-factor authentication flow for WhatsApp."""

import logging
from bot.services.whatsapp_flows.base import BaseWhatsAppFlow, FlowResponse
from bot.services.whatsapp_flows import register_flow
from bot.services.whatsapp_conversation import ConversationState

logger = logging.getLogger(__name__)


class TwoFAFlow(BaseWhatsAppFlow):
    flow_name = "twofa"
    trigger_commands = ["2fa", "security", "/2fa"]
    steps = {
        "show_menu": "_step_show_menu",
        "enable_start": "_step_enable_start",
        "enable_verify": "_step_enable_verify",
        "disable_confirm": "_step_disable_confirm",
        "set_threshold": "_step_set_threshold",
    }

    async def start(self, user_id: str, user_db_id: int, text: str = "") -> FlowResponse:
        await self._set_state(user_id, "show_menu", {"user_db_id": user_db_id})
        return await self._show_2fa_menu(user_db_id)

    async def _show_2fa_menu(self, user_db_id: int) -> FlowResponse:
        try:
            from database.db import get_session
            from bot.models.user import User

            with get_session() as session:
                user = session.query(User).filter(User.id == user_db_id).first()
                enabled = user.two_fa_enabled if user else False
                threshold = user.two_fa_threshold if user else 1000
        except Exception:
            enabled = False
            threshold = 1000

        status_icon = "ON" if enabled else "OFF"

        return FlowResponse(
            text=(
                f"*Security Settings*\n\n"
                f"2FA Status: *{status_icon}*\n"
                f"Threshold: *${threshold}*\n\n"
                f"Transactions above the threshold will require a TOTP code."
            ),
            buttons=[
                {"id": "2fa_enable", "title": "Enable 2FA"},
                {"id": "2fa_disable", "title": "Disable 2FA"},
                {"id": "2fa_threshold", "title": "Set Threshold"},
            ],
        )

    async def _step_show_menu(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        db_uid = state.data.get("user_db_id") or user_db_id

        if text == "2fa_enable":
            return await self._start_enable(user_id, db_uid)
        elif text == "2fa_disable":
            await self._update(user_id, "disable_confirm")
            return FlowResponse(
                text=(
                    "*Disable 2FA*\n\n"
                    "This will remove the extra security on your transactions.\n\n"
                    "Type *DISABLE* to confirm:"
                ),
            )
        elif text == "2fa_threshold":
            await self._update(user_id, "set_threshold")
            return FlowResponse(
                text="Enter the USD threshold for 2FA (e.g. `500` or `1000`):\n\nTransactions above this amount will require a TOTP code.",
            )
        else:
            return await self._show_2fa_menu(db_uid)

    async def _start_enable(self, user_id: str, user_db_id: int) -> FlowResponse:
        try:
            import pyotp

            secret = pyotp.random_base32()
            totp = pyotp.TOTP(secret)
            provisioning_uri = totp.provisioning_uri(
                name=f"user_{user_db_id}",
                issuer_name="Suwappu",
            )

            await self._update(user_id, "enable_verify", {"totp_secret": secret})

            return FlowResponse(
                text=(
                    "*Enable 2FA*\n\n"
                    "1. Open your authenticator app (Google Authenticator, Authy, etc.)\n"
                    "2. Add a new account using this setup key:\n\n"
                    f"`{secret}`\n\n"
                    f"Or scan: `{provisioning_uri}`\n\n"
                    "3. Enter the 6-digit code from your authenticator to verify:"
                ),
            )
        except ImportError:
            logger.error("pyotp not installed")
            await self._clear(user_id)
            return FlowResponse("2FA setup is temporarily unavailable. Try again later.")
        except Exception as e:
            logger.error(f"2FA enable error: {e}")
            await self._clear(user_id)
            return FlowResponse("Failed to generate 2FA secret. Try again later.")

    async def _step_enable_start(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        # Redirect to enable flow
        db_uid = state.data.get("user_db_id") or user_db_id
        return await self._start_enable(user_id, db_uid)

    async def _step_enable_verify(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        db_uid = state.data.get("user_db_id") or user_db_id
        secret = state.data.get("totp_secret")

        if not secret:
            await self._clear(user_id)
            return FlowResponse("Session expired. Type *2fa* to start again.")

        code = text.strip().replace(" ", "")
        if not code.isdigit() or len(code) != 6:
            return FlowResponse("Please enter a valid 6-digit code from your authenticator app:")

        try:
            import pyotp

            totp = pyotp.TOTP(secret)
            if not totp.verify(code):
                return FlowResponse(
                    "Invalid code. Please try again with the current code from your authenticator:"
                )
        except Exception as e:
            logger.error(f"TOTP verify error: {e}")
            await self._clear(user_id)
            return FlowResponse("Verification failed. Type *2fa* to try again.")

        # Save to database
        try:
            from database.db import get_session
            from bot.models.user import User

            with get_session() as session:
                user = session.query(User).filter(User.id == db_uid).first()
                if user:
                    from bot.services.twofa import twofa_service

                    user.two_fa_enabled = True
                    # Encrypt at rest — never persist the raw TOTP seed.
                    user.totp_secret = twofa_service.encrypt_secret(secret)
                    session.commit()
        except Exception as e:
            logger.error(f"2FA save error: {e}")
            await self._clear(user_id)
            return FlowResponse("Failed to save 2FA settings. Try again later.")

        await self._clear(user_id)
        return FlowResponse(
            "2FA has been *enabled*.\n\n"
            "Transactions above your threshold will now require a TOTP code."
        )

    async def _step_disable_confirm(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        db_uid = state.data.get("user_db_id") or user_db_id

        if text.strip().upper() != "DISABLE":
            return FlowResponse("Type *DISABLE* to confirm, or *cancel* to go back:")

        try:
            from database.db import get_session
            from bot.models.user import User

            with get_session() as session:
                user = session.query(User).filter(User.id == db_uid).first()
                if user:
                    user.two_fa_enabled = False
                    user.totp_secret = None
                    session.commit()
        except Exception as e:
            logger.error(f"2FA disable error: {e}")
            await self._clear(user_id)
            return FlowResponse("Failed to disable 2FA. Try again later.")

        await self._clear(user_id)
        return FlowResponse("2FA has been *disabled*.")

    async def _step_set_threshold(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        db_uid = state.data.get("user_db_id") or user_db_id

        try:
            amount = float(text.replace("$", "").replace(",", "").strip())
            if amount < 0:
                raise ValueError
            threshold = int(amount)
        except ValueError:
            return FlowResponse("Please enter a valid USD amount (e.g. `500`):")

        try:
            from database.db import get_session
            from bot.models.user import User

            with get_session() as session:
                user = session.query(User).filter(User.id == db_uid).first()
                if user:
                    user.two_fa_threshold = threshold
                    session.commit()
        except Exception as e:
            logger.error(f"Threshold update error: {e}")
            await self._clear(user_id)
            return FlowResponse("Failed to update threshold. Try again later.")

        await self._clear(user_id)
        return FlowResponse(f"2FA threshold updated to *${threshold}*.")


_flow = TwoFAFlow()
register_flow("twofa", _flow)
