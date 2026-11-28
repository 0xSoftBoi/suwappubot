"""Suwappu Bank entry point for the Telegram bot.

The bank backend lives entirely in api-ts (`/webapp/bank/*`, Telegram initData
auth; `/v1/agent/bank/*`, API keys). The bot has no server-to-server path that
acts for a Telegram user (`InternalAPIClient` uses a global X-Internal-Key and
api-ts exposes no user-scoped bank route behind it), so this module never shows
balances. It opens the Mini App `/bank/*` screens, where the user is
authenticated by initData, and handles the `claim_<token>` / `pay_<slug>`
/start deep links.
"""

import re
from typing import Optional
from urllib.parse import quote

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update, WebAppInfo
from telegram.ext import CallbackQueryHandler, CommandHandler, ContextTypes

from bot.config.settings import settings

# Claim tokens are 24 random bytes, base64url (32 chars). Invoice slugs are
# short URL-safe ids. Both also fit Telegram's /start payload alphabet.
_CLAIM_TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{16,64}$")
_INVOICE_SLUG_RE = re.compile(r"^[A-Za-z0-9_-]{3,64}$")

BANK_TEXT = (
    "🏛️ *Suwappu Bank*\n\n"
    "Hold, send and earn on your money. Open a screen below. "
    "Balances and activity are shown in the app."
)


def _app_url(path: str) -> str:
    return f"{settings.webapp_url.rstrip('/')}{path}"


def _app_button(label: str, path: str) -> InlineKeyboardButton:
    return InlineKeyboardButton(label, web_app=WebAppInfo(url=_app_url(path)))


def _bank_keyboard(with_back: bool = False) -> InlineKeyboardMarkup:
    rows = [
        [_app_button("🏛️ Accounts", "/bank"), _app_button("📤 Send", "/bank/send")],
        [_app_button("➕ Add money", "/bank/add"), _app_button("💵 Cash out", "/bank/cashout")],
        [_app_button("🌾 Earn", "/bank/earn"), _app_button("💳 Card", "/bank/cards")],
        [_app_button("🏦 Borrow", "/bank/credit"), _app_button("🧾 Payments", "/bank/payments")],
        [_app_button("👥 Payroll", "/bank/payroll"), _app_button("🏢 Business", "/bank/business")],
    ]
    if with_back:
        rows.append([InlineKeyboardButton("« Back", callback_data="main_menu")])
    return InlineKeyboardMarkup(rows)


async def bank_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /bank."""
    await update.message.reply_text(BANK_TEXT, parse_mode="Markdown", reply_markup=_bank_keyboard())


async def bank_menu_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle the home-menu Bank button."""
    query = update.callback_query
    await query.answer()
    await query.edit_message_text(
        BANK_TEXT, parse_mode="Markdown", reply_markup=_bank_keyboard(with_back=True)
    )


def parse_bank_start_payload(payload: Optional[str]) -> Optional[tuple[str, str]]:
    """Return ("claim"|"pay", value) for a valid bank deep-link payload, else None."""
    if not payload:
        return None
    if payload.startswith("claim_"):
        token = payload[len("claim_") :]
        if _CLAIM_TOKEN_RE.match(token):
            return "claim", token
    elif payload.startswith("pay_"):
        slug = payload[len("pay_") :]
        if _INVOICE_SLUG_RE.match(slug):
            return "pay", slug
    return None


async def handle_bank_start_payload(update: Update, payload: Optional[str]) -> bool:
    """Handle `/start claim_<token>` and `/start pay_<slug>`. True if handled."""
    parsed = parse_bank_start_payload(payload)
    if parsed is None:
        return False
    kind, value = parsed
    if kind == "claim":
        text = (
            "💸 *You have money waiting*\n\n"
            "Someone sent you funds with Suwappu Bank. Open the claim screen "
            "to collect them. New here? We'll set up your account first."
        )
        button = _app_button("💸 Claim funds", f"/bank/claim/{quote(value, safe='')}")
    else:
        text = (
            "🧾 *Invoice*\n\n" "Open the invoice to review the amount and pay it with Suwappu Bank."
        )
        button = _app_button("🧾 View invoice", f"/pay/{quote(value, safe='')}")
    await update.message.reply_text(
        text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup([[button]])
    )
    return True


bank_handler = CommandHandler("bank", bank_command)
bank_menu_handler = CallbackQueryHandler(bank_menu_callback, pattern="^bank_menu$")
