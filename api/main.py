import sys
import os
import asyncio
import time
import uuid
from contextvars import ContextVar
from pathlib import Path
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta, timezone

# Request-ID context variable — propagated into every service/log call within
# the same async context without threading explicit parameters everywhere.
request_id_ctx: ContextVar[str] = ContextVar("request_id", default="unknown")

from fastapi import FastAPI, Depends, HTTPException, Query, Request, Security, Response, Cookie
from fastapi.security.api_key import APIKeyHeader, APIKey
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

# Import webapp router (may be removed in some branches)
try:
    from api.webapp import router as webapp_router
except ImportError:
    webapp_router = None
from sqlalchemy.orm import Session
from pydantic import BaseModel, ConfigDict
import secrets
import json
import jwt
import hashlib
import base64

# Add project root to path to import bot modules
project_root = str(Path(__file__).parent.parent)
if project_root not in sys.path:
    sys.path.append(project_root)

from bot.services.wallet import WalletService
from bot.config.settings import settings
from bot.services.fee_sweeper import fee_sweeper
from bot.services.alerts import alert_service
from bot.services.orders import order_service
from bot.services.swap_engine import SwapEngine
from bot.services.tx_poller import tx_poller
from bot.services.health_monitor import health_monitor
from bot.services.balance_refresher import balance_refresher
from bot.services.perps_monitor import perps_monitor
from bot.services.event_bus import event_bus
from bot.services.api_client import api_client
from bot.utils.preload import preload_config
from bot.services.rpc_manager import rpc_manager
from database.db import init_db, engine, get_session, DATABASE_AVAILABLE
from bot.models.user import User, Wallet
from bot.models.swap import SwapTransaction, SwapStatus
from bot.models.advanced import LimitOrder, DCAOrder
from bot.models.agent import RegisteredAgent
from bot.utils.db_monitor import setup_db_monitoring
from bot.main import add_handlers
from telegram.ext import Application, PicklePersistence
from telegram import Update
from contextlib import asynccontextmanager

import logging

logger = logging.getLogger(__name__)

# --- Lifespan Manager ---


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifecycle manager for the consolidated API + Bot service."""
    logger.info("🚀 Starting consolidated Suwappu Monolith...")

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

    # 2. Build Bot Application
    os.makedirs("data", exist_ok=True)
    persistence_path = os.environ.get("BOT_PERSISTENCE_PATH", "data/bot_persistence.pickle")
    persistence = PicklePersistence(filepath=persistence_path)
    bot_app = (
        Application.builder().token(settings.telegram_bot_token).persistence(persistence).build()
    )
    add_handlers(bot_app)

    # Store bot_app in app.state for webhook endpoint access
    app.state.bot_app = bot_app

    # 3. Start Bot Hooks (only if database is available)
    polling_task = None
    bot_initialized = False
    using_webhook = False

    if not db_success:
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
                    )
                    using_webhook = True
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
                    _raw_replica_count = os.environ.get("RAILWAY_SERVICE_INSTANCE_COUNT", "1")
                    try:
                        _replica_count = int(_raw_replica_count)
                    except (ValueError, TypeError):
                        _replica_count = 1

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
                        polling_task = asyncio.create_task(
                            bot_app.updater.start_polling(
                                allowed_updates=Update.ALL_TYPES, drop_pending_updates=True
                            )
                        )
            else:
                logger.warning("⚠️ Placeholder or missing Telegram token. Skipping polling/webhook.")
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
            discord_task = asyncio.create_task(discord_bot.start())
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
        # Stagger service starts to avoid thundering herd on DB
        await fee_sweeper.start()
        await asyncio.sleep(2)
        await alert_service.start(bot=bot_app.bot if bot_initialized else None)
        await asyncio.sleep(2)
        await order_service.start(
            bot=bot_app.bot if bot_initialized else None, swap_engine=SwapEngine()
        )
        await asyncio.sleep(2)
        await tx_poller.start(bot=bot_app.bot if bot_initialized else None)
        await asyncio.sleep(2)
        await health_monitor.start(
            bot=bot_app.bot if bot_initialized else None, admin_ids=admin_ids
        )
        await asyncio.sleep(2)
        await balance_refresher.start()
        await asyncio.sleep(2)
        # Perps position-sync loop (#248): previously implemented but never started.
        await perps_monitor.start(bot=bot_app.bot if bot_initialized else None)

        # Start Discord alert service if Discord bot is available
        if discord_bot:
            try:
                from bot.services.discord_alerts import discord_alert_service

                await discord_alert_service.start(discord_bot)
                logger.info("✓ Discord alert service started")
            except Exception as e:
                logger.warning(f"⚠️ Discord alerts failed to start: {e}")

        logger.info("✓ All background services running")
    else:
        logger.warning("⚠️ Background services NOT started - database unavailable")

    # 5b. Periodic cleanup for auth challenge storage (prevents memory leak)
    async def _cleanup_auth_challenges_loop():
        from bot.services.turnkey_client import cleanup_expired_challenges

        while True:
            await asyncio.sleep(300)  # every 5 minutes
            try:
                removed = cleanup_expired_challenges()
                if removed:
                    logger.debug(f"Cleaned up {removed} expired auth challenges")
            except Exception as e:
                logger.warning(f"Auth challenge cleanup error: {e}")

    auth_cleanup_task = asyncio.create_task(_cleanup_auth_challenges_loop())

    # 6. Start cross-service integrations
    try:
        await event_bus.connect()
        if event_bus.connected:
            logger.info("✓ Event bus connected (Redis pub/sub)")
        else:
            logger.info("ℹ Event bus not connected (Redis unavailable, events disabled)")
    except Exception as e:
        logger.warning(f"⚠️ Event bus failed to connect: {e}")

    try:
        await api_client.init()
        logger.info("✓ Internal API client initialized")
    except Exception as e:
        logger.warning(f"⚠️ Internal API client failed to init: {e}")

    # Start the per-user WhatsApp message queue (ordered processing).
    try:
        await _wa_queue.start()
    except Exception as e:
        logger.warning(f"⚠️ WhatsApp message queue failed to start: {e}")

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
        await alert_service.stop()
        await order_service.stop()
        await tx_poller.stop()
        await health_monitor.stop()
        await balance_refresher.stop()
        await perps_monitor.stop()

    # Stop auth challenge cleanup
    auth_cleanup_task.cancel()

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
                            RegisteredAgent.is_active == True,
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
from api.routes.oauth import router as oauth_router

app.include_router(oauth_router)

# --- Import and register mobile app API routes ---
from api.routes.settings import router as settings_router

app.include_router(settings_router)

# --- Import and register Phase 2 mobile feature routes ---
from api.routes.mobile import router as mobile_router

app.include_router(mobile_router)

# --- Import and register new webapp routes (TS API parity) ---
try:
    from api.routes.webapp import router as webapp_v2_router

    app.include_router(webapp_v2_router)
except ImportError as e:
    print(f"Warning: Could not load webapp_v2_router: {e}")

try:
    from api.routes.swap import router as swap_router

    app.include_router(swap_router)
except ImportError as e:
    print(f"Warning: Could not load swap_router: {e}")

try:
    from api.routes.a2a import router as a2a_router

    app.include_router(a2a_router)
except ImportError as e:
    print(f"Warning: Could not load a2a_router: {e}")

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


class AuthChallengeResponse(BaseModel):
    challenge: str
    nonce: str
    expiresAt: datetime


class AuthVerifyRequest(BaseModel):
    address: str
    signature: str
    nonce: str


class AuthVerifyResponse(BaseModel):
    success: bool
    token: str
    user: Optional[Dict] = None
    expiresAt: datetime


class AuthMeResponse(BaseModel):
    authenticated: bool
    address: Optional[str] = None
    userId: Optional[int] = None
    createdAt: Optional[datetime] = None


# --- JWT Configuration ---

JWT_SECRET = getattr(settings, "secret_key", None) or os.environ.get("SECRET_KEY")
if not JWT_SECRET:
    import logging as _jwt_log

    _jwt_log.getLogger(__name__).warning(
        "SECRET_KEY not set — generating ephemeral JWT secret (tokens will not survive restarts)"
    )
    JWT_SECRET = secrets.token_hex(32)
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_HOURS = 24 * 7  # 7 days


def create_jwt_token(address: str, user_id: int) -> str:
    """Create a JWT token for authenticated user."""
    payload = {
        "address": address.lower(),
        "user_id": user_id,
        # camelCase alias so api-ts (which reads `userId`) accepts Python-issued tokens.
        "userId": user_id,
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
    """Extract current user from JWT token in cookie or header."""
    # Try cookie first
    token = auth_token

    # Fallback to Authorization header
    if not token:
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header[7:]

    if not token:
        return None

    return decode_jwt_token(token)


# --- Dependencies ---


def get_db():
    with get_session() as session:
        yield session


# --- Health Checks ---


@app.get("/health/live", tags=["Health"], summary="Liveness probe")
async def health_live():
    """K8s/ECS liveness probe — confirms the process is alive.

    Load balancers should use ``/health/ready`` to gate traffic;
    orchestrators use this to decide whether to restart the container.
    """
    return {"status": "alive"}


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
        else:
            bot_status = "no_bot_app"
    except Exception:
        bot_status = "error"

    # Redis ping
    redis_ok = await redis_cache.ping()

    # Background service heartbeats (TTL 60s; missing key = service dead)
    now = time.time()
    svc_heartbeats: dict = {}
    for svc in ("tx_poller", "balance_refresher", "perps_monitor"):
        last = await redis_cache.get(f"service:{svc}:heartbeat")
        if last is None:
            svc_heartbeats[svc] = "unknown"
        elif now - float(last) > 90:
            svc_heartbeats[svc] = "dead"
        else:
            svc_heartbeats[svc] = "alive"

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
            "checks": {
                "database": "connected" if DATABASE_AVAILABLE else "disconnected",
                "redis": "connected" if redis_ok else "memory-fallback",
                "bot": bot_status,
                "background_services": svc_heartbeats,
            },
        },
    )


@app.get("/health", tags=["Health"], summary="Health check (legacy)")
async def health_check():
    """Legacy alias for /health/ready — kept for backward compatibility."""
    return await health_ready()


# ============ Turnkey Web Authentication ============


@app.post("/auth/turnkey/challenge", response_model=AuthChallengeResponse, tags=["Auth"])
async def auth_challenge(request: AuthChallengeRequest):
    """
    Generate a challenge message for wallet-based authentication.
    The user signs this message with their wallet to prove ownership.
    """
    from bot.services.turnkey_client import generate_auth_challenge

    address = request.address.strip()
    if not address.startswith("0x") or len(address) != 42:
        raise HTTPException(status_code=400, detail="Invalid Ethereum address format")

    # generate_auth_challenge returns a dict (challenge/nonce/expiresAt); unpacking
    # it into two vars raised "too many values to unpack" -> 500 on every challenge.
    result = generate_auth_challenge(address)

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
    from bot.services.turnkey_client import verify_auth_signature

    address = request.address.strip().lower()

    # Verify the signature
    is_valid = verify_auth_signature(
        address=address, signature=request.signature, nonce=request.nonce
    )

    if not is_valid:
        raise HTTPException(status_code=401, detail="Invalid signature or expired challenge")

    # Find or create user by wallet address
    wallet = db.query(Wallet).filter(Wallet.address.ilike(address)).first()

    if wallet:
        user = db.query(User).filter(User.id == wallet.user_id).first()
    else:
        # Create new user and wallet for first-time login
        user = User(telegram_id=None, username=f"web_{address[:8]}", created_at=datetime.utcnow())
        db.add(user)
        db.commit()
        db.refresh(user)

        # Create wallet linked to user
        wallet = Wallet(
            user_id=user.id,
            address=address,
            chain_type="evm",
            is_active=True,
            is_default=True,
            name="Web Wallet",
            created_at=datetime.utcnow(),
        )
        db.add(wallet)
        db.commit()

    # Create JWT token
    token = create_jwt_token(address, user.id)
    expires_at = datetime.utcnow() + timedelta(hours=JWT_EXPIRY_HOURS)

    # Set secure HTTP-only cookie
    response.set_cookie(
        key="suwappu_auth",
        value=token,
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=JWT_EXPIRY_HOURS * 3600,
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

    return AuthMeResponse(
        authenticated=True,
        address=current_user.get("address"),
        userId=user.id,
        createdAt=user.created_at,
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
            Wallet.is_active == True,
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
    token = create_jwt_token(address=session_address, user_id=user.id)
    expires_at = datetime.utcnow() + timedelta(hours=JWT_EXPIRY_HOURS)

    response.set_cookie(
        key="suwappu_auth",
        value=token,
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=JWT_EXPIRY_HOURS * 3600,
        path="/",
    )

    return TelegramAuthResponse(
        token=token,
        expiresAt=expires_at,
        user={"id": user.id},
        address=wallet_address or "",
    )


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
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=JWT_EXPIRY_HOURS * 3600,
        path="/",
    )
    if refresh_token is not None:
        response.set_cookie(
            key=REFRESH_COOKIE,
            value=refresh_token,
            httponly=True,
            secure=True,
            samesite="lax",
            max_age=REFRESH_TTL_SECONDS,
            path="/",
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
        response.delete_cookie(REFRESH_COOKIE, path="/", secure=True, httponly=True, samesite="lax")
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")

    user_id, address, new_refresh, _expires = rotated
    access_token = create_jwt_token(address or "", user_id)
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
        response.delete_cookie(key=key, path="/", secure=True, httponly=True, samesite="lax")
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


@app.post(
    "/auth/passkey/register/init", response_model=PasskeyRegisterInitResponse, tags=["Passkey"]
)
async def passkey_register_init(request: PasskeyRegisterInitRequest):
    """
    Initialize passkey registration.
    Returns a challenge for WebAuthn credential creation.
    """
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
    Verifies the WebAuthn credential and creates user + Turnkey wallet.
    """
    from bot.services.turnkey_client import get_turnkey_client, is_turnkey_configured

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
                Wallet.is_active == True,
            )
            .order_by(Wallet.is_default.desc(), Wallet.id.asc())
            .first()
        )
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
        )
        expires_at = datetime.utcnow() + timedelta(hours=JWT_EXPIRY_HOURS)
        response.set_cookie(
            key="suwappu_auth",
            value=token,
            httponly=True,
            secure=True,
            samesite="lax",
            max_age=JWT_EXPIRY_HOURS * 3600,
            path="/",
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

    # Create Turnkey wallet if configured
    if is_turnkey_configured():
        try:
            turnkey = get_turnkey_client()

            # Create sub-organization for user
            sub_org_name = f"passkey_user_{user.id}"
            sub_org = await turnkey.create_sub_organization(name=sub_org_name)
            sub_org_id = sub_org.sub_org_id

            # Create EVM wallet
            turnkey_wallet = await turnkey.create_wallet(
                wallet_name="Passkey Wallet",
                chain_type="evm",
                organization_id=sub_org_id,
            )
            wallet_address = turnkey_wallet.address or ""

            # Store wallet in database
            wallet = Wallet(
                user_id=user.id,
                name="Passkey Wallet",
                address=wallet_address,
                chain_type="evm",
                wallet_provider="turnkey",
                turnkey_sub_org_id=sub_org_id,
                turnkey_wallet_id=turnkey_wallet.wallet_id,
                turnkey_account_id=turnkey_wallet.account_id,
                is_active=True,
                is_default=True,
            )
            db.add(wallet)
            db.commit()

        except Exception as e:
            logger.error(f"Failed to create Turnkey wallet for passkey user: {e}")
            # Continue without wallet

    # Create JWT token
    token = create_jwt_token(
        address=wallet_address or f"passkey:{request.credentialId[:16]}",
        user_id=user.id,
    )
    expires_at = datetime.utcnow() + timedelta(hours=JWT_EXPIRY_HOURS)

    # Set cookie
    response.set_cookie(
        key="suwappu_auth",
        value=token,
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=JWT_EXPIRY_HOURS * 3600,
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
    import secrets
    import time
    import urllib.parse

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
            Wallet.is_active == True,
        )
        .first()
    )

    if wallet:
        wallet_address = wallet.address

    # Create JWT token
    token = create_jwt_token(
        address=wallet_address or f"passkey:{request.credentialId[:16]}",
        user_id=user.id,
    )
    expires_at = datetime.utcnow() + timedelta(hours=JWT_EXPIRY_HOURS)

    # Set cookie
    response.set_cookie(
        key="suwappu_auth",
        value=token,
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=JWT_EXPIRY_HOURS * 3600,
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

    # 1. Resolve user
    user = db.query(User).filter(User.id == request.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

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
    wallets = db.query(Wallet).filter(Wallet.user_id == user_id, Wallet.is_active == True).all()
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
    wallets = db.query(Wallet).filter(Wallet.user_id == user_id, Wallet.is_active == True).all()

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

from fastapi import Request
from fastapi.responses import PlainTextResponse
from bot.services.whatsapp_service import whatsapp_service
from bot.services.unified_bot_service import unified_bot_service
from bot.services.whatsapp_voice import voice_handler
from bot.services.whatsapp_queue import WhatsAppMessageQueue


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
    # Fail-closed when WHATSAPP_APP_SECRET is set; skipped (with a warning) if not.
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
        logger.error("Bot application not initialized")
        raise HTTPException(status_code=500, detail="Bot not initialized")

    # Parse the update
    try:
        payload = await request.json()
        update = Update.de_json(payload, bot_app.bot)

        # Process the update
        await bot_app.process_update(update)

    except Exception as e:
        logger.error(f"Error processing Telegram webhook: {e}")
        # Return 200 anyway to prevent Telegram from retrying
        # Errors are logged but we don't want to block the webhook

    return {"status": "ok"}


@app.get("/", include_in_schema=False)
async def root_redirect():
    """Redirect root to the API documentation portal."""
    return RedirectResponse(url="/docs-portal/")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
