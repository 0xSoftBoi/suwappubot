"""Airdrop campaign handler — /airdrop command.

Community group owners/admins create token-drop campaigns.  Members claim
via an inline "Claim" button that is safe to post in the group.

MONEY-PATH security contract (enforced here and in the service layer)
----------------------------------------------------------------------
1. Wallet/balance lookups are ALWAYS bound to update.effective_user.id
   (the authenticated Telegram user), never to an id extracted from
   callback_data.  Campaign IDs come from callback data; the claimer
   identity never does.

2. Double-claim protection has two layers:
   a. AlreadyClaimedError raised from the service pre-check before any DB
      write is attempted.
   b. UNIQUE(campaign_id, claimer_id) constraint — even if two concurrent
      requests slip past the pre-check, only one INSERT will succeed; the
      other gets IntegrityError → AlreadyClaimedError.

3. Over-draw protection: the service acquires SELECT FOR UPDATE on the
   campaign row before decrementing remaining_amount, so concurrent claims
   are serialised at the DB row level.

4. Admin/creator-only operations (create, cancel) verify identity before
   touching any funds.
"""

import logging
from datetime import datetime, timezone, timedelta
from decimal import Decimal, InvalidOperation

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
    ConversationHandler,
    MessageHandler,
    filters,
)

from bot.models.user import User
from bot.services.airdrop_campaign_service import (
    airdrop_campaign_service,
    AlreadyClaimedError,
    CampaignExhaustedError,
    CampaignNotActiveError,
    InsufficientFundsError,
)
from bot.utils.formatters import format_amount
from bot.utils.tos_utils import enforce_tos
from database.db import get_session

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Conversation states
# ---------------------------------------------------------------------------
(
    AD_TOKEN,
    AD_CHAIN,
    AD_TOTAL,
    AD_SPLIT,
    AD_EXPIRY,
    AD_CONFIRM,
) = range(6)

_CANCEL_KB = InlineKeyboardMarkup(
    [[InlineKeyboardButton("Cancel", callback_data="airdrop_cancel")]]
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_SUPPORTED_CHAINS = ["ethereum", "base", "polygon", "bsc", "arbitrum", "optimism", "solana"]


def _resolve_db_user(telegram_id: int) -> tuple[int, str] | tuple[None, None]:
    """Return (db_user.id, username) or (None, None) if not registered."""
    with get_session() as session:
        user = session.query(User).filter(User.telegram_id == telegram_id).first()
        if not user:
            return None, None
        return user.id, user.username or ""


def _parse_expiry(text: str) -> datetime | None:
    """Parse a human-readable expiry like '2h', '1d', '30m' or 'none'."""
    text = text.strip().lower()
    if text in ("none", "no", "never", "-"):
        return None
    try:
        if text.endswith("m"):
            return datetime.now(timezone.utc) + timedelta(minutes=int(text[:-1]))
        if text.endswith("h"):
            return datetime.now(timezone.utc) + timedelta(hours=int(text[:-1]))
        if text.endswith("d"):
            return datetime.now(timezone.utc) + timedelta(days=int(text[:-1]))
    except (ValueError, OverflowError):
        pass
    return False  # sentinel for "could not parse"


def _campaign_summary(info) -> str:
    """Return a Markdown summary of a CampaignInfo."""
    per = (
        f"{format_amount(float(info.per_user_amount), symbol=info.token)}"
        if info.per_user_amount
        else "variable"
    )
    expiry = info.expires_at.strftime("%Y-%m-%d %H:%M UTC") if info.expires_at else "no expiry"
    criteria = info.criteria or {}
    max_c = criteria.get("max_claimants", "unlimited")
    return (
        f"*Airdrop #{info.id}*\n"
        f"Token: {info.token} on {info.chain}\n"
        f"Pool: {format_amount(float(info.total_amount), symbol=info.token)}\n"
        f"Per user: {per}\n"
        f"Max claimants: {max_c}\n"
        f"Claimed so far: {info.claim_count}\n"
        f"Remaining: {format_amount(float(info.remaining_amount), symbol=info.token)}\n"
        f"Status: {info.status}\n"
        f"Expires: {expiry}"
    )


async def _is_chat_admin(update: Update, context: ContextTypes.DEFAULT_TYPE) -> bool:
    """Return True if effective_user is an admin/creator of the current chat."""
    chat = update.effective_chat
    user = update.effective_user
    if not chat or not user:
        return False
    # DM context: creator implicitly owns the campaign
    if chat.type == "private":
        return True
    try:
        member = await context.bot.get_chat_member(chat.id, user.id)
        return member.status in ("creator", "administrator")
    except Exception:
        return False


# ---------------------------------------------------------------------------
# /airdrop entry point
# ---------------------------------------------------------------------------


@enforce_tos
async def airdrop_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle /airdrop — show overview or start creation wizard."""
    user = update.effective_user
    db_id, _ = _resolve_db_user(user.id)
    if not db_id:
        await update.message.reply_text("Please use /start first to register.")
        return ConversationHandler.END

    chat_id = str(update.effective_chat.id)
    is_admin = await _is_chat_admin(update, context)

    active = airdrop_campaign_service.get_active_campaigns_for_chat(chat_id)

    lines = ["*Airdrop Campaigns*\n"]

    if active:
        for info in active:
            lines.append(_campaign_summary(info))
            lines.append("")
    else:
        lines.append("_No active airdrops in this chat._\n")

    keyboard = []
    if is_admin:
        keyboard.append([InlineKeyboardButton("Create Airdrop", callback_data="airdrop_create")])
    if active:
        keyboard.append(
            [
                InlineKeyboardButton(
                    f"Claim from #{active[0].id}", callback_data=f"airdrop_claim_{active[0].id}"
                )
            ]
        )
    keyboard.append([InlineKeyboardButton("My Campaigns", callback_data="airdrop_mine")])

    await update.message.reply_text(
        "\n".join(lines),
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard) if keyboard else None,
    )
    return ConversationHandler.END


# ---------------------------------------------------------------------------
# Creation wizard
# ---------------------------------------------------------------------------


async def airdrop_create_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Entry point for campaign creation (button or inline)."""
    query = update.callback_query
    if query:
        await query.answer()

    is_admin = await _is_chat_admin(update, context)
    if not is_admin:
        msg = "Only group admins can create airdrop campaigns."
        if query:
            await query.answer(msg, show_alert=True)
        else:
            await update.effective_message.reply_text(msg)
        return ConversationHandler.END

    user = update.effective_user
    db_id, _ = _resolve_db_user(user.id)
    if not db_id:
        await update.effective_message.reply_text("Please use /start first.")
        return ConversationHandler.END

    context.user_data["airdrop"] = {"creator_db_id": db_id}

    await update.effective_message.reply_text(
        "*Create Airdrop — Step 1/5*\n\nWhich token do you want to airdrop?\n"
        "Enter the token symbol (e.g. USDC, ETH):",
        parse_mode="Markdown",
        reply_markup=_CANCEL_KB,
    )
    return AD_TOKEN


async def airdrop_enter_token(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    token = update.message.text.strip().upper()
    if not token or len(token) > 20:
        await update.message.reply_text("Invalid token symbol. Try again:", reply_markup=_CANCEL_KB)
        return AD_TOKEN

    context.user_data["airdrop"]["token"] = token
    chain_buttons = [
        [InlineKeyboardButton(c.title(), callback_data=f"airdrop_chain_{c}")]
        for c in _SUPPORTED_CHAINS
    ]
    chain_buttons.append([InlineKeyboardButton("Cancel", callback_data="airdrop_cancel")])

    await update.message.reply_text(
        "*Step 2/5* — Select the chain:",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(chain_buttons),
    )
    return AD_CHAIN


async def airdrop_select_chain(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()

    chain = query.data.replace("airdrop_chain_", "")
    if chain not in _SUPPORTED_CHAINS:
        await query.edit_message_text("Unsupported chain. Please /airdrop again.")
        return ConversationHandler.END

    context.user_data["airdrop"]["chain"] = chain
    await query.edit_message_text(
        f"*Step 3/5* — Total pool size\n\nHow many {context.user_data['airdrop']['token']} "
        f"do you want to put into the airdrop pool?",
        parse_mode="Markdown",
        reply_markup=_CANCEL_KB,
    )
    return AD_TOTAL


async def airdrop_enter_total(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    text = update.message.text.strip()
    try:
        total = Decimal(text)
    except InvalidOperation:
        await update.message.reply_text("Invalid amount. Enter a number:", reply_markup=_CANCEL_KB)
        return AD_TOTAL

    if total <= Decimal("0"):
        await update.message.reply_text("Amount must be > 0:", reply_markup=_CANCEL_KB)
        return AD_TOTAL

    context.user_data["airdrop"]["total_amount"] = str(total)

    await update.message.reply_text(
        "*Step 4/5* — How to split?\n\n"
        "Reply with one of:\n"
        "• `fixed 0.5` — each claimer gets exactly 0.5 tokens\n"
        "• `split 100` — split evenly among the first 100 claimants\n"
        "• `unlimited 0.5` — fixed amount, no cap on claimants",
        parse_mode="Markdown",
        reply_markup=_CANCEL_KB,
    )
    return AD_SPLIT


async def airdrop_enter_split(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    text = update.message.text.strip().lower()
    parts = text.split()

    ad = context.user_data.get("airdrop", {})
    total = Decimal(ad.get("total_amount", "0"))
    token = ad.get("token", "")

    per_user_amount: Decimal | None = None
    max_claimants: int | None = None

    error = None
    try:
        if parts[0] in ("fixed", "unlimited") and len(parts) == 2:
            per_user_amount = Decimal(parts[1])
            if per_user_amount <= Decimal("0"):
                error = "Per-user amount must be > 0."
            elif per_user_amount > total:
                error = "Per-user amount exceeds total pool."
            # unlimited: no cap
        elif parts[0] == "split" and len(parts) == 2:
            max_claimants = int(parts[1])
            if max_claimants < 1:
                error = "Number of claimants must be >= 1."
            per_user_amount = (total / Decimal(max_claimants)).quantize(Decimal("0.000001"))
        else:
            error = "Unrecognised format. Use: fixed <amount>, split <n>, or unlimited <amount>."
    except (InvalidOperation, ValueError, IndexError):
        error = "Could not parse. Try: `fixed 0.5` or `split 100`."

    if error:
        await update.message.reply_text(error, reply_markup=_CANCEL_KB)
        return AD_SPLIT

    ad["per_user_amount"] = str(per_user_amount)
    ad["max_claimants"] = max_claimants
    context.user_data["airdrop"] = ad

    await update.message.reply_text(
        "*Step 5/5* — Expiry\n\n"
        "When should this airdrop expire? Examples:\n"
        "• `24h` — 24 hours from now\n"
        "• `7d` — 7 days\n"
        "• `none` — no expiry",
        parse_mode="Markdown",
        reply_markup=_CANCEL_KB,
    )
    return AD_EXPIRY


async def airdrop_enter_expiry(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    text = update.message.text.strip()
    result = _parse_expiry(text)

    if result is False:
        await update.message.reply_text(
            "Could not parse expiry. Use '24h', '7d', '30m', or 'none':",
            reply_markup=_CANCEL_KB,
        )
        return AD_EXPIRY

    ad = context.user_data.get("airdrop", {})
    ad["expires_at"] = result.isoformat() if result else None
    context.user_data["airdrop"] = ad

    token = ad.get("token", "")
    chain = ad.get("chain", "")
    total = Decimal(ad.get("total_amount", "0"))
    per_user = Decimal(ad.get("per_user_amount", "0"))
    max_c = ad.get("max_claimants")
    expiry_str = result.strftime("%Y-%m-%d %H:%M UTC") if result else "no expiry"

    summary = (
        f"*Confirm Airdrop*\n\n"
        f"Token: {token} on {chain}\n"
        f"Pool: {format_amount(float(total), symbol=token)}\n"
        f"Per user: {format_amount(float(per_user), symbol=token)}\n"
        f"Max claimants: {max_c if max_c else 'unlimited'}\n"
        f"Expires: {expiry_str}\n\n"
        f"Your custodial balance will be debited {format_amount(float(total), symbol=token)} now."
    )

    keyboard = InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton("Confirm", callback_data="airdrop_confirm"),
                InlineKeyboardButton("Cancel", callback_data="airdrop_cancel"),
            ]
        ]
    )

    await update.message.reply_text(summary, parse_mode="Markdown", reply_markup=keyboard)
    return AD_CONFIRM


async def airdrop_confirm(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Execute campaign creation after user confirms."""
    query = update.callback_query
    await query.answer()

    # Re-verify identity from the live Telegram user — not from callback data
    user = update.effective_user
    db_id, _ = _resolve_db_user(user.id)
    if not db_id:
        await query.edit_message_text("Session expired. Please /start again.")
        return ConversationHandler.END

    ad = context.user_data.get("airdrop", {})
    if ad.get("creator_db_id") != db_id:
        await query.edit_message_text("Session mismatch. Please /airdrop again.")
        return ConversationHandler.END

    is_admin = await _is_chat_admin(update, context)
    if not is_admin:
        await query.edit_message_text("Only group admins can create campaigns.")
        return ConversationHandler.END

    try:
        expires_iso = ad.get("expires_at")
        expires_at = (
            datetime.fromisoformat(expires_iso).replace(tzinfo=timezone.utc)
            if expires_iso
            else None
        )

        info = airdrop_campaign_service.create_campaign(
            creator_db_id=db_id,
            chat_id=str(update.effective_chat.id),
            token=ad["token"],
            chain=ad["chain"],
            total_amount=Decimal(ad["total_amount"]),
            per_user_amount=Decimal(ad["per_user_amount"]),
            max_claimants=ad.get("max_claimants"),
            expires_at=expires_at,
        )
    except InsufficientFundsError as exc:
        await query.edit_message_text(f"Insufficient balance: {exc}")
        return ConversationHandler.END
    except ValueError as exc:
        await query.edit_message_text(f"Validation error: {exc}")
        return ConversationHandler.END
    except Exception as exc:
        logger.exception("Campaign creation failed: %s", exc)
        await query.edit_message_text("Campaign creation failed. Please try again.")
        return ConversationHandler.END
    finally:
        context.user_data.pop("airdrop", None)

    # Post public Claim button in the chat
    keyboard = InlineKeyboardMarkup(
        [[InlineKeyboardButton("Claim Airdrop", callback_data=f"airdrop_claim_{info.id}")]]
    )
    await query.edit_message_text(
        f"Airdrop #{info.id} created!\n\n{_campaign_summary(info)}\n\n"
        f"Share the Claim button below with your community.",
        parse_mode="Markdown",
        reply_markup=keyboard,
    )
    return ConversationHandler.END


async def airdrop_cancel(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Cancel the creation wizard."""
    context.user_data.pop("airdrop", None)
    query = update.callback_query
    if query:
        await query.answer("Cancelled.")
        await query.edit_message_text("Airdrop creation cancelled.")
    else:
        await update.effective_message.reply_text("Airdrop creation cancelled.")
    return ConversationHandler.END


# ---------------------------------------------------------------------------
# Claim callback
# ---------------------------------------------------------------------------


async def airdrop_claim_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle the public 'Claim Airdrop' inline button.

    MONEY-PATH: claimer identity is taken EXCLUSIVELY from update.effective_user.id
    (Telegram-authenticated), never from the callback data payload.
    """
    query = update.callback_query
    await query.answer()

    # Resolve claimer from authenticated Telegram user — never from callback data
    telegram_user = update.effective_user
    claimer_db_id, _ = _resolve_db_user(telegram_user.id)
    if not claimer_db_id:
        await query.answer("You must /start the bot in a private chat first.", show_alert=True)
        return

    # Extract campaign id from callback data safely
    try:
        campaign_id = int(query.data.replace("airdrop_claim_", ""))
    except (ValueError, AttributeError):
        await query.answer("Invalid campaign reference.", show_alert=True)
        return

    try:
        amount = airdrop_campaign_service.claim_for_user(
            campaign_id=campaign_id,
            claimer_db_id=claimer_db_id,
        )
    except AlreadyClaimedError:
        await query.answer("You have already claimed from this airdrop.", show_alert=True)
        return
    except CampaignExhaustedError:
        await query.answer("This airdrop is fully claimed — no tokens remain.", show_alert=True)
        return
    except CampaignNotActiveError as exc:
        await query.answer(f"Airdrop not available: {exc}", show_alert=True)
        return
    except Exception as exc:
        logger.exception(
            "Claim failed for campaign %d user %d: %s", campaign_id, claimer_db_id, exc
        )
        await query.answer("Claim failed. Please try again.", show_alert=True)
        return

    info = airdrop_campaign_service.get_campaign(campaign_id)
    await query.answer(
        f"Claimed! {format_amount(float(amount))} added to your custodial balance.",
        show_alert=True,
    )

    # Update the inline message with fresh stats so the group sees live progress
    if info:
        try:
            keyboard = None
            if info.status == "active":
                keyboard = InlineKeyboardMarkup(
                    [
                        [
                            InlineKeyboardButton(
                                "Claim Airdrop", callback_data=f"airdrop_claim_{info.id}"
                            )
                        ]
                    ]
                )
            await query.edit_message_text(
                _campaign_summary(info),
                parse_mode="Markdown",
                reply_markup=keyboard,
            )
        except Exception:
            pass  # Best-effort update; the claim itself already succeeded


# ---------------------------------------------------------------------------
# My campaigns / cancel campaign callbacks
# ---------------------------------------------------------------------------


async def airdrop_mine_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Show the requesting user's own campaigns."""
    query = update.callback_query
    await query.answer()

    user = update.effective_user
    db_id, _ = _resolve_db_user(user.id)
    if not db_id:
        await query.edit_message_text("Please /start first.")
        return

    campaigns = airdrop_campaign_service.get_user_campaigns(db_id)
    if not campaigns:
        await query.edit_message_text("You have no airdrop campaigns yet.")
        return

    lines = ["*Your Airdrop Campaigns*\n"]
    keyboard_rows = []
    for info in campaigns[:10]:
        lines.append(_campaign_summary(info))
        lines.append("")
        if info.status == "active":
            keyboard_rows.append(
                [
                    InlineKeyboardButton(
                        f"Cancel #{info.id}", callback_data=f"airdrop_cancel_campaign_{info.id}"
                    )
                ]
            )

    keyboard_rows.append([InlineKeyboardButton("Close", callback_data="noop")])

    await query.edit_message_text(
        "\n".join(lines),
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard_rows),
    )


async def airdrop_cancel_campaign_callback(
    update: Update, context: ContextTypes.DEFAULT_TYPE
) -> None:
    """Cancel an active campaign and refund remaining balance to creator.

    MONEY-PATH: canceller identity is taken from update.effective_user.id.
    The service layer independently checks campaign.creator_id == requestor_db_id.
    """
    query = update.callback_query
    await query.answer()

    user = update.effective_user
    db_id, _ = _resolve_db_user(user.id)
    if not db_id:
        await query.edit_message_text("Please /start first.")
        return

    try:
        campaign_id = int(query.data.replace("airdrop_cancel_campaign_", ""))
    except (ValueError, AttributeError):
        await query.edit_message_text("Invalid campaign reference.")
        return

    try:
        refund = airdrop_campaign_service.cancel_campaign(
            campaign_id=campaign_id,
            requestor_db_id=db_id,
        )
    except PermissionError:
        await query.answer("Only the campaign creator can cancel it.", show_alert=True)
        return
    except CampaignNotActiveError as exc:
        await query.answer(str(exc), show_alert=True)
        return
    except Exception as exc:
        logger.exception("Cancel campaign %d failed: %s", campaign_id, exc)
        await query.edit_message_text("Cancellation failed. Please try again.")
        return

    await query.edit_message_text(
        f"Campaign #{campaign_id} cancelled.\n"
        f"Refunded {format_amount(float(refund))} to your custodial balance."
    )


# ---------------------------------------------------------------------------
# Handler objects for registration in bot/main.py
# ---------------------------------------------------------------------------

airdrop_conversation = ConversationHandler(
    name="airdrop_creation",
    persistent=True,
    entry_points=[
        CommandHandler("airdrop", airdrop_command),
        CallbackQueryHandler(airdrop_create_start, pattern="^airdrop_create$"),
    ],
    states={
        AD_TOKEN: [MessageHandler(filters.TEXT & ~filters.COMMAND, airdrop_enter_token)],
        AD_CHAIN: [CallbackQueryHandler(airdrop_select_chain, pattern="^airdrop_chain_")],
        AD_TOTAL: [MessageHandler(filters.TEXT & ~filters.COMMAND, airdrop_enter_total)],
        AD_SPLIT: [MessageHandler(filters.TEXT & ~filters.COMMAND, airdrop_enter_split)],
        AD_EXPIRY: [MessageHandler(filters.TEXT & ~filters.COMMAND, airdrop_enter_expiry)],
        AD_CONFIRM: [
            CallbackQueryHandler(airdrop_confirm, pattern="^airdrop_confirm$"),
            CallbackQueryHandler(airdrop_cancel, pattern="^airdrop_cancel$"),
        ],
    },
    fallbacks=[
        CommandHandler("cancel", airdrop_cancel),
        CallbackQueryHandler(airdrop_cancel, pattern="^airdrop_cancel$"),
    ],
    per_message=False,
    per_chat=True,
)

airdrop_claim_handler = CallbackQueryHandler(airdrop_claim_callback, pattern="^airdrop_claim_")
airdrop_mine_handler = CallbackQueryHandler(airdrop_mine_callback, pattern="^airdrop_mine$")
airdrop_cancel_campaign_handler = CallbackQueryHandler(
    airdrop_cancel_campaign_callback, pattern="^airdrop_cancel_campaign_"
)

__all__ = [
    "airdrop_conversation",
    "airdrop_claim_handler",
    "airdrop_mine_handler",
    "airdrop_cancel_campaign_handler",
]
