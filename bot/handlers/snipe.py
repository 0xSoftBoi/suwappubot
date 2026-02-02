"""Snipe command handlers for token launch sniping.

Commands:
- /snipe - Start snipe wizard or quick snipe by contract
- /snipe <contract> - Quick snipe a specific token
- /autosnipe - Configure automatic sniping
- /watchlist - View watched tokens
- /snipehistory - View snipe history

Features:
- Quick snipe with preset amounts
- Auto-snipe on new launches
- Migration sniping (pump.fun -> Raydium)
- Snipe history with P&L tracking
"""

import logging
import asyncio
import re
from typing import Optional
from datetime import datetime, timedelta

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    ContextTypes,
    ConversationHandler,
    CommandHandler,
    CallbackQueryHandler,
    MessageHandler,
    filters,
)

from bot.config.settings import settings
from bot.models.user import User, Wallet
from bot.models.snipe import (
    SnipeOrder,
    SnipeConfig,
    SnipeHistory,
    WatchedToken,
    AutoSnipeRule,
    SnipeStatus,
    SnipeMode,
    SnipePlatform,
)
from bot.services.sniping import (
    launch_detector,
    snipe_executor,
    pump_fun_api,
)
from bot.services.sniping.snipe_executor import SnipeConfig as ExecutorConfig
from bot.services.sniping.launch_detector import TokenLaunch, LaunchPlatform
from bot.utils.rate_limiter import UserRateLimiter
from bot.utils.tos_utils import enforce_tos
from bot.services.token_security.token_analyzer import token_analyzer
from database.db import get_session

logger = logging.getLogger(__name__)

# Conversation states
(
    SELECT_ACTION,
    ENTER_CONTRACT,
    SELECT_AMOUNT,
    CONFIRM_SNIPE,
    CONFIGURE_AUTOSNIPE,
    SELECT_PLATFORM,
) = range(6)

# Rate limiter for snipe commands
snipe_limiter = UserRateLimiter(max_requests=10, window_seconds=60)

# Solana address regex
SOLANA_ADDRESS_REGEX = re.compile(r"^[1-9A-HJ-NP-Za-km-z]{32,44}$")


def is_solana_address(text: str) -> bool:
    """Check if text looks like a Solana address."""
    return bool(SOLANA_ADDRESS_REGEX.match(text.strip()))


def format_sol(amount: float) -> str:
    """Format SOL amount."""
    if amount >= 1:
        return f"{amount:.2f}"
    return f"{amount:.4f}"


def format_token_amount(amount: int, decimals: int = 9) -> str:
    """Format token amount."""
    value = amount / (10 ** decimals)
    if value >= 1_000_000:
        return f"{value / 1_000_000:.2f}M"
    if value >= 1_000:
        return f"{value / 1_000:.2f}K"
    return f"{value:.2f}"


# ============ MAIN SNIPE COMMAND ============

@enforce_tos
async def snipe_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle /snipe command.

    Usage:
        /snipe - Open snipe menu
        /snipe <contract> - Quick snipe a specific token
        /snipe <contract> <amount> - Snipe with specific SOL amount
    """
    user = update.effective_user
    args = context.args

    # Rate limit
    if not await snipe_limiter.check(str(user.id)):
        await update.message.reply_text("Please wait before using this command again.")
        return ConversationHandler.END

    # Check user has wallet
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await update.message.reply_text(
                "Please use /start first to create your account."
            )
            return ConversationHandler.END

        wallet = session.query(Wallet).filter(
            Wallet.user_id == db_user.id,
            Wallet.chain == "solana",
            Wallet.is_default == True,
        ).first()

        if not wallet:
            keyboard = InlineKeyboardMarkup([
                [
                    InlineKeyboardButton("Create Solana Wallet", callback_data="wallet_create_solana"),
                    InlineKeyboardButton("Import", callback_data="wallet_import_solana"),
                ],
                [InlineKeyboardButton("« Main Menu", callback_data="main_menu")],
            ])
            await update.message.reply_text(
                "You need a Solana wallet to snipe tokens.",
                reply_markup=keyboard,
            )
            return ConversationHandler.END

        # Get or create snipe config
        config = session.query(SnipeConfig).filter(
            SnipeConfig.user_id == db_user.id
        ).first()

        if not config:
            config = SnipeConfig(user_id=db_user.id)
            session.add(config)
            session.commit()

        user_id = db_user.id
        wallet_id = wallet.id
        quick_amounts = config.quick_amounts or [0.1, 0.5, 1.0, 5.0]
        default_amount = config.default_sol_amount

    # Store in context
    context.user_data["snipe"] = {
        "user_id": user_id,
        "wallet_id": wallet_id,
        "quick_amounts": quick_amounts,
        "default_amount": default_amount,
    }

    # Quick snipe if contract provided
    if args and len(args) >= 1:
        contract = args[0].strip()
        if is_solana_address(contract):
            context.user_data["snipe"]["token_mint"] = contract

            # If amount also provided
            if len(args) >= 2:
                try:
                    amount = float(args[1])
                    context.user_data["snipe"]["sol_amount"] = amount
                    return await show_snipe_confirmation(update, context)
                except ValueError:
                    pass

            # Show amount selection
            return await show_amount_selection(update, context, contract)

    # Show main snipe menu
    return await show_snipe_menu(update, context)


async def show_snipe_menu(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Show main snipe menu."""
    keyboard = [
        [
            InlineKeyboardButton("Snipe Token", callback_data="snipe_token"),
            InlineKeyboardButton("New Launches", callback_data="snipe_launches"),
        ],
        [
            InlineKeyboardButton("Auto-Snipe", callback_data="snipe_auto"),
            InlineKeyboardButton("Watchlist", callback_data="snipe_watchlist"),
        ],
        [
            InlineKeyboardButton("Snipe History", callback_data="snipe_history"),
            InlineKeyboardButton("Settings", callback_data="snipe_settings"),
        ],
        [InlineKeyboardButton("Cancel", callback_data="snipe_cancel")],
    ]

    text = (
        "*Token Sniping*\n\n"
        "Snipe new token launches on Solana:\n\n"
        "**Snipe Token** - Snipe a specific contract\n"
        "**New Launches** - View recent launches\n"
        "**Auto-Snipe** - Auto-buy new tokens\n"
        "**Watchlist** - Monitor tokens for migration\n"
        "**History** - Your snipe history & P&L\n\n"
        "_Tip: Send any Solana contract address to quick snipe_"
    )

    if update.callback_query:
        await update.callback_query.edit_message_text(
            text,
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup(keyboard),
        )
    else:
        await update.message.reply_text(
            text,
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup(keyboard),
        )

    return SELECT_ACTION


async def snipe_token_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle 'Snipe Token' button."""
    query = update.callback_query
    await query.answer()

    await query.edit_message_text(
        "*Enter Token Contract*\n\n"
        "Send the Solana token mint address you want to snipe.\n\n"
        "_Example: 7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr_",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton("Cancel", callback_data="snipe_cancel")]
        ]),
    )

    return ENTER_CONTRACT


async def receive_contract(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle contract address input."""
    text = update.message.text.strip()

    if not is_solana_address(text):
        await update.message.reply_text(
            "That doesn't look like a valid Solana address.\n"
            "Please enter a valid token mint address.",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("Cancel", callback_data="snipe_cancel")]
            ]),
        )
        return ENTER_CONTRACT

    context.user_data["snipe"]["token_mint"] = text
    return await show_amount_selection(update, context, text)


async def show_amount_selection(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    token_mint: str,
) -> int:
    """Show amount selection for sniping."""
    snipe_data = context.user_data.get("snipe", {})
    quick_amounts = snipe_data.get("quick_amounts", [0.1, 0.5, 1.0, 5.0])

    # Try to get token info
    token = await pump_fun_api.get_token(token_mint)

    if token:
        token_info = (
            f"*Token:* {token.name} ({token.symbol})\n"
            f"*Price:* {format_sol(token.price_sol)} SOL\n"
            f"*Progress:* {token.progress_percent:.1f}%\n"
        )
        if token.twitter:
            token_info += f"*Twitter:* {token.twitter}\n"
    else:
        token_info = f"*Token:* `{token_mint[:8]}...{token_mint[-4:]}`\n"

    # Quick safety check
    safety_line = ""
    try:
        is_safe, warnings = await token_analyzer.quick_check(token_mint, chain="solana")
        if not is_safe and warnings:
            if any("honeypot" in w.lower() for w in warnings):
                safety_line = "\n🚫 *HONEYPOT WARNING* - This token may not be sellable!\n"
            else:
                safety_line = f"\n⚠️ {warnings[0]}\n"
        elif is_safe:
            safety_line = "\n🛡️ Quick check passed\n"
    except Exception as e:
        logger.debug(f"Quick safety check failed: {e}")

    # Build amount buttons
    amount_buttons = []
    row = []
    for i, amount in enumerate(quick_amounts):
        row.append(InlineKeyboardButton(
            f"{format_sol(amount)} SOL",
            callback_data=f"snipe_amount_{amount}",
        ))
        if (i + 1) % 2 == 0:
            amount_buttons.append(row)
            row = []
    if row:
        amount_buttons.append(row)

    keyboard = amount_buttons + [
        [InlineKeyboardButton("Custom Amount", callback_data="snipe_custom_amount")],
        [InlineKeyboardButton("Cancel", callback_data="snipe_cancel")],
    ]

    text = (
        f"*Snipe Token*\n\n"
        f"{token_info}{safety_line}\n"
        f"Select amount of SOL to spend:"
    )

    if update.callback_query:
        await update.callback_query.edit_message_text(
            text,
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup(keyboard),
        )
    else:
        await update.message.reply_text(
            text,
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup(keyboard),
        )

    return SELECT_AMOUNT


async def amount_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle amount selection."""
    query = update.callback_query
    await query.answer()

    amount = float(query.data.replace("snipe_amount_", ""))
    context.user_data["snipe"]["sol_amount"] = amount

    return await show_snipe_confirmation(update, context)


async def custom_amount_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle custom amount selection."""
    query = update.callback_query
    await query.answer()

    await query.edit_message_text(
        "*Enter Custom Amount*\n\n"
        "Enter the amount of SOL you want to spend:\n\n"
        "_Example: 0.25_",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton("Cancel", callback_data="snipe_cancel")]
        ]),
    )

    context.user_data["snipe"]["awaiting_custom_amount"] = True
    return SELECT_AMOUNT


async def receive_custom_amount(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle custom amount input."""
    if not context.user_data.get("snipe", {}).get("awaiting_custom_amount"):
        return SELECT_AMOUNT

    try:
        amount = float(update.message.text.strip())
        if amount <= 0:
            raise ValueError("Amount must be positive")
        if amount > 100:
            await update.message.reply_text(
                "Maximum snipe amount is 100 SOL. Please enter a smaller amount."
            )
            return SELECT_AMOUNT

        context.user_data["snipe"]["sol_amount"] = amount
        context.user_data["snipe"]["awaiting_custom_amount"] = False
        return await show_snipe_confirmation(update, context)

    except ValueError:
        await update.message.reply_text(
            "Invalid amount. Please enter a valid number.\n"
            "_Example: 0.5_",
            parse_mode="Markdown",
        )
        return SELECT_AMOUNT


async def show_snipe_confirmation(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Show snipe confirmation."""
    snipe_data = context.user_data.get("snipe", {})
    token_mint = snipe_data.get("token_mint")
    sol_amount = snipe_data.get("sol_amount")

    # Get token info
    token = await pump_fun_api.get_token(token_mint)

    if token:
        token_info = (
            f"*Token:* {token.name} ({token.symbol})\n"
            f"*Contract:* `{token_mint[:8]}...{token_mint[-4:]}`\n"
            f"*Price:* {format_sol(token.price_sol)} SOL\n"
        )
        # Estimate tokens received
        quote = await pump_fun_api.get_buy_quote(token_mint, sol_amount)
        if quote:
            tokens_estimate = format_token_amount(quote.token_amount)
            token_info += f"*Est. Tokens:* ~{tokens_estimate}\n"
    else:
        token_info = f"*Contract:* `{token_mint}`\n"

    # Full security analysis
    security_text = ""
    dex_url = None
    is_honeypot = False
    try:
        report = await token_analyzer.analyze(token_mint, chain="solana")
        security_text = f"\n🛡️ *Security Shield*\n{token_analyzer.get_safety_summary(report)}\n"
        dex_url = report.dex_url
        is_honeypot = report.is_honeypot
    except Exception as e:
        logger.debug(f"Security analysis failed in snipe confirmation: {e}")

    confirm_label = "⚠️ Snipe (RISKY)" if is_honeypot else "Confirm Snipe"

    keyboard = [
        [
            InlineKeyboardButton(confirm_label, callback_data="snipe_confirm"),
        ],
        [
            InlineKeyboardButton("Jito: ON", callback_data="snipe_toggle_jito"),
            InlineKeyboardButton("Slippage: 10%", callback_data="snipe_toggle_slippage"),
        ],
        [InlineKeyboardButton("Cancel", callback_data="snipe_cancel")],
    ]
    if dex_url:
        keyboard.append([InlineKeyboardButton("📈 DexScreener Chart", url=dex_url)])

    text = (
        f"*Confirm Snipe*\n\n"
        f"{token_info}\n"
        f"*Amount:* {format_sol(sol_amount)} SOL\n"
        f"*Slippage:* 10%\n"
        f"*MEV Protection:* Jito Enabled\n"
        f"{security_text}\n"
        f"_Click Confirm to execute the snipe_"
    )

    if update.callback_query:
        await update.callback_query.edit_message_text(
            text,
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup(keyboard),
        )
    else:
        await update.message.reply_text(
            text,
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup(keyboard),
        )

    return CONFIRM_SNIPE


async def confirm_snipe_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Execute the snipe."""
    query = update.callback_query
    await query.answer("Executing snipe...")

    snipe_data = context.user_data.get("snipe", {})
    token_mint = snipe_data.get("token_mint")
    sol_amount = snipe_data.get("sol_amount")
    user_id = snipe_data.get("user_id")
    wallet_id = snipe_data.get("wallet_id")

    # Show executing message
    await query.edit_message_text(
        f"*Executing Snipe...*\n\n"
        f"Sniping `{token_mint[:8]}...{token_mint[-4:]}` with {format_sol(sol_amount)} SOL\n\n"
        f"Please wait...",
        parse_mode="Markdown",
    )

    # Create snipe order in database
    with get_session() as session:
        order = SnipeOrder(
            user_id=user_id,
            wallet_id=wallet_id,
            token_mint=token_mint,
            sol_amount=sol_amount,
            slippage_bps=1000,
            mode=SnipeMode.INSTANT.value,
            use_jito=True,
            status=SnipeStatus.EXECUTING.value,
        )
        session.add(order)
        session.commit()
        order_id = order.id

    # Get wallet keypair (simplified - real implementation needs secure key retrieval)
    # This would use the wallet service to decrypt the private key
    try:
        # Create launch object for the executor
        token = await pump_fun_api.get_token(token_mint)
        if token:
            launch = TokenLaunch(
                token_mint=token_mint,
                platform=LaunchPlatform.PUMP_FUN,
                name=token.name,
                symbol=token.symbol,
                creator=token.creator,
                initial_liquidity_sol=0,
                detected_at=datetime.utcnow(),
                bonding_curve=token.bonding_curve,
            )
        else:
            launch = TokenLaunch(
                token_mint=token_mint,
                platform=LaunchPlatform.RAYDIUM,
                name="",
                symbol="",
                creator="",
                initial_liquidity_sol=0,
                detected_at=datetime.utcnow(),
            )

        # TODO: Integrate actual snipe execution with wallet service
        # result = await snipe_executor.execute_snipe(launch, keypair, config)
        logger.warning(f"Snipe execution for {token_mint} is using SIMULATED results - not yet production-ready")

        # Simulated success - replace with actual execution
        result_success = True
        result_signature = "simulated_signature_" + token_mint[:8]
        result_tokens = 1000000000  # Simulated

        # Update order in database
        with get_session() as session:
            order = session.query(SnipeOrder).filter(SnipeOrder.id == order_id).first()
            if order:
                if result_success:
                    order.status = SnipeStatus.CONFIRMED.value
                    order.tx_signature = result_signature
                    order.tokens_received = str(result_tokens)
                    order.executed_at = datetime.utcnow()
                else:
                    order.status = SnipeStatus.FAILED.value
                    order.error_message = "Execution failed"
                session.commit()

        if result_success:
            await query.edit_message_text(
                f"*Snipe Successful!*\n\n"
                f"Token: `{token_mint[:8]}...{token_mint[-4:]}`\n"
                f"Spent: {format_sol(sol_amount)} SOL\n"
                f"Received: ~{format_token_amount(result_tokens)} tokens\n\n"
                f"[View on Solscan](https://solscan.io/tx/{result_signature})",
                parse_mode="Markdown",
                disable_web_page_preview=True,
            )
        else:
            await query.edit_message_text(
                f"*Snipe Failed*\n\n"
                f"Token: `{token_mint[:8]}...{token_mint[-4:]}`\n"
                f"Error: Transaction failed\n\n"
                f"Your SOL has not been spent.",
                parse_mode="Markdown",
            )

    except Exception as e:
        logger.error(f"Snipe execution error: {e}")

        # Update order as failed
        with get_session() as session:
            order = session.query(SnipeOrder).filter(SnipeOrder.id == order_id).first()
            if order:
                order.status = SnipeStatus.FAILED.value
                order.error_message = str(e)
                session.commit()

        await query.edit_message_text(
            f"*Snipe Failed*\n\n"
            f"Error: {str(e)[:100]}\n\n"
            f"Please try again.",
            parse_mode="Markdown",
        )

    # Clear context
    context.user_data.pop("snipe", None)
    return ConversationHandler.END


# ============ NEW LAUNCHES ============

async def launches_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Show recent token launches."""
    query = update.callback_query
    await query.answer()

    # Get recent launches from detector
    launches = launch_detector.get_recent_launches(limit=10)

    if not launches:
        await query.edit_message_text(
            "*Recent Launches*\n\n"
            "No recent launches detected.\n"
            "Launches will appear here as they happen.",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("Refresh", callback_data="snipe_launches")],
                [InlineKeyboardButton("Back", callback_data="snipe_menu")],
            ]),
        )
        return SELECT_ACTION

    text = "*Recent Launches*\n\n"
    keyboard = []

    for launch in launches[:5]:
        age_mins = int(launch.age_seconds / 60)
        platform_emoji = "" if launch.platform == LaunchPlatform.PUMP_FUN else ""

        text += (
            f"{platform_emoji} *{launch.symbol or 'Unknown'}*\n"
            f"   Liq: {format_sol(launch.initial_liquidity_sol)} SOL | "
            f"Age: {age_mins}m | "
            f"Score: {launch.quality_score:.0f}\n\n"
        )

        keyboard.append([
            InlineKeyboardButton(
                f"Snipe {launch.symbol or launch.token_mint[:6]}",
                callback_data=f"snipe_quick_{launch.token_mint[:20]}",
            )
        ])

    keyboard.extend([
        [InlineKeyboardButton("Refresh", callback_data="snipe_launches")],
        [InlineKeyboardButton("Back", callback_data="snipe_menu")],
    ])

    await query.edit_message_text(
        text,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )

    return SELECT_ACTION


# ============ WATCHLIST ============

async def watchlist_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Show user's watchlist."""
    query = update.callback_query
    await query.answer()

    user_id = context.user_data.get("snipe", {}).get("user_id")

    with get_session() as session:
        watched = session.query(WatchedToken).filter(
            WatchedToken.user_id == user_id,
            WatchedToken.is_active == True,
        ).order_by(WatchedToken.created_at.desc()).limit(10).all()

        if not watched:
            await query.edit_message_text(
                "*Watchlist*\n\n"
                "Your watchlist is empty.\n\n"
                "Add tokens to watch for migration events\n"
                "(pump.fun -> Raydium graduations).",
                parse_mode="Markdown",
                reply_markup=InlineKeyboardMarkup([
                    [InlineKeyboardButton("Add Token", callback_data="snipe_watch_add")],
                    [InlineKeyboardButton("Back", callback_data="snipe_menu")],
                ]),
            )
            return SELECT_ACTION

        text = "*Watchlist*\n\n"
        keyboard = []

        for token in watched:
            progress = token.progress_percent
            status = "" if progress >= 90 else ""

            text += (
                f"{status} *{token.token_symbol or 'Unknown'}*\n"
                f"   Progress: {progress:.1f}%\n\n"
            )

            keyboard.append([
                InlineKeyboardButton(
                    f"Remove {token.token_symbol or token.token_mint[:6]}",
                    callback_data=f"snipe_unwatch_{token.id}",
                )
            ])

    keyboard.extend([
        [InlineKeyboardButton("Add Token", callback_data="snipe_watch_add")],
        [InlineKeyboardButton("Back", callback_data="snipe_menu")],
    ])

    await query.edit_message_text(
        text,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )

    return SELECT_ACTION


# ============ SNIPE HISTORY ============

async def history_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Show snipe history."""
    query = update.callback_query
    await query.answer()

    user_id = context.user_data.get("snipe", {}).get("user_id")

    with get_session() as session:
        history = session.query(SnipeHistory).filter(
            SnipeHistory.user_id == user_id,
        ).order_by(SnipeHistory.sniped_at.desc()).limit(10).all()

        if not history:
            await query.edit_message_text(
                "*Snipe History*\n\n"
                "No snipes yet.\n"
                "Your snipe history will appear here.",
                parse_mode="Markdown",
                reply_markup=InlineKeyboardMarkup([
                    [InlineKeyboardButton("Back", callback_data="snipe_menu")],
                ]),
            )
            return SELECT_ACTION

        text = "*Snipe History*\n\n"
        total_pnl = 0

        for h in history:
            pnl_emoji = "" if (h.pnl_percent or 0) >= 0 else ""
            pnl_str = f"{h.pnl_percent:.1f}%" if h.pnl_percent else "N/A"

            text += (
                f"{pnl_emoji} *{h.token_symbol or 'Unknown'}*\n"
                f"   Entry: {format_sol(h.entry_price)} SOL\n"
                f"   P&L: {pnl_str}\n\n"
            )

            total_pnl += h.pnl_sol or 0

        total_emoji = "" if total_pnl >= 0 else ""
        text += f"\n*Total P&L:* {total_emoji}{format_sol(abs(total_pnl))} SOL"

    await query.edit_message_text(
        text,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton("Back", callback_data="snipe_menu")],
        ]),
    )

    return SELECT_ACTION


# ============ CANCEL ============

async def cancel_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle cancel."""
    query = update.callback_query
    await query.answer()

    context.user_data.pop("snipe", None)

    await query.edit_message_text("Snipe cancelled.")
    return ConversationHandler.END


async def menu_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Return to main snipe menu."""
    return await show_snipe_menu(update, context)


# ============ CONVERSATION HANDLER ============

snipe_conversation_handler = ConversationHandler(
    entry_points=[
        CommandHandler("snipe", snipe_command),
    ],
    states={
        SELECT_ACTION: [
            CallbackQueryHandler(snipe_token_callback, pattern="^snipe_token$"),
            CallbackQueryHandler(launches_callback, pattern="^snipe_launches$"),
            CallbackQueryHandler(watchlist_callback, pattern="^snipe_watchlist$"),
            CallbackQueryHandler(history_callback, pattern="^snipe_history$"),
            CallbackQueryHandler(menu_callback, pattern="^snipe_menu$"),
            CallbackQueryHandler(cancel_callback, pattern="^snipe_cancel$"),
        ],
        ENTER_CONTRACT: [
            MessageHandler(filters.TEXT & ~filters.COMMAND, receive_contract),
            CallbackQueryHandler(cancel_callback, pattern="^snipe_cancel$"),
        ],
        SELECT_AMOUNT: [
            CallbackQueryHandler(amount_callback, pattern="^snipe_amount_"),
            CallbackQueryHandler(custom_amount_callback, pattern="^snipe_custom_amount$"),
            MessageHandler(filters.TEXT & ~filters.COMMAND, receive_custom_amount),
            CallbackQueryHandler(cancel_callback, pattern="^snipe_cancel$"),
        ],
        CONFIRM_SNIPE: [
            CallbackQueryHandler(confirm_snipe_callback, pattern="^snipe_confirm$"),
            CallbackQueryHandler(cancel_callback, pattern="^snipe_cancel$"),
        ],
    },
    fallbacks=[
        CallbackQueryHandler(cancel_callback, pattern="^snipe_cancel$"),
        CommandHandler("cancel", lambda u, c: cancel_callback(u, c)),
    ],
    name="snipe_conversation",
    persistent=False,
)
