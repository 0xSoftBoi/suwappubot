"""Swap flow handlers."""

import secrets
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
from bot.services.wallet import WalletService
from bot.services.fee_service import fee_service
from bot.config.chains import CHAINS, ChainType, get_chain_by_name
from bot.config.tokens import get_tokens_for_chain, get_token_address
from bot.utils.formatters import format_amount, format_usd, format_time_estimate, format_tx_link
from bot.utils.validators import validate_amount
from bot.utils.rate_limiter import swap_limiter, enforce_rate_limit_for_update
from database.db import get_session
from bot.utils.tos_utils import enforce_tos
from bot.utils.gating import require_tier
from bot.models.subscription import SubscriptionTier
from bot.services.referral_service import referral_service
from bot.services.points_service import points_service
from bot.services.token_security.token_analyzer import token_analyzer
from bot.services.x402_service import x402_service
from bot.utils.quote_validator import quote_validator
from bot.utils.errors import detect_error_code, detect_error_code_from_exception, get_error_message, format_error_with_buttons
from bot.services.twofa import twofa_service


# Conversation states
SELECT_PAIR, ENTER_AMOUNT, SELECT_WALLETS, CONFIRM_SWAP = range(4)
# Keep old names as aliases for backward compatibility within this module
SELECT_FROM_CHAIN = SELECT_PAIR
SELECT_FROM_TOKEN = SELECT_PAIR
SELECT_TO_CHAIN = SELECT_PAIR
SELECT_TO_TOKEN = SELECT_PAIR

swap_engine = SwapEngine()
wallet_service = WalletService()

import logging
logger = logging.getLogger(__name__)


def _get_recent_and_favorite_pairs(user_id: int) -> list[dict]:
    """Get recent swap pairs and favorites, deduped, max 5 total."""
    from bot.models.swap import SwapTransaction
    pairs = []
    seen = set()

    with get_session() as session:
        # Try favorites first
        try:
            from bot.models.favorites import FavoriteSwapPair
            favs = session.query(FavoriteSwapPair).filter(
                FavoriteSwapPair.user_id == user_id,
            ).order_by(FavoriteSwapPair.use_count.desc()).limit(3).all()
            for f in favs:
                key = (f.from_chain, f.from_token, f.to_chain, f.to_token)
                if key not in seen:
                    seen.add(key)
                    pairs.append({
                        "from_chain": f.from_chain,
                        "from_token": f.from_token,
                        "to_chain": f.to_chain,
                        "to_token": f.to_token,
                    })
        except Exception as e:
            logger.debug(f"Could not load favorite swap pairs: {e}")

        # Recent swaps
        recent = session.query(SwapTransaction).filter(
            SwapTransaction.user_id == user_id,
        ).order_by(SwapTransaction.created_at.desc()).limit(20).all()

        for s in recent:
            if len(pairs) >= 5:
                break
            key = (s.from_chain, s.from_token, s.to_chain, s.to_token)
            if key not in seen:
                seen.add(key)
                pairs.append({
                    "from_chain": s.from_chain,
                    "from_token": s.from_token,
                    "to_chain": s.to_chain,
                    "to_token": s.to_token,
                })

    return pairs[:5]


@enforce_tos
async def swap_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle /swap command."""
    return await start_swap(update, context, is_callback=False)


@enforce_tos
async def swap_start_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle swap_start callback."""
    query = update.callback_query
    await query.answer()
    return await start_swap(update, context, is_callback=True)


async def start_swap(update: Update, context: ContextTypes.DEFAULT_TYPE, is_callback: bool = False) -> int:
    """Start the swap flow."""
    user = update.effective_user
    logger.info("swap_start user_id=%s telegram_id=%s is_callback=%s", user.id if user else None, user.id if user else None, is_callback)

    # Rate limit swap flow entry
    allowed = await enforce_rate_limit_for_update(update, swap_limiter)
    if not allowed:
        logger.info("swap_start rate_limited user_id=%s", user.id if user else None)
        return ConversationHandler.END

    # Clear previous swap data
    context.user_data.pop("swap", None)

    # Check if user has wallets (single query with join)
    with get_session() as session:
        from sqlalchemy.orm import joinedload
        db_user = session.query(User).options(
            joinedload(User.wallets)
        ).filter(User.telegram_id == user.id).first()

        if not db_user:
            text = "❌ Please use /start first to set up your account."
            if is_callback:
                await update.callback_query.edit_message_text(text)
            else:
                await update.message.reply_text(text)
            return ConversationHandler.END

        wallets = [w for w in db_user.wallets if w.is_active]

        if not wallets:
            keyboard = [[InlineKeyboardButton("👛 Add Wallet", callback_data="wallet_menu")]]
            text = "👛 You need to add a wallet first before swapping!"
            if is_callback:
                await update.callback_query.edit_message_text(text, reply_markup=InlineKeyboardMarkup(keyboard))
            else:
                await update.message.reply_text(text, reply_markup=InlineKeyboardMarkup(keyboard))
            return ConversationHandler.END

        context.user_data["user_id"] = db_user.id
        user_id = db_user.id

    # Get recent/favorite pairs for quick selection
    recent_pairs = _get_recent_and_favorite_pairs(user_id)

    pair_buttons = []
    if recent_pairs:
        row = []
        for p in recent_pairs:
            from_chain_cfg = get_chain_by_name(p["from_chain"])
            to_chain_cfg = get_chain_by_name(p["to_chain"])
            from_emoji = from_chain_cfg.logo_emoji if from_chain_cfg else ""
            to_emoji = to_chain_cfg.logo_emoji if to_chain_cfg else ""
            label = f"{p['from_token']}{from_emoji} -> {p['to_token']}{to_emoji}"
            cb = f"swap_pair_{p['from_chain']}_{p['from_token']}_{p['to_chain']}_{p['to_token']}"
            # Telegram callback_data max is 64 bytes; truncate if needed
            if len(cb) <= 64:
                row.append(InlineKeyboardButton(label, callback_data=cb))
            if len(row) == 2:
                pair_buttons.append(row)
                row = []
        if row:
            pair_buttons.append(row)

    # Custom pair falls through to chain selection
    pair_buttons.append([
        InlineKeyboardButton("Custom pair...", callback_data="swap_custom_pair"),
        InlineKeyboardButton("❌ Cancel", callback_data="swap_cancel"),
    ])

    text = "🔄 *New Swap*\n\n"
    if recent_pairs:
        text += "Your pairs:"
    else:
        text += "Select a pair or choose custom:"

    reply_markup = InlineKeyboardMarkup(pair_buttons)

    if is_callback:
        await update.callback_query.edit_message_text(
            text, parse_mode="Markdown", reply_markup=reply_markup
        )
    else:
        await update.message.reply_text(
            text, parse_mode="Markdown", reply_markup=reply_markup
        )

    return SELECT_PAIR


async def swap_pair_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle quick pair selection — jumps directly to ENTER_AMOUNT."""
    query = update.callback_query
    await query.answer()

    # Parse: swap_pair_{from_chain}_{from_token}_{to_chain}_{to_token}
    parts = query.data.replace("swap_pair_", "").split("_")
    if len(parts) < 4:
        await query.edit_message_text("❌ Invalid pair. Please try again.")
        return ConversationHandler.END

    from_chain, from_token, to_chain, to_token = parts[0], parts[1], parts[2], parts[3]
    user_id = context.user_data.get("user_id")
    logger.info("swap_pair_selected user_id=%s pair=%s/%s->%s/%s", user_id, from_chain, from_token, to_chain, to_token)

    context.user_data["swap"] = {
        "from_chain": from_chain,
        "from_token": from_token,
        "to_chain": to_chain,
        "to_token": to_token,
    }

    from_chain_config = get_chain_by_name(from_chain)
    to_chain_config = get_chain_by_name(to_chain)

    text = (
        f"🔄 *New Swap*\n\n"
        f"{from_chain_config.logo_emoji} From: *{from_chain_config.display_name}* ({from_token})\n"
        f"{to_chain_config.logo_emoji} To: *{to_chain_config.display_name}* ({to_token})\n\n"
        f"Enter the amount to swap:"
    )

    # Build quickbuy preset row
    native_token = "SOL" if from_chain_config.chain_type == ChainType.SOLANA else "ETH"
    quickbuy_amounts = [0.1, 0.5, 1.0, 5.0]
    quickbuy_row = [
        InlineKeyboardButton(f"{amt} {native_token}", callback_data=f"swap_qb_{amt}")
        for amt in quickbuy_amounts
    ]

    keyboard = [
        quickbuy_row,
        [
            InlineKeyboardButton("25%", callback_data="swap_pct_25"),
            InlineKeyboardButton("50%", callback_data="swap_pct_50"),
            InlineKeyboardButton("75%", callback_data="swap_pct_75"),
            InlineKeyboardButton("Max", callback_data="swap_pct_100"),
        ],
        [InlineKeyboardButton("❌ Cancel", callback_data="swap_cancel")],
    ]

    await query.edit_message_text(
        text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard)
    )

    return ENTER_AMOUNT


async def swap_custom_pair_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle 'Custom pair...' — shows chain selection flow."""
    query = update.callback_query
    await query.answer()

    text = "🔄 *New Swap*\n\nSelect the source chain:"

    chain_buttons = []
    row = []
    for name, chain in CHAINS.items():
        btn = InlineKeyboardButton(
            f"{chain.logo_emoji} {chain.display_name}",
            callback_data=f"from_chain_{name}"
        )
        row.append(btn)
        if len(row) == 2:
            chain_buttons.append(row)
            row = []
    if row:
        chain_buttons.append(row)

    chain_buttons.append([InlineKeyboardButton("❌ Cancel", callback_data="swap_cancel")])

    await query.edit_message_text(
        text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(chain_buttons)
    )

    return SELECT_PAIR


async def swap_pct_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle percentage buttons (25%, 50%, 75%, Max) for amount entry."""
    query = update.callback_query
    await query.answer()

    pct = int(query.data.replace("swap_pct_", ""))
    user_id = context.user_data.get("user_id")
    swap_data = context.user_data.get("swap", {})
    from_chain = swap_data.get("from_chain")
    from_token = swap_data.get("from_token")

    if not from_chain or not from_token:
        await query.edit_message_text("❌ Session expired. Please start over.")
        return ConversationHandler.END

    from_chain_config = get_chain_by_name(from_chain)
    chain_type = "solana" if from_chain_config.chain_type == ChainType.SOLANA else "evm"

    default_wallet = wallet_service.get_default_wallet(user_id, chain_type)
    if not default_wallet:
        await query.edit_message_text("❌ No wallet found for this chain.")
        return ConversationHandler.END

    try:
        if chain_type == "evm":
            if from_token in ["ETH", "BNB", "MATIC", "AVAX"]:
                balance = await wallet_service.get_evm_native_balance(from_chain, default_wallet.address)
            else:
                balance = await wallet_service.get_evm_token_balance(from_chain, from_token, default_wallet.address)
        else:
            if from_token == "SOL":
                balance = await wallet_service.get_solana_native_balance(default_wallet.address)
            else:
                balance = await wallet_service.get_solana_token_balance(from_token, default_wallet.address)
    except Exception as e:
        logger.warning(f"Balance fetch failed for pct swap: {e}")
        await query.edit_message_text("❌ Could not fetch balance. Please enter amount manually.")
        return ENTER_AMOUNT

    amount = balance * (pct / 100.0)
    if amount <= 0:
        await query.edit_message_text(
            f"❌ Insufficient {from_token} balance.",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("🔄 Try Again", callback_data="swap_start")],
                [InlineKeyboardButton("« Main Menu", callback_data="main_menu")],
            ])
        )
        return ConversationHandler.END

    swap_data["amount"] = round(amount, 8)
    swap_data["wallet_id"] = default_wallet.id

    # Auto-skip wallet selection if only 1 wallet for this chain type
    with get_session() as session:
        wallet_count = session.query(Wallet).filter(
            Wallet.user_id == user_id,
            Wallet.chain_type == chain_type,
            Wallet.is_active == True,
        ).count()

    if wallet_count <= 1:
        swap_data["selected_wallets"] = [default_wallet.id]
        return await _show_quote(update, context)

    return await show_wallet_selection(update, context)


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
    
    text = f"🔄 *New Swap*\n\n{chain.logo_emoji} From: *{chain.display_name}*\n\nSelect the token to swap:"
    
    token_buttons = []
    row = []
    for token in tokens:
        btn = InlineKeyboardButton(
            f"{token.logo_emoji} {token.symbol}",
            callback_data=f"from_token_{token.symbol}"
        )
        row.append(btn)
        if len(row) == 2:
            token_buttons.append(row)
            row = []
    if row:
        token_buttons.append(row)
    
    token_buttons.append([
        InlineKeyboardButton("« Back", callback_data="swap_start"),
        InlineKeyboardButton("❌ Cancel", callback_data="swap_cancel"),
    ])
    
    await query.edit_message_text(
        text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(token_buttons)
    )
    
    return SELECT_FROM_TOKEN


async def select_from_token(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle source token selection."""
    query = update.callback_query
    await query.answer()
    
    token_symbol = query.data.replace("from_token_", "")
    context.user_data["swap"]["from_token"] = token_symbol
    
    from_chain = context.user_data["swap"]["from_chain"]
    from_chain_config = get_chain_by_name(from_chain)
    
    text = (
        f"🔄 *New Swap*\n\n"
        f"{from_chain_config.logo_emoji} From: *{from_chain_config.display_name}* ({token_symbol})\n\n"
        f"Select the destination chain:"
    )
    
    # Build chain buttons
    chain_buttons = []
    row = []
    for name, chain in CHAINS.items():
        btn = InlineKeyboardButton(
            f"{chain.logo_emoji} {chain.display_name}",
            callback_data=f"to_chain_{name}"
        )
        row.append(btn)
        if len(row) == 2:
            chain_buttons.append(row)
            row = []
    if row:
        chain_buttons.append(row)
    
    chain_buttons.append([
        InlineKeyboardButton("« Back", callback_data=f"from_chain_{from_chain}"),
        InlineKeyboardButton("❌ Cancel", callback_data="swap_cancel"),
    ])
    
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
    
    context.user_data["swap"]["to_chain"] = chain_name
    
    # Get available tokens
    tokens = get_tokens_for_chain(chain_name)
    
    from_chain = context.user_data["swap"]["from_chain"]
    from_token = context.user_data["swap"]["from_token"]
    from_chain_config = get_chain_by_name(from_chain)
    
    text = (
        f"🔄 *New Swap*\n\n"
        f"{from_chain_config.logo_emoji} From: *{from_chain_config.display_name}* ({from_token})\n"
        f"{chain.logo_emoji} To: *{chain.display_name}*\n\n"
        f"Select the token to receive:"
    )
    
    token_buttons = []
    row = []
    for token in tokens:
        btn = InlineKeyboardButton(
            f"{token.logo_emoji} {token.symbol}",
            callback_data=f"to_token_{token.symbol}"
        )
        row.append(btn)
        if len(row) == 2:
            token_buttons.append(row)
            row = []
    if row:
        token_buttons.append(row)
    
    token_buttons.append([
        InlineKeyboardButton("« Back", callback_data=f"from_token_{from_token}"),
        InlineKeyboardButton("❌ Cancel", callback_data="swap_cancel"),
    ])
    
    await query.edit_message_text(
        text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(token_buttons)
    )
    
    return SELECT_TO_TOKEN


async def select_to_token(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle destination token selection."""
    query = update.callback_query
    await query.answer()
    
    token_symbol = query.data.replace("to_token_", "")
    context.user_data["swap"]["to_token"] = token_symbol
    
    swap_data = context.user_data["swap"]
    from_chain_config = get_chain_by_name(swap_data["from_chain"])
    to_chain_config = get_chain_by_name(swap_data["to_chain"])
    
    text = (
        f"🔄 *New Swap*\n\n"
        f"{from_chain_config.logo_emoji} From: *{from_chain_config.display_name}* ({swap_data['from_token']})\n"
        f"{to_chain_config.logo_emoji} To: *{to_chain_config.display_name}* ({token_symbol})\n\n"
        f"Enter the amount to swap:"
    )

    # Build quickbuy preset row
    native_token = "SOL" if from_chain_config.chain_type == ChainType.SOLANA else "ETH"
    quickbuy_amounts = [0.1, 0.5, 1.0, 5.0]
    quickbuy_row = [
        InlineKeyboardButton(f"{amt} {native_token}", callback_data=f"swap_qb_{amt}")
        for amt in quickbuy_amounts
    ]

    keyboard = [
        quickbuy_row,
        [
            InlineKeyboardButton("25%", callback_data="swap_pct_25"),
            InlineKeyboardButton("50%", callback_data="swap_pct_50"),
            InlineKeyboardButton("75%", callback_data="swap_pct_75"),
            InlineKeyboardButton("Max", callback_data="swap_pct_100"),
        ],
        [InlineKeyboardButton("❌ Cancel", callback_data="swap_cancel")],
    ]

    await query.edit_message_text(
        text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard)
    )

    return ENTER_AMOUNT


async def enter_amount(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle amount input."""
    allowed = await enforce_rate_limit_for_update(update, swap_limiter)
    if not allowed:
        return ConversationHandler.END

    user_id = context.user_data.get("user_id")
    raw_text = update.message.text
    amount = validate_amount(raw_text)

    if amount is None:
        logger.info("enter_amount invalid user_id=%s raw=%s", user_id, raw_text[:30])
        await update.message.reply_text(
            "❌ Invalid amount. Please enter a valid number (e.g., 100 or 50.5):"
        )
        return ENTER_AMOUNT

    logger.info("enter_amount user_id=%s amount=%s token=%s", user_id, amount, context.user_data.get("swap", {}).get("from_token"))
    context.user_data["swap"]["amount"] = amount

    # Get default wallet to start selection
    user_id = context.user_data["user_id"]
    from_chain_config = get_chain_by_name(context.user_data["swap"]["from_chain"])
    chain_type = "solana" if from_chain_config.chain_type == ChainType.SOLANA else "evm"

    default_wallet = wallet_service.get_default_wallet(user_id, chain_type)
    if not default_wallet:
        await update.message.reply_text("❌ No wallet found for this chain.")
        return ConversationHandler.END

    context.user_data["swap"]["wallet_id"] = default_wallet.id

    # Auto-skip wallet selection if only 1 wallet for this chain type
    with get_session() as session:
        wallet_count = session.query(Wallet).filter(
            Wallet.user_id == user_id,
            Wallet.chain_type == chain_type,
            Wallet.is_active == True,
        ).count()

    if wallet_count <= 1:
        context.user_data["swap"]["selected_wallets"] = [default_wallet.id]
        return await _show_quote(update, context)

    # Transition to Wallet Selection
    return await show_wallet_selection(update, context)

async def _show_quote(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Skip wallet selection and go straight to getting a quote.

    Works from both message and callback_query contexts by delegating
    to wallets_confirmed_callback after ensuring selected_wallets is set.
    """
    swap_data = context.user_data.get("swap", {})
    if "selected_wallets" not in swap_data:
        swap_data["selected_wallets"] = [swap_data.get("wallet_id")]

    # We need a callback_query context to call wallets_confirmed_callback.
    # If we came from a message, send a loading message and simulate.
    if update.callback_query:
        return await wallets_confirmed_callback(update, context)
    else:
        # From text entry - send loading and get quote inline
        loading_msg = await update.message.reply_text("⏳ Getting quote...")
        # We'll reuse wallets_confirmed logic manually
        user_id = context.user_data["user_id"]
        selected_wallet_ids = swap_data["selected_wallets"]

        try:
            with get_session() as session:
                ref_wallet = session.query(Wallet).filter(Wallet.id == selected_wallet_ids[0]).first()
                wallet_address = ref_wallet.address

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

            fee_amount, fee_percentage, fee_usd = await fee_service.calculate_fee_with_price(
                amount=quote.from_amount_human,
                token_symbol=swap_data["from_token"],
            )
            num_wallets = len(selected_wallet_ids)

            # MEV protection indicator
            mev_providers = {"cow", "jito"}
            if quote.provider in mev_providers:
                mev_line = f"\n🛡️ *MEV Protected* via {quote.provider.upper()}"
            else:
                mev_line = ""

            # Token security analysis
            security_text = ""
            dex_url = None
            try:
                dest_chain = swap_data["to_chain"]
                dest_token_address = get_token_address(swap_data["to_token"], dest_chain)
                if dest_token_address:
                    report = await token_analyzer.analyze(dest_token_address, chain=dest_chain)
                    security_text = f"\n\n🛡️ *Security Shield*\n{token_analyzer.get_safety_summary(report)}"
                    dex_url = report.dex_url
            except Exception as e:
                import logging as _log
                _log.getLogger(__name__).debug(f"Security analysis failed: {e}")

            text = (
                f"📊 *Swap Quote*\n\n"
                f"*From:*\n"
                f"{from_chain_config.logo_emoji} {format_amount(quote.from_amount_human, symbol=swap_data['from_token'])}\n"
                f"on {from_chain_config.display_name}\n\n"
                f"*To (after fees):*\n"
                f"{to_chain_config.logo_emoji} ~{format_amount(quote.to_amount_human, symbol=swap_data['to_token'])}\n"
                f"on {to_chain_config.display_name}\n\n"
                f"*Fees:*\n"
                f"• Platform fee: {fee_percentage}% ({format_usd(fee_usd)})\n"
                f"• Provider: {quote.provider.upper()}"
                f"{mev_line}"
                f"{security_text}"
            )

            keyboard = [
                [
                    InlineKeyboardButton("🚀 Confirm Swap", callback_data="swap_confirm"),
                    InlineKeyboardButton("❌ Cancel", callback_data="swap_cancel"),
                ],
            ]
            if dex_url:
                keyboard.append([InlineKeyboardButton("📈 DexScreener Chart", url=dex_url)])

            await loading_msg.edit_text(
                text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard)
            )

            return CONFIRM_SWAP

        except SwapError as e:
            await loading_msg.edit_text(
                f"❌ Error getting quote: {str(e)}",
                reply_markup=InlineKeyboardMarkup([
                    [InlineKeyboardButton("🔄 Try Again", callback_data="swap_start")],
                    [InlineKeyboardButton("« Main Menu", callback_data="main_menu")],
                ]),
            )
            return ConversationHandler.END
        except Exception as e:
            await loading_msg.edit_text(
                f"❌ Unexpected error: {str(e)}",
                reply_markup=InlineKeyboardMarkup([
                    [InlineKeyboardButton("🔄 Try Again", callback_data="swap_start")],
                    [InlineKeyboardButton("« Main Menu", callback_data="main_menu")],
                ]),
            )
            return ConversationHandler.END


async def show_wallet_selection(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Show multi-wallet selection screen."""
    swap_data = context.user_data["swap"]
    user_id = context.user_data["user_id"]
    from_chain_config = get_chain_by_name(swap_data["from_chain"])
    chain_type = "solana" if from_chain_config.chain_type == ChainType.SOLANA else "evm"
    logger.info("show_wallet_selection user_id=%s chain_type=%s", user_id, chain_type)

    with get_session() as session:
        wallets = session.query(Wallet).filter(
            Wallet.user_id == user_id,
            Wallet.chain_type == chain_type,
            Wallet.is_active == True,
        ).all()
        
        if not wallets:
            logger.info("show_wallet_selection no_wallets user_id=%s chain_type=%s", user_id, chain_type)
            await update.message.reply_text("❌ No wallets found. Please add one first.")
            return ConversationHandler.END

        logger.info("show_wallet_selection found=%d wallets user_id=%s", len(wallets), user_id)
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
        keyboard.append([InlineKeyboardButton(btn_text, callback_data=f"swap_toggle_wallet_{w.id}")])
    
    keyboard.append([
        InlineKeyboardButton("✅ Confirm Selection", callback_data="swap_wallets_confirmed"),
        InlineKeyboardButton("❌ Cancel", callback_data="swap_cancel"),
    ])
    
    if update.callback_query:
        await update.callback_query.edit_message_text(text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard))
    else:
        await update.message.reply_text(text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard))
        
    return SELECT_WALLETS


async def toggle_wallet_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Toggle a wallet in the selection list."""
    query = update.callback_query
    await query.answer()
    
    wallet_id = int(query.data.replace("swap_toggle_wallet_", ""))
    swap_data = context.user_data["swap"]
    
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
    
    swap_data = context.user_data["swap"]
    user_id = context.user_data["user_id"]
    selected_wallet_ids = swap_data.get("selected_wallets", [])
    
    if not selected_wallet_ids:
        await query.edit_message_text("❌ Please select at least one wallet.")
        return SELECT_WALLETS
        
    await query.edit_message_text("⏳ Getting quotes for all wallets...")
    logger.info("quote_request user_id=%s wallets=%d pair=%s/%s->%s/%s amount=%s",
                user_id, len(selected_wallet_ids),
                swap_data.get("from_chain"), swap_data.get("from_token"),
                swap_data.get("to_chain"), swap_data.get("to_token"),
                swap_data.get("amount"))

    try:
        # For simplicity, we get one quote and assume it applies to all
        # (in a professional setup we'd get individual quotes, but here
        # we'll start with the default wallet's quote as a reference)
        with get_session() as session:
            ref_wallet = session.query(Wallet).filter(Wallet.id == selected_wallet_ids[0]).first()
            wallet_address = ref_wallet.address

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
        logger.info("quote_received user_id=%s provider=%s rate=%.6f to_amount=%.6f gas_usd=%.4f",
                    user_id, quote.provider, quote.exchange_rate, quote.to_amount_human, quote.gas_cost_usd)

        from_chain_config = get_chain_by_name(swap_data["from_chain"])
        to_chain_config = get_chain_by_name(swap_data["to_chain"])

        # Fees info
        fee_amount, fee_percentage, fee_usd = await fee_service.calculate_fee_with_price(
            amount=quote.from_amount_human,
            token_symbol=swap_data["from_token"],
        )
        num_wallets = len(selected_wallet_ids)
        total_fee_usd = fee_usd * num_wallets
        total_from_human = quote.from_amount_human * num_wallets
        
        # MEV protection indicator
        mev_providers = {"cow", "jito"}
        if quote.provider in mev_providers:
            mev_line = f"\n🛡️ *MEV Protected* via {quote.provider.upper()}"
        else:
            mev_line = ""

        # Token Security Analysis (all chains via GoPlus + DexScreener)
        security_text = ""
        dex_url = None
        try:
            dest_chain = swap_data["to_chain"]
            dest_token_address = get_token_address(swap_data["to_token"], dest_chain)
            if dest_token_address:
                report = await token_analyzer.analyze(dest_token_address, chain=dest_chain)
                security_text = f"\n\n🛡️ *Security Shield*\n{token_analyzer.get_safety_summary(report)}"
                dex_url = report.dex_url
        except Exception as e:
            logger.debug(f"Security analysis failed: {e}")

        text = (
            f"📊 *Multi-Wallet Swap Quote*\n\n"
            f"*From:*\n"
            f"{from_chain_config.logo_emoji} {format_amount(quote.from_amount_human, symbol=swap_data['from_token'])} "
            f"x *{num_wallets} wallets* (Total: {format_amount(total_from_human, symbol=swap_data['from_token'])})\n"
            f"on {from_chain_config.display_name}\n\n"
            f"*To (after fees):*\n"
            f"{to_chain_config.logo_emoji} ~{format_amount(quote.to_amount_human, symbol=swap_data['to_token'])}\n"
            f"on {to_chain_config.display_name}\n\n"
            f"*Fees (Combined):*\n"
            f"• Platform fee: {fee_percentage}% ({format_usd(total_fee_usd)})\n"
            f"• Provider: {quote.provider.upper()}"
            f"{mev_line}"
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
        if dex_url:
            keyboard.append([InlineKeyboardButton("📈 DexScreener Chart", url=dex_url)])
        
        await query.edit_message_text(
            text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard)
        )
        
        return CONFIRM_SWAP
        
    except SwapError as e:
        await query.edit_message_text(
            f"❌ Error getting quote: {str(e)}",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("🔄 Try Again", callback_data="swap_start")],
                [InlineKeyboardButton("« Main Menu", callback_data="main_menu")],
            ]),
        )
        return ConversationHandler.END
    except Exception as e:
        await query.edit_message_text(
            f"❌ Unexpected error: {str(e)}",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("🔄 Try Again", callback_data="swap_start")],
                [InlineKeyboardButton("« Main Menu", callback_data="main_menu")],
            ]),
        )
        return ConversationHandler.END


async def confirm_swap(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle swap confirmation."""
    query = update.callback_query
    await query.answer()
    
    allowed = await enforce_rate_limit_for_update(update, swap_limiter)
    if not allowed:
        return ConversationHandler.END

    swap_data = context.user_data.get("swap")
    quote: SwapQuote = swap_data.get("quote")
    user_id = context.user_data.get("user_id")
    wallet_id = swap_data.get("wallet_id")
    
    if not quote:
        logger.warning("confirm_swap quote_missing user_id=%s", user_id)
        await query.edit_message_text("❌ Quote expired. Please start over.")
        return ConversationHandler.END

    logger.info("confirm_swap user_id=%s provider=%s from=%s/%s to=%s/%s amount=%s",
                user_id, quote.provider, quote.from_chain, quote.from_token,
                quote.to_chain, quote.to_token, quote.from_amount_human)

    # Check if 2FA is required for high-value swaps
    swap_amount_usd = quote.from_amount_human  # Approximate USD value
    if twofa_service.requires_2fa(user_id, swap_amount_usd):
        # Check if user already provided 2FA code in this attempt
        if not swap_data.get("2fa_verified"):
            code = twofa_service.generate_simple_code(user_id, action_data={"attempt_id": swap_data.get("attempt_id")})
            await query.edit_message_text(
                f"🔐 *2FA Required*\n\n"
                f"This swap exceeds your security threshold "
                f"(${twofa_service.get_2fa_threshold(user_id):,.0f}).\n\n"
                f"Your verification code: `{code}`\n"
                f"Please reply with this code to confirm.",
                parse_mode="Markdown",
            )
            swap_data["awaiting_2fa"] = True
            return CONFIRM_SWAP

    # Validate quote freshness (30s expiry via quote_validator)
    try:
        quote_validator.validate_quote_freshness(quote)
    except SwapError as e:
        await query.edit_message_text(
            f"⏰ {str(e)}",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("🔄 New Quote", callback_data="swap_requote")],
                [InlineKeyboardButton("« Main Menu", callback_data="main_menu")],
            ])
        )
        return ConversationHandler.END
    
    # Pre-validate balance and gas for all selected wallets
    selected_wallet_ids = swap_data.get("selected_wallets", [swap_data.get("wallet_id")])

    with get_session() as session:
        wallets = session.query(Wallet).filter(Wallet.id.in_(selected_wallet_ids)).all()
        wallet_map = {w.id: w for w in wallets}

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
                await quote_validator.validate_gas(
                    wallet_address=wallet.address,
                    quote=quote,
                    wallet_service=wallet_service,
                )
            except SwapError as e:
                await query.edit_message_text(
                    f"❌ Insufficient funds on wallet {wallet.name[:20]}\n\n{str(e)}",
                    reply_markup=InlineKeyboardMarkup([
                        [InlineKeyboardButton("« Back", callback_data="swap_back_to_wallets")],
                        [InlineKeyboardButton("❌ Cancel", callback_data="swap_cancel")],
                    ])
                )
                return ConversationHandler.END

    # Show progress indicator with details
    from_chain_cfg = get_chain_by_name(quote.from_chain)
    to_chain_cfg = get_chain_by_name(quote.to_chain)
    status_text = (
        f"⏳ *Executing Swap...*\n\n"
        f"{from_chain_cfg.logo_emoji} {format_amount(quote.from_amount_human, symbol=quote.from_token)} → "
        f"{to_chain_cfg.logo_emoji} ~{format_amount(quote.to_amount_human, symbol=quote.to_token)}\n\n"
        f"🔄 Preparing transaction..."
    )
    if quote.from_chain == "solana" and quote.to_chain == "solana":
        tier = await x402_service.get_tier(user_id)
        if tier in [SubscriptionTier.PRO, SubscriptionTier.PREMIUM]:
            status_text = (
                f"🛡️ *Running Deep State Simulation...*\n\n"
                f"{from_chain_cfg.logo_emoji} {format_amount(quote.from_amount_human, symbol=quote.from_token)} → "
                f"{to_chain_cfg.logo_emoji} ~{format_amount(quote.to_amount_human, symbol=quote.to_token)}\n\n"
                f"_Verifying tokens are tradeable and safe._"
            )

    await query.edit_message_text(status_text, parse_mode="Markdown")
    
    try:
        attempt_id = swap_data.get("attempt_id") or "no_attempt"
        selected_wallet_ids = swap_data.get("selected_wallets", [swap_data.get("wallet_id")])

        # Progress update: building transactions
        if len(selected_wallet_ids) > 1:
            await query.edit_message_text(
                f"⏳ *Building transactions*\n\n"
                f"Preparing swaps for *{len(selected_wallet_ids)}* wallets...\n"
                f"Provider: {quote.provider.upper()}",
                parse_mode="Markdown"
            )

        # Prepare list of (quote, wallet_id) for execute_multi_swap
        # For simplicity, we use the same quote for all (might need individual ones for strict gas checks)
        quotes_with_wallets = []
        for wid in selected_wallet_ids:
            quotes_with_wallets.append((quote, wid))

        logger.info("swap_execute_start user_id=%s wallets=%d attempt=%s provider=%s",
                    user_id, len(selected_wallet_ids), attempt_id, quote.provider)

        swap_results = await swap_engine.execute_multi_swap(
            quotes_with_wallets=quotes_with_wallets,
            user_id=user_id,
            attempt_id=attempt_id,
        )

        # Progress update: processing results
        await query.edit_message_text("⏳ Processing results...", parse_mode="Markdown")

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
                
                # Record reward and award points
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
                )
                total_points += points_earned
        
        num_fail = len(selected_wallet_ids) - num_success
        logger.info("swap_complete user_id=%s success=%d fail=%d total_points=%d total_fee_usd=%.4f",
                    user_id, num_success, num_fail, total_points, total_fee_usd)

        from_tok = swap_data.get("from_token", "")
        to_tok = swap_data.get("to_token", "")
        amt = swap_data.get("amount", "")
        chain_hint = swap_data.get("from_chain", "")

        text = (
            f"✅ *Multi-Swap Submitted!*\n\n"
            f"• Success: *{num_success}* wallets\n"
            f"• Failed: *{num_fail}* wallets\n\n"
            f"💰 *+{total_points} XP earned!*\n"
            f"Total platform fee: {format_usd(total_fee_usd)}\n\n"
            f"Check individual status in /hx.\n\n"
            f"_Next time: /s {amt} {from_tok} {to_tok} {chain_hint}_"
        )

        keyboard = [
            [
                InlineKeyboardButton("Sell 25%", callback_data=f"qsell_25_{to_tok}_{chain_hint}"),
                InlineKeyboardButton("Sell 50%", callback_data=f"qsell_50_{to_tok}_{chain_hint}"),
                InlineKeyboardButton("Sell 100%", callback_data=f"qsell_100_{to_tok}_{chain_hint}"),
            ],
            [InlineKeyboardButton("🔄 New Swap", callback_data="swap_start")],
            [InlineKeyboardButton("« Main Menu", callback_data="main_menu")],
        ]

        await query.edit_message_text(
            text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard)
        )
        
    except SwapError as e:
        error_code = detect_error_code_from_exception(e)
        error_obj = get_error_message(error_code)
        logger.warning("swap_error user_id=%s code=%s msg=%s", user_id, error_code, str(e)[:200])
        text, keyboard = format_error_with_buttons(error_obj)
        if not keyboard:
            keyboard = InlineKeyboardMarkup([
                [InlineKeyboardButton("🔄 Try Again", callback_data="swap_start")],
                [InlineKeyboardButton("« Main Menu", callback_data="main_menu")],
            ])
        await query.edit_message_text(text, reply_markup=keyboard)
    except Exception as e:
        error_code = detect_error_code_from_exception(e)
        error_obj = get_error_message(error_code)
        logger.error("swap_unexpected_error user_id=%s code=%s msg=%s", user_id, error_code, str(e)[:200], exc_info=True)
        text, keyboard = format_error_with_buttons(error_obj)
        if not keyboard:
            keyboard = InlineKeyboardMarkup([
                [InlineKeyboardButton("🔄 Try Again", callback_data="swap_start")],
                [InlineKeyboardButton("« Main Menu", callback_data="main_menu")],
            ])
        await query.edit_message_text(text, reply_markup=keyboard)

    return ConversationHandler.END


async def handle_2fa_code(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle 2FA verification code input during swap confirmation."""
    swap_data = context.user_data.get("swap", {})
    user_id = context.user_data.get("user_id")

    if not swap_data.get("awaiting_2fa"):
        return CONFIRM_SWAP

    code = update.message.text.strip()
    success, _ = twofa_service.verify_simple_code(user_id, code)

    if not success:
        await update.message.reply_text(
            "❌ Invalid or expired code. Please try again or /cancel.",
        )
        return CONFIRM_SWAP

    swap_data["2fa_verified"] = True
    swap_data["awaiting_2fa"] = False

    # Re-trigger confirmation by simulating the confirm callback
    await update.message.reply_text("✅ Verified! Executing swap...")

    # Create a synthetic callback to trigger confirm_swap
    # We proceed manually since we're in a message context
    return await _execute_confirmed_swap(update, context)


async def _execute_confirmed_swap(update, context):
    """Execute swap after all checks pass (used by both callback and 2FA flows)."""
    # This delegates to confirm_swap logic but the actual execution
    # happens in confirm_swap via the callback. Since the 2FA flag
    # is set, confirm_swap will skip the 2FA gate on next callback.
    keyboard = InlineKeyboardMarkup([
        [InlineKeyboardButton("🚀 Execute Now", callback_data="swap_confirm")],
        [InlineKeyboardButton("❌ Cancel", callback_data="swap_cancel")],
    ])
    msg = update.message or getattr(getattr(update, "callback_query", None), "message", None)
    if msg:
        await msg.reply_text(
            "Press Execute Now to complete your swap:",
            reply_markup=keyboard,
        )
    return CONFIRM_SWAP


async def swap_cancel(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Cancel the swap flow."""
    query = update.callback_query
    await query.answer()

    user_id = context.user_data.get("user_id")
    logger.info("swap_cancel user_id=%s", user_id)
    context.user_data.pop("swap", None)
    
    await query.edit_message_text(
        "❌ Swap cancelled.",
        reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton("🔄 New Swap", callback_data="swap_start")],
            [InlineKeyboardButton("« Main Menu", callback_data="main_menu")],
        ]),
    )
    
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

    user_id = context.user_data.get("user_id")
    logger.info("swap_requote user_id=%s pair=%s/%s->%s/%s amount=%s",
                user_id, swap_data.get("from_chain"), swap_data.get("from_token"),
                swap_data.get("to_chain"), swap_data.get("to_token"), swap_data.get("amount"))

    # Simulate entering the amount again to get a new quote
    # We need to recreate a message-like update
    await query.edit_message_text("⏳ Getting new quote...")
    
    user_id = context.user_data["user_id"]
    
    with get_session() as session:
        from_chain_config = get_chain_by_name(swap_data["from_chain"])
        chain_type = "solana" if from_chain_config.chain_type == ChainType.SOLANA else "evm"
        
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
            f"• Provider: {quote.provider.upper()}"
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
        
    except SwapError as e:
        await query.edit_message_text(
            f"❌ Quote error: {str(e)}",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("🔄 Try Again", callback_data="swap_start")],
            ]),
        )
        return ConversationHandler.END
    except Exception as e:
        logger.error(f"Unexpected error in swap_requote: {e}", exc_info=True)
        await query.edit_message_text(
            f"❌ Unexpected error: {str(e)}",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("🔄 Try Again", callback_data="swap_start")],
            ]),
        )
        return ConversationHandler.END


async def check_swap_status(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Check status of a swap."""
    query = update.callback_query
    await query.answer()

    allowed = await enforce_rate_limit_for_update(update, swap_limiter)
    if not allowed:
        return
    
    swap_id = int(query.data.replace("swap_status_", ""))
    
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
            keyboard.append([InlineKeyboardButton("🔄 Refresh Status", callback_data=f"swap_status_{swap_id}")])
        
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
                keyboard = InlineKeyboardMarkup([
                    [
                        InlineKeyboardButton("📋 Copy Trade", callback_data=f"copy_execute_{copy_trade_id}"),
                        InlineKeyboardButton("⏭️ Skip", callback_data=f"copy_skip_{copy_trade_id}"),
                    ]
                ])
                
                await bot.send_message(
                    chat_id=follower.telegram_id,
                    text=msg,
                    parse_mode="Markdown",
                    reply_markup=keyboard,
                )
        except Exception as e:
            # Don't let notification failures affect the main swap
            import logging
            logging.getLogger(__name__).warning(f"Failed to notify follower {follower_info.get('user_id')}: {e}")


async def swap_quickbuy_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle quickbuy preset amount selection."""
    query = update.callback_query
    await query.answer()

    amount = float(query.data.replace("swap_qb_", ""))
    swap_data = context.user_data.get("swap", {})
    swap_data["amount"] = amount

    user_id = context.user_data.get("user_id")
    from_chain = swap_data.get("from_chain")
    from_chain_config = get_chain_by_name(from_chain)
    chain_type = "solana" if from_chain_config.chain_type == ChainType.SOLANA else "evm"

    default_wallet = wallet_service.get_default_wallet(user_id, chain_type)
    if not default_wallet:
        await query.edit_message_text("❌ No wallet found.")
        return ConversationHandler.END

    swap_data["wallet_id"] = default_wallet.id
    swap_data["selected_wallets"] = [default_wallet.id]

    return await _show_quote(update, context)


async def quick_sell_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle quick-sell buttons from post-swap card."""
    query = update.callback_query
    await query.answer()

    # Parse: qsell_{percent}_{token}_{chain}
    parts = query.data.split("_")
    sell_pct = int(parts[1])
    token = parts[2]
    chain = parts[3]

    user = update.effective_user
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await query.edit_message_text("❌ User not found.")
            return
        user_id = db_user.id

    chain_config = get_chain_by_name(chain)
    chain_type = "solana" if chain_config.chain_type == ChainType.SOLANA else "evm"
    native_token = "SOL" if chain_type == "solana" else "ETH"

    # Pre-fill swap as reverse: sell token back to native
    context.user_data["swap"] = {
        "from_chain": chain,
        "from_token": token,
        "to_chain": chain,
        "to_token": native_token,
        "sell_percent": sell_pct,
    }
    context.user_data["user_id"] = user_id

    await query.edit_message_text(
        f"🔄 *Quick Sell {sell_pct}% {token}*\n\nFetching quote...",
        parse_mode="Markdown",
    )

    # TODO: Get balance, calculate amount, show quote
    # For now, redirect to swap flow


# Create conversation handler
swap_conversation_handler = ConversationHandler(
    entry_points=[
        CommandHandler("swap", swap_command),
        CallbackQueryHandler(swap_start_callback, pattern="^swap_start$"),
    ],
    states={
        SELECT_PAIR: [
            # Quick pair selection (recent/favorites)
            CallbackQueryHandler(swap_pair_callback, pattern=r"^swap_pair_"),
            CallbackQueryHandler(swap_custom_pair_callback, pattern="^swap_custom_pair$"),
            # Existing chain/token selection sub-flow
            CallbackQueryHandler(select_from_chain, pattern="^from_chain_"),
            CallbackQueryHandler(select_from_token, pattern="^from_token_"),
            CallbackQueryHandler(select_to_chain, pattern="^to_chain_"),
            CallbackQueryHandler(select_to_token, pattern="^to_token_"),
            CallbackQueryHandler(swap_start_callback, pattern="^swap_start$"),
        ],
        ENTER_AMOUNT: [
            MessageHandler(filters.TEXT & ~filters.COMMAND, enter_amount),
            CallbackQueryHandler(swap_pct_callback, pattern=r"^swap_pct_"),
            CallbackQueryHandler(swap_quickbuy_callback, pattern=r"^swap_qb_"),
        ],
        SELECT_WALLETS: [
            CallbackQueryHandler(toggle_wallet_callback, pattern="^swap_toggle_wallet_"),
            CallbackQueryHandler(wallets_confirmed_callback, pattern="^swap_wallets_confirmed$"),
        ],
        CONFIRM_SWAP: [
            CallbackQueryHandler(confirm_swap, pattern="^swap_confirm$"),
            CallbackQueryHandler(swap_requote, pattern="^swap_requote$"),
            CallbackQueryHandler(show_wallet_selection, pattern="^swap_back_to_wallets$"),
            MessageHandler(filters.TEXT & ~filters.COMMAND, handle_2fa_code),
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

