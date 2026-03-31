"""Service for managing Terms of Service acceptance."""

import logging
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy.orm import Session

from bot.models.user import User
from database.db import get_session

logger = logging.getLogger(__name__)

TOS_TEXT = """
🌸 *suwappu Terms of Service* 🌸

Welcome to Suwappu Bot! By using this service, you agree to the following:

1. *No Financial Advice*: We do not provide financial advice. All trades are at your own risk.
2. *Security*: You are responsible for your own security. When using self-custody mode, you are the only one who has access to your private keys (locally encrypted).
3. *Fees*: We charge a 1% fee on all swaps. These fees are used to maintain the service and provide gas sponsorship in custodial mode.
4. *No Liability*: Suwappu Bot is provided "as is" without any warranties. We are not responsible for any losses, including but not limited to loss of funds, smart contract failures, or network issues.
5. *Compliance*: You agree to comply with all applicable laws and regulations in your jurisdiction.

Do you accept these terms and conditions?
"""

class TosService:
    """Service for handling TOS acceptance."""
    
    @staticmethod
    def is_accepted(user_id: int) -> bool:
        """Check if a user (by internal ID) has accepted the TOS."""
        with get_session() as session:
            user = session.query(User).filter(User.id == user_id).first()
            return user.tos_accepted if user else False

    @staticmethod
    def is_accepted_telegram(telegram_id: int) -> bool:
        """Check if a user (by Telegram ID) has accepted the TOS."""
        with get_session() as session:
            user = session.query(User).filter(User.telegram_id == telegram_id).first()
            return user.tos_accepted if user else False

    @staticmethod
    def is_accepted_whatsapp(whatsapp_id: str) -> bool:
        """Check if a user (by WhatsApp ID) has accepted the TOS."""
        with get_session() as session:
            user = session.query(User).filter(User.whatsapp_id == whatsapp_id).first()
            return user.tos_accepted if user else False

    @staticmethod
    def accept(user_id: int) -> bool:
        """Mark TOS as accepted for a user."""
        try:
            with get_session() as session:
                user = session.query(User).filter(User.id == user_id).first()
                if user:
                    user.tos_accepted = True
                    user.tos_accepted_at = datetime.now(timezone.utc)
                    return True
                return False
        except Exception as e:
            logger.error(f"Error accepting TOS for user {user_id}: {e}")
            return False

tos_service = TosService()

