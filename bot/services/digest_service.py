"""Weekly portfolio digest background service.

Checks every hour whether any opted-in user is due a digest (7 days since
last_digest_at, or never received one), builds a short summary from the
existing portfolio/balance service, and sends it via Telegram.
"""

import asyncio
import logging
from datetime import datetime, timezone, timedelta

from sqlalchemy import or_

from database.db import get_session
from bot.models.user import User, Wallet
from bot.utils.safe_send import safe_send

logger = logging.getLogger(__name__)

CHECK_INTERVAL_SECONDS = 3600  # check every hour
DIGEST_INTERVAL_DAYS = 7


def is_digest_due(last_digest_at, now=None) -> bool:
    """A digest is due if never sent, or sent more than DIGEST_INTERVAL_DAYS ago.

    Naive datetimes are treated as UTC (SQLite stores them naive).
    """
    if last_digest_at is None:
        return True
    if now is None:
        now = datetime.now(timezone.utc)
    if last_digest_at.tzinfo is None:
        last_digest_at = last_digest_at.replace(tzinfo=timezone.utc)
    return last_digest_at < now - timedelta(days=DIGEST_INTERVAL_DAYS)


class DigestService:
    """Background task that sends weekly portfolio digests."""

    def __init__(self):
        self._running = False
        self._task = None
        self._bot = None

    async def start(self, bot=None) -> None:
        """Start the digest service."""
        if self._running:
            logger.warning("Digest service already running")
            return
        self._bot = bot
        self._running = True
        self._task = asyncio.create_task(self._loop())
        logger.info("Digest service started")

    async def stop(self) -> None:
        """Stop the digest service."""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("Digest service stopped")

    async def _loop(self) -> None:
        """Main loop: sleep 1 h, then check all opted-in users."""
        await asyncio.sleep(60)  # small initial delay

        while self._running:
            try:
                await self._send_due_digests()
            except Exception as exc:
                logger.error(f"Digest loop error: {exc}", exc_info=True)

            await asyncio.sleep(CHECK_INTERVAL_SECONDS)

    async def _send_due_digests(self) -> None:
        """Find users whose digest is due and send it."""
        if self._bot is None:
            return

        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(days=DIGEST_INTERVAL_DAYS)

        with get_session() as session:
            # Include users with either Telegram or WhatsApp so WA-only users get digests
            users = (
                session.query(User)
                .filter(
                    User.weekly_digest == True,  # noqa: E712
                    # A Telegram block must not also cancel the WhatsApp leg
                    # for a dual-channel user.
                    or_(
                        User.bot_blocked_at.is_(None),
                        User.whatsapp_id.isnot(None),
                    ),
                )
                .filter((User.telegram_id.isnot(None)) | (User.whatsapp_id.isnot(None)))
                .all()
            )
            due_users = [u for u in users if is_digest_due(u.last_digest_at, now)]
            # Detach so we can use IDs after session closes
            due_info = [
                (
                    u.id,
                    u.telegram_id,
                    u.whatsapp_id,
                    [(w.id, w.address, w.chain_type, w.name) for w in u.wallets],
                )
                for u in due_users
            ]

        for user_id, telegram_id, whatsapp_id, wallet_infos in due_info:
            try:
                await self._send_digest(user_id, telegram_id, whatsapp_id, wallet_infos)
            except Exception as exc:
                logger.warning(f"Failed to send digest to user {user_id}: {exc}")

    async def _send_digest(
        self,
        user_id: int,
        telegram_id: int,
        whatsapp_id: str,
        wallet_infos: list,
    ) -> None:
        """Build and send the digest message for one user via Telegram and/or WhatsApp."""
        from bot.services.wallet import WalletService
        from bot.services.price_service import PriceService
        from bot.utils.formatters import format_usd

        wallet_service = WalletService()
        price_service = PriceService()

        all_balances: dict = {}
        for _wid, address, chain_type, _name in wallet_infos:
            try:
                balances = await wallet_service.get_balances_by_address(address, chain_type)
                for chain, tokens in balances.items():
                    if chain not in all_balances:
                        all_balances[chain] = {}
                    for token, amount in tokens.items():
                        all_balances[chain][token] = all_balances[chain].get(token, 0) + amount
            except Exception as exc:
                logger.debug(f"Balance fetch failed for {address}: {exc}")

        all_tokens = {t for tokens in all_balances.values() for t in tokens}
        prices = await price_service.get_prices(list(all_tokens)) if all_tokens else {}

        total_usd = 0.0
        top_token = None
        top_value = 0.0
        chain_count = 0

        for chain, tokens in all_balances.items():
            has_value = False
            for token, amount in tokens.items():
                price = prices.get(token, 0) or 0
                usd = amount * price
                total_usd += usd
                if usd > 0.01:
                    has_value = True
                if usd > top_value:
                    top_value = usd
                    top_token = token
            if has_value:
                chain_count += 1

        chain_count = max(chain_count, len(wallet_infos) > 0 and 1 or 0)

        top_str = f" Top holding: {top_token}." if top_token else ""
        text = (
            f"📊 *Your weekly Suwappu summary*\n\n"
            f"Portfolio value: *{format_usd(total_usd)}* across {chain_count} chain(s).{top_str}\n\n"
            f"_Use /p for a full breakdown or /digest to turn off these summaries._"
        )

        # Telegram delivery (guarded: some WhatsApp-only users have no telegram_id)
        if telegram_id and self._bot:
            await safe_send(
                self._bot,
                telegram_id,
                text,
                category="weekly_digest",
                parse_mode="Markdown",
            )

        # WhatsApp delivery via pre-approved template (works outside 24h window)
        if whatsapp_id:
            try:
                from bot.services.whatsapp_service import whatsapp_service
                from bot.services.whatsapp_templates import template_service

                if whatsapp_service.is_configured():
                    # Compute a simple 24h change percentage for the template.
                    # We use 0% as a safe default when historical data isn't available.
                    change_pct = "0.00"
                    await template_service.send_daily_portfolio(
                        to=whatsapp_id,
                        total_value=f"{total_usd:.2f}",
                        change_pct=change_pct,
                    )
            except Exception as wa_exc:
                logger.warning(f"WhatsApp digest delivery failed for user {user_id}: {wa_exc}")

        # Mark digest as sent
        now = datetime.now(timezone.utc)
        with get_session() as session:
            user = session.query(User).filter(User.id == user_id).first()
            if user:
                user.last_digest_at = now
                session.commit()

        logger.info(f"Sent weekly digest to user {user_id} (tg={telegram_id}, wa={whatsapp_id})")


digest_service = DigestService()
