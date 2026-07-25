"""Gift card purchase handler — /gift command.

SCAFFOLD — NOT FUNCTIONAL.
Blocked on: BITREFILL_API_KEY env var + a live Bitrefill (or equivalent) merchant
account.  While the key is absent every entry point shows a "coming soon" message
and returns immediately.  No funds are moved, no orders are placed.

Money-path contract (enforced by the service layer):
  - Custodial balance is ONLY debited after bitrefill_client.create_order() returns
    AND order.status is in _CONFIRMED_ORDER_STATUSES ("payment_received" or
    "complete") — "pending"/"cancelled"/"refunded" orders are reported to the
    user with no balance change.
  - Any GiftCardUnavailableError or unexpected exception AFTER a successful debit
    triggers _refund_hold(), which restores the user's balance in full.
  - The status gate + debit + order creation happen in a single try/except block
    so a partial failure leaves the user no worse off.

MONEY-PATH: The purchase confirmation path (_gift_confirm_callback) is tagged here
for the money-path-reviewer Opus pass that must run before this scaffold is activated.

Conversation states:
  GIFT_BRAND    — user picks a brand from the inline catalogue
  GIFT_VALUE    — user picks a face value (or enters a custom amount)
  GIFT_CONFIRM  — user reviews and confirms the purchase
"""

import logging
from decimal import Decimal

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    CallbackQueryHandler,
    CommandHandler,
    ConversationHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

from bot.config.settings import settings
from bot.models.user import User
from bot.services.giftcard_api import (
    GiftCardUnavailableError,
    bitrefill_client,
    is_giftcard_enabled,
)
from bot.services.hot_wallet import hot_wallet_service
from database.db import get_session

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Conversation states
# ---------------------------------------------------------------------------
GIFT_BRAND, GIFT_VALUE, GIFT_CONFIRM = range(3)

# ---------------------------------------------------------------------------
# Provider order-status gate
# ---------------------------------------------------------------------------

# Only these order statuses represent a confirmed, paid/complete provider
# order.  Debit must never happen for "pending" (payment not yet settled on
# Bitrefill's side) or "cancelled"/"refunded" orders — those must be treated
# as "no funds moved" from the user's perspective.
_CONFIRMED_ORDER_STATUSES = {"payment_received", "complete"}

# ---------------------------------------------------------------------------
# UI constants
# ---------------------------------------------------------------------------

# Payment chain used for custodial-balance debit (USDC on Base is the default).
# When the Bitrefill integration is live, the handler will use Bitrefill's
# native invoice settlement (BTC/Lightning/USDC) and simply debit the equivalent
# from the user's custodial balance.
_PAYMENT_CHAIN = "base"
_PAYMENT_TOKEN = "USDC"

# Preset face values shown to the user (USD).
_PRESET_VALUES = [10, 25, 50, 100]

# Coming-soon message shown while the feature is disabled.
_COMING_SOON_MSG = (
    "Gift cards are coming soon.\n\n"
    "You will be able to buy Amazon, Google Play, Steam and 3,000+ other "
    "gift cards directly with crypto — right here in the bot."
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _feature_disabled_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        [[InlineKeyboardButton("« Back to Menu", callback_data="main_menu")]]
    )


def _cancel_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([[InlineKeyboardButton("Cancel", callback_data="gift_cancel")]])


def _get_db_user(telegram_id: int):
    """Return the User ORM object or None."""
    with get_session() as session:
        return session.query(User).filter(User.telegram_id == telegram_id).first()


async def _refund_hold(user_id: int, amount: Decimal, note: str) -> None:
    """Restore a custodial-balance hold after a failed purchase.

    MONEY-PATH: This must be called (and must not raise) whenever the Bitrefill
    order creation fails after a balance debit has been attempted, so the user
    is never left out of pocket.
    """
    try:
        hot_wallet_service.update_custodial_balance(
            user_id=user_id,
            chain=_PAYMENT_CHAIN,
            token_symbol=_PAYMENT_TOKEN,
            amount=amount,
            operation="add",
        )
        logger.info(
            "[giftcard] refunded %.2f %s to user_id=%s (%s)",
            amount,
            _PAYMENT_TOKEN,
            user_id,
            note,
        )
    except Exception as exc:
        # Log loudly — this is a money-path failure requiring manual review.
        logger.error(
            "[giftcard] REFUND FAILED for user_id=%s amount=%.2f: %s",
            user_id,
            amount,
            exc,
            exc_info=True,
        )


# ---------------------------------------------------------------------------
# Entry point — /gift command
# ---------------------------------------------------------------------------


async def gift_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle /gift — show catalogue or "coming soon" if disabled."""
    if not is_giftcard_enabled():
        await update.message.reply_text(
            _COMING_SOON_MSG,
            reply_markup=_feature_disabled_keyboard(),
        )
        return ConversationHandler.END

    # Feature is enabled — show brand picker.
    return await _show_brand_picker(update, context, edit=False)


# ---------------------------------------------------------------------------
# State: GIFT_BRAND — pick a brand
# ---------------------------------------------------------------------------


async def _show_brand_picker(
    update: Update, context: ContextTypes.DEFAULT_TYPE, *, edit: bool = True
) -> int:
    """Fetch top products and display them as inline buttons."""
    try:
        products = await bitrefill_client.list_products(country="US", limit=12)
    except GiftCardUnavailableError:
        text = _COMING_SOON_MSG
        markup = _feature_disabled_keyboard()
        if edit and update.callback_query:
            await update.callback_query.edit_message_text(text, reply_markup=markup)
        else:
            await update.effective_message.reply_text(text, reply_markup=markup)
        return ConversationHandler.END
    except Exception as exc:
        logger.warning("[giftcard] list_products error: %s", exc)
        text = "Could not load gift card catalogue right now. Please try again later."
        markup = _feature_disabled_keyboard()
        if edit and update.callback_query:
            await update.callback_query.edit_message_text(text, reply_markup=markup)
        else:
            await update.effective_message.reply_text(text, reply_markup=markup)
        return ConversationHandler.END

    # Build button rows (2 per row).
    buttons = [InlineKeyboardButton(p.name, callback_data=f"gift_brand_{p.id}") for p in products]
    rows = [buttons[i : i + 2] for i in range(0, len(buttons), 2)]
    rows.append([InlineKeyboardButton("Cancel", callback_data="gift_cancel")])

    text = "Select a gift card brand:"
    markup = InlineKeyboardMarkup(rows)

    if edit and update.callback_query:
        await update.callback_query.edit_message_text(text, reply_markup=markup)
    else:
        await update.effective_message.reply_text(text, reply_markup=markup)

    return GIFT_BRAND


async def gift_brand_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """User tapped a brand button."""
    query = update.callback_query
    await query.answer()

    # Extract product_id from callback data, e.g. "gift_brand_amazon-us" -> "amazon-us"
    product_id = query.data[len("gift_brand_") :]
    context.user_data["gift_product_id"] = product_id

    # Fetch product details to show denominations.
    try:
        product = await bitrefill_client.get_product(product_id)
    except GiftCardUnavailableError:
        await query.edit_message_text(_COMING_SOON_MSG, reply_markup=_feature_disabled_keyboard())
        return ConversationHandler.END
    except Exception as exc:
        logger.warning("[giftcard] get_product(%s) error: %s", product_id, exc)
        await query.edit_message_text(
            "Could not load product details. Please try again.",
            reply_markup=_cancel_keyboard(),
        )
        return GIFT_BRAND

    context.user_data["gift_product_name"] = product.name
    context.user_data["gift_currency"] = product.currency_code

    # Build value buttons from product denominations or presets.
    values = product.denominations or _PRESET_VALUES
    buttons = [InlineKeyboardButton(f"${v}", callback_data=f"gift_value_{v}") for v in values]
    rows = [buttons[i : i + 3] for i in range(0, len(buttons), 3)]
    rows.append([InlineKeyboardButton("« Back", callback_data="gift_back_brands")])
    rows.append([InlineKeyboardButton("Cancel", callback_data="gift_cancel")])

    await query.edit_message_text(
        f"Select a value for {product.name}:",
        reply_markup=InlineKeyboardMarkup(rows),
    )
    return GIFT_VALUE


# ---------------------------------------------------------------------------
# State: GIFT_VALUE — pick a face value
# ---------------------------------------------------------------------------


async def gift_value_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """User tapped a value button."""
    query = update.callback_query
    await query.answer()

    raw_value = query.data[len("gift_value_") :]
    try:
        value = float(raw_value)
    except ValueError:
        await query.answer("Invalid value — please try again.")
        return GIFT_VALUE

    context.user_data["gift_value"] = value

    product_name = context.user_data.get("gift_product_name", "Gift Card")
    currency = context.user_data.get("gift_currency", "USD")

    # Show confirmation screen.
    text = (
        f"Confirm Purchase\n\n"
        f"Brand:  {product_name}\n"
        f"Value:  {currency} {value:.2f}\n"
        f"Pay via: {_PAYMENT_TOKEN} on {_PAYMENT_CHAIN.capitalize()}\n\n"
        "Your custodial balance will be debited only after the provider confirms "
        "the order. If the order fails, your balance will be refunded automatically."
    )
    keyboard = InlineKeyboardMarkup(
        [
            [InlineKeyboardButton("Confirm & Buy", callback_data="gift_confirm")],
            [InlineKeyboardButton("« Back", callback_data="gift_back_values")],
            [InlineKeyboardButton("Cancel", callback_data="gift_cancel")],
        ]
    )
    await query.edit_message_text(text, reply_markup=keyboard)
    return GIFT_CONFIRM


# ---------------------------------------------------------------------------
# State: GIFT_CONFIRM — execute purchase
# ---------------------------------------------------------------------------


async def gift_confirm_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """User confirmed the purchase.

    MONEY-PATH: This callback is the only place real funds move.
    Debit only occurs AFTER the provider returns an order AND that order's
    status is a confirmed paid/complete state (_CONFIRMED_ORDER_STATUSES) —
    never for "pending" or "cancelled"/"refunded" orders.  Order creation and
    the debit are coupled inside the same try/except: if the debit itself
    raises after a confirmed order was created, the exception handler below
    calls _refund_hold() — but since `debited` is only set True once the
    debit call returns successfully, that reconciliation path is a no-op
    safety net, not the primary correctness guarantee. The primary guarantee
    is ordering: no debit is even attempted unless order.status is confirmed.
    Any exception AFTER a successful debit triggers _refund_hold() so the
    user is never charged without a confirmed order in hand.

    This path is currently unreachable because is_giftcard_enabled() returns
    False (no BITREFILL_API_KEY).  The structure is correct for when
    credentials are available — a money-path-reviewer Opus pass is required
    before activation.
    """
    query = update.callback_query
    await query.answer()

    user = update.effective_user
    db_user = _get_db_user(user.id)
    if not db_user:
        await query.edit_message_text("Please use /start first to register.")
        return ConversationHandler.END

    product_id = context.user_data.get("gift_product_id")
    value = context.user_data.get("gift_value")
    product_name = context.user_data.get("gift_product_name", "Gift Card")

    if not product_id or value is None:
        await query.edit_message_text(
            "Session expired. Please start again with /gift.",
            reply_markup=_feature_disabled_keyboard(),
        )
        return ConversationHandler.END

    amount_decimal = Decimal(str(value))

    # --- Step 1: verify sufficient custodial balance (no debit yet) ---
    balance = hot_wallet_service.get_custodial_balance(
        user_id=db_user.id,
        chain=_PAYMENT_CHAIN,
        token_symbol=_PAYMENT_TOKEN,
    )
    if balance < amount_decimal:
        await query.edit_message_text(
            f"Insufficient balance.\n"
            f"Required: {_PAYMENT_TOKEN} {amount_decimal:.2f}\n"
            f"Available: {_PAYMENT_TOKEN} {balance:.2f}\n\n"
            "Top up your custodial balance and try again.",
            reply_markup=_cancel_keyboard(),
        )
        return ConversationHandler.END

    await query.edit_message_text("Placing order with provider...")

    # --- Step 2: create provider order (no balance change yet) ---
    debited = False
    try:
        order = await bitrefill_client.create_order(
            product_id=product_id,
            value=value,
            payment_method="usdc",
        )

        # --- Step 3: gate the debit on a CONFIRMED order status ---
        # FIX P1/P2: create_order() returning without raising is NOT itself
        # proof of a paid/complete order — Bitrefill can return status
        # "pending" (payment not yet settled) or "cancelled"/"refunded".
        # Debiting on any successful return (the previous behaviour) could
        # charge the user for an order that was never actually paid/fulfilled
        # by the provider.  Only debit for statuses in
        # _CONFIRMED_ORDER_STATUSES; anything else is treated as "no funds
        # moved" and reported to the user without touching their balance.
        if order.status not in _CONFIRMED_ORDER_STATUSES:
            logger.warning(
                "[giftcard] order_id=%s user_id=%s returned unconfirmed status=%s — "
                "no debit applied",
                order.order_id,
                db_user.id,
                order.status,
            )
            await query.edit_message_text(
                f"Order could not be confirmed by the provider (status: {order.status}). "
                "No funds were taken. Please try again or contact support with "
                f"order ID `{order.order_id}`.",
                parse_mode="Markdown",
                reply_markup=_cancel_keyboard(),
            )
            context.user_data.clear()
            return ConversationHandler.END

        # --- Step 4: debit only after provider confirms the order ---
        # MONEY-PATH: debit happens here, after a confirmed order object is in hand.
        hot_wallet_service.update_custodial_balance(
            user_id=db_user.id,
            chain=_PAYMENT_CHAIN,
            token_symbol=_PAYMENT_TOKEN,
            amount=amount_decimal,
            operation="subtract",
        )
        debited = True

        logger.info(
            "[giftcard] order created: order_id=%s user_id=%s product=%s value=%.2f status=%s",
            order.order_id,
            db_user.id,
            product_id,
            value,
            order.status,
        )

    except GiftCardUnavailableError as exc:
        logger.warning("[giftcard] provider unavailable for user_id=%s: %s", db_user.id, exc)
        if debited:
            await _refund_hold(db_user.id, amount_decimal, "provider_unavailable")
        await query.edit_message_text(
            "Gift card service is temporarily unavailable. No funds were taken. "
            "Please try again later.",
            reply_markup=_cancel_keyboard(),
        )
        return ConversationHandler.END

    except Exception as exc:
        logger.error(
            "[giftcard] unexpected error for user_id=%s: %s", db_user.id, exc, exc_info=True
        )
        if debited:
            await _refund_hold(db_user.id, amount_decimal, "unexpected_error")
        await query.edit_message_text(
            "Something went wrong placing your order. "
            "If any funds were taken they will be refunded automatically. "
            "Please contact support if you do not see your balance restored.",
            reply_markup=_cancel_keyboard(),
        )
        return ConversationHandler.END

    # --- Step 5: show result ---
    if order.redemption_code:
        # Immediate fulfillment (rare; most cards are async).
        text = (
            f"{product_name} — {_PAYMENT_TOKEN} {amount_decimal:.2f} debited.\n\n"
            f"Your redemption code:\n"
            f"`{order.redemption_code}`\n\n"
            f"Order ID: `{order.order_id}`"
        )
    else:
        # Async fulfillment — code arrives once the order is complete.
        text = (
            f"Order placed for {product_name} (${value:.2f}).\n\n"
            f"Order ID: `{order.order_id}`\n"
            f"Status: {order.status}\n\n"
            "Your redemption code will be delivered once the order is processed. "
            "You will receive a notification here."
        )

    await query.edit_message_text(text, parse_mode="Markdown")
    context.user_data.clear()
    return ConversationHandler.END


# ---------------------------------------------------------------------------
# Navigation / cancel callbacks
# ---------------------------------------------------------------------------


async def gift_cancel_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Cancel the conversation."""
    query = update.callback_query
    await query.answer()
    context.user_data.clear()
    await query.edit_message_text("Gift card purchase cancelled. Use /gift to start again.")
    return ConversationHandler.END


async def gift_back_brands_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Navigate back to the brand picker."""
    query = update.callback_query
    await query.answer()
    return await _show_brand_picker(update, context, edit=True)


async def gift_back_values_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Navigate back to the value picker (re-fetch product)."""
    query = update.callback_query
    await query.answer()

    product_id = context.user_data.get("gift_product_id", "")
    # Reuse brand callback logic by spoofing the callback data.
    # Simpler than duplicating the product-fetch logic.
    query.data = f"gift_brand_{product_id}"
    return await gift_brand_callback(update, context)


# ---------------------------------------------------------------------------
# Handler objects — registered in bot/main.py (see snippet in report)
# ---------------------------------------------------------------------------

gift_handler = CommandHandler("gift", gift_command)

gift_conversation = ConversationHandler(
    name="giftcard",
    persistent=False,  # Set True once a PicklePersistence is wired for this conversation.
    entry_points=[
        CommandHandler("gift", gift_command),
    ],
    states={
        GIFT_BRAND: [
            CallbackQueryHandler(gift_brand_callback, pattern=r"^gift_brand_"),
            CallbackQueryHandler(gift_back_brands_callback, pattern="^gift_back_brands$"),
        ],
        GIFT_VALUE: [
            CallbackQueryHandler(gift_value_callback, pattern=r"^gift_value_"),
            CallbackQueryHandler(gift_back_values_callback, pattern="^gift_back_values$"),
        ],
        GIFT_CONFIRM: [
            CallbackQueryHandler(gift_confirm_callback, pattern="^gift_confirm$"),
            CallbackQueryHandler(gift_back_values_callback, pattern="^gift_back_values$"),
        ],
    },
    fallbacks=[
        CallbackQueryHandler(gift_cancel_callback, pattern="^gift_cancel$"),
        CommandHandler("gift", gift_command),
    ],
    per_message=False,
    allow_reentry=True,
)
