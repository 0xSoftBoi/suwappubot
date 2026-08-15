"""
Wallet recovery service for Turnkey wallets.

Handles email-based recovery flow:
1. User sets up recovery email (proactive)
2. User initiates recovery (when access lost)
3. User completes recovery with new authenticator
"""

import logging
from datetime import datetime, timezone
from typing import Optional

from bot.models.user import User, Wallet

logger = logging.getLogger(__name__)


class WalletRecoveryService:
    """Handles Turnkey wallet recovery flows."""

    def __init__(self):
        self._turnkey_client = None

    @property
    def turnkey_client(self):
        if self._turnkey_client is None:
            from bot.services.turnkey_client import get_turnkey_client

            self._turnkey_client = get_turnkey_client()
        return self._turnkey_client

    async def setup_email_recovery(
        self,
        user_id: int,
        email: str,
    ) -> bool:
        """
        Link a recovery email to the user's Turnkey sub-org.

        Should be prompted after wallet creation.

        Args:
            user_id: Telegram user ID
            email: Recovery email address

        Returns:
            True if setup successful
        """
        from database.db import get_session

        with get_session() as session:
            user = session.query(User).filter(User.telegram_id == user_id).first()
            if not user:
                logger.error(f"User {user_id} not found for recovery setup")
                return False

            wallet = (
                session.query(Wallet)
                .filter(
                    Wallet.user_id == user.id,
                    Wallet.wallet_provider == "turnkey",
                    Wallet.is_active == True,
                )
                .first()
            )
            if not wallet:
                logger.error(f"No Turnkey wallet found for user {user_id}")
                return False

            user.recovery_email = email
            user.recovery_setup_at = datetime.now(timezone.utc)

        logger.info(f"Recovery email set for user {user_id}: {email[:3]}***")
        return True

    async def initiate_recovery(
        self,
        email: str,
        target_public_key: str,
    ) -> Optional[str]:
        """
        Start the recovery process for a user who lost access.

        Looks up the user by recovery email, then initiates
        Turnkey's email recovery flow.

        Args:
            email: The recovery email registered earlier
            target_public_key: Public key of the new authenticator device

        Returns:
            User ID if recovery initiated, None on failure
        """
        from database.db import get_session

        with get_session() as session:
            user = session.query(User).filter(User.recovery_email == email).first()
            if not user:
                logger.warning(f"No user found with recovery email: {email[:3]}***")
                return None

            wallet = (
                session.query(Wallet)
                .filter(
                    Wallet.user_id == user.id,
                    Wallet.wallet_provider == "turnkey",
                    Wallet.is_active == True,
                )
                .first()
            )
            if not wallet or not wallet.turnkey_sub_org_id:
                logger.error(f"No Turnkey wallet/sub-org for user {user.id}")
                return None

            sub_org_id = wallet.turnkey_sub_org_id

        try:
            recovery_user_id = await self.turnkey_client.init_email_recovery(
                email=email,
                target_public_key=target_public_key,
                organization_id=sub_org_id,
            )
            logger.info(f"Recovery initiated for email {email[:3]}***")
            return recovery_user_id
        except Exception as e:
            logger.error(f"Failed to initiate recovery: {e}")
            return None

    async def complete_recovery(
        self,
        email: str,
        authenticator: dict,
        new_telegram_id: Optional[str] = None,
    ) -> bool:
        """
        Complete the recovery process.

        Adds the new authenticator to the user's Turnkey sub-org
        and optionally updates their Telegram ID.

        Args:
            email: Recovery email used to initiate recovery
            authenticator: New authenticator details from passkey registration
            new_telegram_id: New Telegram user ID (if account changed)

        Returns:
            True if recovery completed successfully
        """
        from database.db import get_session

        with get_session() as session:
            user = session.query(User).filter(User.recovery_email == email).first()
            if not user:
                return False

            wallet = (
                session.query(Wallet)
                .filter(
                    Wallet.user_id == user.id,
                    Wallet.wallet_provider == "turnkey",
                    Wallet.is_active == True,
                )
                .first()
            )
            if not wallet or not wallet.turnkey_sub_org_id:
                return False

            sub_org_id = wallet.turnkey_sub_org_id
            user_db_id = user.id

        try:
            auth_id = await self.turnkey_client.recover_user(
                authenticator=authenticator,
                organization_id=sub_org_id,
            )

            if not auth_id:
                logger.error("Recovery failed: no authenticator ID returned")
                return False

            if new_telegram_id:
                with get_session() as session:
                    user = session.query(User).filter(User.id == user_db_id).first()
                    if user:
                        user.telegram_id = new_telegram_id

            logger.info(f"Recovery completed for user {user_db_id}, " f"new auth: {auth_id}")
            return True

        except Exception as e:
            logger.error(f"Failed to complete recovery: {e}")
            return False

    async def get_recovery_status(self, user_id: int) -> dict:
        """Check if user has recovery set up."""
        from database.db import get_session

        with get_session() as session:
            user = session.query(User).filter(User.telegram_id == user_id).first()
            if not user:
                return {"has_recovery": False}

            has_turnkey = (
                session.query(Wallet)
                .filter(
                    Wallet.user_id == user.id,
                    Wallet.wallet_provider == "turnkey",
                )
                .first()
                is not None
            )

            return {
                "has_recovery": bool(user.recovery_email),
                "recovery_email": user.recovery_email,
                "setup_at": user.recovery_setup_at.isoformat() if user.recovery_setup_at else None,
                "has_turnkey_wallet": has_turnkey,
            }
