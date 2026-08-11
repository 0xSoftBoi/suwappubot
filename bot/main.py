"""Main entry point for the Suwappu Bot."""

import logging
import asyncio
from telegram import Update, MenuButtonWebApp, WebAppInfo, BotCommand
from telegram.ext import (
    Application,
    CommandHandler,
    CallbackQueryHandler,
    InlineQueryHandler,
    MessageHandler,
    filters,
    PicklePersistence,
    AIORateLimiter,
)

from bot.config.settings import settings
from bot.handlers.start import (
    start_handler,
    help_handler,
    help_callback,
    main_menu_callback,
    more_menu_callback,
    noop_callback,
    tos_accept_callback,
    tos_decline_callback,
    tos_review_callback,
    gekko_approve_callback,
    gekko_reject_callback,
)
from bot.handlers.home import home_refresh_callback
from bot.handlers.balance import balance_handler, balance_callback
from bot.handlers.wallet import (
    wallet_handler,
    wallet_menu_callback,
    wallet_create_callback,
    wallet_qr_callback,
    wallet_import_handler,
)
from bot.handlers.swap import swap_conversation_handler, check_swap_status, swap_share_ref_handler
from bot.handlers.bulk_swap import bulk_swap_conversation_handler
from bot.handlers.bulk_pay import bulk_pay_conversation_handler
from bot.handlers.battle import battle_conversation_handler, battle_menu_callback_handler
from bot.handlers.rewards import rewards_handler, rewards_claim_handler
from bot.handlers.tip import tip_handler
from bot.handlers.luckybox import luckybox_handler, luckybox_claim_handler
from bot.handlers.split import split_handler, split_pay_handler
from bot.handlers.airdrop import (
    airdrop_conversation,
    airdrop_claim_handler,
    airdrop_mine_handler,
    airdrop_cancel_campaign_handler,
)
from bot.handlers.giftcard import gift_conversation
from bot.handlers.stocks import (
    stocks_command_handler,
    stocks_page_callback_handler,
    stocks_view_callback_handler,
    stocks_list_callback_handler,
    stocks_sell_hint_callback_handler,
    stocks_close_callback_handler,
)
from bot.handlers.paste_trade import (
    on_freeform_text,
    check_command,
    paste_cancel_callback,
    paste_check_hint_callback,
)
from bot.handlers.nl_trade import handle_nl_text
from bot.handlers.llm_model import llm_model_command
from bot.handlers.trending import (
    trending_command,
    trending_open_callback,
    trending_buy_callback,
)
from bot.handlers.twofa import twofa_conversation
from bot.handlers.sessions import (
    sessions_handler,
    sessions_revoke_all_handler,
    sessions_close_handler,
)
from bot.handlers.smart_account import smart_account_handler, smart_account_chain_handler
from bot.handlers.recovery import recover_handler, recover_cancel_handler
from bot.handlers.history import (
    history_handler,
    history_callback,
    history_menu_callback,
    history_page_handler,
    share_pnl_handler,
)
from bot.handlers.portfolio import portfolio_handler, portfolio_callback
from bot.handlers.positions import (
    positions_command_handler,
    positions_menu_callback_handler,
    positions_refresh_callback_handler,
    pos_manage_callback_handler,
    pos_sell_callback_handler,
)
from bot.handlers.gas import gas_handler, gas_callback, gas_menu_callback
from bot.handlers.favorites import (
    favorites_handler,
    favorites_callback,
    use_favorite_callback,
    delete_favorite_callback,
)
from bot.handlers.settings import (
    settings_handler,
    settings_callback,
    toggle_notify_handler,
    slippage_conversation,
    toggle_panic_handler,
    settings_menu_callback,
    recovery_handler,
    limits_handler,
    recovery_menu_callback,
    recovery_conversation,
    limits_conversation,
    toggle_mev_handler,
    toggle_proactive_handler,
    speed_menu_handler,
    speed_set_handler,
    chain_menu_handler,
    chain_set_handler,
    notify_prefs_handler,
    ntoggle_copy_handler,
    ntoggle_order_handler,
    ntoggle_portfolio_handler,
    ntoggle_risk_handler,
)
from bot.handlers.admin import (
    status_handler,
    status_refresh_callback,
    clear_cache_handler,
    broadcast_handler,
    hl_builder_handler,
    hl_claim_handler,
    cctp_relay_handler,
    set_region_handler,
)
from bot.handlers.digest import digest_handler
from bot.handlers.quickswap import (
    quickswap_handler,
    quickswap_confirm_callback,
    quickswap_menu_callback,
)
from bot.handlers.custodial import (
    custodial_handler,
    custodial_callback,
    deposit_callback,
    deposit_qr_callback,
    withdrawal_conversation,
)
from bot.handlers.admin_custodial import (
    admin_hot_wallets_handler,
    admin_wallets_callback,
    create_evm_wallet,
    create_sol_wallet,
    gas_config,
    configure_gas_chain,
)
from bot.handlers.admin_fees import (
    fees_handler,
    set_fee_callback,
    fees_refresh_callback,
    sweep_fees_callback,
)

# New handlers
from bot.handlers.alerts import (
    alerts_handler,
    alert_conversation,
    alerts_menu_callback,
    alert_manage_callback,
    alert_delete_callback,
)
from bot.handlers.referral import (
    referral_handler,
    ref_menu_callback_handler,
    ref_list_callback_handler,
    ref_claim_callback_handler,
    fees_command_handler,
    rewards_command_handler,
    fees_callback_handler,
    rewards_callback_handler as ref_rewards_callback_handler,
)
from bot.handlers.limit_orders import (
    orders_handler,
    dca_handler,
    limit_order_conversation,
    trailing_stop_conversation,
    dca_view_handler,
    dca_actions_handler,
    dca_menu_callback,
    limit_orders_menu_callback_handler,
)
from bot.handlers.tax import (
    tax_handler,
    tax_year_callback_handler,
    tax_download_callback_handler,
    tax_menu_callback_handler,
)
from bot.handlers.admin_metrics import (
    metrics_handler,
    metrics_volume_handler,
    metrics_fees_handler,
    metrics_users_handler,
    metrics_chains_handler,
    metrics_wallets_handler,
    metrics_errors_handler,
    metrics_refresh_handler,
)
from bot.handlers.admin_performance import (
    perf_handler,
    perf_refresh_handler,
    perf_reset_handler,
    perf_slow_queries_handler,
)
from bot.handlers.support import (
    support_conversation_handler,
    tickets_handler,
    ticket_handler,
    treply_handler,
    tclose_handler,
)
from bot.handlers.subscription import (
    subscription_handler,
    subscription_conversation,
    sub_compare_callback,
    sub_back_callback,
)
from bot.handlers.vip import vip_handler
from bot.handlers.import_handler import import_conversation_handler
from bot.handlers.intel import (
    intel_handler,
    devwatch_handler,
    intel_refresh_handler,
    intel_watch_handler,
)

# Points/XP system handlers
from bot.handlers.points import (
    xp_handler,
    checkin_handler,
    leaderboard_handler,
    rewards_handler,
    xp_callback_handler,
    checkin_callback_handler,
    leaderboard_callback_handler,
    rewards_callback_handler,
    redeem_callback_handler,
    noop_callback_handler as xp_noop_handler,
    points_menu_callback_handler,
)

# Copy Trading handlers
from bot.handlers.copy import (
    traders_handler,
    following_handler,
    profile_handler,
    stats_handler,
    traders_callback_handler,
    view_trader_callback_handler,
    follow_callback_handler,
    unfollow_callback_handler,
    following_callback_handler,
    profile_callback_handler,
    toggle_public_callback_handler,
    edit_emoji_callback_handler,
    set_emoji_callback_handler,
    my_followers_callback_handler,
    mystats_callback_handler,
    copy_now_callback_handler,
    skip_copy_callback_handler,
    profile_edit_conversation,
    copy_menu_callback_handler,
)

# Token Sniping handlers
from bot.handlers.snipe import snipe_conversation_handler
from bot.handlers.predict import predict_conversation_handler
from bot.handlers.savings import savings_conversation_handler
from bot.handlers.borrow import borrow_conversation_handler
from bot.handlers.btc import btc_conversation_handler
from bot.handlers.perps import perps_conversation_handler, perps_menu_callback_handler
from bot.handlers.p2p_handler import p2p_conversation_handler
from bot.handlers.admin_p2p import (
    p2p_release_handler,
    p2p_refund_handler,
    p2p_disputes_handler,
    p2p_resolve_handler,
    p2p_dispute_handler,
)
from bot.handlers.approvals import approval_decision_handler, approvals_command_handler
from bot.handlers.admin_killswitch import kill_switch_handler
from bot.handlers.fund import fund_command_handler, fund_callback_handler
from bot.handlers.hl_ecosystem import (
    twap_handler,
    stake_handler,
    unstake_handler,
    stakemove_handler,
    vault_handler,
    spot_handler,
    hlmove_handler,
    hl_hub_handler,
    hl_ref_handler,
    hl_cancel_handler,
    hl_twap_cancel_handler,
    hl_twap_refresh_handler,
    hl_hub_cb_handler,
    hl_ecosystem_conversation,
)
from bot.handlers.dashboard import dashboard_handler, dashboard_menu_callback
from bot.handlers.token import (
    token_conv_handler,
    token_menu_callback_handler,
    token_unstake_callback_handler,
    token_claim_rewards_callback_handler,
    bond_menu_callback_handler,
    bond_list_callback_handler,
)
from bot.handlers.enterprise import (
    org_handler,
    org_newkey_conversation,
    org_members_callback,
    org_keys_callback,
    org_cancel_callback,
    org_back_callback,
)
from bot.handlers.mpp_handler import get_mpp_handlers
from bot.handlers.tempo import get_tempo_handlers
from bot.handlers.claim_agent import claim_agent_handler, unlink_agent_handler
from bot.handlers.aegis_scan import aegis_scan_update
from bot.handlers.inline_query import inline_query_handler
from bot.services.sniping import launch_detector
from bot.services.fee_sweeper import fee_sweeper
from bot.services.alerts import alert_service
from bot.services.hl_ws_alerts import hl_ws_alerts
from bot.services.orders import order_service
from bot.services.tx_poller import tx_poller
from bot.services.health_monitor import health_monitor
from bot.services.token_security.rug_service import rug_service
from bot.services.swap_engine import SwapEngine
from bot.services.support_notifier import support_notifier
from bot.services.battle_monitor import battle_monitor
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

# SECRET LEAK: httpx logs every request URL at INFO, and the Telegram Bot API
# puts the bot token IN the path — so a plain INFO log level published the full
# token to Railway logs on every API call:
#
#   httpx - INFO - HTTP Request: POST https://api.telegram.org/bot<TOKEN>/sendMessage
#
# Anyone who can read the logs can then read every message and post as the bot.
# The same applies to any other client whose credentials ride in a URL, so pin
# the HTTP libraries to WARNING regardless of LOG_LEVEL rather than relying on
# the deploy never being set to INFO/DEBUG.
for _noisy in ("httpx", "httpcore", "urllib3", "telegram.request"):
    logging.getLogger(_noisy).setLevel(logging.WARNING)

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
    # ============ AEGIS OBSERVE-MODE SCAN (group -1) ============
    # Runs before every group-0 handler below on EVERY update that carries
    # text/caption (free text, captions, forwarded messages all qualify —
    # pure service updates with no text/caption are filtered out here).
    # Scan-only: no reply, no state mutation, never raises
    # ApplicationHandlerStop, so group 0 always still runs normally after it.
    application.add_handler(
        MessageHandler(filters.TEXT | filters.CAPTION, aegis_scan_update), group=-1
    )

    # ============ COMMAND HANDLERS ============
    application.add_handler(start_handler)
    application.add_handler(help_handler)
    application.add_handler(balance_handler)
    application.add_handler(wallet_handler)
    application.add_handler(quickswap_handler)  # /s shortcut
    application.add_handler(history_handler)  # /hx
    application.add_handler(portfolio_handler)  # /p
    application.add_handler(positions_command_handler)  # /pos
    application.add_handler(positions_menu_callback_handler)  # 💼 Positions button
    application.add_handler(positions_refresh_callback_handler)  # Refresh
    application.add_handler(pos_manage_callback_handler)  # Positions → Manage token
    application.add_handler(pos_sell_callback_handler)  # Positions → Sell %
    application.add_handler(gas_handler)  # /g
    application.add_handler(favorites_handler)  # /f
    application.add_handler(settings_handler)  # /set
    application.add_handler(recovery_handler)  # /recovery
    application.add_handler(limits_handler)  # /limits

    # Custodial
    application.add_handler(custodial_handler)  # /c

    # New feature commands
    application.add_handler(alerts_handler)  # /a
    application.add_handler(referral_handler)  # /ref
    application.add_handler(fees_command_handler)  # /fees
    application.add_handler(rewards_command_handler)  # /rewards
    application.add_handler(orders_handler)  # /o (limit orders)
    application.add_handler(dca_handler)  # /dca
    application.add_handler(tax_handler)  # /tax
    application.add_handler(subscription_handler)  # /sub (x402)
    application.add_handler(org_handler)  # /org (enterprise org management)
    application.add_handler(vip_handler)  # /vip (cross-line VIP status)
    application.add_handler(dashboard_handler)  # /dashboard (Mini App)
    application.add_handler(digest_handler)  # /digest

    # Perps Trading
    # Note: perps_conversation_handler added below with other conversation handlers

    # Points/XP system
    application.add_handler(xp_handler)  # /xp
    application.add_handler(checkin_handler)  # /checkin
    application.add_handler(leaderboard_handler)  # /lb
    application.add_handler(rewards_handler)  # /rewards (XP rewards)

    # Copy Trading
    application.add_handler(traders_handler)  # /traders
    application.add_handler(following_handler)  # /following
    application.add_handler(profile_handler)  # /profile
    application.add_handler(stats_handler)  # /tstats (trader stats)

    # Admin commands
    application.add_handler(status_handler)  # /status
    application.add_handler(
        CallbackQueryHandler(status_refresh_callback, pattern="^admin_status$")
    )  # "Refresh" button on /status output
    application.add_handler(clear_cache_handler)  # /clearcache
    application.add_handler(broadcast_handler)  # /broadcast
    application.add_handler(hl_builder_handler)  # /hlbuilder
    application.add_handler(hl_claim_handler)  # /hlclaim
    application.add_handler(cctp_relay_handler)  # /cctprelay
    application.add_handler(set_region_handler)  # /setregion (admin: set user region)
    application.add_handler(hl_ref_handler)  # /hlref (admin)
    application.add_handler(twap_handler)  # /twap
    application.add_handler(stake_handler)  # /stake
    application.add_handler(unstake_handler)  # /unstake
    application.add_handler(stakemove_handler)  # /stakemove
    application.add_handler(vault_handler)  # /vault
    application.add_handler(spot_handler)  # /spot
    application.add_handler(hlmove_handler)  # /hlmove (spot<->perp USDC)
    application.add_handler(hl_hub_handler)  # /hl hub
    application.add_handler(hl_ecosystem_conversation)  # stake/vault amount-entry flow
    application.add_handler(hl_cancel_handler)  # dashboard close button
    application.add_handler(claim_agent_handler)  # /claim (agent control-plane)
    application.add_handler(unlink_agent_handler)  # /unlink
    application.add_handler(hl_twap_cancel_handler)  # TWAP cancel button
    application.add_handler(hl_twap_refresh_handler)  # TWAP refresh button
    application.add_handler(hl_hub_cb_handler)  # /hl hub buttons
    application.add_handler(admin_hot_wallets_handler)  # /hotwallets
    application.add_handler(fees_handler)  # /fees
    application.add_handler(metrics_handler)  # /metrics
    application.add_handler(perf_handler)  # /perf
    application.add_handler(tickets_handler)  # /tickets (admin: list support tickets)
    application.add_handler(ticket_handler)  # /ticket (admin: view one ticket)
    application.add_handler(treply_handler)  # /treply (admin: reply to a ticket)
    application.add_handler(tclose_handler)  # /tclose (admin: resolve a ticket)
    application.add_handler(intel_handler)  # /intel — token deployer/holder report
    application.add_handler(devwatch_handler)  # /devwatch — deployer watchlist
    application.add_handler(intel_refresh_handler)  # /intel "Refresh" button
    application.add_handler(intel_watch_handler)  # /intel "Watch deployer" button

    # ============ CONVERSATION HANDLERS ============
    # Must be added before generic callback handlers
    application.add_handler(swap_conversation_handler)
    application.add_handler(bulk_swap_conversation_handler)  # MONEY-PATH: /bulk multi-leg swap
    application.add_handler(bulk_pay_conversation_handler)  # MONEY-PATH: /pay bulk send to many
    application.add_handler(
        swap_share_ref_handler
    )  # post-swap referral share (outside conversation)
    application.add_handler(wallet_import_handler)
    application.add_handler(slippage_conversation)
    application.add_handler(recovery_conversation)  # settings_recovery -> set email
    application.add_handler(limits_conversation)  # settings_limits -> set spend limits
    application.add_handler(withdrawal_conversation)
    application.add_handler(alert_conversation)
    application.add_handler(limit_order_conversation)
    application.add_handler(
        trailing_stop_conversation
    )  # MONEY-PATH: trailing stop triggers sell execution
    application.add_handler(subscription_conversation)  # x402 subscription flow
    application.add_handler(org_newkey_conversation)  # Enterprise /org new-key name entry
    application.add_handler(profile_edit_conversation)  # Copy trading profile editing
    application.add_handler(snipe_conversation_handler)  # Token sniping /snipe
    application.add_handler(perps_conversation_handler)  # Perps trading /perps
    application.add_handler(battle_conversation_handler)  # MONEY-PATH: gamified /battle
    application.add_handler(predict_conversation_handler)  # Prediction markets /predict
    application.add_handler(savings_conversation_handler)  # USDC savings /save (Aave V3 Base)
    application.add_handler(borrow_conversation_handler)  # Borrow USDC vs cbBTC /borrow (Morpho)
    application.add_handler(btc_conversation_handler)  # BTC bridge /btc (Atomiq, Starknet)
    application.add_handler(p2p_conversation_handler)  # P2P marketplace /p2p
    application.add_handler(p2p_release_handler)  # admin /p2prelease — settle native escrow
    application.add_handler(p2p_refund_handler)  # admin /p2prefund — refund native escrow
    application.add_handler(p2p_dispute_handler)  # /p2pdispute — party freezes escrow
    application.add_handler(p2p_disputes_handler)  # admin /p2pdisputes — arbiter queue
    application.add_handler(p2p_resolve_handler)  # admin /p2presolve — arbitrate
    application.add_handler(approvals_command_handler)  # /approvals (agent control-plane)
    application.add_handler(approval_decision_handler)  # apprv:<id>:yes|no callback
    application.add_handler(kill_switch_handler)  # admin /ks — agent-policy kill switch
    application.add_handler(token_conv_handler)  # SUWP token /token /suwp
    application.add_handler(twofa_conversation)  # TOTP 2FA enrollment /2fa
    application.add_handler(sessions_handler)  # /sessions — list/revoke signed-in devices
    application.add_handler(sessions_revoke_all_handler)  # sessions_revoke_all callback
    application.add_handler(sessions_close_handler)  # sessions_close callback
    application.add_handler(smart_account_handler)  # ERC-4337 smart account /sa
    application.add_handler(recover_handler)  # DKIM-email social recovery /recover
    application.add_handler(airdrop_conversation)  # MONEY-PATH: /airdrop campaign wizard
    application.add_handler(gift_conversation)  # /gift gift cards (gated on BITREFILL_API_KEY)
    application.add_handler(support_conversation_handler)  # /support, /bug — ticket filing

    # ============ COMMUNITY PAYMENT TOOLS (Bucket 2) ============
    # MONEY-PATH: custodial-balance transfers (tip / lucky box / split)
    application.add_handler(tip_handler)  # /tip @user <amt> <token>
    application.add_handler(luckybox_handler)  # /luckybox <total> <count> [random|even]
    application.add_handler(luckybox_claim_handler)  # ^lbclaim_\d+$ — after luckybox_handler
    application.add_handler(split_handler)  # /split <total> @a @b ...
    application.add_handler(split_pay_handler)  # ^splitpay_\d+$

    # Paste-to-trade: /check front door + card callbacks (Buy buttons enter the
    # swap conversation via its own "^pbuy_" entry_point — no extra handler here)
    application.add_handler(CommandHandler("check", check_command))
    application.add_handler(CallbackQueryHandler(paste_cancel_callback, pattern="^paste_cancel$"))
    application.add_handler(
        CallbackQueryHandler(paste_check_hint_callback, pattern="^paste_check_hint$")
    )

    # LLM model preference for natural-language trading (multi-provider routing)
    application.add_handler(CommandHandler("model", llm_model_command))

    # Trending (pull-only discovery): /trending + inline tile + token-view-to-buy.
    # Buy buttons funnel through paste_token + the swap "^pbuy_" entry_point.
    application.add_handler(CommandHandler("trending", trending_command))
    application.add_handler(CallbackQueryHandler(trending_open_callback, pattern="^trending_open$"))
    application.add_handler(CallbackQueryHandler(trending_buy_callback, pattern="^tbuy_"))

    # xStocks — tokenized equities (Backed Finance / Jupiter, Solana). Geo-gated
    # (US/GB/CA/AU + unknown blocked). Buy buttons reuse the swap "^pbuy_" entry.
    application.add_handler(stocks_command_handler)  # /stocks
    application.add_handler(stocks_page_callback_handler)  # xs_page_<n>
    application.add_handler(stocks_view_callback_handler)  # xs_view_<TICKER>
    application.add_handler(stocks_list_callback_handler)  # xs_list_<n>
    application.add_handler(stocks_sell_hint_callback_handler)  # xs_sell_hint
    application.add_handler(stocks_close_callback_handler)  # xs_close

    # ============ CALLBACK QUERY HANDLERS ============

    # Smart accounts (ERC-4337) — chain switcher
    application.add_handler(smart_account_chain_handler)
    # Social recovery — cancel button
    application.add_handler(recover_cancel_handler)

    # On-chain fee cashback (Rewards v1)
    application.add_handler(rewards_handler)  # MONEY-PATH: /rewards + admin epoch lifecycle
    application.add_handler(rewards_claim_handler)  # ^rewards_claim$ custodial credit

    # Gamified battle + airdrop callbacks (Bucket 2/3)
    application.add_handler(battle_menu_callback_handler)  # ^battle_list$ outside conversation
    application.add_handler(airdrop_claim_handler)  # "Claim Airdrop" button
    application.add_handler(airdrop_mine_handler)  # "My Campaigns" button
    application.add_handler(airdrop_cancel_campaign_handler)  # "Cancel #N" button

    # Navigation
    application.add_handler(CallbackQueryHandler(help_callback, pattern="^help$"))
    application.add_handler(CallbackQueryHandler(main_menu_callback, pattern="^main_menu$"))
    application.add_handler(CallbackQueryHandler(home_refresh_callback, pattern="^home_refresh$"))
    application.add_handler(CallbackQueryHandler(more_menu_callback, pattern="^more_menu$"))
    application.add_handler(CallbackQueryHandler(noop_callback, pattern="^noop$"))
    application.add_handler(CallbackQueryHandler(tos_accept_callback, pattern="^tos_accept$"))
    application.add_handler(CallbackQueryHandler(tos_decline_callback, pattern="^tos_decline$"))
    application.add_handler(CallbackQueryHandler(tos_review_callback, pattern="^tos_review$"))
    # Gekko mobile Telegram sign-in: staged-request Approve/Not me buttons.
    # MONEY-PATH — approve_callback is the only call site that can mint a
    # collectible pairing (see bot/handlers/start.py, mobile_pairing_service.py).
    application.add_handler(CallbackQueryHandler(gekko_approve_callback, pattern="^gekko_ok:"))
    application.add_handler(CallbackQueryHandler(gekko_reject_callback, pattern="^gekko_no:"))

    # Balance & Portfolio
    application.add_handler(CallbackQueryHandler(balance_callback, pattern="^balance$"))
    application.add_handler(CallbackQueryHandler(portfolio_callback, pattern="^portfolio"))
    application.add_handler(history_callback)
    application.add_handler(history_menu_callback)
    application.add_handler(history_page_handler)
    application.add_handler(share_pnl_handler)  # "^pnl_share_\d+$" Share PnL button

    # Wallet
    application.add_handler(CallbackQueryHandler(wallet_menu_callback, pattern="^wallet_menu$"))
    application.add_handler(CallbackQueryHandler(wallet_create_callback, pattern="^wallet_create_"))
    application.add_handler(CallbackQueryHandler(wallet_qr_callback, pattern="^wallet_qr_"))

    # Swap
    application.add_handler(CallbackQueryHandler(check_swap_status, pattern="^swap_status_"))
    application.add_handler(
        CallbackQueryHandler(quickswap_confirm_callback, pattern="^quickswap_confirm$")
    )
    application.add_handler(
        CallbackQueryHandler(quickswap_menu_callback, pattern="^quickswap_menu$")
    )

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
    application.add_handler(toggle_mev_handler)  # Settings → MEV protection toggle
    application.add_handler(toggle_proactive_handler)  # Settings → proactive-alerts opt-in
    application.add_handler(speed_menu_handler)  # Settings → tx speed menu
    application.add_handler(speed_set_handler)  # Settings → tx speed set
    application.add_handler(chain_menu_handler)  # Settings → default chain menu
    application.add_handler(chain_set_handler)  # Settings → default chain set
    application.add_handler(recovery_menu_callback)  # settings_recovery button
    application.add_handler(notify_prefs_handler)  # Settings → notification prefs submenu
    application.add_handler(ntoggle_copy_handler)  # Notif prefs → copy executed toggle
    application.add_handler(ntoggle_order_handler)  # Notif prefs → order triggered toggle
    application.add_handler(ntoggle_portfolio_handler)  # Notif prefs → portfolio milestone toggle
    application.add_handler(ntoggle_risk_handler)  # Notif prefs → risk event toggle

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
    application.add_handler(CallbackQueryHandler(alert_manage_callback, pattern="^alert_manage$"))
    application.add_handler(CallbackQueryHandler(alert_delete_callback, pattern="^alert_delete_"))

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
    application.add_handler(
        CallbackQueryHandler(dashboard_menu_callback, pattern="^dashboard_menu$")
    )

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

    # Enterprise org management
    application.add_handler(CallbackQueryHandler(org_members_callback, pattern="^org_members$"))
    application.add_handler(CallbackQueryHandler(org_keys_callback, pattern="^org_keys$"))
    application.add_handler(CallbackQueryHandler(org_cancel_callback, pattern="^org_cancel$"))
    application.add_handler(CallbackQueryHandler(org_back_callback, pattern="^org_back$"))

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

    # HyperLiquid funding (one-click cross-chain deposits)
    application.add_handler(fund_command_handler)
    application.add_handler(fund_callback_handler)

    # SUWP token staking callbacks
    application.add_handler(token_menu_callback_handler)
    application.add_handler(token_unstake_callback_handler)
    application.add_handler(token_claim_rewards_callback_handler)
    application.add_handler(bond_menu_callback_handler)
    application.add_handler(bond_list_callback_handler)

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

    # Tempo MPP (Machine Payments Protocol) — /mpp
    # Gated OFF by default: the MPP hosts (api.mpp.dev / directory.mpp.dev) do
    # not resolve, so registering this would ship a command that always fails.
    if settings.mpp_enabled:
        for mpp_handler in get_mpp_handlers():
            application.add_handler(mpp_handler)
    else:
        logger.info("MPP surface disabled (mpp_enabled=false) — /mpp not registered")

    # Tempo session keys (access keys) — /tempo
    for tempo_handler in get_tempo_handlers():
        application.add_handler(tempo_handler)

    # BullX Neo migration wizard — /import
    application.add_handler(import_conversation_handler)

    # Inline mode — "@<botname> BTC" in any chat renders a price card with a
    # referral deep link. Requires enabling inline mode for the bot via
    # BotFather (/setinline) in addition to this registration.
    application.add_handler(InlineQueryHandler(inline_query_handler))

    # Natural-language trade intent (Anthropic-backed) — registered in the
    # SAME default group (0), immediately BEFORE the freeform-text catch-all,
    # and ONLY when settings.NL_TRADING_ENABLED is True. This placement is
    # safe because:
    #  1. PTB checks handlers within a group in insertion order and stops the
    #     group at the first match. All ConversationHandlers (2FA entry,
    #     amount-entry, confirm-swap states, etc.) are registered earlier in
    #     this same group, so an active conversation's text is consumed there
    #     and this handler is never reached for it.
    #  2. When the flag is off (default in production) the handler is not
    #     registered at all, so there is zero behavior change from today.
    #  3. handle_nl_text itself delegates to on_freeform_text (the existing
    #     paste-to-trade / keyword router) for anything it can't confidently
    #     classify, so enabling the flag never produces a dead-end or a
    #     silently dropped message.
    if settings.NL_TRADING_ENABLED:
        application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_nl_text))

    # Freeform text catch-all — MUST be registered last in the default group so
    # it only fires when no ConversationHandler (or earlier handler) handles the
    # text. PTB runs one handler per group; conversations only match when active,
    # so a plain paste / freeform message falls through to here. Handles
    # paste-to-trade (token address → card) and the keyword intent router.
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, on_freeform_text))

    # Error handler
    application.add_error_handler(error_handler)


async def post_init(application) -> None:
    """Called after the application is initialized."""
    logger.info("Starting background services...")

    # Set up Telegram Mini App menu button
    try:
        await application.bot.set_chat_menu_button(
            menu_button=MenuButtonWebApp(
                text="📊 Dashboard", web_app=WebAppInfo(url=settings.webapp_url)
            )
        )
        logger.info(f"✓ Menu button set to Mini App: {settings.webapp_url}")
    except Exception as e:
        logger.warning(f"Could not set menu button: {e}")

    # Register bot commands for Telegram autocomplete menu.
    #
    # A 40-item flat "/" list is an unscannable wall that buries the headline
    # actions. We register a CURATED ~13-command default menu (the long tail
    # still works when typed, and everything is reachable via /start's inline
    # menu). Admins additionally get their ops tools in their OWN "/" menu via a
    # per-chat scope, so they no longer have to remember hidden commands.
    try:
        commands = [
            BotCommand("start", "🏠 Home — live balance, positions & PnL"),
            BotCommand("s", "💱 Swap a token"),
            BotCommand("perps", "📈 Perps trading"),
            BotCommand("predict", "🔮 Prediction markets"),
            BotCommand("p", "📊 Portfolio overview"),
            BotCommand("pos", "💼 Positions & PnL"),
            BotCommand("w", "👛 Wallets"),
            BotCommand("save", "🏦 Earn yield on idle USDC"),
            BotCommand("a", "🔔 Price alerts"),
            BotCommand("check", "🛡️ Token safety check"),
            BotCommand("btc", "₿ BTC bridge (Lightning ⇄ Starknet)"),
            BotCommand("ref", "🎁 Referrals & rewards"),
            BotCommand("vip", "⭐ VIP status — your tier, fee rate & XP multiplier"),
            BotCommand("import", "📥 Import wallets — migrate from BullX or another bot"),
            BotCommand("model", "🤖 AI model for natural-language trading"),
            BotCommand("support", "🆘 Contact support"),
            BotCommand("bug", "🐞 Report a bug"),
            BotCommand("set", "⚙️ Settings"),
            BotCommand("h", "📖 Help — full command list"),
        ]
        await application.bot.set_my_commands(commands)
        logger.info(f"✓ Registered {len(commands)} default bot commands")

        # Admin-scoped menu: curated commands + ops tools, only in admins' chats.
        try:
            from telegram import BotCommandScopeChat
            from bot.handlers.admin import ADMIN_IDS

            admin_commands = commands + [
                BotCommand("st", "🛠️ Status"),
                BotCommand("m", "🛠️ Metrics"),
                BotCommand("perf", "🛠️ Performance"),
                BotCommand("fee", "🛠️ Fees"),
                BotCommand("hw", "🛠️ Hot wallets"),
                BotCommand("bc", "🛠️ Broadcast"),
                BotCommand("cc", "🛠️ Clear cache"),
            ]
            for admin_id in ADMIN_IDS:
                try:
                    await application.bot.set_my_commands(
                        admin_commands, scope=BotCommandScopeChat(chat_id=admin_id)
                    )
                except Exception as e:
                    logger.warning(f"Could not set admin commands for {admin_id}: {e}")
            if ADMIN_IDS:
                logger.info(f"✓ Registered admin command menu for {len(ADMIN_IDS)} admin(s)")
        except Exception as e:
            logger.warning(f"Could not register admin command scope: {e}")
    except Exception as e:
        logger.warning(f"Could not register bot commands: {e}")

    # Seed default milestones and rewards for points system
    from bot.services.points_service import points_service

    points_service.seed_milestones_and_rewards()
    logger.info("✓ Points milestones and rewards seeded")

    # Seed the first convertible-points season (idempotent)
    from bot.services.seasons_service import seasons_service

    seasons_service.ensure_seed()
    logger.info("✓ Season seeded")

    # Get admin IDs from settings
    admin_ids = getattr(settings, "admin_ids", [])

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
        # Dev Tracking: notify users watching a deployer when it launches a new
        # token. Hooked non-fatally — a bug here must never break sniping.
        async def _on_launch_dev_watch(launch) -> None:
            try:
                from bot.services.token_intel.dev_watch import check_watched_deployer_launch

                await check_watched_deployer_launch(launch, bot=application.bot)
            except Exception as e:
                logger.error(f"Dev-watch launch check failed: {e}")

        launch_detector.on_launch(_on_launch_dev_watch)
        await launch_detector.start()
        logger.info("✓ Token launch detector started")

        # Start rug protection service (money-path auto-sell — gated off by
        # default, see RUG_AUTO_SELL_ENABLED in bot/config/settings.py).
        # H2: RugService.start() now hard-refuses (raises RuntimeError) if the
        # DB schema it depends on isn't ready (e.g. swap_transactions.from_token/
        # to_token not yet widened) rather than starting a silently-dead
        # service. Caught here so a schema-gap on an opt-in feature doesn't
        # take the whole bot boot down — it's logged as CRITICAL and the
        # service simply doesn't run.
        if settings.rug_auto_sell_enabled:
            try:
                await rug_service.start(swap_engine=SwapEngine())
                logger.info("✓ Rug protection service started")
            except Exception as e:
                # Broadened from RuntimeError: any failure here (schema gap,
                # transient DB blip, etc.) must not brick the whole bot boot —
                # log CRITICAL and continue without the (opt-in) service.
                logger.critical(f"✗ Rug protection service refused to start: {e}")
        else:
            logger.info("⏭️ Rug protection service DISABLED via RUG_AUTO_SELL_ENABLED=false")

        # Start support ticket fan-out (admin DM + support group + Linear sync)
        await support_notifier.start(bot=application.bot)
        logger.info("✓ Support notifier started")

        # Start HyperLiquid WebSocket alert feed
        if settings.hl_ws_alerts_enabled:
            await hl_ws_alerts.start(bot=application.bot)
            logger.info("✓ HyperLiquid WebSocket alerts started")

        # Start battle settlement monitor (settles expired /battle positions)
        await battle_monitor.start(bot=application.bot)
        logger.info("✓ Battle monitor started")


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
        if settings.hl_ws_alerts_enabled:
            await hl_ws_alerts.stop()
        await support_notifier.stop()
        await battle_monitor.stop()

    # Finding 4: stop the rug protection service on shutdown too — same gate
    # (rug_auto_sell_enabled) as the start call in post_init. `stop()` itself
    # is safe to call even if start() never ran (or refused to start via the
    # H2 schema-capability guard) — it's a no-op guard on `self._ws_task`.
    if settings.rug_auto_sell_enabled:
        await rug_service.stop()

    logger.info("Closing HTTP session pool...")
    await close_http_session()


async def run_headless() -> None:
    """Run background services without Telegram polling."""
    logger.warning("⚠️ Starting in HEADLESS MODE (Telegram token invalid/missing)")

    # Initialize background services manually
    admin_ids = getattr(settings, "admin_ids", [])

    await fee_sweeper.start()
    logger.info("✓ Fee sweeper started")

    # These services usually need a bot to send messages
    # We pass None and they should handle it gracefully
    await alert_service.start(bot=None)
    await order_service.start(bot=None, swap_engine=SwapEngine())
    await tx_poller.start(bot=None)
    await health_monitor.start(bot=None, admin_ids=admin_ids)
    if settings.rug_auto_sell_enabled:
        try:
            await rug_service.start(swap_engine=SwapEngine())
        except Exception as e:
            # Broadened from RuntimeError — see comment at the other
            # rug_service.start() call site above.
            logger.critical(f"✗ Rug protection service refused to start: {e}")
    else:
        logger.info("⏭️ Rug protection service DISABLED via RUG_AUTO_SELL_ENABLED=false")
    await battle_monitor.start(bot=None)

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
    builder = (
        Application.builder()
        .token(settings.telegram_bot_token)
        .persistence(persistence)
        .post_init(post_init)
        .post_shutdown(post_shutdown)
    )
    if settings.bot_concurrent_updates > 0:
        from bot.utils.update_processor import PerUserSerializingProcessor

        builder = (
            builder.concurrent_updates(
                PerUserSerializingProcessor(max_concurrent_updates=settings.bot_concurrent_updates)
            )
            .connection_pool_size(512)
            .rate_limiter(AIORateLimiter(max_retries=3))
        )
    application = builder.build()

    # Add all handlers
    add_handlers(application)

    # Log available commands
    logger.info("User commands: /start, /h, /w, /b, /s, /hx, /p, /g, /f, /set, /c")
    logger.info(
        "Trading commands: /a, /o, /dca, /ref, /tax, /sub, /snipe, /perps, /predict, /dashboard"
    )
    logger.info("Growth commands: /xp, /checkin, /lb, /traders, /following, /profile")
    logger.info("Admin commands: /st, /hw, /fee, /m")
    logger.info(
        "Background services: Fee sweeper, Price alerts, Limit orders/DCA, Tx poller, Health monitor, Launch detector"
    )

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
