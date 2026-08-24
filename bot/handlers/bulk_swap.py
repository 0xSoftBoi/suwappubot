"""Bulk-swap handler — swap multiple token legs in a single confirmed flow.

User flow:
  1. /bulk  — start; bot shows chain selection for the wallet to operate from.
  2. Select chain → select from-token → enter amount → select to-token → leg added.
  3. User can add more legs (up to MAX_LEGS) or proceed to quote summary.
  4. Bot shows a combined quote card (one quote per leg, fetched in parallel).
  5. User confirms once.  Bot executes legs sequentially with per-leg progress,
     reports per-leg results (success/fail).  One leg failing NEVER silently
     aborts the rest; every result is surfaced.

MONEY-PATH: every leg calls swap_engine.execute_swap which moves on-chain funds.
See the MONEY-PATH note at the bottom of this module for the full audit surface.
"""

import asyncio
import logging
import secrets
import time
from typing import Optional

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import (
    CallbackQueryHandler,
    CommandHandler,
    ConversationHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

from bot.config.chains import CHAINS, get_chain_by_name
from bot.config.tokens import get_tokens_for_chain
from bot.models.swap import SwapStatus, SwapTransaction
from bot.models.user import User, Wallet
from bot.services.fee_service import fee_service
from bot.services.referral_service import referral_service
from bot.services.points_service import points_service
from bot.services.position_cards_service import position_cards_service
from bot.services.spending_limits import spending_limit_service
from bot.services.twofa import twofa_service
from bot.services.wallet import WalletService
from bot.services.x402_service import x402_service
from bot.services.swap_engine import SwapEngine, SwapQuote
from bot.utils.exceptions import SwapError
from bot.utils.formatters import format_amount, format_usd
from bot.utils.quote_validator import quote_validator
from bot.utils.rate_limiter import swap_limiter, enforce_rate_limit_for_update
from bot.utils.tos_utils import enforce_tos
from bot.utils.validators import validate_amount
from database.db import get_session

logger = logging.getLogger(__name__)

# ─── Conversation states ─────────────────────────────────────────────────────
(
    BULK_SELECT_CHAIN,
    BULK_SELECT_FROM_TOKEN,
    BULK_SELECT_TO_TOKEN,
    BULK_ENTER_AMOUNT,
    BULK_SELECT_WALLET,
    BULK_LEG_MENU,
    BULK_CONFIRM,
    BULK_2FA,
) = range(8)

# Maximum legs to prevent runaway sessions / gas
MAX_LEGS = 5

# 2FA validity window (seconds) — mirrors swap.py
TWOFA_VALID_SECONDS = 300

swap_engine = SwapEngine()
wallet_service = WalletService()

# ─── Helpers ─────────────────────────────────────────────────────────────────


def _bulk(ctx: ContextTypes.DEFAULT_TYPE) -> dict:
    """Retrieve (lazily-create) the bulk-swap session dict."""
    if "bulk_swap" not in ctx.user_data:
        ctx.user_data["bulk_swap"] = {"legs": [], "wallet_id": None, "chain": None}
    return ctx.user_data["bulk_swap"]


def _legs(ctx: ContextTypes.DEFAULT_TYPE) -> list:
    return _bulk(ctx)["legs"]


def _cancel_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([[InlineKeyboardButton("Cancel", callback_data="bulk_cancel")]])


def _leg_summary(legs: list) -> str:
    """Human-readable bullet list of legs added so far."""
    if not legs:
        return "_None yet_"
    lines = []
    for i, leg in enumerate(legs, 1):
        amt = format_amount(leg["amount"], symbol=leg["from_token"])
        lines.append(f"{i}. {amt} → {leg['to_token']}")
    return "\n".join(lines)


# ─── Entry point ─────────────────────────────────────────────────────────────


@enforce_tos
async def bulk_command(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle /bulk command — start the bulk-swap flow."""
    allowed = await enforce_rate_limit_for_update(update, swap_limiter)
    if not allowed:
        return ConversationHandler.END

    user = update.effective_user

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await update.message.reply_text("Please use /start first to set up your account.")
            return ConversationHandler.END

        wallets = (
            session.query(Wallet)
            .filter(Wallet.user_id == db_user.id, Wallet.is_active == True)  # noqa: E712
            .all()
        )
        if not wallets:
            await update.message.reply_text(
                "You need a wallet before bulk-swapping.",
                reply_markup=InlineKeyboardMarkup(
                    [[InlineKeyboardButton("Add Wallet", callback_data="wallet_menu")]]
                ),
            )
            return ConversationHandler.END

        ctx.user_data["user_id"] = db_user.id
        ctx.user_data.pop("bulk_swap", None)  # clear any stale session

    return await _show_chain_selection(update, ctx, is_callback=False)


# ─── Chain selection ─────────────────────────────────────────────────────────


async def _show_chain_selection(
    update: Update, ctx: ContextTypes.DEFAULT_TYPE, is_callback: bool = True
) -> int:
    """Show the source-chain selector."""
    buttons = []
    for name, chain in CHAINS.items():
        buttons.append(
            [
                InlineKeyboardButton(
                    f"{chain.logo_emoji} {chain.display_name}",
                    callback_data=f"bulk_chain_{name}",
                )
            ]
        )
    buttons.append([InlineKeyboardButton("Cancel", callback_data="bulk_cancel")])

    text = "Bulk Swap\n\nStep 1: Select the chain you are swapping FROM:"
    markup = InlineKeyboardMarkup(buttons)

    if is_callback:
        await update.callback_query.edit_message_text(text, reply_markup=markup)
    else:
        await update.message.reply_text(text, reply_markup=markup)

    return BULK_SELECT_CHAIN


async def bulk_chain_callback(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle chain selection."""
    query = update.callback_query
    await query.answer()

    chain_name = query.data.replace("bulk_chain_", "")
    chain = get_chain_by_name(chain_name)
    if not chain:
        await query.edit_message_text("Invalid chain. Please start over with /bulk.")
        return ConversationHandler.END

    _bulk(ctx)["chain"] = chain_name
    return await _show_from_token_selection(update, ctx, chain_name)


async def _show_from_token_selection(
    update: Update, ctx: ContextTypes.DEFAULT_TYPE, chain_name: str
) -> int:
    """Show from-token selector for the current chain."""
    chain = get_chain_by_name(chain_name)
    tokens = get_tokens_for_chain(chain_name)
    if not tokens:
        await update.callback_query.edit_message_text(
            f"No supported tokens on {chain.display_name}. Try another chain.",
            reply_markup=_cancel_keyboard(),
        )
        return ConversationHandler.END

    buttons = []
    row = []
    for token in tokens:
        btn = InlineKeyboardButton(
            f"{token.logo_emoji} {token.symbol}",
            callback_data=f"bulk_from_{token.symbol}",
        )
        row.append(btn)
        if len(row) == 3:
            buttons.append(row)
            row = []
    if row:
        buttons.append(row)
    buttons.append([InlineKeyboardButton("Cancel", callback_data="bulk_cancel")])

    legs = _legs(ctx)
    text = (
        f"Bulk Swap — {chain.logo_emoji} {chain.display_name}\n\n"
        f"Legs so far ({len(legs)}/{MAX_LEGS}):\n{_leg_summary(legs)}\n\n"
        f"Select the token to swap FROM:"
    )
    await update.callback_query.edit_message_text(text, reply_markup=InlineKeyboardMarkup(buttons))
    return BULK_SELECT_FROM_TOKEN


async def bulk_from_token_callback(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle from-token selection."""
    query = update.callback_query
    await query.answer()

    token_symbol = query.data.replace("bulk_from_", "")
    _bulk(ctx)["pending_from"] = token_symbol

    chain_name = _bulk(ctx).get("chain", "")
    chain = get_chain_by_name(chain_name)
    tokens = get_tokens_for_chain(chain_name)
    if not tokens:
        await query.edit_message_text("No tokens available.", reply_markup=_cancel_keyboard())
        return ConversationHandler.END

    buttons = []
    row = []
    for token in tokens:
        if token.symbol == token_symbol:
            continue  # can't swap to self
        btn = InlineKeyboardButton(
            f"{token.logo_emoji} {token.symbol}",
            callback_data=f"bulk_to_{token.symbol}",
        )
        row.append(btn)
        if len(row) == 3:
            buttons.append(row)
            row = []
    if row:
        buttons.append(row)
    buttons.append([InlineKeyboardButton("Cancel", callback_data="bulk_cancel")])

    text = (
        f"Bulk Swap — {chain.logo_emoji} {chain.display_name}\n\n"
        f"From: {token_symbol}\n\nSelect the token to swap TO:"
    )
    await query.edit_message_text(text, reply_markup=InlineKeyboardMarkup(buttons))
    return BULK_SELECT_TO_TOKEN


async def bulk_to_token_callback(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle to-token selection and ask for amount."""
    query = update.callback_query
    await query.answer()

    token_symbol = query.data.replace("bulk_to_", "")
    _bulk(ctx)["pending_to"] = token_symbol

    from_token = _bulk(ctx).get("pending_from", "?")
    chain_name = _bulk(ctx).get("chain", "")
    chain = get_chain_by_name(chain_name)

    text = (
        f"Bulk Swap — {chain.logo_emoji} {chain.display_name}\n\n"
        f"Leg: {from_token} → {token_symbol}\n\n"
        f"Enter the amount of {from_token} to swap:"
    )
    await query.edit_message_text(
        text,
        reply_markup=InlineKeyboardMarkup(
            [
                [
                    InlineKeyboardButton("25%", callback_data="bulk_pct_25"),
                    InlineKeyboardButton("50%", callback_data="bulk_pct_50"),
                    InlineKeyboardButton("100%", callback_data="bulk_pct_100"),
                ],
                [InlineKeyboardButton("Cancel", callback_data="bulk_cancel")],
            ]
        ),
    )
    return BULK_ENTER_AMOUNT


async def bulk_pct_callback(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle percentage-based amount buttons."""
    query = update.callback_query
    await query.answer()

    pct = int(query.data.replace("bulk_pct_", ""))
    bulk = _bulk(ctx)
    from_token = bulk.get("pending_from")
    chain_name = bulk.get("chain", "")

    user_id = ctx.user_data.get("user_id")
    chain = get_chain_by_name(chain_name)
    if not chain or not from_token or not user_id:
        await query.edit_message_text("Session expired. Start over with /bulk.")
        return ConversationHandler.END

    chain_type = chain.chain_type.value
    wallet = wallet_service.get_default_wallet(user_id, chain_type)
    if not wallet:
        await query.edit_message_text(
            f"No {chain.display_name} wallet found.", reply_markup=_cancel_keyboard()
        )
        return ConversationHandler.END

    try:
        balances = await wallet_service.get_balances_by_address(wallet.address, chain_type)
        token_balance = 0.0
        for chain_bals in balances.values():
            if from_token in chain_bals:
                token_balance = chain_bals[from_token]
                break
    except Exception:
        token_balance = 0.0

    if token_balance <= 0:
        await query.edit_message_text(
            f"No {from_token} balance found. Please enter an amount manually:",
            reply_markup=_cancel_keyboard(),
        )
        return BULK_ENTER_AMOUNT

    amount = round(token_balance * pct / 100, 6)
    if amount <= 0:
        await query.edit_message_text(
            "Amount too small after rounding. Enter an amount manually:",
            reply_markup=_cancel_keyboard(),
        )
        return BULK_ENTER_AMOUNT

    return await _add_leg_and_show_menu(update, ctx, amount, is_callback=True)


async def bulk_enter_amount(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle manual amount entry."""
    allowed = await enforce_rate_limit_for_update(update, swap_limiter)
    if not allowed:
        return ConversationHandler.END

    amount = validate_amount(update.message.text)
    if amount is None:
        await update.message.reply_text(
            "Invalid amount. Please enter a valid positive number (e.g. 100 or 50.5):"
        )
        return BULK_ENTER_AMOUNT

    return await _add_leg_and_show_menu(update, ctx, amount, is_callback=False)


async def _add_leg_and_show_menu(
    update: Update, ctx: ContextTypes.DEFAULT_TYPE, amount: float, is_callback: bool
) -> int:
    """Validate the pending leg, add it to the list, then show the leg-menu."""
    bulk = _bulk(ctx)
    from_token = bulk.get("pending_from")
    to_token = bulk.get("pending_to")
    chain_name = bulk.get("chain")

    if not from_token or not to_token or not chain_name:
        msg = "Session expired. Start over with /bulk."
        if is_callback:
            await update.callback_query.edit_message_text(msg)
        else:
            await update.message.reply_text(msg)
        return ConversationHandler.END

    if len(bulk["legs"]) >= MAX_LEGS:
        msg = f"You have reached the maximum of {MAX_LEGS} legs. Proceed to confirm or cancel."
        if is_callback:
            await update.callback_query.edit_message_text(msg, reply_markup=_cancel_keyboard())
        else:
            await update.message.reply_text(msg, reply_markup=_cancel_keyboard())
        return BULK_LEG_MENU

    # Add the leg
    bulk["legs"].append(
        {
            "from_token": from_token,
            "to_token": to_token,
            "chain": chain_name,
            "amount": amount,
        }
    )
    # Clear pending
    bulk.pop("pending_from", None)
    bulk.pop("pending_to", None)

    return await _show_leg_menu(update, ctx, is_callback=is_callback)


async def _show_leg_menu(
    update: Update, ctx: ContextTypes.DEFAULT_TYPE, is_callback: bool = True
) -> int:
    """Show the between-legs menu: add another leg or proceed to quote."""
    legs = _legs(ctx)
    chain_name = _bulk(ctx).get("chain", "")
    chain = get_chain_by_name(chain_name)

    text = (
        f"Bulk Swap — {chain.logo_emoji} {chain.display_name}\n\n"
        f"Legs ({len(legs)}/{MAX_LEGS}):\n{_leg_summary(legs)}\n\n"
        f"What would you like to do?"
    )

    buttons = []
    if len(legs) < MAX_LEGS:
        buttons.append([InlineKeyboardButton("Add another leg", callback_data="bulk_add_leg")])
    buttons.append(
        [
            InlineKeyboardButton(
                f"Get quotes & confirm ({len(legs)} leg(s))", callback_data="bulk_quote"
            )
        ]
    )
    if legs:
        buttons.append([InlineKeyboardButton("Remove last leg", callback_data="bulk_remove_last")])
    buttons.append([InlineKeyboardButton("Cancel", callback_data="bulk_cancel")])

    markup = InlineKeyboardMarkup(buttons)

    if is_callback:
        await update.callback_query.edit_message_text(text, reply_markup=markup)
    else:
        await update.message.reply_text(text, reply_markup=markup)

    return BULK_LEG_MENU


async def bulk_add_leg_callback(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> int:
    """User tapped 'Add another leg' — go back to from-token selection."""
    query = update.callback_query
    await query.answer()
    chain_name = _bulk(ctx).get("chain", "")
    return await _show_from_token_selection(update, ctx, chain_name)


async def bulk_remove_last_callback(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> int:
    """Remove the most recently added leg."""
    query = update.callback_query
    await query.answer()
    legs = _legs(ctx)
    if legs:
        legs.pop()
    return await _show_leg_menu(update, ctx, is_callback=True)


# ─── Wallet selection ─────────────────────────────────────────────────────────


async def _show_wallet_selection(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> int:
    """Show wallet selector for the chosen chain."""
    query = update.callback_query
    bulk = _bulk(ctx)
    user_id = ctx.user_data.get("user_id")
    chain_name = bulk.get("chain")

    if not user_id or not chain_name:
        await query.edit_message_text("Session expired. Start over with /bulk.")
        return ConversationHandler.END

    chain = get_chain_by_name(chain_name)
    chain_type = chain.chain_type.value

    with get_session() as session:
        wallets = (
            session.query(Wallet)
            .filter(
                Wallet.user_id == user_id,
                Wallet.chain_type == chain_type,
                Wallet.is_active == True,  # noqa: E712
            )
            .all()
        )

        if not wallets:
            await query.edit_message_text(
                f"No {chain.display_name} wallets found. Add one via /wallet.",
                reply_markup=_cancel_keyboard(),
            )
            return ConversationHandler.END

        if len(wallets) == 1:
            # Skip selection if only one wallet
            bulk["wallet_id"] = wallets[0].id
            return await _fetch_quotes_and_confirm(update, ctx)

        buttons = []
        for w in wallets:
            addr_short = f"{w.address[:6]}...{w.address[-4:]}"
            buttons.append(
                [
                    InlineKeyboardButton(
                        f"{w.name} ({addr_short})", callback_data=f"bulk_wallet_{w.id}"
                    )
                ]
            )
        buttons.append([InlineKeyboardButton("Cancel", callback_data="bulk_cancel")])

        await query.edit_message_text(
            f"Select the wallet to use for all legs on {chain.display_name}:",
            reply_markup=InlineKeyboardMarkup(buttons),
        )

    return BULK_SELECT_WALLET


async def bulk_wallet_callback(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle wallet selection."""
    query = update.callback_query
    await query.answer()

    try:
        wallet_id = int(query.data.replace("bulk_wallet_", ""))
    except ValueError:
        await query.edit_message_text("Invalid wallet.", reply_markup=_cancel_keyboard())
        return ConversationHandler.END

    _bulk(ctx)["wallet_id"] = wallet_id
    return await _fetch_quotes_and_confirm(update, ctx)


# ─── Quoting ─────────────────────────────────────────────────────────────────


async def bulk_quote_callback(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> int:
    """User tapped 'Get quotes & confirm' — go to wallet selection then quoting."""
    query = update.callback_query
    await query.answer()

    legs = _legs(ctx)
    if not legs:
        await query.edit_message_text(
            "Add at least one leg before getting a quote.",
            reply_markup=_cancel_keyboard(),
        )
        return BULK_LEG_MENU

    # If no wallet chosen yet, ask; otherwise fetch quotes immediately
    if not _bulk(ctx).get("wallet_id"):
        return await _show_wallet_selection(update, ctx)

    return await _fetch_quotes_and_confirm(update, ctx)


async def _fetch_quotes_and_confirm(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> int:
    """Fetch one quote per leg in parallel, then render the confirm card."""
    query = update.callback_query
    bulk = _bulk(ctx)
    user_id = ctx.user_data.get("user_id")
    wallet_id = bulk.get("wallet_id")
    legs = bulk.get("legs", [])

    if not user_id or not wallet_id or not legs:
        await query.edit_message_text("Session expired. Start over with /bulk.")
        return ConversationHandler.END

    await query.edit_message_text(f"Fetching {len(legs)} quote(s)...")

    # Resolve wallet address
    with get_session() as session:
        wallet = (
            session.query(Wallet).filter(Wallet.id == wallet_id, Wallet.user_id == user_id).first()
        )
        if not wallet:
            await query.edit_message_text("Wallet not found.", reply_markup=_cancel_keyboard())
            return ConversationHandler.END
        wallet_address = wallet.address
        wallet_name = wallet.name

    # Resolve fee tier once
    user_tier = await x402_service.get_tier(user_id)
    platform_fee_bps = fee_service.get_fee_bps(user_tier, user_id=user_id)

    # Fetch all quotes in parallel
    async def _get_one_quote(leg: dict) -> Optional[SwapQuote]:
        try:
            return await swap_engine.get_quote(
                from_chain=leg["chain"],
                to_chain=leg["chain"],
                from_token=leg["from_token"],
                to_token=leg["to_token"],
                amount=leg["amount"],
                from_address=wallet_address,
                platform_fee_bps=platform_fee_bps,
            )
        except SwapError as exc:
            logger.warning(f"Bulk quote failed for leg {leg}: {exc}")
            return None

    quote_results = await asyncio.gather(*[_get_one_quote(leg) for leg in legs])

    # Pair quotes with legs; track which ones failed
    failed_legs = []
    quoted_legs = []
    for leg, quote in zip(legs, quote_results):
        if quote is None:
            failed_legs.append(leg)
        else:
            quoted_legs.append((leg, quote))

    if not quoted_legs:
        await query.edit_message_text(
            "Could not get a quote for any leg. Please check your tokens and try again.",
            reply_markup=InlineKeyboardMarkup(
                [
                    [InlineKeyboardButton("Start over", callback_data="bulk_restart")],
                    [InlineKeyboardButton("Cancel", callback_data="bulk_cancel")],
                ]
            ),
        )
        return ConversationHandler.END

    # Validate balances for every quoted leg
    balance_errors = []
    for leg, quote in quoted_legs:
        try:
            await quote_validator.validate_balance(
                wallet_id=wallet_id,
                quote=quote,
                wallet_service=wallet_service,
            )
        except SwapError as exc:
            balance_errors.append(f"{leg['from_token']} → {leg['to_token']}: {exc}")

    if balance_errors:
        await query.edit_message_text(
            "Insufficient balance for one or more legs:\n\n"
            + "\n".join(f"- {e}" for e in balance_errors)
            + "\n\nPlease adjust amounts and start over with /bulk.",
            reply_markup=_cancel_keyboard(),
        )
        return ConversationHandler.END

    # Calculate aggregate fees
    total_fee_usd = 0.0
    for leg, quote in quoted_legs:
        fee_amount, fee_pct, fee_usd = await fee_service.calculate_fee_with_price(
            amount=quote.from_amount_human,
            token_symbol=leg["from_token"],
            tier=user_tier,
            user_id=user_id,
        )
        leg["_fee_amount"] = fee_amount
        leg["_fee_pct"] = fee_pct
        leg["_fee_usd"] = fee_usd
        total_fee_usd += fee_usd

    # USD outflow for spending-limit check.
    # FIX P2: compute the total from quoted_legs only — legs whose quote
    # failed are skipped at execution time (never actually sent), so
    # including them here would inflate the 2FA/spending-limit total and
    # could either wrongly trigger 2FA/limit rejection or (if the failed
    # leg later gets skipped) misrepresent the real USD amount actually
    # moved for auditing purposes.
    total_usd: Optional[float] = None
    try:
        amounts_usd = await asyncio.gather(
            *[
                spending_limit_service.usd_value(leg["from_token"], leg["amount"])
                for leg, _quote in quoted_legs
            ],
            return_exceptions=True,
        )
        usd_vals = [v for v in amounts_usd if isinstance(v, (int, float)) and v > 0]
        if usd_vals:
            total_usd = sum(usd_vals)
    except Exception:
        pass

    # Stash the quoted context for the confirm step
    bulk["quoted_legs"] = quoted_legs
    bulk["failed_legs"] = failed_legs
    bulk["total_fee_usd"] = total_fee_usd
    bulk["total_usd"] = total_usd
    bulk["attempt_id"] = secrets.token_urlsafe(16)
    bulk["platform_fee_bps"] = platform_fee_bps
    bulk["wallet_address"] = wallet_address
    bulk["wallet_name"] = wallet_name

    # Build the confirmation card
    chain_name = bulk.get("chain", "")
    chain = get_chain_by_name(chain_name)

    lines = [f"Bulk Swap — {chain.logo_emoji} {chain.display_name}", ""]
    lines.append(f"Wallet: {wallet_name}")
    lines.append("")
    lines.append(f"Legs to execute ({len(quoted_legs)}):")
    for i, (leg, quote) in enumerate(quoted_legs, 1):
        provider_display = quote.provider.upper()
        lines.append(
            f"  {i}. {format_amount(leg['amount'], symbol=leg['from_token'])}"
            f" → ~{format_amount(quote.to_amount_human, symbol=leg['to_token'])}"
            f" via {provider_display}"
        )

    if failed_legs:
        lines.append("")
        lines.append(f"Could NOT quote ({len(failed_legs)} leg(s) — will be SKIPPED):")
        for leg in failed_legs:
            lines.append(f"  - {leg['from_token']} → {leg['to_token']} ({leg['amount']})")

    lines.append("")
    lines.append(f"Platform fee: ~{format_usd(total_fee_usd)}")
    if total_usd:
        lines.append(f"Est. total outflow: ~{format_usd(total_usd)}")
    lines.append("")
    lines.append(
        f"Confirm will execute {len(quoted_legs)} swap(s) sequentially. "
        "Each failing leg is reported but does NOT cancel the rest."
    )

    text = "\n".join(lines)

    keyboard = InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton(
                    f"Confirm {len(quoted_legs)} swap(s)", callback_data="bulk_confirm"
                ),
                InlineKeyboardButton("Cancel", callback_data="bulk_cancel"),
            ],
            [InlineKeyboardButton("Add/remove legs", callback_data="bulk_back_to_menu")],
        ]
    )

    await query.edit_message_text(text, reply_markup=keyboard)
    return BULK_CONFIRM


# ─── Confirmation + execution ─────────────────────────────────────────────────


async def bulk_confirm_callback(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle the confirm button — guard then execute."""
    query = update.callback_query
    await query.answer()

    allowed = await enforce_rate_limit_for_update(update, swap_limiter)
    if not allowed:
        return ConversationHandler.END

    bulk = _bulk(ctx)
    user_id = ctx.user_data.get("user_id")

    quoted_legs = bulk.get("quoted_legs")
    if not quoted_legs or not user_id:
        await query.edit_message_text("Session expired. Start over with /bulk.")
        return ConversationHandler.END

    # Quote freshness: any expired quote → abort early
    for leg, quote in quoted_legs:
        try:
            quote_validator.validate_quote_freshness(quote)
        except SwapError:
            await query.edit_message_text(
                "One or more quotes expired. Please start over to get fresh quotes.",
                reply_markup=InlineKeyboardMarkup(
                    [[InlineKeyboardButton("Start over", callback_data="bulk_restart")]]
                ),
            )
            return ConversationHandler.END

    # Spending-limit pre-check
    total_usd = bulk.get("total_usd")
    if total_usd is not None:
        limit_ok, limit_reason = spending_limit_service.check(user_id, total_usd)
        if not limit_ok:
            await query.edit_message_text(
                f"Spending limit exceeded: {limit_reason}",
                reply_markup=InlineKeyboardMarkup(
                    [[InlineKeyboardButton("Cancel", callback_data="bulk_cancel")]]
                ),
            )
            return ConversationHandler.END

        # 2FA gate
        verified_at = bulk.get("twofa_verified_at", 0)
        recently_verified = (time.time() - verified_at) < TWOFA_VALID_SECONDS
        if (
            not recently_verified
            and twofa_service.is_2fa_enabled(user_id)
            and total_usd >= spending_limit_service.effective_2fa_threshold(user_id)
        ):
            bulk["twofa_attempts"] = 0
            await query.edit_message_text(
                f"2FA Required\n\n"
                f"This bulk swap moves ~{format_usd(total_usd)}, which is at or above "
                f"your 2FA threshold.\n\n"
                f"Enter the 6-digit code from your authenticator app:",
                reply_markup=InlineKeyboardMarkup(
                    [[InlineKeyboardButton("Cancel", callback_data="bulk_cancel")]]
                ),
            )
            return BULK_2FA

    return await _run_bulk_swap(query.edit_message_text, ctx)


async def bulk_twofa_entered(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> int:
    """Verify the TOTP code then execute."""
    bulk = _bulk(ctx)
    user_id = ctx.user_data.get("user_id")

    if not bulk.get("quoted_legs") or not user_id:
        await update.message.reply_text("Session expired. Start over with /bulk.")
        return ConversationHandler.END

    code = (update.message.text or "").strip()
    if not twofa_service.verify_transaction(user_id, code):
        attempts = bulk.get("twofa_attempts", 0) + 1
        bulk["twofa_attempts"] = attempts
        if attempts >= 3:
            ctx.user_data.pop("bulk_swap", None)
            await update.message.reply_text("Too many invalid 2FA codes. Bulk swap cancelled.")
            return ConversationHandler.END
        await update.message.reply_text(
            f"Invalid code. {3 - attempts} attempt(s) left — try again:"
        )
        return BULK_2FA

    bulk["twofa_verified_at"] = time.time()

    # Re-check quote freshness after the 2FA round-trip
    quoted_legs = bulk.get("quoted_legs", [])
    for _, quote in quoted_legs:
        try:
            quote_validator.validate_quote_freshness(quote)
        except SwapError:
            await update.message.reply_text(
                "Code verified — but one or more quotes expired in the meantime. "
                "Start over to get fresh quotes.",
                reply_markup=InlineKeyboardMarkup(
                    [[InlineKeyboardButton("Start over", callback_data="bulk_restart")]]
                ),
            )
            return BULK_CONFIRM

    status_msg = await update.message.reply_text("Executing bulk swap...")
    return await _run_bulk_swap(status_msg.edit_text, ctx)


async def _run_bulk_swap(edit, ctx: ContextTypes.DEFAULT_TYPE) -> int:
    """Execute all quoted legs sequentially with per-leg status updates.

    MONEY-PATH: this is where funds move.  Each call to
    swap_engine.execute_swap signs and broadcasts an on-chain transaction.
    One leg failing NEVER aborts the rest — we collect and report every
    outcome.
    """
    bulk = _bulk(ctx)
    user_id = ctx.user_data.get("user_id")
    quoted_legs: list = bulk.get("quoted_legs", [])
    wallet_id: int = bulk.get("wallet_id")
    attempt_id: str = bulk.get("attempt_id", secrets.token_urlsafe(16))
    failed_legs: list = bulk.get("failed_legs", [])

    if not quoted_legs or not user_id or not wallet_id:
        await edit("Session expired. Start over with /bulk.")
        return ConversationHandler.END

    await edit(f"Executing {len(quoted_legs)} swap(s) — this may take a moment...")

    results: list[dict] = []  # {"leg": ..., "tx": SwapTransaction | None, "error": str | None}

    for i, (leg, quote) in enumerate(quoted_legs, 1):
        idempotency_key = f"bulk:{user_id}:{wallet_id}:{attempt_id}:{i}"
        try:
            # Update progress before each leg
            try:
                await edit(
                    f"Executing leg {i}/{len(quoted_legs)}: "
                    f"{leg['from_token']} → {leg['to_token']} ({format_amount(leg['amount'])})..."
                )
            except Exception:
                pass  # best-effort progress update

            swap_tx: SwapTransaction = await swap_engine.execute_swap(
                quote=quote,
                wallet_id=wallet_id,
                user_id=user_id,
                idempotency_key=idempotency_key,
            )
            results.append({"leg": leg, "tx": swap_tx, "error": None})

        except SwapError as exc:
            logger.error(f"Bulk swap leg {i} failed for user {user_id}: {exc}", exc_info=True)
            results.append({"leg": leg, "tx": None, "error": str(exc)})
        except Exception as exc:
            logger.error(
                f"Bulk swap leg {i} unexpected error for user {user_id}: {exc}", exc_info=True
            )
            results.append({"leg": leg, "tx": None, "error": f"Unexpected error: {exc}"})

    # ── Post-execution accounting (only for successful legs) ──────────────────
    total_points = 0
    gas_rebate_usd = 0.0
    any_success = False

    for item in results:
        leg = item["leg"]
        swap_tx = item["tx"]
        if swap_tx is None:
            continue
        if swap_tx.status not in (SwapStatus.SUBMITTED.value, SwapStatus.COMPLETED.value):
            continue

        any_success = True
        fee_amount = leg.get("_fee_amount", 0)
        fee_pct = leg.get("_fee_pct", 1.0)
        fee_usd = leg.get("_fee_usd", 0)

        # Record platform fee
        fee_service.record_fee(
            user_id=user_id,
            chain=leg["chain"],
            token_symbol=leg["from_token"],
            swap_amount=leg["amount"],
            fee_amount=fee_amount,
            fee_percentage=fee_pct,
            fee_amount_usd=fee_usd,
            swap_id=swap_tx.id,
        )

        # Referral reward
        referral_service.record_reward(
            referee_id=user_id,
            swap_id=swap_tx.id,
            fee_amount_usd=fee_usd,
        )

        # XP points
        swap_usd = fee_usd / (fee_pct / 100) if fee_pct > 0 else 0
        # Position-card ticker boost, resolved here because the points service is
        # sync and must not do I/O. Wired on the bulk path too — a perk that only
        # fires on single swaps is a perk users will report as broken.
        ticker_boost = await position_cards_service.swap_xp_boost_bps(
            user_id, leg.get("from_token"), leg.get("to_token")
        )
        pts, _, _ = points_service.award_swap_points(
            user_id=user_id,
            swap_amount_usd=swap_usd,
            swap_id=swap_tx.id,
            fee_usd=fee_usd,
            ticker_boost_bps=ticker_boost,
        )
        total_points += pts

    # Gas rebate — atomically consumed once if at least one swap succeeded
    if any_success:
        gas_rebate_usd = points_service.consume_gas_rebate(user_id)

    # ── Build the result card ─────────────────────────────────────────────────
    successes = [r for r in results if r["tx"] is not None and r["error"] is None]
    failures = [r for r in results if r["error"] is not None]
    skipped = failed_legs  # legs that couldn't be quoted

    chain_name = bulk.get("chain", "")
    chain = get_chain_by_name(chain_name)

    lines = [f"Bulk Swap Complete — {chain.logo_emoji} {chain.display_name}", ""]
    lines.append(f"Executed: {len(successes)}/{len(quoted_legs)} leg(s) succeeded")

    if successes:
        lines.append("")
        lines.append("Successful legs:")
        for r in successes:
            leg = r["leg"]
            tx = r["tx"]
            tx_info = ""
            if tx and tx.tx_hash:
                tx_info = f" ({tx.tx_hash[:10]}...)"
            lines.append(
                f"  + {leg['from_token']} → {leg['to_token']}"
                f" ({format_amount(leg['amount'])}){tx_info}"
            )

    if failures:
        lines.append("")
        lines.append("Failed legs (funds NOT moved):")
        for r in failures:
            leg = r["leg"]
            lines.append(
                f"  - {leg['from_token']} → {leg['to_token']}"
                f" ({format_amount(leg['amount'])}): {r['error']}"
            )

    if skipped:
        lines.append("")
        lines.append("Skipped (could not quote):")
        for leg in skipped:
            lines.append(f"  - {leg['from_token']} → {leg['to_token']}")

    if total_points > 0:
        lines.append("")
        lines.append(f"+{total_points} XP earned!")

    if gas_rebate_usd > 0:
        lines.append(f"Gas rebate applied: -{format_usd(gas_rebate_usd)}")

    lines.append("")
    lines.append("Check individual tx status in /hx.")

    text = "\n".join(lines)

    keyboard = InlineKeyboardMarkup(
        [
            [InlineKeyboardButton("New Bulk Swap", callback_data="bulk_restart")],
            [InlineKeyboardButton("Main Menu", callback_data="main_menu")],
        ]
    )

    await edit(text, reply_markup=keyboard)

    # Clear session data
    ctx.user_data.pop("bulk_swap", None)

    return ConversationHandler.END


# ─── Utility callbacks ────────────────────────────────────────────────────────


async def bulk_cancel(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> int:
    """Cancel the bulk-swap flow.

    FIX P2: this is registered as BOTH a CallbackQueryHandler fallback (the
    "Cancel" button) AND a CommandHandler("cancel") fallback — /cancel
    arrives as a message update with no callback_query, so the previous
    unconditional query.answer() crashed with AttributeError on None.
    """
    query = update.callback_query
    ctx.user_data.pop("bulk_swap", None)

    if query is None:
        # Arrived via /cancel (message update), not a callback button tap.
        if update.message:
            await update.message.reply_text("Bulk swap cancelled.")
        return ConversationHandler.END

    await query.answer("Bulk swap cancelled.")

    from bot.handlers.start import main_menu_callback

    await main_menu_callback(update, ctx)
    return ConversationHandler.END


async def bulk_back_to_menu_callback(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> int:
    """Return to the leg-management menu."""
    query = update.callback_query
    await query.answer()
    return await _show_leg_menu(update, ctx, is_callback=True)


async def bulk_restart_callback(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> int:
    """Restart: clear state and re-enter the flow from chain selection."""
    query = update.callback_query
    await query.answer()

    allowed = await enforce_rate_limit_for_update(update, swap_limiter)
    if not allowed:
        return ConversationHandler.END

    user = update.effective_user

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await query.edit_message_text("Please use /start first.")
            return ConversationHandler.END
        ctx.user_data["user_id"] = db_user.id

    ctx.user_data.pop("bulk_swap", None)
    return await _show_chain_selection(update, ctx, is_callback=True)


# ─── Conversation handler ─────────────────────────────────────────────────────

bulk_swap_conversation_handler = ConversationHandler(
    name="bulk_swap",
    persistent=True,
    entry_points=[
        CommandHandler("bulk", bulk_command),
        CallbackQueryHandler(bulk_restart_callback, pattern="^bulk_restart$"),
    ],
    states={
        BULK_SELECT_CHAIN: [
            CallbackQueryHandler(bulk_chain_callback, pattern="^bulk_chain_"),
        ],
        BULK_SELECT_FROM_TOKEN: [
            CallbackQueryHandler(bulk_from_token_callback, pattern="^bulk_from_"),
        ],
        BULK_SELECT_TO_TOKEN: [
            CallbackQueryHandler(bulk_to_token_callback, pattern="^bulk_to_"),
        ],
        BULK_ENTER_AMOUNT: [
            CallbackQueryHandler(bulk_pct_callback, pattern="^bulk_pct_"),
            MessageHandler(filters.TEXT & ~filters.COMMAND, bulk_enter_amount),
        ],
        BULK_LEG_MENU: [
            CallbackQueryHandler(bulk_add_leg_callback, pattern="^bulk_add_leg$"),
            CallbackQueryHandler(bulk_remove_last_callback, pattern="^bulk_remove_last$"),
            CallbackQueryHandler(bulk_quote_callback, pattern="^bulk_quote$"),
        ],
        BULK_SELECT_WALLET: [
            CallbackQueryHandler(bulk_wallet_callback, pattern="^bulk_wallet_"),
        ],
        BULK_CONFIRM: [
            CallbackQueryHandler(bulk_confirm_callback, pattern="^bulk_confirm$"),
            CallbackQueryHandler(bulk_back_to_menu_callback, pattern="^bulk_back_to_menu$"),
        ],
        BULK_2FA: [
            MessageHandler(filters.TEXT & ~filters.COMMAND, bulk_twofa_entered),
        ],
    },
    fallbacks=[
        CallbackQueryHandler(bulk_cancel, pattern="^bulk_cancel$"),
        CommandHandler("cancel", lambda u, c: bulk_cancel(u, c)),
    ],
    allow_reentry=True,
    per_message=False,
    per_chat=True,
)

# ─── MONEY-PATH audit surface ─────────────────────────────────────────────────
#
# Every place funds move in this module:
#
# 1. _run_bulk_swap → swap_engine.execute_swap(quote, wallet_id, user_id, ...)
#    Called once per quoted leg, sequentially.  This is the sole on-chain
#    dispatch; all prior steps are read-only (quoting, validation, UI).
#
# 2. fee_service.record_fee — records the platform fee for each successful swap.
#    No on-chain transfer here; the fee is collected on-chain by the aggregator
#    (baked into platform_fee_bps on the quote) and tracked off-chain by this call.
#
# 3. referral_service.record_reward — awards referrer credit from the fee.
#    Off-chain accounting only; no on-chain transfer.
#
# 4. points_service.award_swap_points — credits XP.  Off-chain only.
#
# 5. points_service.consume_gas_rebate — atomically applies a one-shot gas
#    rebate (display only — the rebate is a points discount, not an on-chain tx).
#
# Guards that protect #1:
#   - @enforce_tos on the entry command
#   - enforce_rate_limit_for_update (swap_limiter) on entry + confirm
#   - Balance validation (quote_validator.validate_balance) per leg before quoting
#   - Quote freshness check (quote_validator.validate_quote_freshness) at confirm
#   - Spending-limit pre-check (spending_limit_service.check) at confirm
#   - Optional TOTP 2FA gate at confirm
#   - Per-wallet asyncio.Lock inside execute_swap (prevents concurrent same-wallet swaps)
#   - Idempotency key per leg (prevents double-execution on retry)
