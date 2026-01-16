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


# Conversation states
SELECT_FROM_CHAIN, SELECT_FROM_TOKEN, SELECT_TO_CHAIN, SELECT_TO_TOKEN, ENTER_AMOUNT, CONFIRM_SWAP = range(6)

swap_engine = SwapEngine()
wallet_service = WalletService()


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
        
        wallets = session.query(Wallet).filter(
            Wallet.user_id == db_user.id,
            Wallet.is_active == True,
        ).all()
        
        if not wallets:
            keyboard = [[InlineKeyboardButton("👛 Add Wallet", callback_data="wallet_menu")]]
            text = "👛 You need to add a wallet first before swapping!"
            if is_callback:
                await update.callback_query.edit_message_text(text, reply_markup=InlineKeyboardMarkup(keyboard))
            else:
                await update.message.reply_text(text, reply_markup=InlineKeyboardMarkup(keyboard))
            return ConversationHandler.END
        
        context.user_data["user_id"] = db_user.id
    
    # Show chain selection
    text = "🔄 *New Swap*\n\nSelect the source chain:"
    
    # Build chain buttons (2 per row)
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
    
    reply_markup = InlineKeyboardMarkup(chain_buttons)
    
    if is_callback:
        await update.callback_query.edit_message_text(
            text, parse_mode="Markdown", reply_markup=reply_markup
        )
    else:
        await update.message.reply_text(
            text, parse_mode="Markdown", reply_markup=reply_markup
        )
    
    return SELECT_FROM_CHAIN


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
    
    await query.edit_message_text(text, parse_mode="Markdown")
    
    return ENTER_AMOUNT


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
    
    # Get quote
    swap_data = context.user_data["swap"]
    user_id = context.user_data["user_id"]
    
    # Get user's wallet
    from_chain_config = get_chain_by_name(swap_data["from_chain"])
    chain_type = "solana" if from_chain_config.chain_type == ChainType.SOLANA else "evm"
    
    with get_session() as session:
        wallet = session.query(Wallet).filter(
            Wallet.user_id == user_id,
            Wallet.chain_type == chain_type,
            Wallet.is_active == True,
        ).first()
        
        if not wallet:
            await update.message.reply_text(
                f"❌ No {chain_type.upper()} wallet found. Please add one first.",
                reply_markup=InlineKeyboardMarkup([
                    [InlineKeyboardButton("👛 Add Wallet", callback_data="wallet_menu")]
                ]),
            )
            return ConversationHandler.END
        
        # Extract data while in session
        wallet_address = wallet.address
        wallet_id = wallet.id
    
    context.user_data["swap"]["wallet_id"] = wallet_id
    
    loading_msg = await update.message.reply_text("⏳ Getting quote...")
    
    try:
        quote = await swap_engine.get_quote(
            from_chain=swap_data["from_chain"],
            to_chain=swap_data["to_chain"],
            from_token=swap_data["from_token"],
            to_token=swap_data["to_token"],
            amount=amount,
            from_address=wallet_address,
        )
        
        context.user_data["swap"]["quote"] = quote
        # New attempt id each time we present a confirm button (prevents double-submit)
        context.user_data["swap"]["attempt_id"] = secrets.token_urlsafe(16)
        
        from_chain_config = get_chain_by_name(swap_data["from_chain"])
        to_chain_config = get_chain_by_name(swap_data["to_chain"])
        
        # Calculate platform fee (1%)
        fee_amount, fee_percentage, fee_usd = await fee_service.calculate_fee_with_price(
            amount=quote.from_amount_human,
            token_symbol=swap_data["from_token"],
        )
        context.user_data["swap"]["fee_amount"] = fee_amount
        context.user_data["swap"]["fee_percentage"] = fee_percentage
        context.user_data["swap"]["fee_usd"] = fee_usd
        
        # Calculate net amount after fee
        net_to_amount = quote.to_amount_human * (1 - fee_percentage / 100)
        
        text = (
            f"📊 *Swap Quote*\n\n"
            f"*From:*\n"
            f"{from_chain_config.logo_emoji} {format_amount(quote.from_amount_human, symbol=swap_data['from_token'])}\n"
            f"on {from_chain_config.display_name}\n\n"
            f"*To (after fees):*\n"
            f"{to_chain_config.logo_emoji} ~{format_amount(net_to_amount, symbol=swap_data['to_token'])}\n"
            f"on {to_chain_config.display_name}\n\n"
            f"*Fees:*\n"
            f"• Platform fee: {fee_percentage}% ({format_usd(fee_usd)})\n"
            f"• Gas: {format_usd(quote.gas_cost_usd)}\n"
            f"• Bridge: {format_usd(quote.fee_cost_usd)}\n\n"
            f"*Details:*\n"
            f"• Rate: 1 {swap_data['from_token']} = {quote.exchange_rate:.4f} {swap_data['to_token']}\n"
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


async def confirm_swap(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle swap confirmation."""
    from datetime import datetime
    
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
        await query.edit_message_text("❌ Quote expired. Please start over.")
        return ConversationHandler.END
    
    # Check quote age (max 60 seconds for confirmation)
    CONFIRMATION_TIMEOUT = 60  # seconds
    if hasattr(quote, 'timestamp') and quote.timestamp:
        quote_age = (datetime.utcnow() - quote.timestamp).total_seconds()
        if quote_age > CONFIRMATION_TIMEOUT:
            await query.edit_message_text(
                f"⏰ Quote expired ({quote_age:.0f}s old). Please start a new swap.",
                reply_markup=InlineKeyboardMarkup([
                    [InlineKeyboardButton("🔄 New Swap", callback_data="swap_start")],
                    [InlineKeyboardButton("« Main Menu", callback_data="main_menu")],
                ])
            )
            return ConversationHandler.END
    
    await query.edit_message_text("⏳ Executing swap...")
    
    try:
        attempt_id = swap_data.get("attempt_id") or "no_attempt"
        idempotency_key = f"tg:{user_id}:{wallet_id}:{attempt_id}"
        swap_tx = await swap_engine.execute_swap(
            quote=quote,
            wallet_id=wallet_id,
            user_id=user_id,
            idempotency_key=idempotency_key,
        )
        
        # Record the fee ONLY if swap was successfully submitted
        # Don't charge fees for failed swaps
        if swap_tx and swap_tx.status == SwapStatus.SUBMITTED.value:
            fee_amount = swap_data.get("fee_amount", 0)
            fee_percentage = swap_data.get("fee_percentage", 1.0)
            fee_usd = swap_data.get("fee_usd", 0)
            
            if fee_amount > 0:
                # Prevent duplicate fee records on double-tap (idempotent)
                from bot.models.fees import FeeTransaction
                with get_session() as session:
                    existing_fee = session.query(FeeTransaction).filter(
                        FeeTransaction.swap_id == swap_tx.id
                    ).first()
                if not existing_fee:
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
        
        from_chain_config = get_chain_by_name(swap_data["from_chain"])
        
        text = (
            f"✅ *Swap Submitted!*\n\n"
            f"*Transaction:*\n"
            f"{format_tx_link(swap_tx.tx_hash, swap_data['from_chain'])}\n\n"
            f"*Fee:* {format_usd(fee_usd)} ({fee_percentage}%)\n"
            f"*Status:* {swap_tx.status}\n\n"
            f"The swap is being processed. This may take a few minutes for cross-chain swaps."
        )
        
        keyboard = [
            [InlineKeyboardButton("🔍 Check Status", callback_data=f"swap_status_{swap_tx.id}")],
            [InlineKeyboardButton("🔄 New Swap", callback_data="swap_start")],
            [InlineKeyboardButton("« Main Menu", callback_data="main_menu")],
        ]
        
        await query.edit_message_text(
            text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard)
        )
        
    except SwapError as e:
        await query.edit_message_text(
            f"❌ Swap failed: {str(e)}",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("🔄 Try Again", callback_data="swap_start")],
                [InlineKeyboardButton("« Main Menu", callback_data="main_menu")],
            ]),
        )
    except Exception as e:
        await query.edit_message_text(
            f"❌ Unexpected error: {str(e)}",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("🔄 Try Again", callback_data="swap_start")],
                [InlineKeyboardButton("« Main Menu", callback_data="main_menu")],
            ]),
        )
    
    return ConversationHandler.END


async def swap_cancel(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Cancel the swap flow."""
    query = update.callback_query
    await query.answer()
    
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
        
    except Exception as e:
        await query.edit_message_text(
            f"❌ Error: {str(e)}",
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


# Create conversation handler
swap_conversation_handler = ConversationHandler(
    entry_points=[
        CommandHandler("s", swap_command),
        CallbackQueryHandler(swap_start_callback, pattern="^swap_start$"),
    ],
    states={
        SELECT_FROM_CHAIN: [
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
            MessageHandler(filters.TEXT & ~filters.COMMAND, enter_amount),
        ],
        CONFIRM_SWAP: [
            CallbackQueryHandler(confirm_swap, pattern="^swap_confirm$"),
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

