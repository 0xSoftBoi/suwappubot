"""Telegram Stars payment service for subscription upgrades."""

import logging
from datetime import datetime
from telegram import Bot, LabeledPrice, Update
from telegram.ext import ContextTypes

from bot.models.subscription import SubscriptionTier, X402Payment, PaymentStatus
from bot.services.x402_service import x402_service
from database.db import get_session

logger = logging.getLogger(__name__)

# Stars pricing per tier per month
STARS_PRICES = {
    SubscriptionTier.PRO: 500,
    SubscriptionTier.PREMIUM: 1500,
}


class StarsService:
    """Service for handling Telegram Stars payments."""

    async def create_stars_invoice(
        self, bot: Bot, chat_id: int, tier: SubscriptionTier, duration_months: int = 1
    ):
        """Generate and send a Telegram Stars invoice."""
        if tier not in STARS_PRICES:
            raise ValueError(f"Stars payment not available for tier: {tier}")

        stars_amount = STARS_PRICES[tier] * duration_months
        title = f"Suwappu {tier.value.upper()} Subscription"
        description = f"{tier.value.upper()} plan - {duration_months} month(s)"

        prices = [LabeledPrice(label=title, amount=stars_amount)]

        await bot.send_invoice(
            chat_id=chat_id,
            title=title,
            description=description,
            payload=f"sub_{tier.value}_{duration_months}m_{chat_id}",
            provider_token="",  # Empty string for Telegram Stars
            currency="XTR",  # Telegram Stars currency code
            prices=prices,
        )

    async def handle_pre_checkout(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Validate pre-checkout query. Must respond within 10 seconds."""
        query = update.pre_checkout_query
        await query.answer(ok=True)

    async def handle_successful_payment(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Process successful Stars payment and upgrade subscription."""
        payment = update.message.successful_payment
        payload = payment.invoice_payload

        # Parse payload: sub_pro_1m_12345
        parts = payload.split("_")
        if len(parts) < 4 or parts[0] != "sub":
            logger.error(f"Invalid payment payload: {payload}")
            return

        tier_name = parts[1]
        duration_str = parts[2]  # "1m"
        user_telegram_id = int(parts[3])

        tier = SubscriptionTier(tier_name)
        duration_months = int(duration_str.replace("m", ""))

        # Record payment in database
        self._record_stars_payment(
            user_telegram_id=user_telegram_id,
            stars_amount=payment.total_amount,
            tier=tier,
            telegram_payment_id=payment.telegram_payment_charge_id,
        )

        # Get internal user ID for subscription upgrade
        with get_session() as session:
            from bot.models.user import User
            user = session.query(User).filter_by(telegram_id=user_telegram_id).first()
            if not user:
                logger.error(f"User not found for telegram_id: {user_telegram_id}")
                await update.message.reply_text("Payment received but user not found. Please contact support.")
                return
            user_id = user.id

        # Upgrade subscription
        await x402_service.upgrade_subscription(
            user_id, tier, duration_days=30 * duration_months
        )

        await update.message.reply_text(
            f"Payment successful! You're now on the {tier.value.upper()} plan.\n\n"
            f"Enjoy your premium features! Use /sub to check your status."
        )

    def _record_stars_payment(
        self,
        user_telegram_id: int,
        stars_amount: int,
        tier: SubscriptionTier,
        telegram_payment_id: str,
    ):
        """Record Stars payment in database."""
        with get_session() as session:
            from bot.models.user import User
            user = session.query(User).filter_by(telegram_id=user_telegram_id).first()
            if not user:
                logger.error(f"User not found for telegram_id: {user_telegram_id}")
                return

            payment = X402Payment(
                user_id=user.id,
                payment_id=telegram_payment_id,
                amount=0,  # Stars payment, not USD
                payment_method="telegram_stars",
                stars_amount=stars_amount,
                product_type=f"subscription_{tier.value}",
                status=PaymentStatus.COMPLETED,
                completed_at=datetime.utcnow(),
            )
            session.add(payment)

    def get_stars_prices(self):
        """Return tier pricing in Stars."""
        return {tier.value: amount for tier, amount in STARS_PRICES.items()}


stars_service = StarsService()
