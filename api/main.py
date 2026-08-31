import sys
import os
import asyncio

# Use uvloop for a faster event loop when available (no-op if not installed).
# Must run before any event loop is created.
try:
    import uvloop

    uvloop.install()
except ImportError:
    pass

import re
import time
import uuid
from contextvars import ContextVar
from pathlib import Path
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

# Request-ID context variable — propagated into every service/log call within
# the same async context without threading explicit parameters everywhere.
request_id_ctx: ContextVar[str] = ContextVar("request_id", default="unknown")

from fastapi import (  # noqa: E402
    FastAPI,
    Depends,
    HTTPException,
    Request,
    Security,
    Response,
    Cookie,
)  # noqa: E402
from fastapi.security.api_key import APIKeyHeader  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import PlainTextResponse, JSONResponse, RedirectResponse  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402

# Import webapp router (may be removed in some branches)
try:
    from api.webapp import router as webapp_router
except ImportError:
    webapp_router = None
from sqlalchemy.orm import Session  # noqa: E402
from pydantic import BaseModel, ConfigDict  # noqa: E402
import secrets  # noqa: E402
import json  # noqa: E402
import jwt  # noqa: E402
import hashlib  # noqa: E402
import hmac  # noqa: E402
import base64  # noqa: E402

# Add project root to path to import bot modules
project_root = str(Path(__file__).parent.parent)
if project_root not in sys.path:
    sys.path.append(project_root)

from bot.services.wallet import WalletService  # noqa: E402
from bot.config.settings import settings  # noqa: E402
from bot.services.fee_sweeper import fee_sweeper  # noqa: E402
from bot.services.alerts import alert_service  # noqa: E402
from bot.services.market_data import market_data_service  # noqa: E402
from bot.services.venue_data import venue_data_service  # noqa: E402
from bot.services.orders import order_service  # noqa: E402
from bot.services.swap_engine import SwapEngine  # noqa: E402
from bot.services.tx_poller import tx_poller  # noqa: E402
from bot.services.execution_scorer import execution_scorer  # noqa: E402
from bot.services.withdraw_reconciler import withdraw_reconciler  # noqa: E402
from bot.services.health_monitor import health_monitor  # noqa: E402
from bot.services.approval_notifier import approval_notifier  # noqa: E402
from bot.services.webhook_dispatcher import webhook_dispatcher  # noqa: E402
from bot.services.balance_refresher import balance_refresher  # noqa: E402
from bot.services.perps_monitor import perps_monitor  # noqa: E402
from bot.services.hl_ecosystem_monitor import hl_ecosystem_monitor  # noqa: E402
from bot.services.hl_ws_alerts import hl_ws_alerts  # noqa: E402
from bot.services.predict_monitor import predict_monitor  # noqa: E402
from bot.services.cctp_relayer import cctp_relayer  # noqa: E402
from bot.services.cctp_generic_relayer import cctp_generic_relayer  # noqa: E402
from bot.services.event_bus import event_bus  # noqa: E402
from bot.services.digest_service import digest_service  # noqa: E402
from bot.services.api_client import api_client  # noqa: E402
from bot.utils.preload import preload_config  # noqa: E402
from bot.services.rpc_manager import rpc_manager  # noqa: E402
from bot.services.aegis_service import get_aegis  # noqa: E402
from database.db import init_db, engine, get_session, DATABASE_AVAILABLE  # noqa: E402
from bot.models.user import User, Wallet  # noqa: E402
from bot.models.swap import SwapTransaction, SwapStatus  # noqa: E402
from bot.models.agent import RegisteredAgent  # noqa: E402
from bot.utils.db_monitor import setup_db_monitoring  # noqa: E402
from bot.utils.rate_limiter import UserRateLimiter, RateLimitExceeded  # noqa: E402
from bot.utils.telegram_safe import safe_md  # noqa: E402
from bot.utils import task_supervisor  # noqa: E402
from bot.main import add_handlers  # noqa: E402
from telegram.ext import AIORateLimiter, Application, PicklePersistence  # noqa: E402
from telegram import Update  # noqa: E402
from contextlib import asynccontextmanager, contextmanager  # noqa: E402

import logging  # noqa: E402

logger = logging.getLogger(__name__)

# Tracks optional/non-critical services that failed to start (or, for
# periodic tasks, most recently failed) so /health can surface them without
# flipping the process unhealthy — these are deliberately non-fatal to
# startup, but a failure should never be invisible. name -> short error
# summary. Cleared on a subsequent success so a self-healing periodic task
# (e.g. auth-challenge cleanup) doesn't stay flagged forever.
DEGRADED_SERVICES: dict[str, str] = {}


def _mark_degraded(name: str, error: BaseException) -> None:
    DEGRADED_SERVICES[name] = str(error)[:300]


def _clear_degraded(name: str) -> None:
    DEGRADED_SERVICES.pop(name, None)


@contextmanager
def _track_degraded(name: str, log_prefix: str, auto_clear: bool = True):
    """Run one optional startup step, never letting its failure block startup.

    Collapses the try/except/`_mark_degraded`/`_clear_degraded` skeleton that
    was previously hand-rolled at each optional-service call site (p2p_escrow,
    discord_alerts, auth_challenge_cleanup, event_bus, internal_api_client,
    whatsapp_queue) into one reusable wrapper. On a clean exit,
    `_clear_degraded(name)` runs automatically unless `auto_clear=False` — the
    event_bus site needs that escape hatch because "connected" and "ran
    without error but stayed disconnected" are both non-exceptional outcomes
    that should NOT both clear the degraded flag, so it clears explicitly
    inside its own body instead.
    """
    try:
        yield
        if auto_clear:
            _clear_degraded(name)
    except Exception as e:  # noqa: BLE001 — deliberately broad: never block startup
        logger.warning(f"{log_prefix}: {e}")
        _mark_degraded(name, e)


# --- Lifespan Manager ---


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifecycle manager for the consolidated API + Bot service."""
    logger.info("🚀 Starting consolidated Suwappu Monolith...")

    # 0. Error tracking (no-op unless SENTRY_DSN is set; never raises)
    from bot.services.sentry_service import init_sentry

    init_sentry()

    # 1. Initialize DB, Cache & Config
    preload_config()
    from bot.utils.redis_cache import redis_cache

    await redis_cache.connect()
    await rpc_manager.start()

    # Initialize database with error handling
    db_success = False
    try:
        db_success = init_db(settings.database_url)
        if not db_success:
            logger.warning("⚠️ Database initialization failed - API running in degraded mode")
    except Exception as e:
        logger.error(f"Database initialization error: {e}")
        logger.warning("⚠️ API will run in degraded mode without database")

    # Set up database monitoring if database is available
    if engine and db_success:
        setup_db_monitoring(engine)
        logger.info("✓ Database monitoring enabled")
    else:
        logger.warning("⚠️ Database monitoring disabled (no connection)")

    if not db_success:
        # DATABASE_AVAILABLE is only ever set inside init_db(), so a DB that is
        # unreachable for the ~30s of boot-time retries used to leave this
        # instance degraded — /health/ready 503 — for its entire life, which
        # Railway reads as a failed deploy. Keep retrying in the background so
        # a transient outage self-heals. Telegram bot init is still skipped for
        # the life of the process (restoring it needs the full startup
        # sequence); this recovers API readiness, not the bot.
        async def _db_reconnect_loop():
            delay = 15.0
            while True:
                await asyncio.sleep(delay)
                # init_db is sync and retries internally — run it off the event
                # loop so reconnect attempts don't stall request handling.
                if await asyncio.to_thread(init_db, settings.database_url):
                    from database import db as _db_module

                    if _db_module.engine is not None:
                        setup_db_monitoring(_db_module.engine)
                    logger.info("✓ Database recovered after failed boot-time init")
                    return
                delay = min(delay * 2, 300.0)

        task_supervisor.spawn("db_reconnect", _db_reconnect_loop)

    # Reconcile any EXECUTING rows that have no tx_hash (process died mid-execution)
    if db_success:
        try:
            cutoff = datetime.now(timezone.utc) - timedelta(minutes=10)
            with get_session() as session:
                orphaned = (
                    session.query(SwapTransaction)
                    .filter(
                        SwapTransaction.status == SwapStatus.EXECUTING.value,
                        SwapTransaction.tx_hash.is_(None),
                        SwapTransaction.created_at < cutoff,
                    )
                    .all()
                )
                if orphaned:
                    for row in orphaned:
                        row.status = SwapStatus.FAILED.value
                        row.error_message = "Reconciled at startup: EXECUTING with no tx_hash"
                    session.commit()
                    logger.warning("Reconciled %d orphaned EXECUTING transactions", len(orphaned))
        except Exception as e:
            logger.warning(f"Orphan reconciliation error (non-fatal): {e}")

    # 2. Build Bot Application (skipped entirely in worker mode: RUN_TELEGRAM_BOT=false)
    bot_app = None
    if settings.run_telegram_bot:
        os.makedirs("data", exist_ok=True)
        persistence_path = os.environ.get("BOT_PERSISTENCE_PATH", "data/bot_persistence.pickle")
        persistence = PicklePersistence(filepath=persistence_path)
        _bot_builder = (
            Application.builder().token(settings.telegram_bot_token).persistence(persistence)
        )
        if settings.bot_concurrent_updates > 0:
            from bot.utils.update_processor import PerUserSerializingProcessor

            _bot_builder = (
                _bot_builder.concurrent_updates(
                    PerUserSerializingProcessor(
                        max_concurrent_updates=settings.bot_concurrent_updates
                    )
                )
                .connection_pool_size(512)
                .rate_limiter(AIORateLimiter(max_retries=3))
            )
        bot_app = _bot_builder.build()
        add_handlers(bot_app)

    # Store bot_app (or None in worker mode) in app.state for webhook endpoint access
    app.state.bot_app = bot_app

    # 3. Start Bot Hooks (only if database is available)
    polling_task = None
    bot_initialized = False
    using_webhook = False

    if not settings.run_telegram_bot:
        logger.info("⏭️ Telegram bot DISABLED via RUN_TELEGRAM_BOT=false (worker mode)")
    elif not db_success:
        logger.warning("⚠️ Skipping bot initialization - database not available")
    else:
        try:
            await bot_app.initialize()
            await bot_app.start()
            bot_initialized = True

            if settings.telegram_bot_token and settings.telegram_bot_token != "123456789:ABCDEF":
                # Check if webhook mode is enabled
                if settings.use_webhook and settings.webhook_url:
                    # Webhook mode for production (safe with multiple replicas)
                    webhook_secret = settings.get_webhook_secret()
                    await bot_app.bot.set_webhook(
                        url=settings.webhook_url,
                        secret_token=webhook_secret,
                        allowed_updates=Update.ALL_TYPES,
                        drop_pending_updates=True,
                        max_connections=40,
                    )
                    using_webhook = True  # noqa: F841
                    logger.info(f"✓ Telegram webhook set: {settings.webhook_url}")
                else:
                    # Guard: refuse to start polling when multiple replicas are
                    # detected.  Telegram only allows one concurrent getUpdates
                    # consumer per bot token; a second poller causes 409 conflicts
                    # and message duplication.  Railway exposes
                    # RAILWAY_SERVICE_INSTANCE_COUNT (configured replicas) and
                    # RAILWAY_REPLICA_ID (present on every replica instance).
                    # We block when the configured count is explicitly > 1.
                    # Unknown / unset values default to 1 (safe for local dev).
                    _replica_count_is_set = "RAILWAY_SERVICE_INSTANCE_COUNT" in os.environ
                    _raw_replica_count = os.environ.get("RAILWAY_SERVICE_INSTANCE_COUNT", "1")
                    try:
                        _replica_count = int(_raw_replica_count)
                    except (ValueError, TypeError):
                        _replica_count = 1

                    # The default-to-1 above is silent by design for local dev, but on
                    # Railway an unset var is indistinguishable from "really 1 replica"
                    # — if a service's replica count is bumped without this var being
                    # wired up, polling mode starts happily on every replica and the
                    # 409 guard above never fires. Surface it instead of trusting the
                    # default blindly in a deployed environment.
                    if not _replica_count_is_set and os.environ.get("RAILWAY_ENVIRONMENT_NAME"):
                        logger.warning(
                            "RAILWAY_SERVICE_INSTANCE_COUNT is unset on Railway while "
                            "polling mode is active (USE_WEBHOOK=false). Defaulting to "
                            "1 replica — if this service is ever scaled to multiple "
                            "replicas without this var set, the multi-replica 409 guard "
                            "above will not catch it."
                        )

                    if _replica_count > 1:
                        logger.error(
                            "POLLING DISABLED: %d replicas detected "
                            "(RAILWAY_SERVICE_INSTANCE_COUNT=%s) but USE_WEBHOOK=false. "
                            "Running multiple polling instances against the same bot token "
                            "will cause Telegram 409 conflicts. "
                            "Fix: set USE_WEBHOOK=true and configure WEBHOOK_URL + "
                            "WEBHOOK_SECRET_TOKEN, then redeploy.",
                            _replica_count,
                            _raw_replica_count,
                        )
                        # Leave polling_task = None so shutdown is unaffected.
                    else:
                        # Polling mode for local development / single-instance deploys
                        logger.info("✓ Starting Telegram polling background task")
                        # drop_pending_updates=True helps avoid conflicts during redeploys
                        # restart=False: `start_polling()` only bootstraps PTB's own
                        # internal fetch-loop task and returns — it does not run for the
                        # life of the process, so there is nothing here for the
                        # supervisor to restart. PTB's Updater already retries transient
                        # getUpdates failures internally; supervising this awaitable is
                        # only for logging a bootstrap failure and matching the existing
                        # `if polling_task:` shutdown check.
                        polling_task = task_supervisor.spawn(
                            "telegram_polling",
                            lambda: bot_app.updater.start_polling(
                                allowed_updates=Update.ALL_TYPES, drop_pending_updates=True
                            ),
                            restart=False,
                        )
            else:
                logger.warning(
                    "⚠️ Placeholder or missing Telegram token. Skipping polling/webhook."
                )
        except Exception as e:
            logger.error(f"❌ Telegram bot failed to initialize: {e}")
            logger.warning("⚠️ Continuing in HEADLESS MODE (API only)")

    # 4. Start Discord Bot (if configured)
    discord_bot = None
    discord_task = None
    if db_success and settings.discord_bot_token:
        try:
            from bot.platforms.discord_bot import SuwappuDiscordBot

            discord_bot = SuwappuDiscordBot()
            # restart=True: discord.py's Client.start() runs for the life of the
            # connection and raises on a dropped gateway session — worth restarting
            # rather than leaving the bot silently offline until the next deploy.
            discord_task = task_supervisor.spawn(  # noqa: F841
                "discord_bot", discord_bot.start, restart=True
            )
            app.state.discord_bot = discord_bot
            logger.info("✓ Discord bot starting")
        except Exception as e:
            logger.warning(f"⚠️ Discord bot failed to start: {e}")

    # 5. Start Background Services (only if database is available AND enabled)
    admin_ids = getattr(settings, "admin_ids", [])
    enable_background_services = getattr(settings, "enable_background_services", True)

    if not enable_background_services:
        logger.info("⏭️ Background services DISABLED via ENABLE_BACKGROUND_SERVICES=false")
    elif db_success:
        # Publish this build's fingerprint so the worker is verifiable.
        #
        # python-worker has NO public URL, so /health cannot be probed and
        # there was no way to answer "is the worker running my code?". That
        # turned a stale worker deploy into hours of guesswork: the scorer was
        # wired into this very block, deployed green repeatedly, and simply
        # never appeared in the boot sequence — indistinguishable from a code
        # bug. Redis is already the worker's channel for heartbeats, so it is
        # the natural place to announce the build too; python-api surfaces it
        # on /health/ready.
        try:
            from bot.utils.redis_cache import redis_cache

            # 24h, not an hour: this answers "what build did the worker last
            # boot with", so it must outlive a quiet period. A short TTL would
            # expire on a perfectly healthy worker and report "unknown",
            # recreating exactly the ambiguity this is meant to remove.
            # Liveness is a separate question, already answered by the
            # per-service heartbeats below.
            await redis_cache.set(
                "service:worker:fingerprint", SOURCE_FINGERPRINT, ttl_seconds=86400
            )
            logger.info(f"✓ Worker build fingerprint published: {SOURCE_FINGERPRINT}")

            # ...and keep republishing it. Writing this ONCE at startup meant a
            # 24h TTL could only answer the question for the first 24h of a
            # deploy. Observed in production: the worker last deployed 04 Aug,
            # the key expired on the 5th, and /health reported
            # worker_fingerprint "unknown" for ten days on a worker that was
            # demonstrably alive and logging — which is precisely the ambiguity
            # the comment above says this exists to remove. A stable worker does
            # not restart for weeks, so "outlive a quiet period" needed a
            # refresh, not a longer TTL.
            async def _republish_fingerprint():
                while True:
                    await asyncio.sleep(3600)
                    try:
                        await redis_cache.set(
                            "service:worker:fingerprint",
                            SOURCE_FINGERPRINT,
                            ttl_seconds=86400,
                        )
                    except Exception:  # pragma: no cover - best effort
                        pass

            task_supervisor.spawn("fingerprint_republisher", _republish_fingerprint)
        except Exception as e:
            logger.warning(f"Could not publish worker fingerprint: {e}")

        # Stagger service starts to avoid thundering herd on DB
        await fee_sweeper.start()
        await asyncio.sleep(2)
        # Credits inbound custodial deposits. Without it TransactionType.DEPOSIT
        # is never written and funds sent to a deposit address are never booked
        # to anyone. Optional-start: a watcher that cannot reach an RPC must not
        # block the API, but it must be visible as degraded rather than silent.
        with _track_degraded("deposit_watcher", "⚠️ Deposit watcher failed to start"):
            from bot.services.deposit_watcher import deposit_watcher

            await deposit_watcher.start()
        await asyncio.sleep(2)
        await alert_service.start(bot=bot_app.bot if bot_initialized else None)
        await asyncio.sleep(2)
        # Market data capture (candles for the Historical API). No-op unless
        # market_data_capture_enabled (default True).
        await market_data_service.start()
        await asyncio.sleep(2)
        # Venue data capture (perps/predictions/lend time series). No-op unless
        # venue_data_capture_enabled (default True).
        await venue_data_service.start()
        await asyncio.sleep(2)
        await order_service.start(
            bot=bot_app.bot if bot_initialized else None, swap_engine=SwapEngine()
        )
        await asyncio.sleep(2)
        await tx_poller.start(bot=bot_app.bot if bot_initialized else None)
        await asyncio.sleep(2)
        # Resolves PENDING custodial withdrawal placeholders left behind by
        # crashes or ambiguous post-broadcast send failures (see
        # bot/services/withdraw_reconciler.py + PostBroadcastAmbiguous in
        # hot_wallet.py).
        await withdraw_reconciler.start()
        await asyncio.sleep(2)
        await health_monitor.start(
            bot=bot_app.bot if bot_initialized else None, admin_ids=admin_ids
        )
        await asyncio.sleep(2)
        await balance_refresher.start()
        await asyncio.sleep(2)
        # Agent control-plane approval notifier: DMs the owning Telegram user
        # for pending api-ts approval_requests rows (gated on
        # AGENT_APPROVALS_ENABLED, no-op otherwise).
        await approval_notifier.start(bot=bot_app.bot if bot_initialized else None)
        await asyncio.sleep(2)
        # Durable retry + dead-letter for approval-decision webhooks enqueued
        # by approval_webhook.notify_approval_decided. Same feature flag as
        # approval_notifier since it's part of the same agent control-plane
        # feature.
        await webhook_dispatcher.start()
        await asyncio.sleep(2)
        # Post-trade execution scoring (execution intelligence, phase 2).
        # Marks out completed swaps at fixed horizons so realized-vs-quoted
        # (ours) can be separated from markout (the market's).
        await execution_scorer.start()
        await asyncio.sleep(2)
        # Perps position-sync loop (#248): previously implemented but never started.
        await perps_monitor.start(bot=bot_app.bot if bot_initialized else None)
        await asyncio.sleep(2)
        # HyperLiquid ecosystem loop: TWAP completion, unstake unlocks, vault PnL.
        await hl_ecosystem_monitor.start(bot=bot_app.bot if bot_initialized else None)
        await asyncio.sleep(2)
        # Prediction-market loop: live PnL refresh + market-resolution settlement.
        await predict_monitor.start(bot=bot_app.bot if bot_initialized else None)
        await asyncio.sleep(2)
        # Wire the native P2P escrow executor to the on-chain USDC settlement path.
        if getattr(settings, "p2p_enabled", True):
            with _track_degraded("p2p_escrow", "P2P escrow wiring skipped"):
                from bot.services.p2p_escrow_executor import wire_p2p_escrow

                wire_p2p_escrow()
        # Real-time HyperLiquid WS alert feed (no-op unless hl_ws/whale flags on).
        await hl_ws_alerts.start(bot=bot_app.bot if bot_initialized else None)
        await asyncio.sleep(2)
        # CCTP -> HyperCore deposit relayer (no-op unless cctp_relayer_enabled).
        await cctp_relayer.start(bot=bot_app.bot if bot_initialized else None)
        await asyncio.sleep(2)
        # CCTP generic-rail completion relayer (no-op unless
        # cctp_generic_relayer_enabled; independent of cctp_generic_rail_enabled).
        await cctp_generic_relayer.start(bot=bot_app.bot if bot_initialized else None)
        await asyncio.sleep(2)
        await digest_service.start(bot=bot_app.bot if bot_initialized else None)
        if getattr(settings, "starknet_btc_bridge_enabled", False):
            await asyncio.sleep(2)
            from bot.services.btc_bridge_poller import btc_bridge_poller

            await btc_bridge_poller.start(bot=bot_app.bot if bot_initialized else None)

        if getattr(settings, "morpho_enabled", False):
            await asyncio.sleep(2)
            from bot.services.morpho_monitor import morpho_monitor

            await morpho_monitor.start(bot=bot_app.bot if bot_initialized else None)

        # Start Discord alert service if Discord bot is available
        if discord_bot:
            with _track_degraded("discord_alerts", "⚠️ Discord alerts failed to start"):
                from bot.services.discord_alerts import discord_alert_service

                await discord_alert_service.start(discord_bot)
                logger.info("✓ Discord alert service started")

        logger.info("✓ All background services running")
    else:
        logger.warning("⚠️ Background services NOT started - database unavailable")

    # 5b. Periodic cleanup for auth challenge storage (prevents memory leak)
    async def _cleanup_auth_challenges_loop():
        from bot.services.turnkey_client import cleanup_expired_challenges

        while True:
            await asyncio.sleep(300)  # every 5 minutes
            with _track_degraded("auth_challenge_cleanup", "Auth challenge cleanup error"):
                removed = cleanup_expired_challenges()
                if removed:
                    logger.debug(f"Cleaned up {removed} expired auth challenges")

    # Handle itself is unused past here — task_supervisor.cancel_all() in the
    # shutdown block below cancels it by name, not by this reference.
    task_supervisor.spawn("auth_challenge_cleanup", _cleanup_auth_challenges_loop)

    # 6. Start cross-service integrations
    with _track_degraded("event_bus", "⚠️ Event bus failed to connect", auto_clear=False):
        await event_bus.connect()
        if event_bus.connected:
            logger.info("✓ Event bus connected (Redis pub/sub)")
            _clear_degraded("event_bus")
        else:
            logger.info("ℹ Event bus not connected (Redis unavailable, events disabled)")

    with _track_degraded("internal_api_client", "⚠️ Internal API client failed to init"):
        await api_client.init()
        logger.info("✓ Internal API client initialized")

    # Start the per-user WhatsApp message queue (ordered processing).
    with _track_degraded("whatsapp_queue", "⚠️ WhatsApp message queue failed to start"):
        await _wa_queue.start()

    yield

    # --- Shutdown ---
    logger.info("🛑 Shutting down Suwappu Monolith...")
    try:
        await _wa_queue.stop()
    except Exception as e:
        logger.warning(f"WhatsApp queue stop failed: {e}")
    await redis_cache.close()

    # Stop Discord bot
    if discord_bot:
        try:
            await discord_bot.stop()
            logger.info("✓ Discord bot stopped")
        except Exception as e:
            logger.warning(f"Failed to stop Discord bot: {e}")

    # Stop bot polling if it was started
    if polling_task:
        await bot_app.updater.stop()

    # NOTE: Do NOT delete the webhook on shutdown. In ECS rolling deployments the new
    # task sets the webhook before the old task shuts down, so deleting it here would
    # silently kill the bot until the next restart.

    # Only stop/shutdown bot if it was initialized
    if bot_initialized:
        try:
            await bot_app.stop()
            await bot_app.shutdown()
        except Exception:
            pass

    # Only stop services if they were started
    if db_success and enable_background_services:
        await fee_sweeper.stop()
        await digest_service.stop()
        await alert_service.stop()
        await market_data_service.stop()
        await venue_data_service.stop()
        await order_service.stop()
        await tx_poller.stop()
        await withdraw_reconciler.stop()
        await health_monitor.stop()
        await balance_refresher.stop()
        await approval_notifier.stop()
        await webhook_dispatcher.stop()
        await execution_scorer.stop()
        await perps_monitor.stop()
        await hl_ecosystem_monitor.stop()
        await predict_monitor.stop()
        await hl_ws_alerts.stop()
        await cctp_generic_relayer.stop()
        if getattr(settings, "starknet_btc_bridge_enabled", False):
            from bot.services.btc_bridge_poller import btc_bridge_poller

            await btc_bridge_poller.stop()
        if getattr(settings, "morpho_enabled", False):
            from bot.services.morpho_monitor import morpho_monitor

            await morpho_monitor.stop()

    # Stop every supervisor.spawn()-created task (auth cleanup, fingerprint
    # republisher, discord bot, polling bootstrap) in one place, after the
    # services above have had their own graceful `.stop()`.
    await task_supervisor.cancel_all()

    # Stop RPC manager
    await rpc_manager.stop()

    # Stop cross-service integrations
    await event_bus.close()
    await api_client.close()

    logger.info("✓ Cleanup complete")


app = FastAPI(
    title="Suwappu Agent Infrastructure",
    description="""
    A high-performance liquidity API for AI agents.
    This API allows agents to manage multi-chain wallets, fetch portfolio balances, and execute cross-chain swaps.

    **Agent Instructions**:
    - Use the `/wallets` endpoint to discover available addresses.
    - Use `/portfolio` to check balances before trading.
    - For swaps, use the Unified Bot logic via the WhatsApp/Telegram integration modules for best results.
    """,
    version="1.1.0",
    lifespan=lifespan,
)

# --- Agent Authentication ---
API_KEY_NAME = "X-Agent-Key"
api_key_header = APIKeyHeader(name=API_KEY_NAME, auto_error=False)

# --- Admin Authentication ---
ADMIN_KEY_NAME = "X-Admin-Key"
admin_key_header = APIKeyHeader(name=ADMIN_KEY_NAME, auto_error=False)

# Agent key cache: api_key -> (agent_id, cached_at)
_agent_key_cache: dict[str, tuple[int, float]] = {}
_AGENT_KEY_CACHE_TTL = 300  # 5 minutes


async def get_agent_key(
    api_key: str = Security(api_key_header),
):
    """Verify the agent's API key against global key or registered agent keys."""
    valid_key = getattr(settings, "agent_api_key", None)
    if not valid_key:
        import logging

        logging.getLogger(__name__).warning(
            "AGENT_API_KEY not set — all agent endpoints require authentication. Set AGENT_API_KEY env var."
        )
        raise HTTPException(
            status_code=403,
            detail="Agent API key not configured. Set AGENT_API_KEY environment variable.",
        )

    # Fast path: check global key
    if api_key == valid_key:
        return api_key

    # Check in-memory cache first (avoids DB hit on every request)
    import time as _time

    if api_key in _agent_key_cache:
        _, cached_at = _agent_key_cache[api_key]
        if _time.time() - cached_at < _AGENT_KEY_CACHE_TTL:
            return api_key

    # Check registered agent keys in DB
    if api_key and DATABASE_AVAILABLE:
        try:
            from database.db import run_in_db

            def _lookup_agent():
                with get_session() as session:
                    agent = (
                        session.query(RegisteredAgent)
                        .filter(
                            RegisteredAgent.api_key == api_key,
                            RegisteredAgent.is_active == True,  # noqa: E712
                        )
                        .first()
                    )
                    return agent.id if agent else None

            agent_id = await run_in_db(_lookup_agent)
            if agent_id:
                _agent_key_cache[api_key] = (agent_id, _time.time())
                return api_key
        except Exception:
            pass

    raise HTTPException(
        status_code=403,
        detail="Invalid or missing Agent API Key. Discovery requires authentication.",
    )


async def get_admin_key(
    api_key: str = Security(admin_key_header),
):
    """Verify the admin API key (for dashboard/ops)."""
    valid_key = getattr(settings, "admin_api_key", None)
    if not valid_key:
        import logging

        logging.getLogger(__name__).warning(
            "ADMIN_API_KEY not set — all admin endpoints locked. Set ADMIN_API_KEY env var."
        )
        raise HTTPException(
            status_code=403,
            detail="Admin API key not configured. Set ADMIN_API_KEY environment variable.",
        )

    if api_key == valid_key:
        return api_key

    raise HTTPException(status_code=403, detail="Invalid or missing Admin API Key")


async def get_agent_or_admin_key(
    agent_key: str = Security(api_key_header),
    admin_key: str = Security(admin_key_header),
):
    """Allow either an agent key or an admin key."""
    if admin_key:
        return await get_admin_key(admin_key)
    return await get_agent_key(agent_key)


# Setup CORS
_cors_origins = os.environ.get(
    "CORS_ORIGINS",
    "https://app.suwappu.bot,https://devfront.suwappu.bot,https://suwappu.bot,https://www.suwappu.bot,https://terminal.suwappu.bot",
).split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _cors_origins],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=[
        "Authorization",
        "Content-Type",
        "X-Agent-Key",
        "X-Admin-Key",
        "X-Telegram-Init-Data",
    ],
)


# --- Request ID Middleware ---
@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    """Inject a UUID request ID into every async context and response header.

    Downstream services can call ``request_id_ctx.get()`` to include the ID
    in log records without threading it through every function signature.
    """
    rid = request.headers.get("X-Request-ID") or str(uuid.uuid4())
    token = request_id_ctx.set(rid)
    try:
        response = await call_next(request)
    finally:
        request_id_ctx.reset(token)
    response.headers["X-Request-ID"] = rid
    return response


# --- Request Timing Middleware ---
@app.middleware("http")
async def timing_middleware(request: Request, call_next):
    """Log request duration for performance profiling."""
    start = time.monotonic()
    response = await call_next(request)
    duration_ms = (time.monotonic() - start) * 1000
    path = request.url.path
    method = request.method
    status = response.status_code
    if duration_ms > 100:  # Only log slow requests (>100ms)
        logger.info(f"⏱ {method} {path} → {status} in {duration_ms:.0f}ms")
    response.headers["X-Response-Time"] = f"{duration_ms:.0f}ms"
    return response


wallet_service = WalletService()

# Mount .well-known for Apple App Site Association
_well_known_dir = Path(__file__).parent / "static" / ".well-known"
if _well_known_dir.is_dir():
    app.mount(
        "/.well-known",
        StaticFiles(directory=str(_well_known_dir)),
        name="well-known",
    )

# Mount docs portal static site
_docs_portal_dir = Path(__file__).parent / "static" / "docs"
if _docs_portal_dir.is_dir():
    app.mount(
        "/docs-portal",
        StaticFiles(directory=str(_docs_portal_dir), html=True),
        name="docs-portal",
    )

# Include webapp router for Telegram Mini App
if webapp_router:
    app.include_router(webapp_router)

# --- Import and register OAuth routes ---
from api.routes.oauth import router as oauth_router  # noqa: E402

app.include_router(oauth_router)

# --- Import and register mobile app API routes ---
from api.routes.settings import router as settings_router  # noqa: E402

app.include_router(settings_router)

# --- Import and register Phase 2 mobile feature routes ---
from api.routes.mobile import router as mobile_router  # noqa: E402

app.include_router(mobile_router)

# Jelly-native public discovery and wallet-backed creator claims (no third-party login).
from api.routes.social import router as social_router  # noqa: E402

app.include_router(social_router)

try:
    from api.routes.internal import router as internal_router

    app.include_router(internal_router)
    print(f"✓ Internal router loaded ({len(internal_router.routes)} routes)")
except Exception as e:
    import traceback

    print(f"WARNING: Could not load internal_router: {e}")
    traceback.print_exc()

try:
    from api.routes.terminal import router as terminal_router

    app.include_router(terminal_router)
    print(f"✓ Terminal router loaded ({len(terminal_router.routes)} routes)")
except Exception as e:
    import traceback

    print(f"WARNING: Could not load terminal_router: {e}")
    traceback.print_exc()

# --- Pydantic Models (Aligned with Mobile/Web) ---


class TokenInfo(BaseModel):
    id: str
    symbol: str
    name: str
    decimals: int
    address: str
    chainId: str


class TokenBalance(BaseModel):
    id: str
    token: TokenInfo
    balance: str
    balanceHuman: float
    balanceUSD: float
    chainId: str


class WalletResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    userId: int
    name: str
    address: str
    chainType: str
    isActive: bool
    isDefault: bool
    createdAt: datetime


class PortfolioResponse(BaseModel):
    totalUSD: float
    tokens: List[TokenBalance]
    chains: Dict[str, float]


class AgentExecuteRequest(BaseModel):
    text: str
    user_id: int
    context: Optional[Dict] = None


class AgentWalletCreate(BaseModel):
    user_id: int
    name: Optional[str] = "Agent Managed Wallet"
    chain_type: str = "evm"


class SwapResponse(BaseModel):
    id: int
    fromChain: str
    toChain: str
    fromToken: str
    toToken: str
    fromAmount: str
    toAmount: Optional[str]
    status: str
    timestamp: datetime
    txHash: Optional[str]


# --- Turnkey Auth Models ---


class AuthChallengeRequest(BaseModel):
    address: str
    # EVM chain the wallet is connected to. Smart accounts bind their EIP-1271
    # check to block.chainid, so we must sign for — and verify on — that chain.
    chainId: Optional[int] = None


class AuthChallengeResponse(BaseModel):
    challenge: str
    nonce: str
    expiresAt: datetime


class AuthVerifyRequest(BaseModel):
    address: str
    signature: str
    nonce: str
    # Optional client tag for the connecting wallet. "ledger" marks a hardware
    # wallet; anything else (or absent) is treated as a plain "external" wallet.
    # Both are keyless/non-custodial — this only affects how we label the wallet.
    provider: Optional[str] = None


class AuthVerifyResponse(BaseModel):
    success: bool
    token: str
    user: Optional[Dict] = None
    expiresAt: datetime


# ---------------------------------------------------------------------------
# Session cookie domain
#
# Set to the PARENT domain (e.g. ".suwappu.bot") so one session cookie reaches
# both the site and the API subdomain as a same-site request. Without it the
# cookie is host-only, which is why the web dashboard had no working sign-in:
# it fell back to sending a bearer token to routes that only accepted Telegram
# initData, and every request 401'd.
#
# SECURITY: a parent-domain cookie is readable by EVERY subdomain, so it must
# only be widened to a domain whose subdomains are all trusted. Left unset it
# stays host-only, which is the safe default — the widening is opt-in via
# SESSION_COOKIE_DOMAIN rather than hardcoded.
# ---------------------------------------------------------------------------
SESSION_COOKIE_DOMAIN = os.getenv("SESSION_COOKIE_DOMAIN") or None


def _session_cookie_kwargs() -> Dict[str, Any]:
    """Shared attributes for every session cookie we set.

    Centralised because the attributes were duplicated across four call sites;
    a domain added to three of four would produce an intermittently broken
    session that is painful to diagnose.
    """
    kwargs: Dict[str, Any] = {
        "httponly": True,
        "secure": True,
        "samesite": "lax",
    }
    if SESSION_COOKIE_DOMAIN:
        kwargs["domain"] = SESSION_COOKIE_DOMAIN
    return kwargs


class AuthMeResponse(BaseModel):
    authenticated: bool
    address: Optional[str] = None
    userId: Optional[int] = None
    createdAt: Optional[datetime] = None
    sessionSource: Optional[str] = None
    # "external" => non-custodial (connected wallet signs client-side);
    # "turnkey"/"local" => custodial (server signs). Lets the client pick the
    # right swap path on session resume, before any wallet re-connects.
    walletProvider: Optional[str] = None


# --- JWT Configuration ---

# Resolve the JWT secret from the configured `jwt_secret_key` (env JWT_SECRET_KEY)
# first, then the legacy SECRET_KEY env. NOTE: the settings field is
# `jwt_secret_key` — reading `secret_key` (which doesn't exist) silently ignored
# the configured value and fell through to an ephemeral per-process secret, which
# the terminal's verifier couldn't match (401 on every authed terminal request).
JWT_SECRET = (
    getattr(settings, "jwt_secret_key", None)
    or getattr(settings, "secret_key", None)
    or os.environ.get("SECRET_KEY")
)
if not JWT_SECRET:
    import logging as _jwt_log

    _jwt_log.getLogger(__name__).warning(
        "JWT_SECRET_KEY/SECRET_KEY not set — generating ephemeral JWT secret (tokens will not survive restarts)"
    )
    JWT_SECRET = secrets.token_hex(32)
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_HOURS = 24 * 7  # 7 days


def create_jwt_token(address: str, user_id: int, src: str) -> str:
    """Create a JWT token for authenticated user.

    ``src`` records what this session actually proved possession of, so
    downstream consumers (e.g. api-ts's requireProofOfPossession guard on the
    agent-approvals surface) can distinguish strong wallet/account proofs
    ('siwe', 'passkey', 'telegram') from sessions that didn't prove wallet
    possession at all ('weak'). No default is provided — every call site must
    state its provenance explicitly.
    """
    # EVM addresses are case-insensitive, Solana base58 public keys are not.
    session_address = address.lower() if address.startswith("0x") else address
    payload = {
        "address": session_address,
        # api-ts flexAuth uses this camelCase field when normalizing a session.
        "walletAddress": session_address,
        "user_id": user_id,
        # camelCase alias so api-ts (which reads `userId`) accepts Python-issued tokens.
        "userId": user_id,
        "src": src,
        "exp": datetime.utcnow() + timedelta(hours=JWT_EXPIRY_HOURS),
        "iat": datetime.utcnow(),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_jwt_token(token: str) -> Optional[Dict]:
    """Decode and validate a JWT token."""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None


async def get_current_user_from_token(
    request: Request,
    auth_token: Optional[str] = Cookie(default=None, alias="suwappu_auth"),
) -> Optional[Dict]:
    """Extract current user from JWT token in header or cookie.

    Authorization deliberately wins when both are present. The browser can carry
    an HttpOnly OAuth cookie for one account while localStorage still contains a
    wallet bearer for another; every API surface must resolve that conflict the
    same way or the UI can display one user while a money route acts as another.
    """
    auth_header = request.headers.get("Authorization")
    token = auth_header[7:] if auth_header and auth_header.startswith("Bearer ") else auth_token

    if not token:
        return None

    return decode_jwt_token(token)


# --- Dependencies ---


def get_db():
    with get_session() as session:
        yield session


# --- Health Checks ---

# Max age of a background service's heartbeat before /health calls it "dead",
# per service. Each value is roughly 3x that service's own loop cadence, so a
# healthy-but-slow loop is never reported dead:
#   tx_poller          poll_interval=15s (3s when txs are pending)
#   perps_monitor      POLL_INTERVAL=10s
#   withdraw_reconciler poll_interval=60s
#   balance_refresher  refresh_interval=60s + a refresh pass over all wallets
#   execution_scorer   interval=120s (post-trade marks)
#   predict_monitor    POLL_INTERVAL=120s
#   hl_ws_alerts       websocket refresh loop
# Keep these in sync with each writer's ttl_seconds — the TTL must be >= the
# threshold, or the key is evicted before it can ever be seen as stale.
SERVICE_STALENESS_SECONDS: dict[str, int] = {
    "tx_poller": 90,
    "perps_monitor": 90,
    "withdraw_reconciler": 180,
    "balance_refresher": 300,
    # interval=120s, ttl=300s -> threshold must sit between the two.
    "execution_scorer": 300,
    "predict_monitor": 360,
    "hl_ws_alerts": 300,
}
DEFAULT_STALENESS_SECONDS = 90

# A supervised loop can beat while the work it supervises is wedged. That is
# the price of decoupling the heartbeat from the pass (see
# bot/services/balance_refresher.py) and it must not become a new blind spot,
# so services that publish a "last completed pass" marker get a second check.
# The result is reported as the service's own status word rather than pushed
# only into `degraded`, because the uptime probe walks `checks` and would never
# see a top-level-only signal — which is how the previous wedge went unnoticed.
# Each value must exceed that service's pass budget plus its interval, or a
# healthy-but-slow pass reads as stalled.
SERVICE_PASS_STALL_SECONDS: dict[str, int] = {
    # budget 600s + interval 60s; 1800s leaves room for two bad passes.
    "balance_refresher": 1800,
}


async def _pass_progress_status(svc: str, now: float) -> str:
    """ "alive", or "stalled" when the loop beats but its work is not landing."""
    from bot.utils.redis_cache import redis_cache

    stall = SERVICE_PASS_STALL_SECONDS.get(svc)
    if stall is None:
        return "alive"
    last_pass = await redis_cache.get(f"service:{svc}:last_pass")
    if last_pass is None:
        # No marker yet is only damning once a pass has had time to finish;
        # before that it is an ordinary fresh boot.
        return "stalled" if (now - _PROCESS_STARTED_AT) > stall else "alive"
    try:
        return "stalled" if now - float(last_pass) > stall else "alive"
    except (TypeError, ValueError):
        return "stalled"


# When this process came up. Needed to distinguish a service that has NOT YET
# written its first heartbeat (normal, for a few seconds after boot) from one
# that never will. Without it both read "unknown", and "unknown" was excluded
# from `degraded` — so a wedged balance_refresher sat invisible in production
# for four days behind ready:true and degraded:[].
_PROCESS_STARTED_AT = time.time()


# ---------------------------------------------------------------------------
# Build fingerprint
#
# A deploy that reports SUCCESS is NOT proof the new code is running: Railway
# can keep an older container serving, and `railway redeploy` re-deploys a
# PREVIOUS image rather than current source. That cost real debugging time —
# a scorer was wired into the lifespan, deployed green, and simply was not in
# the running build, with nothing to reveal the mismatch.
#
# So the app fingerprints its OWN source at import: hash every .py under the
# application root. Compare the value in /health against the same hash
# computed locally, and "did my deploy actually land?" becomes a one-line
# check instead of an investigation. No build step, no env var, no git
# metadata required — it works identically for `railway up`, GitHub builds
# and local runs.
# ---------------------------------------------------------------------------
def _compute_source_fingerprint() -> str:
    """SHA-256 over the app's own Python sources, truncated. Import-time only."""
    import hashlib
    import pathlib

    root = pathlib.Path(__file__).resolve().parent.parent
    digest = hashlib.sha256()
    try:
        for sub in ("api", "bot", "database"):
            base = root / sub
            if not base.is_dir():
                continue
            for path in sorted(base.rglob("*.py")):
                if "__pycache__" in path.parts:
                    continue
                digest.update(path.relative_to(root).as_posix().encode())
                digest.update(path.read_bytes())
    except Exception:  # pragma: no cover - never block startup on this
        return "unavailable"
    return digest.hexdigest()[:12]


SOURCE_FINGERPRINT = _compute_source_fingerprint()


@app.get("/admin/activation-funnel", tags=["Admin"], summary="Activation funnel")
async def admin_activation_funnel(_: str = Depends(get_admin_key)):
    """Where new users stop: signup -> wallet -> quote -> swap.

    Built because the product had 43 users, 77 wallets and zero completed swaps,
    and nothing could say WHICH step they stopped at. `biggest_drop` names the
    worst step by retention against the one before it.

    `not_instrumented` lists stages that cannot be measured at all — currently
    "funded", because no table persists a balance. That is reported explicitly
    so a missing stage is never read as a stage with zero users.
    """
    from bot.services.activation_funnel import activation_funnel

    try:
        return activation_funnel.compute()
    except Exception as e:
        logger.error(f"activation funnel failed: {e}", exc_info=True)
        raise HTTPException(status_code=503, detail="Funnel unavailable")


@app.get("/health/live", tags=["Health"], summary="Liveness probe")
async def health_live():
    """K8s/ECS liveness probe — confirms the process is alive.

    Load balancers should use ``/health/ready`` to gate traffic;
    orchestrators use this to decide whether to restart the container.
    """
    # Fingerprint is included here too: /health/live answers even when the DB
    # or Redis is down, so deploy verification never depends on dependencies
    # being healthy.
    return {"status": "alive", "source_fingerprint": SOURCE_FINGERPRINT}


@app.get("/health/ready", tags=["Health"], summary="Readiness probe")
async def health_ready():
    """K8s/ECS readiness probe — confirms the service can handle requests.

    Checks database connectivity, Redis reachability, and background service
    heartbeats. Returns 503 if any critical dependency is unhealthy so that
    the load balancer stops routing traffic to this instance.
    """
    from database.db import DATABASE_AVAILABLE
    from bot.utils.redis_cache import redis_cache

    # Bot mode
    bot_status = "unknown"
    try:
        bot_app = getattr(app.state, "bot_app", None)
        if bot_app and bot_app.updater and bot_app.updater.running:
            bot_status = "polling"
        elif bot_app and bot_app.running:
            bot_status = "webhook"
        elif bot_app:
            bot_status = "not_running"
        elif not settings.run_telegram_bot:
            bot_status = "disabled"
        else:
            bot_status = "no_bot_app"
    except Exception:
        bot_status = "error"

    # Redis ping
    redis_ok = await redis_cache.ping()

    # Background service heartbeats. A single global staleness threshold does not
    # work here: these loops have cadences an order of magnitude apart, and each
    # only beats once per cycle. The old flat 90s cutoff meant predict_monitor
    # (POLL_INTERVAL=120) was reported "dead" for a chunk of every single cycle
    # while perfectly healthy, and balance_refresher flapped whenever a refresh
    # pass pushed its cycle past 90s. Allow ~3 cycles of slack per service, and
    # keep each writer's Redis TTL >= its threshold so a stopped service reads
    # "dead" (stale beat) rather than "unknown" (key already evicted).
    now = time.time()
    svc_heartbeats: dict = {}
    watched_services = [
        "tx_poller",
        "withdraw_reconciler",
        "balance_refresher",
        "perps_monitor",
        "predict_monitor",
        # Post-trade execution scoring. Without this entry the service would
        # run unmonitored — a silently dead scorer looks identical to one with
        # no swaps to score.
        "execution_scorer",
    ]
    if getattr(settings, "hl_ws_alerts_enabled", False) or getattr(
        settings, "hl_whale_alerts_enabled", False
    ):
        watched_services.append("hl_ws_alerts")
    never_beat: list[str] = []
    uptime = now - _PROCESS_STARTED_AT
    for svc in watched_services:
        threshold = SERVICE_STALENESS_SECONDS.get(svc, DEFAULT_STALENESS_SECONDS)
        last = await redis_cache.get(f"service:{svc}:heartbeat")
        if last is None:
            # A missing key past the service's own threshold is not "unknown",
            # it is dead: the loop has had a full window to beat and has not.
            # Reporting it as unknown made a service that never started look
            # exactly like a healthy one.
            if uptime > threshold:
                svc_heartbeats[svc] = "dead"
                never_beat.append(svc)
            else:
                svc_heartbeats[svc] = "starting"
        elif now - float(last) > threshold:
            svc_heartbeats[svc] = "dead"
            never_beat.append(svc)
        else:
            svc_heartbeats[svc] = await _pass_progress_status(svc, now)

    # The worker publishes its own fingerprint to Redis at startup (it has no
    # public URL of its own). Reporting it here is the only way to verify a
    # python-worker deploy actually landed.
    worker_fingerprint = await redis_cache.get("service:worker:fingerprint")

    checks = {
        "database": DATABASE_AVAILABLE,
        "redis": redis_ok,
        "bot": bot_status in ("polling", "webhook"),
        "services": svc_heartbeats,
    }
    # Critical: DB must be up; Redis + bot strongly preferred
    is_ready = checks["database"]
    status_code = 200 if is_ready else 503

    return JSONResponse(
        status_code=status_code,
        content={
            "ready": is_ready,
            "service": "suwappu-bot",
            # Which build is actually serving this request. See
            # _compute_source_fingerprint() — a green deploy is not proof the
            # new code is live; this is.
            "source_fingerprint": SOURCE_FINGERPRINT,
            "worker_fingerprint": worker_fingerprint or "unknown",
            "checks": {
                "database": "connected" if DATABASE_AVAILABLE else "disconnected",
                "redis": "connected" if redis_ok else "memory-fallback",
                "bot": bot_status,
                "background_services": svc_heartbeats,
            },
            # Optional non-critical services that failed to start (or, for
            # periodic tasks, most recently failed) — never affects
            # ready/status_code, purely visibility. Empty when all healthy.
            "degraded": [{"service": name, "error": err} for name, err in DEGRADED_SERVICES.items()]
            # A watched background loop that is not beating belongs here. It was
            # previously visible ONLY as a word inside checks.background_services
            # that nothing alerted on.
            + [
                {"service": name, "error": "no heartbeat past staleness threshold"}
                for name in never_beat
            ]
            # Beating, but its work is not completing. A different fault from a
            # dead loop and it needs a different message, or the operator reads
            # "dead" and goes looking for a crash that never happened.
            + [
                {"service": name, "error": "loop alive but refresh passes are not completing"}
                for name, state in svc_heartbeats.items()
                if state == "stalled"
            ]
            # Supervised tasks (bot/utils/task_supervisor.py) that have crashed
            # at least once, restarted or not. Same rule as the rest of this
            # list: visibility only. Railway's cutover gate stays DB-only
            # (`is_ready` above) because a background task restarting is, by
            # design, self-healing — flipping the readiness probe on every
            # transient crash would take healthy traffic-serving instances out
            # of rotation for a problem that isn't in the request path.
            + [
                {
                    "service": name,
                    "error": f"crashed {state['crash_count']}x, last: {state['last_error']}",
                }
                for name, state in task_supervisor.get_task_states().items()
            ],
        },
    )


@app.get("/probe/wallet", tags=["Health"], summary="Wallet capability probe (static)")
async def wallet_probe():
    """Serve the Robinhood Wallet capability probe.

    Answers the one question the USDG mint path depends on and that cannot be
    settled by reasoning: will Robinhood Wallet sign an EIP-3009
    ReceiveWithAuthorization? It has to be opened on a PHONE, inside the wallet's
    in-app browser, so it needs a real URL — hence a route rather than a file
    somebody has to host.

    Lives in api/static/ deliberately. api/Dockerfile.railway copies only api/,
    bot/ and database/, so the same file under nft/ would 404 in the container
    while working perfectly on a laptop.

    Static, read-only, no secrets, no state. Safe to leave exposed.
    """
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static", "wallet-probe.html")
    try:
        with open(path, encoding="utf-8") as fh:
            body = fh.read()
    except OSError:
        raise HTTPException(status_code=404, detail="probe not bundled in this image")
    return Response(content=body, media_type="text/html; charset=utf-8")


@app.get("/health", tags=["Health"], summary="Health check (legacy)")
async def health_check():
    """Legacy alias for /health/ready — kept for backward compatibility."""
    return await health_ready()


# ============ Turnkey Web Authentication ============


def _wallet_auth_origin(request: Request) -> tuple[str, str]:
    """Return the trusted authority + URI that wallets should display.

    Browser wallet signatures must describe the site the user is actually on.
    The old hard-coded ``app.suwappu.com`` domain made every Terminal prompt look
    unrelated to the requesting origin. Only Suwappu HTTPS origins (plus local
    HTTP development) may influence the signed message.
    """
    origin = request.headers.get("origin")
    if not origin:
        return "terminal.suwappu.bot", "https://terminal.suwappu.bot"

    parsed = urlsplit(origin)
    host = (parsed.hostname or "").lower()
    is_suwappu = parsed.scheme == "https" and (
        host == "suwappu.bot" or host.endswith(".suwappu.bot")
    )
    is_local = parsed.scheme == "http" and host in {"localhost", "127.0.0.1"}
    if not (is_suwappu or is_local) or not parsed.netloc:
        raise HTTPException(status_code=400, detail="Untrusted wallet sign-in origin")
    return parsed.netloc, f"{parsed.scheme}://{parsed.netloc}"


@app.post("/auth/turnkey/challenge", response_model=AuthChallengeResponse, tags=["Auth"])
async def auth_challenge(body: AuthChallengeRequest, request: Request):
    """
    Generate a challenge message for wallet-based authentication.
    The user signs this message with their wallet to prove ownership.
    """
    from bot.services.turnkey_client import generate_auth_challenge

    address = body.address.strip()
    if not address.startswith("0x") or len(address) != 42:
        raise HTTPException(status_code=400, detail="Invalid Ethereum address format")

    domain, uri = _wallet_auth_origin(request)
    # Pass chainId through as-is: None means "client didn't say", which tells the
    # verifier to probe the major chains instead of assuming mainnet.
    result = generate_auth_challenge(address, domain=domain, uri=uri, chain_id=body.chainId)

    return AuthChallengeResponse(
        challenge=result["challenge"],
        nonce=result["nonce"],
        expiresAt=datetime.utcnow() + timedelta(minutes=5),
    )


@app.post("/auth/turnkey/verify", response_model=AuthVerifyResponse, tags=["Auth"])
async def auth_verify(
    request: AuthVerifyRequest, response: Response, db: Session = Depends(get_db)
):
    """
    Verify the signed challenge and create a session.
    Returns a JWT token for subsequent authenticated requests.
    """
    from bot.services.turnkey_client import verify_wallet_auth_signature

    address = request.address.strip().lower()

    # Verify the signature. Handles both EOAs (65-byte ECDSA) and smart accounts
    # (EIP-1271 / ERC-6492 — Coinbase Smart Wallet, Safe, passkey/4337 wallets),
    # whose signatures are not recoverable and must be checked on-chain.
    is_valid = await verify_wallet_auth_signature(
        address=address, signature=request.signature, nonce=request.nonce
    )

    if not is_valid:
        raise HTTPException(status_code=401, detail="Invalid signature or expired challenge")

    # Normalize the client-supplied provider tag. Only "ledger" is special-cased;
    # everything else collapses to the keyless "external" default so a bogus value
    # can never select a custodial code path. (See bot.utils.wallet_provider.)
    from bot.utils.wallet_provider import normalize_wallet_provider

    provider_tag = normalize_wallet_provider(request.provider)

    # Find or create user by wallet address
    wallet = db.query(Wallet).filter(Wallet.address.ilike(address)).first()

    if wallet:
        user = db.query(User).filter(User.id == wallet.user_id).first()
        # Upgrade the label if a returning keyless wallet now connects via Ledger
        # (e.g. first connected with MetaMask, later re-pairs the hardware device).
        # Never touch a custodial wallet ("turnkey"/"local") — those hold/sign keys.
        if provider_tag == "ledger" and wallet.wallet_provider in ("external", None):
            wallet.wallet_provider = "ledger"
            db.commit()
    else:
        # Create new user and wallet for first-time login
        user = User(telegram_id=None, username=f"web_{address[:8]}", created_at=datetime.utcnow())
        db.add(user)
        db.commit()
        db.refresh(user)

        # Create wallet linked to user. This is a NON-CUSTODIAL connection: the
        # user proved ownership by signing the SIWE challenge with their external
        # wallet (MetaMask / WalletConnect / etc.), so we store NO private key and
        # mark the provider "external" — the server can never sign for it; the
        # connected wallet signs swaps client-side via /webapp/swap/build.
        wallet = Wallet(
            user_id=user.id,
            address=address,
            chain_type="evm",
            is_active=True,
            is_default=True,
            wallet_provider=provider_tag,
            name="Ledger" if provider_tag == "ledger" else "Connected Wallet",
            created_at=datetime.utcnow(),
        )
        db.add(wallet)
        db.commit()

    # Create JWT token
    token = create_jwt_token(address, user.id, src="siwe")
    expires_at = datetime.utcnow() + timedelta(hours=JWT_EXPIRY_HOURS)

    # Set secure HTTP-only cookie
    response.set_cookie(
        key="suwappu_auth",
        value=token,
        max_age=JWT_EXPIRY_HOURS * 3600,
        **_session_cookie_kwargs(),
        path="/",
    )

    return AuthVerifyResponse(
        success=True,
        token=token,
        user={"id": user.id, "address": address, "username": user.username},
        expiresAt=expires_at,
    )


# ============ Solana (Phantom) Web Authentication ============


def _is_valid_solana_address(address: str) -> bool:
    """A Solana pubkey is base58 and decodes to exactly 32 bytes."""
    try:
        import base58

        return len(base58.b58decode(address)) == 32
    except Exception:
        return False


@app.post("/auth/solana/challenge", response_model=AuthChallengeResponse, tags=["Auth"])
async def auth_solana_challenge(body: AuthChallengeRequest, request: Request):
    """
    Generate a Sign-In-With-Solana challenge for a Phantom/Solana wallet to sign.
    """
    from bot.services.turnkey_client import generate_solana_auth_challenge

    address = body.address.strip()
    if not _is_valid_solana_address(address):
        raise HTTPException(status_code=400, detail="Invalid Solana address format")

    domain, uri = _wallet_auth_origin(request)
    result = generate_solana_auth_challenge(address, domain=domain, uri=uri)

    return AuthChallengeResponse(
        challenge=result["challenge"],
        nonce=result["nonce"],
        expiresAt=datetime.utcnow() + timedelta(minutes=5),
    )


@app.post("/auth/solana/verify", response_model=AuthVerifyResponse, tags=["Auth"])
async def auth_solana_verify(
    request: AuthVerifyRequest, response: Response, db: Session = Depends(get_db)
):
    """
    Verify a Solana (ed25519) signed challenge and create a session.

    Non-custodial: the user proved ownership by signing with Phantom, so the
    wallet is stored keyless (wallet_provider="external", chain_type="solana").
    NOTE: the base58 address is CASE-SENSITIVE — do not lowercase it.
    """
    from bot.services.turnkey_client import verify_solana_auth_signature

    address = request.address.strip()
    if not _is_valid_solana_address(address):
        raise HTTPException(status_code=400, detail="Invalid Solana address format")

    is_valid = verify_solana_auth_signature(
        address=address, signature=request.signature, nonce=request.nonce
    )
    if not is_valid:
        raise HTTPException(status_code=401, detail="Invalid signature or expired challenge")

    # Find or create the user by this exact (case-sensitive) Solana address.
    wallet = db.query(Wallet).filter(Wallet.address == address).first()
    if wallet:
        user = db.query(User).filter(User.id == wallet.user_id).first()
    else:
        user = User(telegram_id=None, username=f"sol_{address[:8]}", created_at=datetime.utcnow())
        db.add(user)
        db.commit()
        db.refresh(user)

        wallet = Wallet(
            user_id=user.id,
            address=address,
            chain_type="solana",
            is_active=True,
            is_default=True,
            wallet_provider="external",
            name="Connected Wallet",
            created_at=datetime.utcnow(),
        )
        db.add(wallet)
        db.commit()

    token = create_jwt_token(address, user.id, src="siwe")
    expires_at = datetime.utcnow() + timedelta(hours=JWT_EXPIRY_HOURS)

    response.set_cookie(
        key="suwappu_auth",
        value=token,
        max_age=JWT_EXPIRY_HOURS * 3600,
        **_session_cookie_kwargs(),
        path="/",
    )

    return AuthVerifyResponse(
        success=True,
        token=token,
        user={"id": user.id, "address": address, "username": user.username},
        expiresAt=expires_at,
    )


@app.get("/auth/me", response_model=AuthMeResponse, tags=["Auth"])
async def auth_me(
    request: Request,
    db: Session = Depends(get_db),
    current_user: Optional[Dict] = Depends(get_current_user_from_token),
):
    """
    Get the currently authenticated user's information.
    """
    if not current_user:
        return AuthMeResponse(authenticated=False)

    user = db.query(User).filter(User.id == current_user.get("user_id")).first()

    if not user:
        return AuthMeResponse(authenticated=False)

    # Resolve the wallet's provider so the client knows whether this session is
    # custodial (server signs) or external/non-custodial (wallet signs).
    address = current_user.get("address")
    wallet_provider = None
    if address:
        wallet_query = db.query(Wallet).filter(
            Wallet.user_id == user.id,
            Wallet.is_active == True,  # noqa: E712
        )
        if address.startswith("0x"):
            wallet_query = wallet_query.filter(Wallet.address.ilike(address))
        else:
            # Solana base58 keys are case-sensitive.
            wallet_query = wallet_query.filter(Wallet.address == address)
        wallet = wallet_query.first()
        if wallet:
            wallet_provider = wallet.wallet_provider

    return AuthMeResponse(
        authenticated=True,
        address=address,
        userId=user.id,
        createdAt=user.created_at,
        walletProvider=wallet_provider,
        sessionSource=current_user.get("src"),
    )


# ============ Telegram Mini App (initData) Authentication ============


class TelegramAuthRequest(BaseModel):
    """Request body for /auth/telegram. initData may also come from the
    X-Telegram-Init-Data header, so it is optional here."""

    initData: Optional[str] = None


class TelegramAuthResponse(BaseModel):
    token: str
    expiresAt: datetime
    user: Dict[str, Any]
    address: str


async def _complete_telegram_login(tg_user: Dict[str, Any], response: Response, db: Session):
    """Resolve/create the user, ensure a wallet, mint the session JWT.

    Shared by BOTH Telegram entry points so they cannot drift:
      * /auth/telegram         — Mini App initData (inside Telegram)
      * /auth/telegram/widget  — Login Widget (a normal web browser)

    The two differ ONLY in how the payload is verified; everything after that
    — user provisioning, wallet lookup, token minting, cookie attributes — is
    identical and must stay identical, which is why it lives here rather than
    being copied into the second endpoint.
    """
    telegram_id = int(tg_user["id"])

    # Resolve or create the user by telegram_id (same shape the bot's /start uses).
    user = db.query(User).filter(User.telegram_id == telegram_id).first()
    if user is None:
        user = User(
            telegram_id=telegram_id,
            username=tg_user.get("username"),
            first_name=tg_user.get("first_name"),
            last_name=tg_user.get("last_name"),
            created_at=datetime.utcnow(),
        )
        db.add(user)
    else:
        user.last_active_at = datetime.now(timezone.utc)
        if tg_user.get("username"):
            user.username = tg_user.get("username")
    # Commit so the user (and its id) is visible to the WalletService session below.
    db.commit()
    db.refresh(user)

    # Reuse the user's existing default wallet if present; otherwise provision one
    # the same way the bot does (WalletService — NOT a duplicated key-gen path).
    wallet = (
        db.query(Wallet)
        .filter(
            Wallet.user_id == user.id,
            Wallet.is_active == True,  # noqa: E712
        )
        .order_by(Wallet.is_default.desc(), Wallet.id.asc())
        .first()
    )

    wallet_address = wallet.address if wallet else None
    if not wallet_address:
        from bot.services.wallet import WalletService

        wallet_service = WalletService()
        existing_evm = wallet_service.get_user_wallets(user.id, chain_type="evm")
        if existing_evm:
            wallet_address = existing_evm[0].address
        else:
            try:
                new_wallet = await wallet_service.create_wallet(
                    user_id=user.id,
                    name="Default EVM",
                    chain_type="evm",
                )
                wallet_address = new_wallet.address
                with get_session() as s:
                    w = s.query(Wallet).filter(Wallet.id == new_wallet.id).first()
                    if w and not w.is_default:
                        w.is_default = True
            except Exception as e:
                logger.error(f"auth/telegram: failed to provision wallet for user {user.id}: {e}")

    # Mint the same session JWT the passkey/oauth flows mint.
    session_address = wallet_address or f"telegram:{telegram_id}"
    token = create_jwt_token(address=session_address, user_id=user.id, src="telegram")
    expires_at = datetime.utcnow() + timedelta(hours=JWT_EXPIRY_HOURS)

    response.set_cookie(
        key="suwappu_auth",
        value=token,
        max_age=JWT_EXPIRY_HOURS * 3600,
        **_session_cookie_kwargs(),
        path="/",
    )

    return TelegramAuthResponse(
        token=token,
        expiresAt=expires_at,
        user={"id": user.id},
        address=wallet_address or "",
    )


class TelegramWidgetAuthRequest(BaseModel):
    """Payload produced by Telegram's Login Widget (a browser, not a Mini App)."""

    id: int
    auth_date: int
    hash: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    username: Optional[str] = None
    photo_url: Optional[str] = None


def _verify_telegram_widget(payload: Dict[str, Any], bot_token: str) -> bool:
    """Verify a Telegram Login Widget signature.

    CAREFUL — this is NOT the Mini App scheme. The two derive the secret key
    differently and are not interchangeable:

        Login Widget : secret = SHA256(bot_token)
        Mini App     : secret = HMAC_SHA256("WebAppData", bot_token)

    Using the Mini App derivation here silently rejects every valid browser
    login; using this one for initData would accept nothing. See
    https://core.telegram.org/widgets/login#checking-authorization

    Returns True only for a signature match on a fresh payload.
    """
    received_hash = payload.get("hash")
    if not received_hash or not bot_token:
        return False

    # Every field EXCEPT hash, sorted, as "key=value" joined by newlines.
    # None values are omitted — Telegram does not send absent optional fields,
    # so including them as empty strings would break the digest.
    pairs = sorted(f"{k}={v}" for k, v in payload.items() if k != "hash" and v is not None)
    data_check_string = "\n".join(pairs)

    secret_key = hashlib.sha256(bot_token.encode("utf-8")).digest()
    calculated = hmac.new(secret_key, data_check_string.encode("utf-8"), hashlib.sha256).hexdigest()

    if not hmac.compare_digest(calculated, str(received_hash)):
        return False

    # Replay protection: the signature is valid forever on its own, so a
    # captured payload could be reused indefinitely without a freshness check.
    try:
        auth_date = int(payload.get("auth_date", 0))
    except (TypeError, ValueError):
        return False
    age = datetime.now(timezone.utc).timestamp() - auth_date
    return 0 <= age <= 86400


@app.post("/auth/telegram/widget", response_model=TelegramAuthResponse, tags=["Auth"])
async def auth_telegram_widget(
    body: TelegramWidgetAuthRequest,
    response: Response,
    db: Session = Depends(get_db),
):
    """Sign in from a normal web browser via the Telegram Login Widget.

    The dashboard previously had no browser sign-in at all: users were told to
    open the bot, obtain a token and paste it into a password field. That is
    not something an enterprise buyer gets past, and it trains people to
    handle bearer tokens by hand.

    This mints the SAME session JWT as every other auth flow by delegating to
    _complete_telegram_login, so nothing about sessions, wallets or cookies
    diverges between entry points.
    """
    payload = body.model_dump(exclude_none=True)

    if not _verify_telegram_widget(payload, settings.telegram_bot_token):
        # Never log the payload itself.
        logger.warning("auth/telegram/widget: invalid or stale login payload")
        raise HTTPException(status_code=401, detail="Invalid Telegram login")

    tg_user = {
        "id": body.id,
        "username": body.username,
        "first_name": body.first_name,
        "last_name": body.last_name,
    }
    return await _complete_telegram_login(tg_user, response, db)


@app.post("/auth/telegram", response_model=TelegramAuthResponse, tags=["Auth"])
async def auth_telegram(
    request: Request,
    response: Response,
    body: Optional[TelegramAuthRequest] = None,
    db: Session = Depends(get_db),
):
    """
    Authenticate a Telegram Mini App user via validated WebApp initData.

    Mirrors the passkey/oauth callback flow: validate the HMAC-signed initData,
    resolve (or create) the user by their telegram_id reusing the bot's wallet
    provisioning, mint the same session JWT the other auth flows mint, set the
    httponly 'suwappu_auth' cookie, and return the token + wallet address.
    """
    from api.webapp import validate_telegram_init_data

    # initData may arrive in the JSON body or the X-Telegram-Init-Data header.
    init_data = (body.initData if body else None) or request.headers.get("X-Telegram-Init-Data")
    if not init_data:
        raise HTTPException(status_code=401, detail="Missing Telegram initData")

    tg_user = validate_telegram_init_data(init_data, settings.telegram_bot_token)
    if not tg_user or not tg_user.get("id"):
        # Never log the raw initData.
        logger.warning("auth/telegram: invalid or unverifiable initData")
        raise HTTPException(status_code=401, detail="Invalid Telegram initData")

    return await _complete_telegram_login(tg_user, response, db)


# --- Refresh tokens (H13): short-lived access JWT + rotating refresh token ---

REFRESH_COOKIE = "suwappu_refresh"
REFRESH_TTL_SECONDS = 30 * 24 * 3600


def _set_session_cookies(
    response: Response, access_token: str, refresh_token: Optional[str]
) -> None:
    """Set the access (and optionally refresh) cookies with the standard attributes."""
    response.set_cookie(
        key="suwappu_auth",
        value=access_token,
        max_age=JWT_EXPIRY_HOURS * 3600,
        path="/",
        **_session_cookie_kwargs(),
    )
    if refresh_token is not None:
        response.set_cookie(
            key=REFRESH_COOKIE,
            value=refresh_token,
            max_age=REFRESH_TTL_SECONDS,
            path="/",
            **_session_cookie_kwargs(),
        )


class RefreshRequest(BaseModel):
    refresh_token: Optional[str] = None


@app.post("/auth/refresh", tags=["Auth"])
async def auth_refresh(request: Request, response: Response, body: Optional[RefreshRequest] = None):
    """
    Exchange a (rotating) refresh token for a fresh access JWT.

    Accepts the refresh token from the ``suwappu_refresh`` httponly cookie (OAuth /
    cookie clients) or a JSON body (localStorage clients). Rotates the token; on a
    reused/expired/unknown token returns 401 and revokes the family.
    """
    from bot.services.refresh_token_service import rotate_refresh_token

    token = (body.refresh_token if body else None) or request.cookies.get(REFRESH_COOKIE)
    if not token:
        raise HTTPException(status_code=401, detail="Missing refresh token")

    rotated = rotate_refresh_token(token, client="refresh")
    if rotated is None:
        # Clear stale cookies so the client falls back to a fresh login.
        # Domain must match the one used when setting, or the browser keeps
        # the cookie and "logout" silently leaves a live session behind.
        response.delete_cookie(REFRESH_COOKIE, path="/", **_session_cookie_kwargs())
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")

    user_id, address, new_refresh, _expires = rotated
    access_token = create_jwt_token(address or "", user_id, src="weak")
    _set_session_cookies(response, access_token, new_refresh)
    return {"success": True, "token": access_token, "refresh_token": new_refresh}


@app.post("/auth/logout", tags=["Auth"])
async def auth_logout(request: Request, response: Response, body: Optional[RefreshRequest] = None):
    """
    Log out: clear the session cookies and revoke the refresh-token family.
    """
    token = (body.refresh_token if body else None) or request.cookies.get(REFRESH_COOKIE)
    if token:
        try:
            from bot.services.refresh_token_service import revoke_refresh_token

            revoke_refresh_token(token)
        except Exception as e:
            logger.warning(f"Refresh-token revoke on logout failed: {e}")
    for key in ("suwappu_auth", REFRESH_COOKIE):
        # Same attributes as when set — crucially the domain. A delete that
        # omits it does not match a parent-domain cookie, so logout would
        # appear to succeed while leaving the session valid.
        response.delete_cookie(key=key, path="/", **_session_cookie_kwargs())
    return {"success": True, "message": "Logged out successfully"}


# ============ Passkey Authentication ============


class PasskeyRegisterInitRequest(BaseModel):
    email: Optional[str] = None
    displayName: Optional[str] = None


class PasskeyRegisterInitResponse(BaseModel):
    challenge: str
    userId: str
    userName: str
    rpId: str
    rpName: str
    attestation: str


class PasskeyRegisterCompleteRequest(BaseModel):
    credentialId: str
    attestationObject: str
    clientDataJSON: str
    userHandle: Optional[str] = None
    transports: List[str] = []


class PasskeyRegisterCompleteResponse(BaseModel):
    success: bool
    userId: int
    walletAddress: str
    subOrgId: str
    token: str
    expiresAt: datetime


class PasskeyAuthInitResponse(BaseModel):
    challenge: str
    rpId: str
    allowCredentials: Optional[List[Dict]] = None


class PasskeyAuthCompleteRequest(BaseModel):
    credentialId: str
    authenticatorData: str
    clientDataJSON: str
    signature: str
    userHandle: Optional[str] = None


class PasskeyAuthCompleteResponse(BaseModel):
    success: bool
    token: str
    userId: int
    walletAddress: str
    expiresAt: datetime


# Passkey WebAuthn challenges live in the shared Redis cache (with in-memory
# fallback) so a challenge issued by one ECS replica can be verified by another.
# The previous per-process dict broke under multiple replicas: a challenge created
# on replica A was invisible to replica B, so passkey auth failed intermittently.
PASSKEY_CHALLENGE_TTL = 300  # seconds


def _passkey_key(challenge: str) -> str:
    return f"passkey:challenge:{challenge}"


def _base64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode((value + padding).encode("ascii"))


def _base64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _parse_passkey_client_data(client_data_json: str) -> Dict[str, Any]:
    try:
        return json.loads(_base64url_decode(client_data_json).decode("utf-8"))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid passkey client data")


async def _verify_passkey_challenge(client_data_json: str, expected_type: str) -> None:
    from bot.utils.redis_cache import redis_cache

    client_data = _parse_passkey_client_data(client_data_json)
    if client_data.get("type") != expected_type:
        raise HTTPException(status_code=400, detail="Invalid passkey response type")

    encoded_challenge = client_data.get("challenge")
    if not encoded_challenge:
        raise HTTPException(status_code=400, detail="Missing passkey challenge")

    # The client echoes the challenge base64url-encoded; decode it to recover the
    # raw challenge string we stored as the key, enabling a direct lookup in the
    # shared store (no per-process scan).
    try:
        challenge = _base64url_decode(encoded_challenge).decode("utf-8")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid passkey challenge")

    # Fetch-and-delete atomically so the challenge is single-use even under
    # concurrent requests. A separate get() then delete() leaves a TOCTOU
    # window where two requests both read the challenge before either deletes
    # it — a WebAuthn challenge replay.
    try:
        entry = await redis_cache.get_del(_passkey_key(challenge))
    except Exception:
        # Redis error mid-verification: fail closed rather than risk a replay.
        raise HTTPException(status_code=503, detail="Authentication temporarily unavailable")
    if not entry:
        # Missing, already used, or expired (Redis TTL handles expiry).
        raise HTTPException(status_code=401, detail="Passkey challenge expired")

    expected_flow = "registration" if expected_type == "webauthn.create" else "authentication"
    if entry.get("type") != expected_flow:
        raise HTTPException(status_code=400, detail="Passkey challenge type mismatch")


def _require_passkey_enabled() -> None:
    """Gate for /auth/passkey/* endpoints.

    These handlers do NOT verify the WebAuthn attestation (register/complete) or
    assertion signature (authenticate/complete): no COSE public key is stored at
    registration, so authentication cannot cryptographically bind the assertion to
    a registered credential. As shipped, anyone who obtains a (single-use) Redis
    challenge can mint a session JWT for any credentialId — account takeover.

    Until real verification is implemented, the whole surface is disabled by
    default and returns 503.

    TODO(security): implement real WebAuthn verification with the `webauthn`
    PyPI library (py_webauthn):
      - register/complete: verify_registration_response(); persist the returned
        COSE credential_public_key + sign_count on the User row (needs a new
        column / migration in database/db.py).
      - authenticate/complete: verify_authentication_response() against the stored
        public key, checking the RP ID hash, user-present/verified flags, and the
        signature, and enforce monotonic sign_count.
    Then flip passkey_auth_enabled default to True (or set the env var).
    """
    if not settings.passkey_auth_enabled:
        raise HTTPException(
            status_code=503,
            detail="Passkey auth is disabled pending WebAuthn verification",
        )


@app.post(
    "/auth/passkey/register/init", response_model=PasskeyRegisterInitResponse, tags=["Passkey"]
)
async def passkey_register_init(request: PasskeyRegisterInitRequest):
    """
    Initialize passkey registration.
    Returns a challenge for WebAuthn credential creation.
    """
    _require_passkey_enabled()
    import secrets
    import time

    # Generate challenge
    challenge = secrets.token_urlsafe(32)
    user_id = secrets.token_hex(16)

    # Store challenge for verification (shared across replicas via Redis)
    from bot.utils.redis_cache import redis_cache

    await redis_cache.set(
        _passkey_key(challenge),
        {
            "user_id": user_id,
            "email": request.email,
            "display_name": request.displayName or request.email or "Suwappu User",
            "timestamp": time.time(),
            "type": "registration",
        },
        ttl_seconds=PASSKEY_CHALLENGE_TTL,
    )

    # WebAuthn RP ID — must be a registrable suffix of the page origin (suwappu.bot
    # covers app./terminal./www.). Decoupled from oauth_redirect_base (see settings).
    rp_id = settings.webauthn_rp_id

    return PasskeyRegisterInitResponse(
        challenge=challenge,
        userId=user_id,
        userName=request.email or f"user_{user_id[:8]}",
        rpId=rp_id,
        rpName="Suwappu",
        attestation="none",
    )


@app.post(
    "/auth/passkey/register/complete",
    response_model=PasskeyRegisterCompleteResponse,
    tags=["Passkey"],
)
async def passkey_register_complete(
    request: PasskeyRegisterCompleteRequest,
    response: Response,
    db: Session = Depends(get_db),
):
    """
    Complete passkey registration.
    Verifies the WebAuthn credential and creates user + wallet (Turnkey if
    configured, otherwise a local encrypted wallet via WalletService).
    """
    _require_passkey_enabled()
    await _verify_passkey_challenge(request.clientDataJSON, "webauthn.create")

    existing_user = (
        db.query(User).filter(User.passkey_credential_id == request.credentialId).first()
    )
    if not existing_user and request.userHandle:
        existing_user = (
            db.query(User).filter(User.passkey_user_handle == request.userHandle).first()
        )
    if not existing_user:
        existing_user = (
            db.query(User).filter(User.username == f"passkey_{request.credentialId[:8]}").first()
        )

    if existing_user:
        wallet = (
            db.query(Wallet)
            .filter(
                Wallet.user_id == existing_user.id,
                Wallet.is_active == True,  # noqa: E712
            )
            .order_by(Wallet.is_default.desc(), Wallet.id.asc())
            .first()
        )
        if not wallet:
            # Heal accounts that were created without a wallet (e.g. by the
            # earlier Turnkey-only path that returned an empty wallet when
            # Turnkey was unconfigured). Provision one now via the shared,
            # provider-aware service so the user actually connects.
            try:
                from bot.services.wallet import WalletService

                wallet = await WalletService().create_wallet(
                    user_id=existing_user.id, name="Passkey Wallet", chain_type="evm"
                )
            except Exception as e:
                logger.error(f"Failed to backfill wallet for passkey user {existing_user.id}: {e}")
        wallet_address = wallet.address if wallet else ""
        if not existing_user.passkey_credential_id:
            existing_user.passkey_credential_id = request.credentialId
        if request.userHandle and not existing_user.passkey_user_handle:
            existing_user.passkey_user_handle = request.userHandle
        existing_user.last_active_at = datetime.utcnow()
        db.commit()

        token = create_jwt_token(
            address=wallet_address or f"passkey:{request.credentialId[:16]}",
            user_id=existing_user.id,
            src="passkey",
        )
        expires_at = datetime.utcnow() + timedelta(hours=JWT_EXPIRY_HOURS)
        response.set_cookie(
            key="suwappu_auth",
            value=token,
            max_age=JWT_EXPIRY_HOURS * 3600,
            path="/",
            **_session_cookie_kwargs(),
        )
        return PasskeyRegisterCompleteResponse(
            success=True,
            userId=existing_user.id,
            walletAddress=wallet_address,
            subOrgId=wallet.turnkey_sub_org_id if wallet else "",
            token=token,
            expiresAt=expires_at,
        )

    # Create user
    user = User(
        telegram_id=None,
        username=f"passkey_{request.credentialId[:8]}",
        passkey_credential_id=request.credentialId,
        passkey_user_handle=request.userHandle,
        created_at=datetime.utcnow(),
        tos_accepted=True,
        tos_accepted_at=datetime.utcnow(),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    wallet_address = ""
    sub_org_id = ""

    # Provision a wallet through the shared WalletService, which routes to
    # Turnkey when wallet_provider=turnkey is configured and otherwise creates a
    # local encrypted wallet — the same path Telegram users get on /start.
    # Previously this hardcoded Turnkey and silently returned an empty wallet
    # when Turnkey was not configured (the default), leaving passkey users with
    # no wallet and a "connected" account that looked dead in the UI.
    try:
        from bot.services.wallet import WalletService

        wallet = await WalletService().create_wallet(
            user_id=user.id, name="Passkey Wallet", chain_type="evm"
        )
        wallet_address = wallet.address or ""
        sub_org_id = wallet.turnkey_sub_org_id or ""
    except Exception as e:
        logger.error(f"Failed to provision wallet for passkey user {user.id}: {e}")
        # Continue without wallet

    # Create JWT token
    token = create_jwt_token(
        address=wallet_address or f"passkey:{request.credentialId[:16]}",
        user_id=user.id,
        src="passkey",
    )
    expires_at = datetime.utcnow() + timedelta(hours=JWT_EXPIRY_HOURS)

    # Set cookie
    response.set_cookie(
        key="suwappu_auth",
        value=token,
        max_age=JWT_EXPIRY_HOURS * 3600,
        **_session_cookie_kwargs(),
        path="/",
    )

    return PasskeyRegisterCompleteResponse(
        success=True,
        userId=user.id,
        walletAddress=wallet_address,
        subOrgId=sub_org_id,
        token=token,
        expiresAt=expires_at,
    )


@app.post(
    "/auth/passkey/authenticate/init", response_model=PasskeyAuthInitResponse, tags=["Passkey"]
)
async def passkey_auth_init():
    """
    Initialize passkey authentication.
    Returns a challenge for WebAuthn assertion.
    """
    _require_passkey_enabled()
    import secrets
    import time

    challenge = secrets.token_urlsafe(32)

    from bot.utils.redis_cache import redis_cache

    await redis_cache.set(
        _passkey_key(challenge),
        {
            "timestamp": time.time(),
            "type": "authentication",
        },
        ttl_seconds=PASSKEY_CHALLENGE_TTL,
    )

    rp_id = settings.webauthn_rp_id

    return PasskeyAuthInitResponse(
        challenge=challenge,
        rpId=rp_id,
        allowCredentials=None,  # Allow any credential (discoverable)
    )


@app.post(
    "/auth/passkey/authenticate/complete",
    response_model=PasskeyAuthCompleteResponse,
    tags=["Passkey"],
)
async def passkey_auth_complete(
    request: PasskeyAuthCompleteRequest,
    response: Response,
    db: Session = Depends(get_db),
):
    """
    Complete passkey authentication.
    Verifies the WebAuthn assertion and returns a session.
    """
    _require_passkey_enabled()
    await _verify_passkey_challenge(request.clientDataJSON, "webauthn.get")

    user = db.query(User).filter(User.passkey_credential_id == request.credentialId).first()
    if not user and request.userHandle:
        user = db.query(User).filter(User.passkey_user_handle == request.userHandle).first()
    if not user:
        user = db.query(User).filter(User.username == f"passkey_{request.credentialId[:8]}").first()
    wallet_address = ""

    if not user:
        raise HTTPException(status_code=401, detail="No matching passkey found")

    # Get user's wallet
    wallet = (
        db.query(Wallet)
        .filter(
            Wallet.user_id == user.id,
            Wallet.is_active == True,  # noqa: E712
        )
        .first()
    )

    if wallet:
        wallet_address = wallet.address

    # Create JWT token
    token = create_jwt_token(
        address=wallet_address or f"passkey:{request.credentialId[:16]}",
        user_id=user.id,
        src="passkey",
    )
    expires_at = datetime.utcnow() + timedelta(hours=JWT_EXPIRY_HOURS)

    # Set cookie
    response.set_cookie(
        key="suwappu_auth",
        value=token,
        max_age=JWT_EXPIRY_HOURS * 3600,
        **_session_cookie_kwargs(),
        path="/",
    )

    return PasskeyAuthCompleteResponse(
        success=True,
        token=token,
        userId=user.id,
        walletAddress=wallet_address,
        expiresAt=expires_at,
    )


@app.get("/.well-known/ai-plugin.json", tags=["Discovery"], include_in_schema=False)
async def get_plugin_manifest():
    """Standard OpenAI plugin discovery path."""
    with open("api/ai-plugin.json", "r") as f:
        return json.load(f)


@app.get("/agent-card.json", tags=["Discovery"])
async def get_agent_card():
    """Returns the A2A Agent Card for decentralized discovery."""
    with open("api/agent-card.json", "r") as f:
        return json.load(f)


@app.get("/tools", tags=["Agents"], summary="Agent tool discovery")
async def get_tools(agent_key: str = Depends(get_agent_key)):
    """
    Returns a semantic directory of tools available to AI agents.
    Agents can use this metadata to register Suwappu as a toolset in their local context.
    """
    return {
        "provider": "Suwappu Liquidity Bot",
        "description": "High-performance multi-chain trading and wallet management infrastructure.",
        "tools": [
            {
                "name": "get_portfolio",
                "endpoint": "/users/{user_id}/portfolio",
                "method": "GET",
                "description": "Check multi-chain balances for a user to ensure sufficient liquidity.",
                "parameters": {"user_id": "The database ID of the user."},
            },
            {
                "name": "get_wallets",
                "endpoint": "/users/{user_id}/wallets",
                "method": "GET",
                "description": "Retrieve wallet addresses for deposit or swap targets.",
                "parameters": {"user_id": "The database ID of the user."},
            },
            {
                "name": "provision_wallet",
                "endpoint": "/v1/agent/wallets",
                "method": "POST",
                "description": "Programmatically create a new managed wallet for a user.",
                "parameters": {"user_id": "The target user ID.", "chain_type": "evm or solana"},
            },
            {
                "name": "execute_command",
                "endpoint": "/v1/agent/execute",
                "method": "POST",
                "description": "Submit a natural language trading command (e.g., 'buy 0.1 eth on base'). Returns machine-readable results.",
                "parameters": {
                    "text": "The trading command string.",
                    "user_id": "The target database user ID.",
                },
            },
        ],
    }


_agent_execute_limiter = UserRateLimiter(max_requests=30, window_seconds=60)


@app.post("/v1/agent/execute", tags=["Agents"], summary="Execute natural language trading command")
async def agent_execute(
    request: AgentExecuteRequest,
    agent_key: str = Depends(get_agent_key),
    db: Session = Depends(get_db),
):
    """
    Direct bridge to Suwappu's Natural Language Trading Engine.
    Agents can send raw strings and receive structured execution results.
    """
    from bot.services.unified_bot_service import unified_bot_service

    # 0. Rate limit per agent key (keyed on a stable hash, not the raw secret)
    key_id = hashlib.sha256(agent_key.encode()).hexdigest()[:16]
    try:
        await _agent_execute_limiter.check(key_id)
    except RateLimitExceeded as e:
        raise HTTPException(
            status_code=429,
            detail=str(e),
            headers={"Retry-After": str(max(1, int(getattr(e, "retry_after", 1) or 1)))},
        )

    # 1. Resolve user
    user = db.query(User).filter(User.id == request.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # AEGIS observe-mode scan (advisory only — never blocks execution)
    await get_aegis().ascan(request.text, source="agent_api", user_id=key_id)

    # 2. Execute via unified service
    response = await unified_bot_service.handle_command(
        platform="agent", user_id=f"agent_{request.user_id}", text=request.text
    )

    return {
        "status": "success",
        "input": request.text,
        "response": response.text,
        "buttons": response.buttons,
        "timestamp": datetime.utcnow(),
    }


@app.post(
    "/v1/agent/wallets",
    response_model=WalletResponse,
    tags=["Agents"],
    summary="Provision a new wallet",
)
async def provision_agent_wallet(
    request: AgentWalletCreate,
    agent_key: str = Depends(get_agent_key),
    db: Session = Depends(get_db),
):
    """Programmatically provision a new wallet for an agent-managed user."""
    user = db.query(User).filter(User.id == request.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    wallet = await wallet_service.create_wallet(
        user_id=user.id, name=request.name, chain_type=request.chain_type
    )

    return WalletResponse(
        id=wallet.id,
        userId=wallet.user_id,
        name=wallet.name,
        address=wallet.address,
        chainType=wallet.chain_type,
        isActive=wallet.is_active,
        isDefault=wallet.is_default,
        createdAt=wallet.created_at,
    )


# ==========================================
# Internal API — service-to-service only
# ==========================================


@app.post("/internal/agent/provision-wallet", tags=["Internal"])
async def internal_provision_wallet(request: Request):
    """Create User + Wallet for an agent. Called by TS API during wallet creation."""
    key = request.headers.get("X-Internal-Key", "")
    expected = os.environ.get("INTERNAL_API_KEY", "")
    if not expected or key != expected:
        raise HTTPException(status_code=401, detail="Invalid internal key")

    body = await request.json()
    agent_uuid = body.get("agent_uuid", "")
    chain_type = body.get("chain_type", "evm")
    if not agent_uuid:
        raise HTTPException(status_code=400, detail="agent_uuid required")

    agent_int_id = abs(hash(agent_uuid)) % (2**31 - 1)

    with get_session() as session:
        user = session.query(User).filter(User.telegram_id == agent_int_id).first()
        if not user:
            user = User(
                telegram_id=agent_int_id, username=f"agent_{agent_uuid[:8]}", first_name="Agent"
            )
            session.add(user)
            session.flush()
        user_id = user.id

    # Create Turnkey-managed wallet row — no local key encryption
    turnkey_wallet_id = body.get("turnkey_wallet_id")
    turnkey_sub_org_id = body.get("turnkey_sub_org_id")

    with get_session() as session:
        wallet = Wallet(
            user_id=user_id,
            name=f"agent_{agent_uuid[:8]}",
            address="pending",
            encrypted_private_key="turnkey_managed",
            encryption_scheme="turnkey",
            wallet_provider="turnkey",
            turnkey_wallet_id=turnkey_wallet_id,
            turnkey_sub_org_id=turnkey_sub_org_id,
            chain_type=chain_type,
            is_active=True,
            is_default=True,
            created_at=datetime.utcnow(),
        )
        session.add(wallet)
        session.flush()
        wallet_id = wallet.id

    return {"internal_user_id": user_id, "internal_wallet_id": wallet_id}


@app.post("/internal/agent/execute-swap", tags=["Internal"])
async def internal_execute_swap(request: Request):
    """Execute swap via Python pipeline. Called by TS API."""
    key = request.headers.get("X-Internal-Key", "")
    expected = os.environ.get("INTERNAL_API_KEY", "")
    if not expected or key != expected:
        raise HTTPException(status_code=401, detail="Invalid internal key")

    body = await request.json()
    from bot.services.swap_engine import SwapEngine, SwapQuote
    from bot.services.fee_service import fee_service

    swap_engine = SwapEngine()

    qd = body.get("quote_data", {})
    # Carry the platform fee so EVM execution re-fetches the tx WITH the fee
    # (this internal/webapp execute path was dropping it). Falls back to the
    # default rate; collection stays gated per-provider on a configured collector.
    quote = SwapQuote(
        provider=qd.get("provider", "lifi"),
        from_chain=str(qd.get("from_chain", "base")),
        to_chain=str(qd.get("to_chain", "base")),
        from_token=str(qd.get("from_token", "")),
        to_token=str(qd.get("to_token", "")),
        from_amount=str(qd.get("from_amount", "0")),
        from_amount_human=float(qd.get("from_amount_human", 0)),
        to_amount=str(qd.get("to_amount", "0")),
        to_amount_human=float(qd.get("to_amount_human", 0)),
        to_amount_min=str(qd.get("to_amount_min", qd.get("to_amount", "0"))),
        gas_cost_usd=float(qd.get("gas_cost_usd", 0)),
        fee_cost_usd=float(qd.get("fee_cost_usd", 0)),
        total_cost_usd=float(qd.get("total_cost_usd", 0)),
        estimated_time=int(qd.get("estimated_time", 60)),
        price_impact=float(qd.get("price_impact", 0)),
        exchange_rate=float(qd.get("exchange_rate", 0)),
        raw_quote=qd.get("raw_quote", {}),
        timestamp=datetime.now(),
        platform_fee_bps=qd.get("platform_fee_bps") or fee_service.get_fee_bps(),
    )

    swap_tx = await swap_engine.execute_swap(
        quote=quote,
        wallet_id=body.get("internal_wallet_id"),
        user_id=body.get("internal_user_id"),
        idempotency_key=body.get("idempotency_key"),
    )

    return {"swap_id": swap_tx.id, "tx_hash": swap_tx.tx_hash, "status": swap_tx.status}


# --- Dependencies ---
async def health():
    """Returns the operational status of the Suwappu Monolith. Agents should check this before trade batches."""
    return {"status": "ok", "timestamp": datetime.utcnow()}


@app.get(
    "/users/{user_id}/wallets",
    response_model=List[WalletResponse],
    tags=["Wallets"],
    summary="List user wallets",
)
async def get_wallets(
    user_id: int, db: Session = Depends(get_db), agent_key: str = Depends(get_agent_key)
):
    """
    Retrieve all active wallets for a specific user.
    Agents use this to identify target addresses for deposit/swap operations.
    """
    wallets = (
        db.query(Wallet)
        .filter(Wallet.user_id == user_id, Wallet.is_active == True)  # noqa: E712
        .all()  # noqa: E712
    )  # noqa: E712
    # Map camelCase for iOS compatibility
    res = []
    for w in wallets:
        res.append(
            WalletResponse(
                id=w.id,
                userId=w.user_id,
                name=w.name or "Primary Wallet",
                address=w.address,
                chainType=w.chain_type,
                isActive=w.is_active,
                isDefault=w.is_default,
                createdAt=w.created_at or datetime.utcnow(),
            )
        )
    return res


@app.get(
    "/users/{user_id}/portfolio",
    response_model=PortfolioResponse,
    tags=["Portfolio"],
    summary="Get user portfolio balances",
)
async def get_portfolio(
    user_id: int, db: Session = Depends(get_db), agent_key: str = Depends(get_agent_key)
):
    """
    Fetches a real-time consolidated balance sheet for a user across all supported chains.
    Agents must call this to verify sufficient liquidity before initiating swap orders.
    """
    wallets = (
        db.query(Wallet)
        .filter(Wallet.user_id == user_id, Wallet.is_active == True)  # noqa: E712
        .all()  # noqa: E712
    )  # noqa: E712

    total_usd = 0.0
    all_token_balances = []
    chains_value = {}

    for wallet in wallets:
        balances = await wallet_service.get_all_balances(wallet)
        for chain_name, tokens in balances.items():
            chain_total = chains_value.get(chain_name, 0.0)
            for symbol, bal in tokens.items():
                # Mock token info for now
                token_val = bal  # Assuming 1:1 for stables in mock
                all_token_balances.append(
                    TokenBalance(
                        id=f"{chain_name}-{symbol}",
                        token=TokenInfo(
                            id=f"{chain_name}-{symbol}",
                            symbol=symbol,
                            name=symbol,
                            decimals=18,
                            address="0x...",
                            chainId=chain_name,
                        ),
                        balance=str(int(bal * 10**18)),
                        balanceHuman=bal,
                        balanceUSD=token_val,
                        chainId=chain_name,
                    )
                )
                total_usd += token_val
                chain_total += token_val
            chains_value[chain_name] = chain_total

    return PortfolioResponse(totalUSD=total_usd, tokens=all_token_balances, chains=chains_value)


@app.get(
    "/users/{user_id}/swaps",
    response_model=List[SwapResponse],
    tags=["Swaps"],
    summary="Get user swap history",
)
async def get_swaps(
    user_id: int,
    limit: int = 50,
    db: Session = Depends(get_db),
    _key: str = Depends(get_agent_or_admin_key),
):
    swaps = (
        db.query(SwapTransaction)
        .filter(SwapTransaction.user_id == user_id)
        .order_by(SwapTransaction.created_at.desc())
        .limit(limit)
        .all()
    )

    return [
        SwapResponse(
            id=s.id,
            fromChain=s.from_chain,
            toChain=s.to_chain,
            fromToken=s.from_token,
            toToken=s.to_token,
            fromAmount=s.from_amount,
            toAmount=s.to_amount,
            status=s.status,
            timestamp=s.created_at,
            txHash=s.tx_hash,
        )
        for s in swaps
    ]


class AdminSwapResponse(BaseModel):
    id: int
    userId: int
    fromChain: str
    toChain: str
    fromToken: str
    toToken: str
    fromAmount: str
    toAmount: Optional[str]
    status: str
    timestamp: datetime
    txHash: Optional[str]


@app.get("/admin/swaps", response_model=List[AdminSwapResponse], tags=["Admin"])
async def admin_get_swaps(
    limit: int = 50,
    user_id: Optional[int] = None,
    db: Session = Depends(get_db),
    _admin_key: str = Depends(get_admin_key),
):
    query = db.query(SwapTransaction)
    if user_id is not None:
        query = query.filter(SwapTransaction.user_id == user_id)
    swaps = query.order_by(SwapTransaction.created_at.desc()).limit(limit).all()

    return [
        AdminSwapResponse(
            id=s.id,
            userId=s.user_id,
            fromChain=s.from_chain,
            toChain=s.to_chain,
            fromToken=s.from_token,
            toToken=s.to_token,
            fromAmount=s.from_amount,
            toAmount=s.to_amount,
            status=s.status,
            timestamp=s.created_at,
            txHash=s.tx_hash,
        )
        for s in swaps
    ]


# ============ WhatsApp Webhook ============

from fastapi import Request  # noqa: E402
from bot.services.whatsapp_service import whatsapp_service  # noqa: E402
from bot.services.whatsapp_voice import voice_handler  # noqa: E402
from bot.services.whatsapp_queue import WhatsAppMessageQueue  # noqa: E402


async def _wa_dispatch(message):
    """Queue handler: transcribe voice notes, then route through the flow router."""
    from bot.services.whatsapp_router import whatsapp_router

    if message.message_type == "audio" and message.audio_id:
        transcript = None
        try:
            transcript = await voice_handler.handle_voice(message)
        except Exception as e:
            logger.warning(f"WhatsApp voice transcription failed: {e}")
        if transcript:
            message.text = transcript
            message.message_type = "text"
        else:
            await whatsapp_service.send_text_message(
                message.from_number,
                "🎤 Sorry, I couldn't understand that voice note — please type your request.",
            )
            return

    # AEGIS observe-mode scan (advisory only — never blocks or alters routing).
    scan_parts = []
    if message.text:
        scan_parts.append(message.text)
    if message.button_payload:
        scan_parts.append(message.button_payload)
    if message.list_reply_id:
        scan_parts.append(message.list_reply_id)
    if message.nfm_reply_data:
        try:
            nfm_text = (
                message.nfm_reply_data
                if isinstance(message.nfm_reply_data, str)
                else json.dumps(message.nfm_reply_data, separators=(",", ":"))
            )
        except Exception:
            nfm_text = str(message.nfm_reply_data)
        scan_parts.append(nfm_text)
    if scan_parts:
        await get_aegis().ascan(
            "\n".join(scan_parts), source="whatsapp", user_id=message.from_number
        )

    await whatsapp_router.route(message)


# Per-user ordered message queue (prevents burst race conditions on conversation
# state). Started/stopped in the app lifespan.
_wa_queue = WhatsAppMessageQueue(handler=_wa_dispatch)


@app.get("/webhook")
async def verify_whatsapp_webhook(request: Request):
    """Verify webhook subscription from Meta."""
    params = request.query_params
    mode = params.get("hub.mode")
    token = params.get("hub.verify_token")
    challenge = params.get("hub.challenge")

    result = whatsapp_service.verify_webhook(mode, token, challenge)
    if result:
        return PlainTextResponse(content=result)
    raise HTTPException(status_code=403, detail="Verification failed")


@app.post("/webhook")
async def receive_whatsapp_message(request: Request):
    """Handle incoming WhatsApp messages."""
    # Read the RAW body first — the signature is computed over these exact bytes.
    raw_body = await request.body()

    # Verify Meta's X-Hub-Signature-256 before trusting any of the payload.
    # verify_signature fails closed (rejects) when the signature is invalid or
    # no WHATSAPP_APP_SECRET is configured.
    if not whatsapp_service.verify_signature(raw_body, request.headers.get("X-Hub-Signature-256")):
        logger.warning("Rejected WhatsApp webhook: invalid X-Hub-Signature-256")
        raise HTTPException(status_code=403, detail="Invalid signature")

    try:
        payload = json.loads(raw_body)
    except Exception:
        return {"status": "bad_payload"}

    # Parse the incoming message
    message = whatsapp_service.parse_webhook_message(payload)
    if not message:
        return {"status": "no_message"}

    # Rate limit WhatsApp ingress (per sender)
    from bot.utils.rate_limiter import UserRateLimiter, RateLimitExceeded

    if not hasattr(receive_whatsapp_message, "_limiter"):
        receive_whatsapp_message._limiter = UserRateLimiter(max_requests=30, window_seconds=60)
    try:
        await receive_whatsapp_message._limiter.check(message.from_number)
    except RateLimitExceeded as e:
        await whatsapp_service.send_text_message(message.from_number, f"⏳ {e}")
        return {"status": "rate_limited"}

    # Mark as read
    await whatsapp_service.mark_as_read(message.message_id)

    # Hand off to the per-user ordered queue (voice transcription + flow routing
    # happen in the consumer). Fall back to direct dispatch if the queue is full
    # or errors, so a queue problem never drops a message.
    try:
        queued = await _wa_queue.enqueue(message)
    except Exception as e:
        logger.warning(f"WhatsApp enqueue failed, dispatching directly: {e}")
        queued = False
    if not queued:
        await _wa_dispatch(message)

    return {"status": "ok"}


# ============ Telegram Webhook ============


@app.post("/telegram/webhook")
async def telegram_webhook(request: Request):
    """
    Handle incoming Telegram updates via webhook.
    Used in production with multiple ECS replicas to avoid polling conflicts.
    """
    # Verify the secret token from Telegram
    secret_token = request.headers.get("X-Telegram-Bot-Api-Secret-Token")
    expected_secret = settings.get_webhook_secret()

    if secret_token != expected_secret:
        logger.warning("Telegram webhook request with invalid secret token")
        raise HTTPException(status_code=403, detail="Invalid secret token")

    # Get the bot application from app state
    bot_app = getattr(request.app.state, "bot_app", None)
    if not bot_app:
        if not settings.run_telegram_bot:
            # Worker mode: this service intentionally runs without the Telegram bot.
            logger.warning("Telegram webhook hit on a service with RUN_TELEGRAM_BOT=false")
            raise HTTPException(status_code=503, detail="Telegram bot disabled on this service")
        logger.error("Bot application not initialized")
        raise HTTPException(status_code=500, detail="Bot not initialized")

    # Parse the update
    try:
        payload = await request.json()
        update = Update.de_json(payload, bot_app.bot)

        # Enqueue the update so the endpoint ACKs immediately; the running
        # Application (initialize() + start() in lifespan) drains the queue
        # through the configured update processor.
        await bot_app.update_queue.put(update)

    except Exception as e:
        logger.error(f"Error processing Telegram webhook: {e}")
        # Return 200 anyway to prevent Telegram from retrying
        # Errors are logged but we don't want to block the webhook

    return {"status": "ok"}


@app.post("/internal/railway-webhook", include_in_schema=False)
async def railway_webhook(request: Request):
    """Receive Railway deploy-status webhooks and fan failures out to Telegram admins.

    Railway posts a JSON payload on deployment status changes. We only alert on
    failure/crash states so the team hears about a bad deploy without watching the
    dashboard. Auth is a shared secret passed as ``?token=`` on the webhook URL
    (Railway does not send custom auth headers). Always returns 200 so Railway
    never disables the webhook on our account.
    """
    expected = os.environ.get("RAILWAY_WEBHOOK_SECRET")
    if not expected or request.query_params.get("token") != expected:
        logger.warning("Railway webhook hit with missing/invalid token")
        raise HTTPException(status_code=403, detail="Invalid token")

    try:
        payload = await request.json()
    except Exception:  # noqa: BLE001
        return {"status": "ignored", "reason": "unparseable body"}

    # Railway payloads vary by event; deploy events carry a top-level `status`
    # and a nested `deployment`/`service`/`environment`. Be defensive.
    status = str(payload.get("status") or payload.get("type") or "").upper()
    alert_states = {"FAILED", "CRASHED", "REMOVED", "DEPLOY_FAILED", "BUILD_FAILED"}
    if not any(s in status for s in alert_states):
        return {"status": "ok", "ignored_status": status}

    service = (payload.get("service") or {}).get("name") or payload.get("serviceName") or "?"
    env = (payload.get("environment") or {}).get("name") or payload.get("environmentName") or "?"
    project = (payload.get("project") or {}).get("name") or "suwappu"
    commit = (payload.get("deployment") or {}).get("meta", {}).get("commitMessage")
    commit_line = f"\n`{safe_md(commit.splitlines()[0][:80])}`" if commit else ""

    # The payload is Railway-authenticated by the shared ?token= secret, but its
    # field values (service/env/project/commit names) are still attacker-influenced
    # free text upstream of that boundary — escape before interpolating into a
    # Markdown-rendered admin alert (bug class: markdown injection via external text).
    text = (
        f"🚨 *Railway deploy {safe_md(status)}*\n"
        f"Project: `{safe_md(project)}`\n"
        f"Service: `{safe_md(service)}`\n"
        f"Env: `{safe_md(env)}`{commit_line}"
    )

    bot_app = getattr(request.app.state, "bot_app", None)
    bot = bot_app.bot if bot_app else None
    try:
        from bot.services.support_notifier import post_admin_update

        await post_admin_update(bot, text)
    except Exception as e:  # noqa: BLE001 — never let alerting failure 500 the webhook
        logger.error("Failed to fan out Railway webhook alert: %s", e)

    return {"status": "alerted", "deploy_status": status}


_MONITOR_SOURCE_RE = re.compile(r"[^a-zA-Z0-9_-]")
_MONITOR_SOURCE_MAX_LEN = 40


@app.post("/internal/monitor-heartbeat", include_in_schema=False)
async def monitor_heartbeat(request: Request):
    """Receive uptime-probe heartbeats and record them so the dead-man's switch
    (bot/services/health_monitor.py) can notice when probing itself goes quiet.

    Auth is a shared secret passed as ``?token=`` (same convention as
    ``/internal/railway-webhook`` — external cron schedulers can't send custom
    auth headers). Fails CLOSED: if the secret isn't configured, every request
    is rejected so an unconfigured deploy can never be pinged by anyone.
    """
    import hmac

    expected = settings.monitor_heartbeat_secret
    provided = request.query_params.get("token") or ""
    # Compare bytes, not str: hmac.compare_digest raises TypeError on non-ASCII
    # strings, so `?token=é` turned an auth failure into an unauthenticated 500
    # (a free error-quota generator, and one that echoes the URL into Sentry).
    if not expected or not hmac.compare_digest(provided.encode("utf-8"), expected.encode("utf-8")):
        logger.warning("Monitor heartbeat hit with missing/invalid token")
        raise HTTPException(status_code=403, detail="Invalid token")

    raw_source = request.query_params.get("source") or "unknown"
    source = _MONITOR_SOURCE_RE.sub("", raw_source)[:_MONITOR_SOURCE_MAX_LEN] or "unknown"
    # Allow-list: only the sources the dead-man's switch actually tracks may
    # write a heartbeat key. This bounds the set of `monitor:heartbeat:*`
    # Redis keys a token holder can mint and keeps the checker's per-source
    # scan (bot/services/health_monitor.py) from being unbounded.
    if source not in settings.monitor_expected_sources_list():
        source = "unknown"
    ok = request.query_params.get("ok", "1") != "0"

    try:
        from bot.utils.redis_cache import redis_cache

        key = f"monitor:heartbeat:{source}"
        fail_since = None
        if not ok:
            try:
                existing = await redis_cache.get(key)
            except Exception:
                existing = None
            if isinstance(existing, dict) and existing.get("fail_since"):
                fail_since = existing["fail_since"]
            else:
                fail_since = datetime.now(timezone.utc).isoformat()

        await redis_cache.set(
            key,
            {
                "ts": datetime.now(timezone.utc).isoformat(),
                "ok": ok,
                "fail_since": fail_since,
            },
            ttl_seconds=24 * 60 * 60,
        )
    except Exception as e:  # noqa: BLE001 — never let a bad heartbeat write 500 the endpoint
        logger.error("Failed to record monitor heartbeat from %s: %s", source, e)

    return {"status": "ok"}


@app.get("/", include_in_schema=False)
async def root_redirect():
    """Redirect root to the API documentation portal."""
    return RedirectResponse(url="/docs-portal/")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
