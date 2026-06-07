"""Main entry point for the Suwappu Bot."""

import logging
import asyncio
from telegram import Update, MenuButtonWebApp, WebAppInfo, BotCommand
from telegram.ext import (
    Application,
    CommandHandler,
    CallbackQueryHandler,
    PicklePersistence,
)

from bot.config.settings import settings
from bot.handlers.start import (
    start_handler, help_handler, help_callback,
    main_menu_callback, more_menu_callback, noop_callback,
    tos_accept_callback, tos_decline_callback
)
from bot.handlers.balance import balance_handler, balance_callback
from bot.handlers.wallet import wallet_handler, wallet_menu_callback, wallet_create_callback, wallet_qr_callback, wallet_import_handler
from bot.handlers.swap import swap_conversation_handler, check_swap_status
from bot.handlers.history import history_handler, history_callback, history_menu_callback, history_page_handler, share_pnl_handler
from bot.handlers.portfolio import portfolio_handler, portfolio_callback
from bot.handlers.gas import gas_handler, gas_callback, gas_menu_callback
from bot.handlers.favorites import favorites_handler, favorites_callback, use_favorite_callback, delete_favorite_callback
from bot.handlers.settings import (
    settings_handler, settings_callback, toggle_notify_handler,
    slippage_conversation, toggle_panic_handler, settings_menu_callback
)
from bot.handlers.admin import status_handler, clear_cache_handler, broadcast_handler
from bot.handlers.quickswap import quickswap_handler, quickswap_confirm_callback, quickswap_menu_callback
from bot.handlers.custodial import (
    custodial_handler, custodial_callback, deposit_callback, 
    deposit_qr_callback, withdrawal_conversation
)
from bot.handlers.admin_custodial import (
    admin_hot_wallets_handler, admin_wallets_callback,
    create_evm_wallet, create_sol_wallet, gas_config, configure_gas_chain
)
from bot.handlers.admin_fees import fees_handler, set_fee_callback, fees_refresh_callback, sweep_fees_callback
# New handlers
from bot.handlers.alerts import alerts_handler, alert_conversation, alerts_menu_callback
from bot.handlers.referral import (
    referral_handler, ref_menu_callback_handler, ref_list_callback_handler, ref_claim_callback_handler,
    fees_command_handler, rewards_command_handler, fees_callback_handler,
    rewards_callback_handler as ref_rewards_callback_handler
)
from bot.handlers.limit_orders import (
    orders_handler, dca_handler, limit_order_conversation,
    dca_view_handler, dca_actions_handler, dca_menu_callback,
    limit_orders_menu_callback_handler
)
from bot.handlers.tax import (
    tax_handler, tax_year_callback_handler, tax_download_callback_handler, tax_menu_callback_handler
)
from bot.handlers.admin_metrics import (
    metrics_handler, metrics_volume_handler, metrics_fees_handler, metrics_users_handler,
    metrics_chains_handler, metrics_wallets_handler, metrics_errors_handler, metrics_refresh_handler
)
from bot.handlers.admin_performance import (
    perf_handler, perf_refresh_handler, perf_reset_handler, perf_slow_queries_handler
)
from bot.handlers.subscription import (
    subscription_handler, subscription_conversation,
    sub_compare_callback, sub_back_callback
)
# Points/XP system handlers
from bot.handlers.points import (
    xp_handler, checkin_handler, leaderboard_handler, rewards_handler,
    xp_callback_handler, checkin_callback_handler, leaderboard_callback_handler,
    rewards_callback_handler, redeem_callback_handler, noop_callback_handler as xp_noop_handler,
    points_menu_callback_handler
)
# Copy Trading handlers
from bot.handlers.copy import (
    traders_handler, following_handler, profile_handler, stats_handler,
    traders_callback_handler, view_trader_callback_handler, follow_callback_handler,
    unfollow_callback_handler, following_callback_handler, profile_callback_handler,
    toggle_public_callback_handler, edit_emoji_callback_handler, set_emoji_callback_handler,
    my_followers_callback_handler, mystats_callback_handler, copy_now_callback_handler,
    skip_copy_callback_handler, profile_edit_conversation, copy_menu_callback_handler
)
# Token Sniping handlers
from bot.handlers.snipe import snipe_conversation_handler
from bot.handlers.predict import predict_conversation_handler
from bot.handlers.perps import perps_conversation_handler, perps_menu_callback_handler
from bot.handlers.dashboard import dashboard_handler, dashboard_menu_callback
from bot.handlers.token import (
    token_conv_handler,
    token_menu_callback_handler,
    token_unstake_callback_handler,
    token_claim_rewards_callback_handler,
)
from bot.services.sniping import launch_detector
from bot.services.fee_sweeper import fee_sweeper
from bot.services.alerts import alert_service
from bot.services.orders import order_service
from bot.services.tx_poller import tx_poller
from bot.services.health_monitor import health_monitor
from bot.services.token_security.rug_service import rug_service
from bot.services.swap_engine import SwapEngine
from bot.utils.errors import handle_swap_error
from bot.utils.http_client import close_session as close_http_session
from bot.utils.preload import preload_config
from bot.utils.db_monitor import setup_db_monitoring
from database.db import init_db, DATABASE_AVAILABLE

# Try to import C++ core for high-performance operations
try:
    import suwappu_core
    CPP_CORE_AVAILABLE = True
except ImportError:
    suwappu_core = None
    CPP_CORE_AVAILABLE = False


# Configure logging
logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=getattr(logging, settings.log_level.upper()),
)
logger = logging.getLogger(__name__)


async def error_handler(update: Update, context) -> None:
    """Handle errors with user-friendly messages."""
    logger.error(f"Exception while handling an update: {context.error}")
    
    if update and update.effective_message:
        # Try to get user-friendly error message
        try:
            user_message = handle_swap_error(context.error)
        except Exception:
            user_message = "❌ An error occurred. Please try again later."
        
        try:
            await update.effective_message.reply_text(user_message)
        except Exception:
            pass  # Message might not be sendable


def add_handlers(application: Application) -> None:
    """Add all handlers to the application."""
    # ============ COMMAND HANDLERS ============
    application.add_handler(start_handler)
    application.add_handler(help_handler)
    application.add_handler(balance_handler)
    application.add_handler(wallet_handler)
    application.add_handler(quickswap_handler)  # /s shortcut
    application.add_handler(history_handler)     # /hx
    application.add_handler(portfolio_handler)   # /p
    application.add_handler(gas_handler)         # /g
    application.add_handler(favorites_handler)   # /f
    application.add_handler(settings_handler)    # /set
    
    # Custodial
    application.add_handler(custodial_handler)   # /c
    
    # New feature commands
    application.add_handler(alerts_handler)      # /a
    application.add_handler(referral_handler)    # /ref
    application.add_handler(fees_command_handler)    # /fees
    application.add_handler(rewards_command_handler) # /rewards
    application.add_handler(orders_handler)      # /o (limit orders)
    application.add_handler(dca_handler)         # /dca
    application.add_handler(tax_handler)         # /tax
    application.add_handler(subscription_handler)  # /sub (x402)
    application.add_handler(dashboard_handler)    # /dashboard (Mini App)

    # Perps Trading
    # Note: perps_conversation_handler added below with other conversation handlers

    # Points/XP system
    application.add_handler(xp_handler)          # /xp
    application.add_handler(checkin_handler)     # /checkin
    application.add_handler(leaderboard_handler) # /lb
    application.add_handler(rewards_handler)     # /rewards (XP rewards)
    
    # Copy Trading
    application.add_handler(traders_handler)     # /traders
    application.add_handler(following_handler)   # /following
    application.add_handler(profile_handler)     # /profile
    application.add_handler(stats_handler)       # /tstats (trader stats)
    
    # Admin commands
    application.add_handler(status_handler)      # /status
    application.add_handler(clear_cache_handler) # /clearcache
    application.add_handler(broadcast_handler)   # /broadcast
    application.add_handler(admin_hot_wallets_handler)  # /hotwallets
    application.add_handler(fees_handler)               # /fees
    application.add_handler(metrics_handler)            # /metrics
    application.add_handler(perf_handler)               # /perf
    
    # ============ CONVERSATION HANDLERS ============
    # Must be added before generic callback handlers
    application.add_handler(swap_conversation_handler)
    application.add_handler(wallet_import_handler)
    application.add_handler(slippage_conversation)
    application.add_handler(withdrawal_conversation)
    application.add_handler(alert_conversation)
    application.add_handler(limit_order_conversation)
    application.add_handler(subscription_conversation)  # x402 subscription flow
    application.add_handler(profile_edit_conversation)  # Copy trading profile editing
    application.add_handler(snipe_conversation_handler)  # Token sniping /snipe
    application.add_handler(perps_conversation_handler)  # Perps trading /perps
    application.add_handler(predict_conversation_handler)  # Prediction markets /predict
    application.add_handler(token_conv_handler)           # SUWP token /token /suwp

    # ============ CALLBACK QUERY HANDLERS ============
    
    # Navigation
    application.add_handler(CallbackQueryHandler(help_callback, pattern="^help$"))
    application.add_handler(CallbackQueryHandler(main_menu_callback, pattern="^main_menu$"))
    application.add_handler(CallbackQueryHandler(more_menu_callback, pattern="^more_menu$"))
    application.add_handler(CallbackQueryHandler(noop_callback, pattern="^noop$"))
    application.add_handler(CallbackQueryHandler(tos_accept_callback, pattern="^tos_accept$"))
    application.add_handler(CallbackQueryHandler(tos_decline_callback, pattern="^tos_decline$"))
    
    # Balance & Portfolio
    application.add_handler(CallbackQueryHandler(balance_callback, pattern="^balance$"))
    application.add_handler(CallbackQueryHandler(portfolio_callback, pattern="^portfolio"))
    application.add_handler(history_callback)
    application.add_handler(history_menu_callback)
    application.add_handler(history_page_handler)
    
    # Wallet
    application.add_handler(CallbackQueryHandler(wallet_menu_callback, pattern="^wallet_menu$"))
    application.add_handler(CallbackQueryHandler(wallet_create_callback, pattern="^wallet_create_"))
    application.add_handler(CallbackQueryHandler(wallet_qr_callback, pattern="^wallet_qr_"))
    
    # Swap
    application.add_handler(CallbackQueryHandler(check_swap_status, pattern="^swap_status_"))
    application.add_handler(CallbackQueryHandler(quickswap_confirm_callback, pattern="^quickswap_confirm$"))
    application.add_handler(CallbackQueryHandler(quickswap_menu_callback, pattern="^quickswap_menu$"))
    
    # Gas
    application.add_handler(CallbackQueryHandler(gas_callback, pattern="^gas_refresh$"))
    application.add_handler(CallbackQueryHandler(gas_menu_callback, pattern="^gas_menu$"))
    
    # Favorites
    application.add_handler(CallbackQueryHandler(favorites_callback, pattern="^favorites$"))
    application.add_handler(CallbackQueryHandler(favorites_callback, pattern="^favorites_menu$"))
    application.add_handler(CallbackQueryHandler(use_favorite_callback, pattern="^fav_use_"))
    application.add_handler(CallbackQueryHandler(delete_favorite_callback, pattern="^fav_delete_"))
    
    # Settings
    application.add_handler(settings_menu_callback)
    application.add_handler(toggle_notify_handler)
    application.add_handler(toggle_panic_handler)
    
    # Custodial
    application.add_handler(CallbackQueryHandler(custodial_callback, pattern="^custodial_menu$"))
    application.add_handler(CallbackQueryHandler(deposit_callback, pattern="^custodial_deposit$"))
    application.add_handler(CallbackQueryHandler(deposit_qr_callback, pattern="^deposit_qr_"))
    
    # Admin custodial
    application.add_handler(CallbackQueryHandler(admin_wallets_callback, pattern="^admin_wallets$"))
    application.add_handler(CallbackQueryHandler(create_evm_wallet, pattern="^admin_create_evm$"))
    application.add_handler(CallbackQueryHandler(create_sol_wallet, pattern="^admin_create_sol$"))
    application.add_handler(CallbackQueryHandler(gas_config, pattern="^admin_gas_config$"))
    application.add_handler(CallbackQueryHandler(configure_gas_chain, pattern="^admin_gas_"))
    
    # Fees admin
    application.add_handler(CallbackQueryHandler(set_fee_callback, pattern="^set_fee_"))
    application.add_handler(CallbackQueryHandler(fees_refresh_callback, pattern="^fees_refresh$"))
    application.add_handler(CallbackQueryHandler(sweep_fees_callback, pattern="^sweep_all_fees$"))
    
    # DCA and Limit Orders management
    application.add_handler(dca_view_handler)
    application.add_handler(dca_actions_handler)
    application.add_handler(dca_menu_callback)
    application.add_handler(limit_orders_menu_callback_handler)
    
    # Alerts
    application.add_handler(CallbackQueryHandler(alerts_menu_callback, pattern="^alerts_menu$"))
    
    # Referrals & Fees
    application.add_handler(ref_menu_callback_handler)
    application.add_handler(ref_list_callback_handler)
    application.add_handler(ref_claim_callback_handler)
    application.add_handler(fees_callback_handler)
    application.add_handler(ref_rewards_callback_handler)

    # Tax export
    application.add_handler(tax_year_callback_handler)
    application.add_handler(tax_download_callback_handler)
    application.add_handler(tax_menu_callback_handler)

    # Dashboard
    application.add_handler(CallbackQueryHandler(dashboard_menu_callback, pattern="^dashboard_menu$"))
    
    # Admin metrics
    application.add_handler(metrics_volume_handler)
    application.add_handler(metrics_fees_handler)
    application.add_handler(metrics_users_handler)
    application.add_handler(metrics_chains_handler)
    application.add_handler(metrics_wallets_handler)
    application.add_handler(metrics_errors_handler)
    application.add_handler(metrics_refresh_handler)
    
    # Admin performance
    application.add_handler(perf_refresh_handler)
    application.add_handler(perf_reset_handler)
    application.add_handler(perf_slow_queries_handler)
    
    # x402 Subscription
    application.add_handler(sub_compare_callback)
    application.add_handler(sub_back_callback)
    
    # Points/XP callbacks
    application.add_handler(points_menu_callback_handler)
    application.add_handler(xp_callback_handler)
    application.add_handler(checkin_callback_handler)
    application.add_handler(leaderboard_callback_handler)
    application.add_handler(rewards_callback_handler)
    application.add_handler(redeem_callback_handler)
    application.add_handler(xp_noop_handler)
    
    # Perps Trading callbacks
    application.add_handler(perps_menu_callback_handler)

    # SUWP token staking callbacks
    application.add_handler(token_menu_callback_handler)
    application.add_handler(token_unstake_callback_handler)
    application.add_handler(token_claim_rewards_callback_handler)

    # Copy Trading callbacks
    application.add_handler(copy_menu_callback_handler)
    application.add_handler(traders_callback_handler)
    application.add_handler(view_trader_callback_handler)
    application.add_handler(follow_callback_handler)
    application.add_handler(unfollow_callback_handler)
    application.add_handler(following_callback_handler)
    application.add_handler(profile_callback_handler)
    application.add_handler(toggle_public_callback_handler)
    application.add_handler(edit_emoji_callback_handler)
    application.add_handler(set_emoji_callback_handler)
    application.add_handler(my_followers_callback_handler)
    application.add_handler(mystats_callback_handler)
    application.add_handler(copy_now_callback_handler)
    application.add_handler(skip_copy_callback_handler)
    
    # Error handler
    application.add_error_handler(error_handler)


async def post_init(application) -> None:
    """Called after the application is initialized."""
    logger.info("Starting background services...")

    # Set up Telegram Mini App menu button
    try:
        await application.bot.set_chat_menu_button(
            menu_button=MenuButtonWebApp(
                text="📊 Dashboard",
                web_app=WebAppInfo(url=settings.webapp_url)
            )
        )
        logger.info(f"✓ Menu button set to Mini App: {settings.webapp_url}")
    except Exception as e:
        logger.warning(f"Could not set menu button: {e}")

    # Register bot commands for Telegram autocomplete menu
    try:
        commands = [
            BotCommand("start", "Main menu"),
            BotCommand("s", "Quick swap - /s <amount> <token>"),
            BotCommand("w", "Wallet management"),
            BotCommand("b", "Check balances"),
            BotCommand("p", "Portfolio overview"),
            BotCommand("a", "Price alerts"),
            BotCommand("o", "Limit orders & DCA"),
            BotCommand("snipe", "Token sniping"),
            BotCommand("hx", "Transaction history"),
            BotCommand("g", "Gas tracker"),
            BotCommand("f", "Favorite tokens"),
            BotCommand("ref", "Referral program"),
            BotCommand("xp", "Points & XP"),
            BotCommand("checkin", "Daily check-in"),
            BotCommand("traders", "Copy trading"),
            BotCommand("perps", "Perpetual trading"),
            BotCommand("predict", "Prediction markets"),
            BotCommand("token", "SUWP token & staking"),
            BotCommand("suwp", "SUWP token & staking"),
            BotCommand("following", "Copy trading follows"),
            BotCommand("profile", "Your trader profile"),
            BotCommand("c", "Custodial wallet"),
            BotCommand("dashboard", "Open Mini App"),
            BotCommand("tax", "Tax export"),
            BotCommand("set", "Settings"),
            BotCommand("h", "Help"),
        ]
        await application.bot.set_my_commands(commands)
        logger.info(f"✓ Registered {len(commands)} bot commands")
    except Exception as e:
        logger.warning(f"Could not register bot commands: {e}")

    # Seed default milestones and rewards for points system
    from bot.services.points_service import points_service
    points_service.seed_milestones_and_rewards()
    logger.info("✓ Points milestones and rewards seeded")
    
    # Get admin IDs from settings
    admin_ids = getattr(settings, 'admin_ids', [])

    if not settings.enable_background_services:
        logger.info("⏭️ Background services DISABLED via ENABLE_BACKGROUND_SERVICES=false")
    else:
        # Start fee sweeper
        await fee_sweeper.start()
        logger.info("✓ Fee sweeper started")

        # Start price alert service
        await alert_service.start(bot=application.bot)
        logger.info("✓ Price alert service started")

        # Start order service (limit orders & DCA)
        await order_service.start(bot=application.bot, swap_engine=SwapEngine())
        logger.info("✓ Order service started")

        # Start transaction poller
        await tx_poller.start(bot=application.bot)
        logger.info("✓ Transaction poller started")

        # Start health monitor
        await health_monitor.start(bot=application.bot, admin_ids=admin_ids)
        logger.info("✓ Health monitor started")

        # Start token launch detector for sniping
        await launch_detector.start()
        logger.info("✓ Token launch detector started")

        # Start rug protection service
        await rug_service.start(swap_engine=SwapEngine())
        logger.info("✓ Rug protection service started")


async def post_shutdown(application) -> None:
    """Called when the application shuts down."""
    logger.info("Stopping background services...")

    if settings.enable_background_services:
        await fee_sweeper.stop()
        await alert_service.stop()
        await order_service.stop()
        await tx_poller.stop()
        await health_monitor.stop()
        await launch_detector.stop()
    
    logger.info("Closing HTTP session pool...")
    await close_http_session()


async def run_headless() -> None:
    """Run background services without Telegram polling."""
    logger.warning("⚠️ Starting in HEADLESS MODE (Telegram token invalid/missing)")
    
    # Initialize background services manually
    admin_ids = getattr(settings, 'admin_ids', [])
    
    await fee_sweeper.start()
    logger.info("✓ Fee sweeper started")
    
    # These services usually need a bot to send messages
    # We pass None and they should handle it gracefully
    await alert_service.start(bot=None)
    await order_service.start(bot=None, swap_engine=SwapEngine())
    await tx_poller.start(bot=None)
    await health_monitor.start(bot=None, admin_ids=admin_ids)
    await rug_service.start(swap_engine=SwapEngine())
    
    logger.info("✅ Headless services are running. Press Ctrl+C to stop.")
    
    try:
        while True:
            await asyncio.sleep(3600)
    except asyncio.CancelledError:
        logger.info("Stopping headless services...")
        await post_shutdown(None)


def main() -> None:
    """Run the bot."""
    # Check C++ core availability
    if CPP_CORE_AVAILABLE:
        logger.info(f"✓ C++ core v{suwappu_core.__version__} loaded (high-performance mode)")
    else:
        logger.info("C++ core not available, using Python fallback (pip install -e . to build)")
    
    # Preload config for fast lookups
    logger.info("Preloading configurations...")
    preload_config()
    
    # Initialize database with error handling
    logger.info("Initializing database...")
    db_success = False
    try:
        db_success = init_db(settings.database_url)
        if not db_success:
            logger.warning("⚠️ Database initialization failed - running in degraded mode")
    except Exception as e:
        logger.error(f"Database initialization error: {e}")
        logger.warning("⚠️ Bot will run in degraded mode without database")
    
    # Set up database monitoring if database is available
    from database.db import engine
    if engine and db_success:
        setup_db_monitoring(engine)
        logger.info("✓ Database monitoring enabled")
    else:
        logger.warning("⚠️ Database monitoring disabled (no connection)")
    
    # Ensure data directory exists for persistence
    import os
    os.makedirs("data", exist_ok=True)

    # Create persistence to survive bot restarts
    persistence = PicklePersistence(filepath="data/bot_persistence.pickle")

    # Create application with lifecycle hooks
    logger.info("Creating bot application...")
    application = (
        Application.builder()
        .token(settings.telegram_bot_token)
        .persistence(persistence)
        .post_init(post_init)
        .post_shutdown(post_shutdown)
        .build()
    )
    
    # Add all handlers
    add_handlers(application)
    
    # Log available commands
    logger.info("User commands: /start, /h, /w, /b, /s, /hx, /p, /g, /f, /set, /c")
    logger.info("Trading commands: /a, /o, /dca, /ref, /tax, /sub, /snipe, /perps, /predict, /dashboard")
    logger.info("Growth commands: /xp, /checkin, /lb, /traders, /following, /profile")
    logger.info("Admin commands: /st, /hw, /fee, /m")
    logger.info("Background services: Fee sweeper, Price alerts, Limit orders/DCA, Tx poller, Health monitor, Launch detector")
    
    # Start the bot
    logger.info("Starting bot...")
    try:
        application.run_polling(allowed_updates=Update.ALL_TYPES)
    except Exception as e:
        if "Unauthorized" in str(e) or "InvalidToken" in str(e) or "rejected" in str(e):
            logger.error(f"❌ Telegram authentication failed: {e}")
            asyncio.run(run_headless())
        else:
            raise e


if __name__ == "__main__":
    main()
