"""Cross-platform account linking service for Telegram, WhatsApp, and Discord."""

import logging
import string
import secrets
import json

from bot.models.user import User, Wallet
from bot.utils.redis_cache import redis_cache
from database.db import get_session

logger = logging.getLogger(__name__)

LINK_CODE_TTL = 300  # 5 minutes
LINK_CODE_LENGTH = 6
LINK_CODE_PREFIX = "link_code:"

PLATFORM_COLUMNS = {
    "telegram": "telegram_id",
    "whatsapp": "whatsapp_id",
    "discord": "discord_id",
}


class PlatformLinkService:
    """Links user accounts across Telegram, WhatsApp, and Discord."""

    async def generate_link_code(self, user_id: int, source_platform: str) -> str:
        """Generate a 6-char alphanumeric code, stored in Redis with 5-min TTL.

        Args:
            user_id: Internal user ID initiating the link.
            source_platform: Platform the user is calling from (telegram/whatsapp/discord).

        Returns:
            The generated link code string.
        """
        if source_platform not in PLATFORM_COLUMNS:
            raise ValueError(f"Unknown platform: {source_platform}")

        alphabet = string.ascii_uppercase + string.digits
        code = "".join(secrets.choice(alphabet) for _ in range(LINK_CODE_LENGTH))

        payload = json.dumps({"user_id": user_id, "source_platform": source_platform})
        await redis_cache.set(f"{LINK_CODE_PREFIX}{code}", payload, ttl_seconds=LINK_CODE_TTL)

        logger.info(f"Generated link code for user {user_id} on {source_platform}")
        return code

    async def redeem_link_code(
        self,
        code: str,
        target_platform: str,
        target_platform_id: str,
    ) -> bool:
        """Redeem a link code to merge accounts across platforms.

        Looks up the code in Redis, sets the target platform's ID on the
        source user, and handles duplicate-user merging if the target
        platform already has an existing user record.

        Args:
            code: The 6-char link code.
            target_platform: Platform being linked (telegram/whatsapp/discord).
            target_platform_id: The user's ID on the target platform.

        Returns:
            True if linking succeeded, False otherwise.
        """
        if target_platform not in PLATFORM_COLUMNS:
            logger.warning(f"Redeem failed — unknown platform: {target_platform}")
            return False

        raw = await redis_cache.get(f"{LINK_CODE_PREFIX}{code}")
        if raw is None:
            logger.warning(f"Redeem failed — code expired or invalid: {code}")
            return False

        try:
            data = json.loads(raw) if isinstance(raw, str) else raw
        except (json.JSONDecodeError, TypeError):
            logger.error(f"Redeem failed — corrupt payload for code: {code}")
            return False

        source_user_id: int = data["user_id"]
        source_platform: str = data["source_platform"]

        if target_platform == source_platform:
            logger.warning("Redeem failed — cannot link to the same platform")
            return False

        target_col = PLATFORM_COLUMNS[target_platform]

        with get_session() as session:
            source_user = session.query(User).filter(User.id == source_user_id).first()
            if source_user is None:
                logger.warning(f"Redeem failed — source user {source_user_id} not found")
                return False

            # Check if the source user already has this platform linked
            if getattr(source_user, target_col) is not None:
                logger.warning(f"User {source_user_id} already has {target_platform} linked")
                return False

            # Find any existing user that owns the target platform ID
            existing_user = (
                session.query(User).filter(getattr(User, target_col) == target_platform_id).first()
            )

            if existing_user and existing_user.id != source_user_id:
                # Merge: move wallets from duplicate → source, then delete duplicate
                self._merge_users(session, source_user, existing_user)

            # Set the target platform ID on the source user
            setattr(source_user, target_col, target_platform_id)

        # Delete the consumed code
        await redis_cache.delete(f"{LINK_CODE_PREFIX}{code}")
        logger.info(f"Linked {target_platform}:{target_platform_id} to user {source_user_id}")
        return True

    def get_linked_platforms(self, user_id: int) -> dict:
        """Return dict of {platform: platform_id} for all linked platforms.

        Args:
            user_id: Internal user ID.

        Returns:
            Dict like {"telegram": "12345", "whatsapp": "15551234567"}.
        """
        with get_session() as session:
            user = session.query(User).filter(User.id == user_id).first()
            if user is None:
                return {}

            result = {}
            for platform, col in PLATFORM_COLUMNS.items():
                value = getattr(user, col)
                if value is not None:
                    result[platform] = str(value)
            return result

    def unlink_platform(self, user_id: int, platform: str) -> bool:
        """Remove a platform link by setting the column to None.

        Refuses to unlink the last remaining platform to avoid orphaning the user.

        Args:
            user_id: Internal user ID.
            platform: Platform to unlink (telegram/whatsapp/discord).

        Returns:
            True if unlinked, False otherwise.
        """
        if platform not in PLATFORM_COLUMNS:
            return False

        col = PLATFORM_COLUMNS[platform]

        with get_session() as session:
            user = session.query(User).filter(User.id == user_id).first()
            if user is None:
                return False

            if getattr(user, col) is None:
                return False

            # Prevent unlinking the last platform
            linked_count = sum(1 for c in PLATFORM_COLUMNS.values() if getattr(user, c) is not None)
            if linked_count <= 1:
                logger.warning(
                    f"Cannot unlink {platform} — it is the only linked platform for user {user_id}"
                )
                return False

            setattr(user, col, None)
            if platform == "discord":
                user.discord_username = None

        logger.info(f"Unlinked {platform} from user {user_id}")
        return True

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _merge_users(session, keep_user: User, discard_user: User) -> None:
        """Merge wallets and relevant data from *discard_user* into *keep_user*,
        then delete the duplicate user record.

        This intentionally only migrates wallets (the primary asset-bearing
        relationship). Other relationships (swaps, subscriptions) remain
        attached to the user that created them and are cascade-deleted.
        """
        logger.info(f"Merging user {discard_user.id} into user {keep_user.id}")

        # Re-parent wallets
        wallets_to_move = session.query(Wallet).filter(Wallet.user_id == discard_user.id).all()
        for wallet in wallets_to_move:
            wallet.user_id = keep_user.id

        # Copy over any platform IDs the keep_user doesn't have yet
        for col in PLATFORM_COLUMNS.values():
            if getattr(keep_user, col) is None and getattr(discard_user, col) is not None:
                setattr(keep_user, col, getattr(discard_user, col))

        if keep_user.discord_username is None and discard_user.discord_username:
            keep_user.discord_username = discard_user.discord_username

        # Accumulate referral stats
        keep_user.total_referral_rewards = (keep_user.total_referral_rewards or 0) + (
            discard_user.total_referral_rewards or 0
        )
        keep_user.referral_count = (keep_user.referral_count or 0) + (
            discard_user.referral_count or 0
        )

        session.delete(discard_user)
        session.flush()
        logger.info(f"Merged and deleted user {discard_user.id}")


platform_link_service = PlatformLinkService()
