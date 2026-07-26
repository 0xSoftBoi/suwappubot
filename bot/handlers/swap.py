"""Swap flow handlers."""

import asyncio
import logging
import secrets
import time
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    ContextTypes,
    CommandHandler,
    CallbackQueryHandler,
    ConversationHandler,
    MessageHandler,
    filters,
)

from bot.models.user import User, Wallet
from bot.models.swap import SwapTransaction, SwapStatus
from bot.services.swap_engine import SwapEngine, SwapQuote
from bot.utils.exceptions import SwapError
from bot.services.error_guidance import classify_swap_failure, ErrorGuidance
from bot.services.wallet import WalletService
from bot.services.fee_service import fee_service
from bot.config.chains import CHAINS, ChainType, get_chain_by_name
from bot.config.tokens import get_tokens_for_chain, get_token_address
from bot.utils.formatters import format_amount, format_usd, format_time_estimate, format_tx_link
from bot.utils.validators import validate_amount
from bot.utils.rate_limiter import swap_limiter, enforce_rate_limit_for_update
from database.db import get_session
from bot.config.xstocks import (
    XSTOCKS_BLOCKED_REGION_NAMES,
    is_xstock_mint,
    xstocks_region_allowed,
)
from bot.utils.tos_utils import enforce_tos
from bot.utils.gating import require_tier
from bot.models.subscription import SubscriptionTier
from bot.services.referral_service import referral_service
from bot.services.points_service import points_service
from bot.services.token_security.token_analyzer import token_analyzer, RiskLevel
from bot.services.spending_limits import spending_limit_service
from bot.services.twofa import twofa_service
from bot.services.x402_service import x402_service
from bot.utils.quote_validator import quote_validator
from bot.utils.cache import quote_cache
from bot.utils.feedback import typing, react
from bot.utils.progress import SwapProgressTracker

logger = logging.getLogger(__name__)

# Conversation states
(
    SELECT_FROM_CHAIN,
    SELECT_FROM_TOKEN,
    SELECT_TO_CHAIN,
    SELECT_TO_TOKEN,
    ENTER_AMOUNT,
    SELECT_WALLETS,
    CONFIRM_SWAP,
    ENTER_2FA_CODE,
) = range(8)

# A verified 2FA code covers re-quotes/retries within this window, so a quote
# expiring while the user fetches their code doesn't loop them back into 2FA.
TWOFA_VALID_SECONDS = 300

swap_engine = SwapEngine()
wallet_service = WalletService()


async def _safe_edit(edit_fn, *args, **kwargs) -> None:
    """Best-effort message edit.

    A failed edit (rate limit, "message is not modified", a transient network
    blip) must never abort the swap or crash the handler — the swap
    completing matters infinitely more than a status line landing.
    """
    try:
        await edit_fn(*args, **kwargs)
    except Exception as e:
        logger.debug(f"Swap status edit failed (best-effort): {e}")


def _guidance_keyboard(guidance: ErrorGuidance) -> InlineKeyboardMarkup:
    """Build the inline keyboard for a classified swap failure.

    The primary button is the guidance's single next action (Retry / Re-quote /
    Check status). A Main Menu escape hatch is always appended.
    """
    payload = guidance.action_payload or {}
    rows: list[list[InlineKeyboardButton]] = []

    btn_text = payload.get("button_text")
    if btn_text:
        # Re-quote stays inside the conversation; everything else restarts the
        # swap flow via the top-level swap_start callback.
        callback = payload.get("button_callback") or (
            "swap_requote" if guidance.category == "slippage_exceeded" else "swap_start"
        )
        rows.append([InlineKeyboardButton(btn_text, callback_data=callback)])

    rows.append([InlineKeyboardButton("« Main Menu", callback_data="main_menu")])
    return InlineKeyboardMarkup(rows)


async def _render_swap_failure(edit, exc_or_message, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Classify a failure and render the calm, plain-language guidance card.

    ``edit`` is the status-message editor (``query.edit_message_text`` or
    ``Message.edit_text``). Best-effort: a rendering failure never masks the
    original error.
    """
    swap_data = context.user_data.get("swap") or {}
    ctx = {
        "from_chain": swap_data.get("from_chain"),
        "to_chain": swap_data.get("to_chain"),
        "from_token": swap_data.get("from_token"),
        "is_cross_chain": (
            swap_data.get("from_chain")
            and swap_data.get("to_chain")
            and swap_data.get("from_chain") != swap_data.get("to_chain")
        ),
    }
    guidance = classify_swap_failure(exc_or_message, ctx)
    try:
        await edit(
            guidance.to_message(),
            parse_mode="Markdown",
            reply_markup=_guidance_keyboard(guidance),
        )
    except Exception:
        # If Markdown/edit fails, fall back to a plain-text version so the user
        # still gets the diagnosis rather than a silent failure. Best-effort —
        # if even the fallback edit fails, swallow it rather than crash the
        # handler; the original error is already logged by the caller.
        await _safe_edit(
            edit,
            f"{guidance.title}\n\n{guidance.explanation}\n\nNext: {guidance.next_action}",
            reply_markup=_guidance_keyboard(guidance),
        )


def _prewarm_quote_key(swap_data: dict, wallet_id: int, platform_fee_bps: int) -> str:
    """Build the cache key for a pre-warmed quote.

    Includes platform_fee_bps so a tier change between prewarm and confirm
    results in a cache miss (correctness over hit-rate).
    """
    return (
        f"prewarm:{swap_data['from_chain']}:{swap_data['from_token']}"
        f":{swap_data['to_chain']}:{swap_data['to_token']}"
        f":{swap_data['amount']}:{wallet_id}:{platform_fee_bps}"
    )


def _schedule_quote_prewarm(
    context: ContextTypes.DEFAULT_TYPE, swap_data: dict, wallet_id: int, wallet_address: str
) -> None:
    """Fire-and-forget a background quote fetch so the confirm step is instant.

    Best-effort: any failure is logged and swallowed — the confirm step falls
    back to a cold fetch on cache miss.
    """
    user_id = context.user_data.get("user_id")
    # Snapshot the fields we need so later mutations of swap_data don't race us.
    snapshot = {
        "from_chain": swap_data["from_chain"],
        "to_chain": swap_data["to_chain"],
        "from_token": swap_data["from_token"],
        "to_token": swap_data["to_token"],
        "amount": swap_data["amount"],
    }

    async def _prewarm() -> None:
        try:
            # Resolve tier/fee exactly as wallets_confirmed_callback does so the
            # cached quote is identical to what a cold fetch would return.
            user_tier = await x402_service.get_tier(user_id)
            # Pass user_id so the prewarmed quote is keyed under the SAME VIP/points-
            # adjusted bps the execution path uses (avoids a guaranteed cache miss).
            platform_fee_bps = fee_service.get_fee_bps(user_tier, user_id=user_id)
            quote = await swap_engine.get_quote(
                from_chain=snapshot["from_chain"],
                to_chain=snapshot["to_chain"],
                from_token=snapshot["from_token"],
                to_token=snapshot["to_token"],
                amount=snapshot["amount"],
                from_address=wallet_address,
                platform_fee_bps=platform_fee_bps,
            )
            key = _prewarm_quote_key(snapshot, wallet_id, platform_fee_bps)
            await quote_cache.set(key, quote)
            logger.debug(f"Pre-warmed quote cached for user {user_id} key={key}")
        except Exception as e:
            logger.debug(f"Quote prewarm failed for user {user_id} (best-effort): {e}")

    asyncio.create_task(_prewarm())


@enforce_tos
async def swap_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle /swap command.

    Note: in production `/s` is actually routed to quickswap_command
    (bot/handlers/quickswap.py) — its CommandHandler is registered earlier in
    the same handler group in bot/main.py, so this entry point never fires
    for a real /s message today. The reaction is added here anyway so this
    handler is correct in isolation (e.g. if registration order ever
    changes, or this is invoked as a fallback/other command in the future).
    """
    await react(update, "👀")
    return await start_swap(update, context, is_callback=False)


@enforce_tos
async def swap_start_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle swap_start callback."""
    query = update.callback_query
    await query.answer()
    return await start_swap(update, context, is_callback=True)


async def start_swap(
    update: Update, context: ContextTypes.DEFAULT_TYPE, is_callback: bool = False
) -> int:
    """Start the swap flow."""
    user = update.effective_user

    # Rate limit swap flow entry
    allowed = await enforce_rate_limit_for_update(update, swap_limiter)
    if not allowed:
        return ConversationHandler.END

    # Clear previous swap data
    context.user_data.pop("swap", None)

    # Check if user has wallets
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()

        if not db_user:
            text = "❌ Please use /start first to set up your account."
            if is_callback:
                await update.callback_query.edit_message_text(text)
            else:
                await update.message.reply_text(text)
            return ConversationHandler.END

        wallets = (
            session.query(Wallet)
            .filter(
                Wallet.user_id == db_user.id,
                Wallet.is_active == True,
            )
            .all()
        )

        if not wallets:
            keyboard = [[InlineKeyboardButton("👛 Add Wallet", callback_data="wallet_menu")]]
            text = "👛 You need to add a wallet first before swapping!"
            if is_callback:
                await update.callback_query.edit_message_text(
                    text, reply_markup=InlineKeyboardMarkup(keyboard)
                )
            else:
                await update.message.reply_text(text, reply_markup=InlineKeyboardMarkup(keyboard))
            return ConversationHandler.END

        context.user_data["user_id"] = db_user.id
        wallet_infos = [(w.address, w.chain_type) for w in wallets]

        # Fetch recent swap pairs for quick swap buttons
        recent_swaps = (
            session.query(
                SwapTransaction.from_chain,
                SwapTransaction.from_token,
                SwapTransaction.to_chain,
                SwapTransaction.to_token,
            )
            .filter(
                SwapTransaction.user_id == db_user.id,
                SwapTransaction.status.in_(
                    [
                        SwapStatus.COMPLETED.value,
                        SwapStatus.SUBMITTED.value,
                        SwapStatus.CONFIRMING.value,
                    ]
                ),
            )
            .order_by(SwapTransaction.created_at.desc())
            .limit(20)
            .all()
        )

        # Deduplicate by pair, keep order (most recent first)
        seen_pairs = set()
        quick_swaps = []
        for from_chain, from_token, to_chain, to_token in recent_swaps:
            pair_key = (from_chain, from_token, to_chain, to_token)
            if pair_key not in seen_pairs:
                seen_pairs.add(pair_key)
                quick_swaps.append(pair_key)
            if len(quick_swaps) >= 3:
                break

    # Fetch balances to determine which chains have funds
    chains_with_balance: set[str] = set()
    try:
        async with typing(update):

            async def _check_wallet(address, chain_type):
                bals = await wallet_service.get_balances_by_address(address, chain_type)
                return set(bals.keys())

            results = await asyncio.gather(
                *[_check_wallet(addr, ct) for addr, ct in wallet_infos],
                return_exceptions=True,
            )
            for r in results:
                if isinstance(r, set):
                    chains_with_balance.update(r)
    except Exception:
        pass

    # Cache for reuse in destination chain/token selection
    context.user_data["chains_with_balance"] = chains_with_balance

    # Split chains: ones with balance first
    chains_with_bal = []
    chains_without_bal = []
    for name, chain in CHAINS.items():
        if chain.is_testnet:
            continue
        if name in chains_with_balance:
            chains_with_bal.append((name, chain))
        else:
            chains_without_bal.append((name, chain))

    # Build buttons
    chain_buttons = []

    # Quick swap buttons from recent history
    if quick_swaps:
        for i, (fc, ft, tc, tt) in enumerate(quick_swaps):
            fc_cfg = get_chain_by_name(fc)
            tc_cfg = get_chain_by_name(tc)
            if fc_cfg and tc_cfg:
                label = f"⚡ {ft} {fc_cfg.logo_emoji} → {tt} {tc_cfg.logo_emoji}"
                chain_buttons.append([InlineKeyboardButton(label, callback_data=f"quick_swap_{i}")])
        # Store quick swap data for callback lookup
        context.user_data["quick_swaps"] = quick_swaps

    # Show chain selection
    text = "🔄 *New Swap*\n\n"
    if quick_swaps:
        text += "⚡ *Quick Swap* — repeat a recent swap:\n\n"
    text += "Or select the source chain:"

    # Chains with balance — one per row, highlighted
    for name, chain in chains_with_bal:
        chain_buttons.append(
            [
                InlineKeyboardButton(
                    f"✅ {chain.logo_emoji} {chain.display_name}",
                    callback_data=f"from_chain_{name}",
                )
            ]
        )

    # Remaining chains — compact 2 per row
    row = []
    for name, chain in chains_without_bal:
        btn = InlineKeyboardButton(
            f"{chain.logo_emoji} {chain.display_name}", callback_data=f"from_chain_{name}"
        )
        row.append(btn)
        if len(row) == 3:
            chain_buttons.append(row)
            row = []
    if row:
        chain_buttons.append(row)

    chain_buttons.append([InlineKeyboardButton("❌ Cancel", callback_data="swap_cancel")])

    reply_markup = InlineKeyboardMarkup(chain_buttons)

    if is_callback:
        await update.callback_query.edit_message_text(
            text, parse_mode="Markdown", reply_markup=reply_markup
        )
    else:
        await update.message.reply_text(text, parse_mode="Markdown", reply_markup=reply_markup)

    return SELECT_FROM_CHAIN


async def quick_swap_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle quick swap selection — pre-fill chain/token and jump to amount entry."""
    query = update.callback_query
    await query.answer()

    try:
        idx = int(query.data.replace("quick_swap_", ""))
    except ValueError:
        await query.edit_message_text("❌ Invalid selection.")
        return ConversationHandler.END
    quick_swaps = context.user_data.get("quick_swaps", [])

    if idx >= len(quick_swaps):
        await query.edit_message_text("❌ Quick swap expired. Please start again.")
        return ConversationHandler.END

    from_chain, from_token, to_chain, to_token = quick_swaps[idx]

    # Pre-fill swap data
    context.user_data["swap"] = {
        "from_chain": from_chain,
        "from_token": from_token,
        "to_chain": to_chain,
        "to_token": to_token,
    }

    from_chain_config = get_chain_by_name(from_chain)
    to_chain_config = get_chain_by_name(to_chain)

    text = (
        f"⚡ *Quick Swap*\n\n"
        f"{from_chain_config.logo_emoji} From: *{from_chain_config.display_name}* ({from_token})\n"
        f"{to_chain_config.logo_emoji} To: *{to_chain_config.display_name}* ({to_token})\n\n"
        f"Enter the amount to swap or pick a %:"
    )

    keyboard = InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton("25%", callback_data="swap_pct_25"),
                InlineKeyboardButton("50%", callback_data="swap_pct_50"),
                InlineKeyboardButton("100%", callback_data="swap_pct_100"),
            ],
            [
                InlineKeyboardButton("« Back", callback_data="swap_start"),
                InlineKeyboardButton("❌ Cancel", callback_data="swap_cancel"),
            ],
        ]
    )

    await query.edit_message_text(text, parse_mode="Markdown", reply_markup=keyboard)

    return ENTER_AMOUNT


async def select_from_chain(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle source chain selection."""
    query = update.callback_query
    await query.answer()

    chain_name = query.data.replace("from_chain_", "")
    chain = get_chain_by_name(chain_name)

    if not chain:
        await query.edit_message_text("❌ Invalid chain. Please try again.")
        return ConversationHandler.END

    context.user_data["swap"] = {"from_chain": chain_name}

    # Get available tokens for this chain
    tokens = get_tokens_for_chain(chain_name)

    if not tokens:
        await query.edit_message_text(f"❌ No supported tokens on {chain.display_name}")
        return ConversationHandler.END

    # Fetch user's balances to show tokens they hold first
    user_id = context.user_data.get("user_id")
    chain_type = chain.chain_type.value
    user_balances: dict[str, float] = {}

    try:
        async with typing(update):
            default_wallet = wallet_service.get_default_wallet(user_id, chain_type)
            if default_wallet:
                all_balances = await wallet_service.get_balances_by_address(
                    default_wallet.address, chain_type
                )
                for chain_bals in all_balances.values():
                    user_balances.update(chain_bals)
    except Exception:
        pass  # Show all tokens without balance info on failure

    # Split tokens: ones with balance first, then the rest
    tokens_with_bal = []
    tokens_without_bal = []
    for token in tokens:
        bal = user_balances.get(token.symbol, 0)
        if bal > 0:
            tokens_with_bal.append((token, bal))
        else:
            tokens_without_bal.append(token)

    # Sort tokens with balance by amount descending
    tokens_with_bal.sort(key=lambda x: x[1], reverse=True)

    token_buttons = []

    text = f"🔄 *New Swap*\n\n{chain.logo_emoji} From: *{chain.display_name}*\n\nSelect the token to swap:"

    if tokens_with_bal:
        # Tokens with known balance first
        for token, bal in tokens_with_bal:
            label = f"{token.logo_emoji} {token.symbol} — {format_amount(bal)}"
            token_buttons.append(
                [InlineKeyboardButton(label, callback_data=f"from_token_{token.symbol}")]
            )
        # Then remaining tokens (no balance shown)
        for token in tokens_without_bal:
            label = f"{token.logo_emoji} {token.symbol}"
            token_buttons.append(
                [InlineKeyboardButton(label, callback_data=f"from_token_{token.symbol}")]
            )
    else:
        # Balance fetch failed or empty — show all tokens
        for token in tokens:
            label = f"{token.logo_emoji} {token.symbol}"
            token_buttons.append(
                [InlineKeyboardButton(label, callback_data=f"from_token_{token.symbol}")]
            )

    token_buttons.append(
        [
            InlineKeyboardButton("« Back", callback_data="swap_start"),
            InlineKeyboardButton("❌ Cancel", callback_data="swap_cancel"),
        ]
    )

    await query.edit_message_text(
        text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(token_buttons)
    )

    return SELECT_FROM_TOKEN


async def select_from_token(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle source token selection."""
    query = update.callback_query
    await query.answer()

    token_symbol = query.data.replace("from_token_", "")
    swap_data = context.user_data.get("swap")
    if not swap_data:
        await query.edit_message_text("❌ Session expired. Start again with /s")
        return ConversationHandler.END
    swap_data["from_token"] = token_symbol

    from_chain = swap_data["from_chain"]
    from_chain_config = get_chain_by_name(from_chain)

    text = (
        f"🔄 *New Swap*\n\n"
        f"{from_chain_config.logo_emoji} From: *{from_chain_config.display_name}* ({token_symbol})\n\n"
        f"Select the destination chain:"
    )

    # Reuse cached balance info to sort destination chains
    chains_with_balance = context.user_data.get("chains_with_balance", set())

    chains_with_bal = []
    chains_without_bal = []
    for name, chain in CHAINS.items():
        if chain.is_testnet:
            continue
        if name in chains_with_balance:
            chains_with_bal.append((name, chain))
        else:
            chains_without_bal.append((name, chain))

    chain_buttons = []
    for name, chain in chains_with_bal:
        chain_buttons.append(
            [
                InlineKeyboardButton(
                    f"✅ {chain.logo_emoji} {chain.display_name}", callback_data=f"to_chain_{name}"
                )
            ]
        )

    row = []
    for name, chain in chains_without_bal:
        btn = InlineKeyboardButton(
            f"{chain.logo_emoji} {chain.display_name}", callback_data=f"to_chain_{name}"
        )
        row.append(btn)
        if len(row) == 3:
            chain_buttons.append(row)
            row = []
    if row:
        chain_buttons.append(row)

    chain_buttons.append(
        [
            InlineKeyboardButton("« Back", callback_data=f"from_chain_{from_chain}"),
            InlineKeyboardButton("❌ Cancel", callback_data="swap_cancel"),
        ]
    )

    await query.edit_message_text(
        text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(chain_buttons)
    )

    return SELECT_TO_CHAIN


async def select_to_chain(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle destination chain selection."""
    query = update.callback_query
    await query.answer()

    chain_name = query.data.replace("to_chain_", "")
    chain = get_chain_by_name(chain_name)

    if not chain:
        await query.edit_message_text("❌ Invalid chain. Please try again.")
        return ConversationHandler.END

    swap_data = context.user_data.get("swap")
    if not swap_data:
        await query.edit_message_text("❌ Session expired. Start again with /s")
        return ConversationHandler.END
    swap_data["to_chain"] = chain_name

    # Get available tokens
    tokens = get_tokens_for_chain(chain_name)

    from_chain = swap_data["from_chain"]
    from_token = swap_data["from_token"]
    from_chain_config = get_chain_by_name(from_chain)

    # Fetch user balances on destination chain to sort tokens
    user_id = context.user_data.get("user_id")
    chain_type = chain.chain_type.value
    dest_balances: dict[str, float] = {}
    try:
        async with typing(update):
            default_wallet = wallet_service.get_default_wallet(user_id, chain_type)
            if default_wallet:
                all_balances = await wallet_service.get_balances_by_address(
                    default_wallet.address, chain_type
                )
                for chain_bals in all_balances.values():
                    dest_balances.update(chain_bals)
    except Exception:
        pass

    tokens_with_bal = [
        (t, dest_balances.get(t.symbol, 0)) for t in tokens if dest_balances.get(t.symbol, 0) > 0
    ]
    tokens_without_bal = [t for t in tokens if dest_balances.get(t.symbol, 0) <= 0]
    tokens_with_bal.sort(key=lambda x: x[1], reverse=True)

    text = (
        f"🔄 *New Swap*\n\n"
        f"{from_chain_config.logo_emoji} From: *{from_chain_config.display_name}* ({from_token})\n"
        f"{chain.logo_emoji} To: *{chain.display_name}*\n\n"
        f"Select the token to receive:"
    )

    token_buttons = []

    # Tokens user holds — one per row with balance
    for token, bal in tokens_with_bal:
        label = f"✅ {token.logo_emoji} {token.symbol} — {format_amount(bal)}"
        token_buttons.append(
            [InlineKeyboardButton(label, callback_data=f"to_token_{token.symbol}")]
        )

    # Remaining tokens — compact 3 per row
    row = []
    for token in tokens_without_bal:
        btn = InlineKeyboardButton(
            f"{token.logo_emoji} {token.symbol}", callback_data=f"to_token_{token.symbol}"
        )
        row.append(btn)
        if len(row) == 3:
            token_buttons.append(row)
            row = []
    if row:
        token_buttons.append(row)

    token_buttons.append(
        [
            InlineKeyboardButton("« Back", callback_data=f"from_token_{from_token}"),
            InlineKeyboardButton("❌ Cancel", callback_data="swap_cancel"),
        ]
    )

    await query.edit_message_text(
        text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(token_buttons)
    )

    return SELECT_TO_TOKEN


async def select_to_token(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle destination token selection."""
    query = update.callback_query
    await query.answer()

    token_symbol = query.data.replace("to_token_", "")
    swap_data = context.user_data.get("swap")
    if not swap_data:
        await query.edit_message_text("❌ Session expired. Start again with /s")
        return ConversationHandler.END
    swap_data["to_token"] = token_symbol
    from_chain_config = get_chain_by_name(swap_data["from_chain"])
    to_chain_config = get_chain_by_name(swap_data["to_chain"])

    text = (
        f"🔄 *New Swap*\n\n"
        f"{from_chain_config.logo_emoji} From: *{from_chain_config.display_name}* ({swap_data['from_token']})\n"
        f"{to_chain_config.logo_emoji} To: *{to_chain_config.display_name}* ({token_symbol})\n\n"
        f"Enter the amount to swap or pick a %:"
    )

    keyboard = InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton("25%", callback_data="swap_pct_25"),
                InlineKeyboardButton("50%", callback_data="swap_pct_50"),
                InlineKeyboardButton("100%", callback_data="swap_pct_100"),
            ],
            [InlineKeyboardButton("« Back", callback_data=f"to_chain_{swap_data['to_chain']}")],
            [InlineKeyboardButton("❌ Cancel", callback_data="swap_cancel")],
        ]
    )

    await query.edit_message_text(text, parse_mode="Markdown", reply_markup=keyboard)

    return ENTER_AMOUNT


async def swap_pct_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle percentage button for swap amount (25%, 50%, 100%)."""
    query = update.callback_query
    await query.answer()

    pct = int(query.data.replace("swap_pct_", ""))
    swap_data = context.user_data.get("swap", {})
    from_token = swap_data.get("from_token")
    from_chain = swap_data.get("from_chain")

    if not from_token or not from_chain:
        await query.edit_message_text("❌ Swap session expired. Please start again.")
        return ConversationHandler.END

    # Get user's balance for the from_token
    user_id = context.user_data.get("user_id")
    from_chain_config = get_chain_by_name(from_chain)
    chain_type = from_chain_config.chain_type.value

    default_wallet = wallet_service.get_default_wallet(user_id, chain_type)
    if not default_wallet:
        await query.edit_message_text("❌ No wallet found for this chain.")
        return ConversationHandler.END

    # Fetch balance
    async with typing(update):
        balances = await wallet_service.get_balances_by_address(default_wallet.address, chain_type)
    token_balance = 0.0
    for chain_balances in balances.values():
        if from_token in chain_balances:
            token_balance = chain_balances[from_token]
            break

    if token_balance <= 0:
        await query.edit_message_text(
            f"❌ No {from_token} balance found. Please enter an amount manually:",
        )
        return ENTER_AMOUNT

    amount = round(token_balance * pct / 100, 6)
    if amount <= 0:
        await query.edit_message_text("❌ Amount too small. Please enter an amount manually:")
        return ENTER_AMOUNT

    context.user_data["swap"]["amount"] = amount
    context.user_data["swap"]["wallet_id"] = default_wallet.id

    # Pre-warm the quote for the default wallet while the user picks wallets.
    _schedule_quote_prewarm(
        context, context.user_data["swap"], default_wallet.id, default_wallet.address
    )

    await query.edit_message_text(
        f"✅ Using {pct}% = *{format_amount(amount, symbol=from_token)}*\n\nFetching quote...",
        parse_mode="Markdown",
    )

    return await show_wallet_selection(update, context)


async def enter_amount(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle amount input."""
    allowed = await enforce_rate_limit_for_update(update, swap_limiter)
    if not allowed:
        return ConversationHandler.END

    amount = validate_amount(update.message.text)

    if amount is None:
        await update.message.reply_text(
            "❌ Invalid amount. Please enter a valid number (e.g., 100 or 50.5):"
        )
        return ENTER_AMOUNT

    context.user_data["swap"]["amount"] = amount

    # Get default wallet to start selection
    user_id = context.user_data["user_id"]
    from_chain_config = get_chain_by_name(context.user_data["swap"]["from_chain"])
    chain_type = from_chain_config.chain_type.value

    default_wallet = wallet_service.get_default_wallet(user_id, chain_type)
    if not default_wallet:
        await update.message.reply_text("❌ No wallet found for this chain.")
        return ConversationHandler.END

    context.user_data["swap"]["wallet_id"] = default_wallet.id

    # Pre-warm the quote for the default wallet while the user picks wallets.
    _schedule_quote_prewarm(
        context, context.user_data["swap"], default_wallet.id, default_wallet.address
    )

    # Transition to Wallet Selection
    return await show_wallet_selection(update, context)


async def show_wallet_selection(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Show multi-wallet selection screen."""
    # Answer any pending callback spinner first so the user never sees an
    # infinite loading indicator regardless of which code path triggered us.
    if update.callback_query:
        await update.callback_query.answer()

    swap_data = context.user_data.get("swap")
    user_id = context.user_data.get("user_id")
    if not swap_data or not user_id:
        msg = "❌ Session expired. Start again with /s"
        if update.callback_query:
            await update.callback_query.edit_message_text(msg)
        else:
            await update.message.reply_text(msg)
        return ConversationHandler.END
    from_chain_config = get_chain_by_name(swap_data["from_chain"])
    chain_type = from_chain_config.chain_type.value

    with get_session() as session:
        wallets = (
            session.query(Wallet)
            .filter(
                Wallet.user_id == user_id,
                Wallet.chain_type == chain_type,
                Wallet.is_active == True,
            )
            .all()
        )

        if not wallets:
            no_wallet_msg = "❌ No wallets found. Please add one first."
            if update.callback_query:
                await update.callback_query.edit_message_text(no_wallet_msg)
            else:
                await update.message.reply_text(no_wallet_msg)
            return ConversationHandler.END

        # Initialize selected wallets if not set (default to the one we just found/default)
        if "selected_wallets" not in swap_data:
            swap_data["selected_wallets"] = [swap_data.get("wallet_id")]

    text = (
        f"👛 *Select Wallets*\n\n"
        f"Choose which wallets you want to use for this swap. "
        f"The same amount ({swap_data['amount']} {swap_data['from_token']}) will be swapped on EACH selected wallet.\n\n"
        f"Selected: *{len(swap_data['selected_wallets'])}* wallet(s)"
    )

    keyboard = []
    for w in wallets:
        is_selected = w.id in swap_data["selected_wallets"]
        status = "✅" if is_selected else "⬜"
        # Truncate address for clarity
        addr_short = f"{w.address[:6]}...{w.address[-4:]}"
        btn_text = f"{status} {w.name} ({addr_short})"
        keyboard.append(
            [InlineKeyboardButton(btn_text, callback_data=f"swap_toggle_wallet_{w.id}")]
        )

    keyboard.append(
        [
            InlineKeyboardButton("✅ Confirm Selection", callback_data="swap_wallets_confirmed"),
            InlineKeyboardButton("❌ Cancel", callback_data="swap_cancel"),
        ]
    )

    if update.callback_query:
        await update.callback_query.edit_message_text(
            text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard)
        )
    else:
        await update.message.reply_text(
            text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard)
        )

    return SELECT_WALLETS


async def toggle_wallet_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Toggle a wallet in the selection list."""
    query = update.callback_query
    await query.answer()

    try:
        wallet_id = int(query.data.replace("swap_toggle_wallet_", ""))
    except ValueError:
        await query.edit_message_text("❌ Invalid wallet.")
        return ConversationHandler.END
    swap_data = context.user_data.get("swap")
    if not swap_data:
        await query.edit_message_text("❌ Session expired. Start again with /s")
        return ConversationHandler.END

    if "selected_wallets" not in swap_data:
        swap_data["selected_wallets"] = []

    if wallet_id in swap_data["selected_wallets"]:
        # Don't allow unselecting everything
        if len(swap_data["selected_wallets"]) > 1:
            swap_data["selected_wallets"].remove(wallet_id)
    else:
        swap_data["selected_wallets"].append(wallet_id)

    return await show_wallet_selection(update, context)


async def wallets_confirmed_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Confirm wallet selection and get quotes."""
    query = update.callback_query
    await query.answer()

    swap_data = context.user_data.get("swap")
    user_id = context.user_data.get("user_id")
    if not swap_data or not user_id:
        await query.edit_message_text("❌ Session expired. Start again with /s")
        return ConversationHandler.END
    selected_wallet_ids = swap_data.get("selected_wallets", [])

    if not selected_wallet_ids:
        await query.edit_message_text("❌ Please select at least one wallet.")
        return SELECT_WALLETS

    # xStocks execution-layer geo-gate (manual /s path, covers both buy and sell).
    # to_token is an xStock mint when buying via paste-to-trade or when the user
    # manually enters a mint as the destination.  from_token is an xStock mint when
    # selling (user pastes or enters the mint as the source token).  Checked here
    # — at the quote/confirm boundary — so the gate fires for every code path that
    # reaches execution, regardless of how the swap was initiated.
    _xstock_candidate = swap_data.get("to_token") or ""
    _xstock_sell_candidate = swap_data.get("from_token") or ""
    if is_xstock_mint(_xstock_candidate) or is_xstock_mint(_xstock_sell_candidate):
        _xstock_tg_user = update.effective_user
        _xstock_tg_id = _xstock_tg_user.id if _xstock_tg_user else 0
        _xstock_allowed, _xstock_reason = xstocks_region_allowed(_xstock_tg_id)
        if not _xstock_allowed:
            if _xstock_reason == "unknown":
                _xstock_block_msg = (
                    "*xStocks require region verification*\n\n"
                    "Tokenized equity trading (xStocks) is only available in jurisdictions "
                    f"outside {XSTOCKS_BLOCKED_REGION_NAMES}.\n\n"
                    "Your account region has not been set.  Please contact support to "
                    "complete region verification before accessing xStocks."
                )
            else:
                _xstock_block_msg = (
                    "*xStocks are not available in your region*\n\n"
                    f"Trading of tokenized equities (xStocks) is restricted in "
                    f"{XSTOCKS_BLOCKED_REGION_NAMES} due to regulatory requirements "
                    "from the token issuer (Backed Finance).\n\n"
                    "If you believe this is an error, contact support — your account "
                    "region must be set by a verified operator using the /setregion command."
                )
            await query.edit_message_text(_xstock_block_msg, parse_mode="Markdown")
            return ConversationHandler.END

    await query.edit_message_text("⏳ Getting quotes for all wallets...")

    try:
        # For simplicity, we get one quote and assume it applies to all
        # (in a professional setup we'd get individual quotes, but here
        # we'll start with the default wallet's quote as a reference)
        with get_session() as session:
            ref_wallet = (
                session.query(Wallet)
                .filter(
                    Wallet.id == selected_wallet_ids[0],
                    Wallet.user_id == user_id,
                )
                .first()
            )
            if not ref_wallet:
                await query.edit_message_text("❌ Invalid wallet selection.")
                return ConversationHandler.END
            wallet_address = ref_wallet.address

        # Resolve tier first so the SAME rate drives the on-chain fee we send to
        # the aggregator (platform_fee_bps), the quote we display, and the fee we
        # record — single source of truth, no drift. Passing user_id also folds in
        # the user's active points fee_discount (tier − discount, floored), so the
        # discount applies identically to the on-chain bps, the displayed quote,
        # and the recorded fee (and the referral share scales with it).
        fee_user_id = context.user_data["user_id"]
        user_tier = await x402_service.get_tier(fee_user_id)
        platform_fee_bps = fee_service.get_fee_bps(user_tier, user_id=fee_user_id)

        # Try the pre-warmed quote first (keyed on the reference wallet — the
        # first selected wallet — so it only hits when it matches the wallet
        # the prewarm ran for). Fall back to a cold fetch on miss.
        prewarm_key = _prewarm_quote_key(swap_data, selected_wallet_ids[0], platform_fee_bps)
        quote = await quote_cache.get(prewarm_key)
        if quote is not None:
            logger.debug(f"Using pre-warmed quote for user {user_id} key={prewarm_key}")
        else:
            async with typing(update):
                quote = await swap_engine.get_quote(
                    from_chain=swap_data["from_chain"],
                    to_chain=swap_data["to_chain"],
                    from_token=swap_data["from_token"],
                    to_token=swap_data["to_token"],
                    amount=swap_data["amount"],
                    from_address=wallet_address,
                    platform_fee_bps=platform_fee_bps,
                )

        context.user_data["swap"]["quote"] = quote
        context.user_data["swap"]["attempt_id"] = secrets.token_urlsafe(16)

        from_chain_config = get_chain_by_name(swap_data["from_chain"])
        to_chain_config = get_chain_by_name(swap_data["to_chain"])

        # Fees info — use tier-specific rate (Option B hybrid pricing)
        fee_amount, fee_percentage, fee_usd = await fee_service.calculate_fee_with_price(
            amount=quote.from_amount_human,
            token_symbol=swap_data["from_token"],
            tier=user_tier,
            user_id=fee_user_id,
        )
        # Persist fee values so post-execution can record them
        context.user_data["swap"]["fee_amount"] = fee_amount
        context.user_data["swap"]["fee_percentage"] = fee_percentage
        context.user_data["swap"]["fee_usd"] = fee_usd

        # USD value of the per-wallet outflow, for the spending-limit and 2FA
        # gates at confirm time (None when no price is known — the gates then
        # defer to the engine-side check).
        context.user_data["swap"]["amount_usd"] = await spending_limit_service.usd_value(
            swap_data["from_token"], quote.from_amount_human
        )

        num_wallets = len(selected_wallet_ids)
        total_fee_usd = fee_usd * num_wallets
        total_from_human = quote.from_amount_human * num_wallets
        _provider_names = {
            "layerzero": "Stargate V2",
            "lifi": "LI.FI",
            "jupiter": "Jupiter",
            "cow": "CoW Protocol",
            "cctp": "Circle CCTP",
            "ccip": "Chainlink CCIP",
            "sunswap": "SunSwap V2",
            "okx_dex": "OKX DEX",
        }
        provider_display = _provider_names.get(quote.provider, quote.provider.upper())

        # NEW: Token Security Analysis
        security_text = ""
        _security_report = None
        if swap_data["to_chain"] == "solana":
            try:
                dest_token_address = get_token_address(swap_data["to_token"], "solana")
                if dest_token_address:
                    _security_report = await token_analyzer.analyze(dest_token_address)
                    security_text = f"\n\n\U0001f6e1️ *Security Shield*\n{token_analyzer.get_safety_summary(_security_report)}"
            except Exception as e:
                logger.debug(f"Security analysis failed: {e}")

        # Build all-in cost breakdown (only show lines where data is real)
        slippage_pct = quote.raw_quote.get("slippage") or (swap_data.get("slippage") or 0.5)
        allin_lines = [f"• Platform fee: {fee_percentage}% ({format_usd(total_fee_usd)})"]
        if quote.gas_cost_usd and quote.gas_cost_usd > 0:
            allin_lines.append(f"• Est. gas: {format_usd(quote.gas_cost_usd * num_wallets)}")
        allin_lines.append(f"• Max slippage: {slippage_pct}%")
        allin_cost_block = "\n".join(allin_lines)

        text = (
            f"📊 *Multi-Wallet Swap Quote*\n\n"
            f"*From:*\n"
            f"{from_chain_config.logo_emoji} {format_amount(quote.from_amount_human, symbol=swap_data['from_token'])} "
            f"x *{num_wallets} wallets* (Total: {format_amount(total_from_human, symbol=swap_data['from_token'])})\n"
            f"on {from_chain_config.display_name}\n\n"
            f"*To (after fees):*\n"
            f"{to_chain_config.logo_emoji} ~{format_amount(quote.to_amount_human, symbol=swap_data['to_token'])}\n"
            f"on {to_chain_config.display_name}\n\n"
            f"*Provider:* {provider_display}\n\n"
            f"💸 *All-in cost*\n"
            f"{allin_cost_block}"
            f"{security_text}\n\n"
            f"⚠️ *Confirmation will execute swaps on {num_wallets} wallets simultaneously.*"
        )

        keyboard = [
            [
                InlineKeyboardButton("🚀 Confirm MULTI-SWAP", callback_data="swap_confirm"),
                InlineKeyboardButton("❌ Cancel", callback_data="swap_cancel"),
            ],
            [InlineKeyboardButton("« Back to Wallets", callback_data="swap_back_to_wallets")],
        ]

        # HARD BLOCK: a confirmed honeypot (simulation shows the token cannot be
        # sold after buying) is never a legitimate trade. Unlike the HIGH/CRITICAL
        # warn-and-confirm gate below, there is NO "swap anyway" override here —
        # allowing it would only enable a guaranteed total loss. `is_honeypot` is
        # only True on a positive detection (verification errors leave it False),
        # so this does not block on a merely-uncertain result.
        if _security_report is not None and getattr(_security_report, "is_honeypot", False):
            blocked_text = (
                "🛑 *SWAP BLOCKED — HONEYPOT DETECTED*\n\n"
                f"{token_analyzer.get_safety_summary(_security_report)}\n\n"
                "Simulation shows this token *cannot be sold* after buying — a "
                "confirmed honeypot. Suwappu has blocked this trade to protect "
                "your funds."
            )
            await query.edit_message_text(
                blocked_text,
                parse_mode="Markdown",
                reply_markup=InlineKeyboardMarkup(
                    [[InlineKeyboardButton("❌ Cancel", callback_data="swap_cancel")]]
                ),
            )
            return CONFIRM_SWAP

        # HIGH/CRITICAL risk gate: intercept before showing the confirm screen.
        # Store the prepared quote message so the "swap anyway" handler can display
        # it without rebuilding, then replace the current message with a risk warning.
        if _security_report is not None and _security_report.risk_level in (
            RiskLevel.HIGH,
            RiskLevel.CRITICAL,
        ):
            risk_label = _security_report.risk_level.value.upper()
            attempt_id = swap_data.get("attempt_id", secrets.token_urlsafe(8))
            context.user_data["swap"]["pending_confirm_text"] = text
            context.user_data["swap"]["pending_confirm_keyboard"] = keyboard

            risk_summary = token_analyzer.get_safety_summary(_security_report)
            warning_text = (
                f"🚨 *{risk_label} RISK TOKEN DETECTED*\n\n"
                f"{risk_summary}\n\n"
                f"This token has been flagged as *{risk_label}* risk. "
                f"Swapping may result in a total loss of funds.\n\n"
                f"Are you sure you want to proceed?"
            )
            risk_keyboard = [
                [
                    InlineKeyboardButton(
                        "⚠️ I understand, swap anyway",
                        callback_data=f"swap_risk_confirm_{attempt_id}",
                    ),
                    InlineKeyboardButton("❌ Cancel", callback_data="swap_cancel"),
                ]
            ]
            await query.edit_message_text(
                warning_text,
                parse_mode="Markdown",
                reply_markup=InlineKeyboardMarkup(risk_keyboard),
            )
            return CONFIRM_SWAP

        await query.edit_message_text(
            text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard)
        )

        return CONFIRM_SWAP

    except SwapError as e:
        logger.error(
            f"Quote failed for user {context.user_data.get('user_id')}: {e}", exc_info=True
        )
        await _render_swap_failure(query.edit_message_text, e, context)
        return ConversationHandler.END
    except Exception as e:
        logger.error(
            f"Quote unexpected error for user {context.user_data.get('user_id')}: {e}",
            exc_info=True,
        )
        await _render_swap_failure(query.edit_message_text, e, context)
        return ConversationHandler.END


async def confirm_swap(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle swap confirmation."""
    query = update.callback_query
    await query.answer()

    allowed = await enforce_rate_limit_for_update(update, swap_limiter)
    if not allowed:
        return ConversationHandler.END

    swap_data = context.user_data.get("swap")
    if not swap_data:
        await query.edit_message_text("❌ Session expired. Start again with /s")
        return ConversationHandler.END
    quote: SwapQuote = swap_data.get("quote")
    user_id = context.user_data.get("user_id")
    wallet_id = swap_data.get("wallet_id")

    if not quote:
        await query.edit_message_text("❌ Quote expired. Please start over.")
        return ConversationHandler.END

    # Validate quote freshness (30s expiry via quote_validator)
    try:
        quote_validator.validate_quote_freshness(quote)
    except SwapError as e:
        await query.edit_message_text(
            f"⏰ {str(e)}",
            reply_markup=InlineKeyboardMarkup(
                [
                    [InlineKeyboardButton("🔄 New Quote", callback_data="swap_requote")],
                    [InlineKeyboardButton("« Main Menu", callback_data="main_menu")],
                ]
            ),
        )
        return ConversationHandler.END

    # Pre-validate balance for all selected wallets
    selected_wallet_ids = swap_data.get("selected_wallets", [swap_data.get("wallet_id")])

    with get_session() as session:
        wallets = (
            session.query(Wallet)
            .filter(
                Wallet.id.in_(selected_wallet_ids),
                Wallet.user_id == user_id,
            )
            .all()
        )
        wallet_map = {w.id: w for w in wallets}

        async with typing(update):
            for wid in selected_wallet_ids:
                wallet = wallet_map.get(wid)
                if not wallet:
                    continue

                try:
                    await quote_validator.validate_balance(
                        wallet_id=wid,
                        quote=quote,
                        wallet_service=wallet_service,
                    )
                except SwapError as e:
                    await query.edit_message_text(
                        f"❌ Insufficient funds on wallet {wallet.name[:20]}\n\n{str(e)}",
                        reply_markup=InlineKeyboardMarkup(
                            [
                                [InlineKeyboardButton("🔄 Try Again", callback_data="swap_start")],
                                [InlineKeyboardButton("❌ Cancel", callback_data="swap_cancel")],
                            ]
                        ),
                    )
                    return ConversationHandler.END

                # Gas check is a warning, not a blocker — providers like Li.Fi
                # and Stargate can handle gas in cross-chain routes
                try:
                    await quote_validator.validate_gas(
                        wallet_address=wallet.address,
                        quote=quote,
                        wallet_service=wallet_service,
                    )
                except SwapError:
                    pass  # Let the provider attempt the swap

    # Spending-limit pre-check on the TOTAL outflow across selected wallets.
    # The engine re-checks per wallet at execution; this gives the user a
    # friendly early error before anything starts moving.
    amount_usd = swap_data.get("amount_usd")
    total_usd = amount_usd * len(selected_wallet_ids) if amount_usd is not None else None
    if total_usd is not None:
        limit_ok, limit_reason = spending_limit_service.check(user_id, total_usd)
        if not limit_ok:
            await query.edit_message_text(
                f"🚫 {limit_reason}",
                reply_markup=InlineKeyboardMarkup(
                    [
                        [InlineKeyboardButton("🔄 New Swap", callback_data="swap_start")],
                        [InlineKeyboardButton("« Main Menu", callback_data="main_menu")],
                    ]
                ),
            )
            return ConversationHandler.END

        # 2FA gate: at/above the user's threshold, demand a fresh TOTP code
        # before any funds move (skipped when a code was verified moments ago,
        # e.g. the quote expired mid-verification and was refreshed).
        verified_at = swap_data.get("twofa_verified_at", 0)
        recently_verified = (time.time() - verified_at) < TWOFA_VALID_SECONDS
        if (
            not recently_verified
            and twofa_service.is_2fa_enabled(user_id)
            and total_usd >= spending_limit_service.effective_2fa_threshold(user_id)
        ):
            swap_data["twofa_attempts"] = 0
            await query.edit_message_text(
                f"🔐 *2FA Required*\n\n"
                f"This swap moves {format_usd(total_usd)}, which is at or above "
                f"your 2FA threshold.\n\n"
                f"Enter the 6-digit code from your authenticator app:",
                parse_mode="Markdown",
                reply_markup=InlineKeyboardMarkup(
                    [[InlineKeyboardButton("❌ Cancel", callback_data="swap_cancel")]]
                ),
            )
            return ENTER_2FA_CODE

    return await _run_confirmed_swap(update, query.message, context)


async def twofa_code_entered(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Verify the TOTP code typed during swap confirmation, then execute."""
    swap_data = context.user_data.get("swap")
    user_id = context.user_data.get("user_id")
    if not swap_data or not swap_data.get("quote") or not user_id:
        await update.message.reply_text("❌ Session expired. Start again with /s")
        return ConversationHandler.END

    code = (update.message.text or "").strip()
    if not twofa_service.verify_transaction(user_id, code):
        attempts = swap_data.get("twofa_attempts", 0) + 1
        swap_data["twofa_attempts"] = attempts
        if attempts >= 3:
            context.user_data.pop("swap", None)
            await update.message.reply_text("🚫 Too many invalid 2FA codes. Swap cancelled.")
            return ConversationHandler.END
        await update.message.reply_text(
            f"❌ Invalid code. {3 - attempts} attempt(s) left — try again:"
        )
        return ENTER_2FA_CODE

    swap_data["twofa_verified_at"] = time.time()

    # The quote may have gone stale while the user fetched their code — the
    # recent verification carries over, so the refreshed quote won't re-prompt.
    try:
        quote_validator.validate_quote_freshness(swap_data["quote"])
    except SwapError:
        await update.message.reply_text(
            "✅ Code verified — but the quote expired in the meantime. "
            "Get a fresh one to continue:",
            reply_markup=InlineKeyboardMarkup(
                [
                    [InlineKeyboardButton("🔄 New Quote", callback_data="swap_requote")],
                    [InlineKeyboardButton("❌ Cancel", callback_data="swap_cancel")],
                ]
            ),
        )
        return CONFIRM_SWAP

    status_msg = await update.message.reply_text("⏳ Executing multi-swap...")
    return await _run_confirmed_swap(update, status_msg, context)


async def _run_confirmed_swap(update: Update, message, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Execute the confirmed multi-swap.

    ``message`` is the single Telegram message this swap's execution UI lives
    on — the callback-query's message (button-confirmed swaps) or the message
    created for the 2FA-code reply. It is edited in place through every
    stage via SwapProgressTracker rather than replaced, so the execution
    phase is one message, not a scrolling log. ``edit`` (``message.edit_text``)
    is kept for the few ad hoc status lines that aren't part of the tracked
    stage sequence (e.g. the Solana Deep State Simulation notice); every call
    through it is wrapped in ``_safe_edit`` so a failed edit never aborts the
    swap.
    """
    edit = message.edit_text
    swap_data = context.user_data.get("swap")
    quote: SwapQuote = swap_data.get("quote")
    user_id = context.user_data.get("user_id")
    is_cross_chain = quote.from_chain != quote.to_chain

    # Show safety simulation message for Solana Pro users (ad hoc — not part
    # of the tracked stage sequence below).
    if quote.from_chain == "solana" and quote.to_chain == "solana":
        tier = await x402_service.get_tier(user_id)
        if tier in [SubscriptionTier.PRO, SubscriptionTier.PREMIUM]:
            await _safe_edit(
                edit,
                "🛡️ *Running Deep State Simulation...*\n_Verifying tokens are tradeable and safe._",
                parse_mode="Markdown",
            )

    # One progress bar, edited in place through the remaining stages.
    # "Validating quote" and "Checking balance" already ran above this call
    # (quote_validator.validate_quote_freshness / validate_balance in
    # confirm_swap), so the tracker starts past those two rather than
    # re-claiming they happen here.
    selected_wallet_ids = swap_data.get("selected_wallets", [swap_data.get("wallet_id")])
    tracker = SwapProgressTracker(message, is_cross_chain=is_cross_chain)
    tracker.current_step = 2
    if len(selected_wallet_ids) > 1:
        tracker.title = f"Executing Swap ({len(selected_wallet_ids)} wallets)"

    try:
        attempt_id = swap_data.get("attempt_id") or "no_attempt"

        # "Preparing transaction" in progress.
        await tracker.update()

        # Prepare list of (quote, wallet_id) for execute_multi_swap
        # For simplicity, we use the same quote for all (might need individual ones for strict gas checks)
        quotes_with_wallets = [(quote, wid) for wid in selected_wallet_ids]

        # "Signing transaction" -> "Broadcasting to network" in progress.
        # Signing and broadcasting both happen inside execute_multi_swap —
        # the engine doesn't expose a sub-stage callback — so these two
        # advance back-to-back right before the blocking call; the throttle
        # in ProgressTracker.update() naturally collapses them into whichever
        # one lands, and the final complete() below always renders regardless.
        await tracker.next_step()
        await tracker.next_step()

        swap_results = await swap_engine.execute_multi_swap(
            quotes_with_wallets=quotes_with_wallets,
            user_id=user_id,
            attempt_id=attempt_id,
        )

        # Process results
        num_success = 0
        total_fee_usd = 0
        total_points = 0

        for swap_tx in swap_results:
            if swap_tx.status == SwapStatus.SUBMITTED.value:
                num_success += 1
                fee_amount = swap_data.get("fee_amount", 0)
                fee_percentage = swap_data.get("fee_percentage", 1.0)
                fee_usd = swap_data.get("fee_usd", 0)
                total_fee_usd += fee_usd

                # Record the fee
                fee_service.record_fee(
                    user_id=user_id,
                    chain=swap_data["from_chain"],
                    token_symbol=swap_data["from_token"],
                    swap_amount=quote.from_amount_human,
                    fee_amount=fee_amount,
                    fee_percentage=fee_percentage,
                    fee_amount_usd=fee_usd,
                    swap_id=swap_tx.id,
                )

                # Consume one referee rebate slot if applicable.
                # This is the SINGLE decrement point for referee_swap_rebate_remaining.
                # It runs here — keyed to the actual charged swap — independent of the
                # volume/cap guards inside record_reward. The atomic SQL UPDATE WHERE
                # remaining > 0 is concurrency-safe without an explicit row lock.
                referral_service.consume_referee_rebate(referee_id=user_id)

                # Record referral reward and award points
                referral_service.record_reward(
                    referee_id=user_id,
                    swap_id=swap_tx.id,
                    fee_amount_usd=fee_usd,
                )

                swap_amount_usd = fee_usd / (fee_percentage / 100) if fee_percentage > 0 else 0
                points_earned, _, _ = points_service.award_swap_points(
                    user_id=user_id,
                    swap_amount_usd=swap_amount_usd,
                    swap_id=swap_tx.id,
                    fee_usd=fee_usd,
                )
                total_points += points_earned

        num_fail = len(selected_wallet_ids) - num_success

        # Gas rebate (one-shot points redemption): consume EXACTLY ONCE, and only
        # if a swap actually went through (don't burn the rebate on a fully-failed
        # batch). consume_gas_rebate atomically flips the redemption to 'applied',
        # so it can rebate a single swap and never re-applies. Floor the displayed
        # net gas at 0 — a rebate can offset the gas shown but never go negative.
        gas_rebate_usd = 0.0
        if num_success > 0:
            gas_rebate_usd = points_service.consume_gas_rebate(user_id)

        total_gas_usd = (quote.gas_cost_usd or 0.0) * num_success
        net_gas_usd = max(0.0, total_gas_usd - gas_rebate_usd)
        rebate_line = ""
        if gas_rebate_usd > 0:
            applied = min(gas_rebate_usd, total_gas_usd)
            rebate_line = (
                f"⛽ Gas rebate applied: −{format_usd(applied)} "
                f"(gas now {format_usd(net_gas_usd)})\n"
            )

        text = (
            f"✅ *Multi-Swap Submitted!*\n\n"
            f"• Success: *{num_success}* wallets\n"
            f"• Failed: *{num_fail}* wallets\n\n"
            f"💰 *+{total_points} XP earned!*\n"
            f"Total platform fee: {format_usd(total_fee_usd)} ({swap_data.get('fee_percentage', 0.8)}%)\n"
            f"{rebate_line}\n"
            f"Check individual status in /hx."
        )

        keyboard = [
            [InlineKeyboardButton("🔄 New Swap", callback_data="swap_start")],
            # Post-swap action chips: surface adjacent features in-flow at the
            # highest-intent moment (display only — these are existing, live
            # callbacks; no execution logic changes).
            [
                InlineKeyboardButton("🔔 Alert", callback_data="alerts_menu"),
                InlineKeyboardButton("🔁 DCA", callback_data="dca_menu"),
                InlineKeyboardButton("🛡️ Check", callback_data="paste_check_hint"),
                InlineKeyboardButton("🎁 Refer", callback_data="ref_menu"),
            ],
            # Share moment: a freshly-completed swap is the highest-intent point
            # to ask the user to invite friends. Routed to a top-level handler
            # (swap_share_ref_callback) because the conversation has just ended.
            [InlineKeyboardButton("📣 Share your referral link", callback_data="swap_share_ref")],
            [InlineKeyboardButton("« Main Menu", callback_data="main_menu")],
        ]

        # Final edit: replaces the progress bar entirely with the receipt +
        # terminal keyboard. complete() bypasses the throttle so this always
        # lands even if a stage edit just fired.
        await tracker.complete(success_message=text, reply_markup=InlineKeyboardMarkup(keyboard))

        if num_success > 0:
            await react(update, "🎉")

    except SwapError as e:
        logger.error(
            f"Swap execution failed for user {context.user_data.get('user_id')}: {e}", exc_info=True
        )
        await _render_swap_failure(edit, e, context)
    except Exception as e:
        logger.error(
            f"Swap unexpected error for user {context.user_data.get('user_id')}: {e}", exc_info=True
        )
        await _render_swap_failure(edit, e, context)

    return ConversationHandler.END


async def swap_risk_confirm_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle the secondary confirmation for HIGH/CRITICAL risk tokens.

    The user tapped "I understand, swap anyway" on the risk warning screen.
    Retrieve the pre-built quote message and show the normal confirm screen.
    """
    query = update.callback_query
    await query.answer()

    swap_data = context.user_data.get("swap")
    if not swap_data:
        await query.edit_message_text("❌ Session expired. Start again with /s")
        return ConversationHandler.END

    pending_text = swap_data.pop("pending_confirm_text", None)
    pending_keyboard = swap_data.pop("pending_confirm_keyboard", None)

    if not pending_text or not pending_keyboard:
        # Fallback: session data missing, drop to normal confirm state
        await query.edit_message_text("⚠️ Risk acknowledged. Please use /s to start a new swap.")
        return ConversationHandler.END

    await query.edit_message_text(
        pending_text,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(pending_keyboard),
    )
    return CONFIRM_SWAP


async def swap_cancel(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Cancel the swap flow and return to main menu."""
    query = update.callback_query
    await query.answer("Swap cancelled")

    context.user_data.pop("swap", None)

    # Go straight to main menu
    from bot.handlers.start import main_menu_callback

    await main_menu_callback(update, context)

    return ConversationHandler.END


async def swap_requote(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Get a new quote for the same swap."""
    query = update.callback_query
    await query.answer()

    allowed = await enforce_rate_limit_for_update(update, swap_limiter)
    if not allowed:
        return ConversationHandler.END

    swap_data = context.user_data.get("swap")
    if not swap_data or "amount" not in swap_data:
        await query.edit_message_text("❌ Session expired. Please start over.")
        return ConversationHandler.END

    # Simulate entering the amount again to get a new quote
    # We need to recreate a message-like update
    await query.edit_message_text("⏳ Getting new quote...")

    user_id = context.user_data["user_id"]

    with get_session() as session:
        from_chain_config = get_chain_by_name(swap_data["from_chain"])
        chain_type = from_chain_config.chain_type.value

        wallet = wallet_service.get_default_wallet(user_id, chain_type)
        wallet_address = wallet.address if wallet else None

    if not wallet_address:
        await query.edit_message_text("❌ No wallet found.")
        return ConversationHandler.END

    try:
        quote = await swap_engine.get_quote(
            from_chain=swap_data["from_chain"],
            to_chain=swap_data["to_chain"],
            from_token=swap_data["from_token"],
            to_token=swap_data["to_token"],
            amount=swap_data["amount"],
            from_address=wallet_address,
        )

        context.user_data["swap"]["quote"] = quote
        context.user_data["swap"]["attempt_id"] = secrets.token_urlsafe(16)

        from_chain_config = get_chain_by_name(swap_data["from_chain"])
        to_chain_config = get_chain_by_name(swap_data["to_chain"])
        _pn = {
            "layerzero": "Stargate V2",
            "lifi": "LI.FI",
            "jupiter": "Jupiter",
            "cow": "CoW Protocol",
            "cctp": "Circle CCTP",
            "ccip": "Chainlink CCIP",
        }
        provider_display2 = _pn.get(quote.provider, quote.provider.upper())

        text = (
            f"📊 *Updated Swap Quote*\n\n"
            f"*From:*\n"
            f"{from_chain_config.logo_emoji} {format_amount(quote.from_amount_human, symbol=swap_data['from_token'])}\n"
            f"on {from_chain_config.display_name}\n\n"
            f"*To:*\n"
            f"{to_chain_config.logo_emoji} {format_amount(quote.to_amount_human, symbol=swap_data['to_token'])}\n"
            f"on {to_chain_config.display_name}\n\n"
            f"*Details:*\n"
            f"• Rate: 1 {swap_data['from_token']} = {quote.exchange_rate:.4f} {swap_data['to_token']}\n"
            f"• Gas: {format_usd(quote.gas_cost_usd)}\n"
            f"• Bridge fee: {format_usd(quote.fee_cost_usd)}\n"
            f"• Time: {format_time_estimate(quote.estimated_time)}\n"
            f"• Provider: {provider_display2}"
        )

        keyboard = [
            [
                InlineKeyboardButton("✅ Confirm Swap", callback_data="swap_confirm"),
                InlineKeyboardButton("❌ Cancel", callback_data="swap_cancel"),
            ],
            [InlineKeyboardButton("🔄 Get New Quote", callback_data="swap_requote")],
        ]

        await query.edit_message_text(
            text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard)
        )

        return CONFIRM_SWAP

    except Exception as e:
        logger.error(f"Error in swap_confirm: {e}", exc_info=True)
        await query.edit_message_text(
            "❌ An unexpected error occurred. Please try again.",
            reply_markup=InlineKeyboardMarkup(
                [
                    [InlineKeyboardButton("🔄 Try Again", callback_data="swap_start")],
                ]
            ),
        )
        return ConversationHandler.END


async def check_swap_status(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Check status of a swap."""
    query = update.callback_query
    await query.answer()

    allowed = await enforce_rate_limit_for_update(update, swap_limiter)
    if not allowed:
        return

    try:
        swap_id = int(query.data.replace("swap_status_", ""))
    except ValueError:
        await query.edit_message_text("❌ Invalid swap reference.")
        return

    with get_session() as session:
        swap_tx = session.query(SwapTransaction).filter(SwapTransaction.id == swap_id).first()

        if not swap_tx:
            await query.edit_message_text("❌ Swap not found.")
            return

        # Update status
        swap_tx = await swap_engine.check_status(swap_tx)

        from_chain_config = get_chain_by_name(swap_tx.from_chain)
        to_chain_config = get_chain_by_name(swap_tx.to_chain)

        status_emoji = {
            SwapStatus.PENDING.value: "⏳",
            SwapStatus.EXECUTING.value: "🔄",
            SwapStatus.SUBMITTED.value: "📤",
            SwapStatus.CONFIRMING.value: "⏳",
            SwapStatus.COMPLETED.value: "✅",
            SwapStatus.FAILED.value: "❌",
        }.get(swap_tx.status, "❓")

        text = (
            f"📊 *Swap Status*\n\n"
            f"*{from_chain_config.logo_emoji} {swap_tx.from_token}* → *{to_chain_config.logo_emoji} {swap_tx.to_token}*\n\n"
            f"*Status:* {status_emoji} {swap_tx.status.upper()}\n\n"
        )

        if swap_tx.tx_hash:
            text += f"*Source TX:*\n{format_tx_link(swap_tx.tx_hash, swap_tx.from_chain)}\n\n"

        if swap_tx.destination_tx_hash:
            text += f"*Destination TX:*\n{format_tx_link(swap_tx.destination_tx_hash, swap_tx.to_chain)}\n\n"

        if swap_tx.error_message:
            text += f"*Error:* {swap_tx.error_message}\n"

        keyboard = []
        if swap_tx.status not in [SwapStatus.COMPLETED.value, SwapStatus.FAILED.value]:
            keyboard.append(
                [InlineKeyboardButton("🔄 Refresh Status", callback_data=f"swap_status_{swap_id}")]
            )

        # Surface the shareable PnL card at the natural moment — right after a
        # swap completes — instead of only behind /hx. Routes to the existing
        # read-only pnl_share_ callback (renders the branded card with the
        # sharer's referral link/QR baked in). This is the organic-growth loop.
        if swap_tx.status == SwapStatus.COMPLETED.value:
            keyboard.append(
                [InlineKeyboardButton("📤 Share PnL", callback_data=f"pnl_share_{swap_id}")]
            )

        keyboard.append([InlineKeyboardButton("🔄 New Swap", callback_data="swap_start")])
        keyboard.append([InlineKeyboardButton("« Main Menu", callback_data="main_menu")])

        await query.edit_message_text(
            text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard)
        )


async def _notify_followers(bot, followers_to_notify, swap_data, swap_tx):
    """Send copy trade notifications to followers."""
    from bot.models.user import User
    from bot.services.copy_service import copy_service

    for follower_info in followers_to_notify:
        try:
            follower_id = follower_info["user_id"]
            copy_trade_id = follower_info["copy_trade_id"]
            copy_mode = follower_info["copy_mode"]
            copy_amount = follower_info["copy_amount"]

            # Get follower's Telegram ID
            with get_session() as session:
                follower = session.query(User).filter(User.id == follower_id).first()
                if not follower or not follower.telegram_id:
                    continue

                # Get trader's profile
                trader_profile = copy_service.get_or_create_profile(swap_data.get("user_id"))
                trader_name = trader_profile.display_name if trader_profile else "Trader"

            from_chain_config = get_chain_by_name(swap_data["from_chain"])
            to_chain_config = get_chain_by_name(swap_data["to_chain"])

            msg = (
                f"🔔 *{trader_name} just traded!*\n\n"
                f"{from_chain_config.logo_emoji} *{swap_data['from_token']}* → "
                f"{to_chain_config.logo_emoji} *{swap_data['to_token']}*\n\n"
                f"💰 Amount: ${swap_data.get('amount_usd', 0):.2f}\n"
                f"📋 Your copy: ${copy_amount:.2f}\n"
            )

            if copy_mode == "auto":
                # Auto-copy is enabled, execute immediately
                success, _, _ = await copy_service.execute_copy(follower_id, copy_trade_id)
                if success:
                    msg += "\n✅ *Auto-copied successfully!*"
                else:
                    msg += "\n❌ Auto-copy failed"

                await bot.send_message(
                    chat_id=follower.telegram_id,
                    text=msg,
                    parse_mode="Markdown",
                )
            else:
                # Notify mode - send with buttons
                keyboard = InlineKeyboardMarkup(
                    [
                        [
                            InlineKeyboardButton(
                                "📋 Copy Trade", callback_data=f"copy_execute_{copy_trade_id}"
                            ),
                            InlineKeyboardButton(
                                "⏭️ Skip", callback_data=f"copy_skip_{copy_trade_id}"
                            ),
                        ]
                    ]
                )

                await bot.send_message(
                    chat_id=follower.telegram_id,
                    text=msg,
                    parse_mode="Markdown",
                    reply_markup=keyboard,
                )
        except Exception as e:
            # Don't let notification failures affect the main swap
            import logging

            logging.getLogger(__name__).warning(
                f"Failed to notify follower {follower_info.get('user_id')}: {e}"
            )


# Create conversation handler
async def swap_share_ref_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Top-level handler for the '📣 Share your referral link' button on the
    swap-success card. Sends the user a forwardable invite message built from
    the existing referral-link logic (no duplication).

    Registered standalone in main.py because the swap ConversationHandler has
    already ended by the time the success card is shown.
    """
    query = update.callback_query
    await query.answer()

    user = update.effective_user
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await query.answer("Please /start first.", show_alert=True)
            return
        user_id = db_user.id

    bot_username = (await context.bot.get_me()).username
    share_message = referral_service.format_share_message(user_id, bot_username)

    await context.bot.send_message(
        chat_id=query.message.chat_id,
        text=share_message,
        parse_mode="Markdown",
        disable_web_page_preview=True,
    )
    await query.answer("Forward the message below to invite friends! 📣")


# Standalone callback handler (registered in main.py — the swap conversation has
# ended by the time the share button is shown).
swap_share_ref_handler = CallbackQueryHandler(swap_share_ref_callback, pattern="^swap_share_ref$")


@enforce_tos
async def paste_buy_entry(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Entry point for paste-to-trade Buy buttons.

    The paste-to-trade card (bot/handlers/paste_trade.py) stashes the pending
    token in context.user_data["paste_token"] and renders Buy buttons with
    callback_data "pbuy_<amount>" / "pbuy_custom". This seeds the SAME swap
    context the normal flow builds and hands off to show_wallet_selection, so
    the buy inherits quote → wallet selection → CONFIRM_SWAP → 2FA and spending
    limits. It NEVER calls execute_swap directly — the guardrail.
    """
    query = update.callback_query
    await query.answer()
    user = update.effective_user

    allowed = await enforce_rate_limit_for_update(update, swap_limiter)
    if not allowed:
        return ConversationHandler.END

    token = context.user_data.get("paste_token")
    if not token:
        await query.edit_message_text("❌ Session expired. Paste the token address again.")
        return ConversationHandler.END

    chain = token["chain"]
    address = token["address"]
    chain_config = get_chain_by_name(chain)
    if not chain_config:
        await query.edit_message_text("❌ Unsupported chain for this token.")
        return ConversationHandler.END
    native_symbol = chain_config.native_token
    chain_type = chain_config.chain_type.value

    # xStocks execution-layer geo-gate (buy path).
    # Checked HERE — after the address is known, before any quote or wallet
    # work — so the block is enforced even when a user bypasses the discovery
    # UI and pastes a known mint directly into chat or uses /s.
    if is_xstock_mint(address):
        allowed, reason = xstocks_region_allowed(user.id)
        if not allowed:
            if reason == "unknown":
                block_msg = (
                    "*xStocks require region verification*\n\n"
                    "Tokenized equity trading (xStocks) is only available in jurisdictions "
                    f"outside {XSTOCKS_BLOCKED_REGION_NAMES}.\n\n"
                    "Your account region has not been set.  Please contact support to "
                    "complete region verification before accessing xStocks."
                )
            else:
                block_msg = (
                    "*xStocks are not available in your region*\n\n"
                    f"Trading of tokenized equities (xStocks) is restricted in "
                    f"{XSTOCKS_BLOCKED_REGION_NAMES} due to regulatory requirements "
                    "from the token issuer (Backed Finance).\n\n"
                    "If you believe this is an error, contact support — your account "
                    "region must be set by a verified operator using the /setregion command."
                )
            await query.edit_message_text(block_msg, parse_mode="Markdown")
            return ConversationHandler.END

    # Resolve amount (preset from the button, or hand off to manual entry)
    data = query.data
    if data == "pbuy_custom":
        context.user_data["swap"] = {
            "from_chain": chain,
            "from_token": native_symbol,
            "to_chain": chain,
            "to_token": address,
        }
        with get_session() as session:
            db_user = session.query(User).filter(User.telegram_id == user.id).first()
            if not db_user:
                await query.edit_message_text("❌ Use /start first to set up your account.")
                return ConversationHandler.END
            context.user_data["user_id"] = db_user.id
        await query.edit_message_text(
            f"💱 Buying *{token.get('symbol', 'token')}* with {native_symbol}\n\n"
            f"Enter the amount of {native_symbol} to spend:",
            parse_mode="Markdown",
        )
        return ENTER_AMOUNT

    try:
        amount = float(data.replace("pbuy_", ""))
    except (ValueError, TypeError):
        await query.edit_message_text("❌ Invalid amount.")
        return ConversationHandler.END

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await query.edit_message_text("❌ Use /start first to set up your account.")
            return ConversationHandler.END
        context.user_data["user_id"] = db_user.id

    default_wallet = wallet_service.get_default_wallet(db_user.id, chain_type)
    if not default_wallet:
        await query.edit_message_text(
            f"❌ No {chain_config.display_name} wallet found. Use /wallet to create one."
        )
        return ConversationHandler.END

    context.user_data["swap"] = {
        "from_chain": chain,
        "from_token": native_symbol,
        "to_chain": chain,
        "to_token": address,
        "amount": amount,
        "wallet_id": default_wallet.id,
    }

    _schedule_quote_prewarm(
        context, context.user_data["swap"], default_wallet.id, default_wallet.address
    )

    await query.edit_message_text(
        f"💱 Buying *{token.get('symbol', 'token')}* with "
        f"*{format_amount(amount, symbol=native_symbol)}*\n\nFetching quote...",
        parse_mode="Markdown",
    )
    return await show_wallet_selection(update, context)


swap_conversation_handler = ConversationHandler(
    name="swap",
    persistent=True,
    entry_points=[
        CommandHandler("s", swap_command),
        CallbackQueryHandler(swap_start_callback, pattern="^swap_start$"),
        CallbackQueryHandler(paste_buy_entry, pattern="^pbuy_"),
    ],
    states={
        SELECT_FROM_CHAIN: [
            CallbackQueryHandler(quick_swap_callback, pattern="^quick_swap_"),
            CallbackQueryHandler(select_from_chain, pattern="^from_chain_"),
        ],
        SELECT_FROM_TOKEN: [
            CallbackQueryHandler(select_from_token, pattern="^from_token_"),
            CallbackQueryHandler(swap_start_callback, pattern="^swap_start$"),
        ],
        SELECT_TO_CHAIN: [
            CallbackQueryHandler(select_to_chain, pattern="^to_chain_"),
            CallbackQueryHandler(select_from_chain, pattern="^from_chain_"),
        ],
        SELECT_TO_TOKEN: [
            CallbackQueryHandler(select_to_token, pattern="^to_token_"),
            CallbackQueryHandler(select_from_token, pattern="^from_token_"),
        ],
        ENTER_AMOUNT: [
            CallbackQueryHandler(swap_pct_callback, pattern="^swap_pct_"),
            CallbackQueryHandler(select_to_chain, pattern="^to_chain_"),
            MessageHandler(filters.TEXT & ~filters.COMMAND, enter_amount),
        ],
        SELECT_WALLETS: [
            CallbackQueryHandler(toggle_wallet_callback, pattern="^swap_toggle_wallet_"),
            CallbackQueryHandler(wallets_confirmed_callback, pattern="^swap_wallets_confirmed$"),
        ],
        CONFIRM_SWAP: [
            CallbackQueryHandler(confirm_swap, pattern="^swap_confirm$"),
            CallbackQueryHandler(swap_requote, pattern="^swap_requote$"),
            CallbackQueryHandler(show_wallet_selection, pattern="^swap_back_to_wallets$"),
            CallbackQueryHandler(swap_risk_confirm_callback, pattern="^swap_risk_confirm_"),
        ],
        ENTER_2FA_CODE: [
            MessageHandler(filters.TEXT & ~filters.COMMAND, twofa_code_entered),
            CallbackQueryHandler(swap_requote, pattern="^swap_requote$"),
        ],
    },
    fallbacks=[
        CallbackQueryHandler(swap_cancel, pattern="^swap_cancel$"),
        CommandHandler("cancel", lambda u, c: swap_cancel(u, c)),
    ],
    allow_reentry=True,
    per_message=False,
    per_chat=True,
)
