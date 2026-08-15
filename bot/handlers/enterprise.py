"""Enterprise org management handler — /org command.

Available to enterprise-tier users only. Lets them view their org overview,
list team members, list API keys, and create new API keys.
"""

import logging
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, ForceReply
from telegram.ext import (
    ContextTypes,
    CommandHandler,
    CallbackQueryHandler,
    ConversationHandler,
    MessageHandler,
    filters,
)

from bot.models.subscription import SubscriptionTier
from bot.services.x402_service import x402_service
from bot.services.api_client import api_client, APIClientError

logger = logging.getLogger(__name__)

# Conversation state
AWAITING_KEY_NAME = 0

DEFAULT_KEY_SCOPES = ["trade:read", "portfolio:read"]

_ORG_URL = "app.suwappu.bot/enterprise"
_PRICING_URL = "suwappu.bot/pricing"


def _org_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton("👥 Team", callback_data="org_members"),
                InlineKeyboardButton("🔑 API Keys", callback_data="org_keys"),
            ],
            [
                InlineKeyboardButton("➕ New Key", callback_data="org_newkey"),
                InlineKeyboardButton("❌ Close", callback_data="org_cancel"),
            ],
        ]
    )


async def org_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /org command — show org overview."""
    user = update.effective_user
    if not user:
        return

    tier = await x402_service.get_tier(user.id)

    if tier != SubscriptionTier.ENTERPRISE:
        await update.message.reply_text(
            "This command is for Enterprise subscribers.\n" f"Upgrade at {_PRICING_URL}",
            disable_web_page_preview=True,
        )
        return

    try:
        org = await api_client.get_my_org(user.id)
    except APIClientError as e:
        logger.error(f"[Enterprise] get_my_org failed for {user.id}: {e}")
        await update.message.reply_text("Failed to fetch org data. Please try again later.")
        return

    if not org:
        await update.message.reply_text(
            "You don't have an enterprise organization yet.\n" f"Visit {_ORG_URL} to set one up.",
            disable_web_page_preview=True,
        )
        return

    context.user_data["org_id"] = org.get("id", "")
    text = _format_org_overview(org)
    await update.message.reply_text(
        text,
        parse_mode="Markdown",
        reply_markup=_org_keyboard(),
    )


def _format_org_overview(org: dict) -> str:
    name = org.get("name", "Unknown")
    seats_used = org.get("seatsUsed", org.get("seats_used", "?"))
    seats_total = org.get("seatsTotal", org.get("seats_total", "?"))
    active_keys = org.get("activeApiKeys", org.get("active_api_keys", "?"))
    plan = org.get("plan", "Enterprise").upper()

    return (
        f"*{name}*\n"
        f"Plan: {plan}\n"
        f"Seats: {seats_used} / {seats_total}\n"
        f"Active API Keys: {active_keys}"
    )


async def org_members_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Show org member list."""
    query = update.callback_query
    await query.answer()

    user = update.effective_user
    org_id = context.user_data.get("org_id", "")

    if not org_id:
        await query.edit_message_text("Session expired. Run /org again.")
        return

    try:
        members = await api_client.get_org_members(user.id, org_id)
    except APIClientError as e:
        logger.error(f"[Enterprise] get_org_members failed: {e}")
        await query.edit_message_text("Failed to fetch members. Please try again.")
        return

    if not members:
        text = "No members found."
    else:
        lines = ["*Team Members*\n"]
        for m in members:
            handle = m.get("username") or m.get("email") or m.get("id", "unknown")
            role = m.get("role", "member").lower()
            lines.append(f"• {handle} — _{role}_")
        text = "\n".join(lines)

    await query.edit_message_text(
        text,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(
            [[InlineKeyboardButton("« Back", callback_data="org_back")]]
        ),
    )


async def org_keys_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Show org API key list (prefix + scopes, never raw key)."""
    query = update.callback_query
    await query.answer()

    user = update.effective_user
    org_id = context.user_data.get("org_id", "")

    if not org_id:
        await query.edit_message_text("Session expired. Run /org again.")
        return

    try:
        keys = await api_client.get_org_api_keys(user.id, org_id)
    except APIClientError as e:
        logger.error(f"[Enterprise] get_org_api_keys failed: {e}")
        await query.edit_message_text("Failed to fetch API keys. Please try again.")
        return

    if not keys:
        text = "No active API keys."
    else:
        lines = ["*API Keys*\n"]
        for k in keys:
            prefix = k.get("prefix", k.get("id", "???"))
            name = k.get("name", "Unnamed")
            scopes = ", ".join(k.get("scopes", []))
            lines.append(f"• `{prefix}…` — *{name}*\n  Scopes: {scopes or 'none'}")
        text = "\n".join(lines)

    await query.edit_message_text(
        text,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(
            [
                [
                    InlineKeyboardButton("➕ New Key", callback_data="org_newkey"),
                    InlineKeyboardButton("« Back", callback_data="org_back"),
                ]
            ]
        ),
    )


async def org_newkey_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Start new-key flow — ask for a name."""
    query = update.callback_query
    await query.answer()

    org_id = context.user_data.get("org_id", "")
    if not org_id:
        await query.edit_message_text("Session expired. Run /org again.")
        return ConversationHandler.END

    await query.message.reply_text(
        "Enter a name for the new API key:",
        reply_markup=ForceReply(selective=True, input_field_placeholder="e.g. Production Bot"),
    )
    return AWAITING_KEY_NAME


async def org_newkey_name_received(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Receive key name, create the key, show it once."""
    user = update.effective_user
    name = (update.message.text or "").strip()

    if not name:
        await update.message.reply_text("Key name cannot be empty. Run /org and try again.")
        return ConversationHandler.END

    org_id = context.user_data.get("org_id", "")
    if not org_id:
        await update.message.reply_text("Session expired. Run /org again.")
        return ConversationHandler.END

    try:
        result = await api_client.create_org_api_key(user.id, org_id, name, DEFAULT_KEY_SCOPES)
    except APIClientError as e:
        logger.error(f"[Enterprise] create_org_api_key failed: {e}")
        await update.message.reply_text(f"Failed to create API key: {e}\nPlease try again later.")
        return ConversationHandler.END

    raw_key = result.get("key", "")
    scopes = ", ".join(DEFAULT_KEY_SCOPES)

    await update.message.reply_text(
        f"*New API Key Created*\n\n"
        f"Name: {name}\n"
        f"Scopes: {scopes}\n\n"
        f"`{raw_key}`\n\n"
        f"⚠️ Save this key — it will not be shown again.",
        parse_mode="Markdown",
    )
    return ConversationHandler.END


async def org_cancel_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Dismiss the org menu."""
    query = update.callback_query
    await query.answer()
    await query.edit_message_text("Org menu closed. Run /org to reopen.")


async def org_back_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Go back to the org overview."""
    query = update.callback_query
    await query.answer()

    user = update.effective_user
    org_id = context.user_data.get("org_id", "")

    if not org_id:
        await query.edit_message_text("Session expired. Run /org again.")
        return

    try:
        org = await api_client.get_my_org(user.id)
    except APIClientError as e:
        logger.error(f"[Enterprise] get_my_org (back) failed: {e}")
        await query.edit_message_text("Failed to reload org. Run /org again.")
        return

    if not org:
        await query.edit_message_text("Org not found. Run /org again.")
        return

    text = _format_org_overview(org)
    await query.edit_message_text(
        text,
        parse_mode="Markdown",
        reply_markup=_org_keyboard(),
    )


# ─── Conversation handler for key-name entry ─────────────────────────────────

org_newkey_conversation = ConversationHandler(
    entry_points=[CallbackQueryHandler(org_newkey_callback, pattern="^org_newkey$")],
    states={
        AWAITING_KEY_NAME: [
            MessageHandler(filters.TEXT & ~filters.COMMAND, org_newkey_name_received)
        ]
    },
    fallbacks=[],
    name="org_newkey_conversation",
    persistent=False,
)

# ─── Simple command handler ───────────────────────────────────────────────────

org_handler = CommandHandler("org", org_command)
