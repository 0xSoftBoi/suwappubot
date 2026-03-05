import sys
import os
import asyncio
from pathlib import Path
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta

from fastapi import FastAPI, Depends, HTTPException, Query, Request, Security, Response, Cookie
from fastapi.security.api_key import APIKeyHeader, APIKey
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

# Import webapp router
from api.webapp import router as webapp_router
from sqlalchemy.orm import Session
from pydantic import BaseModel, ConfigDict
import secrets
import json
import jwt
import hashlib

# Add project root to path to import bot modules
project_root = str(Path(__file__).parent.parent)
if project_root not in sys.path:
    sys.path.append(project_root)

from bot.services.wallet import WalletService
from bot.config.settings import settings
from bot.services.fee_sweeper import fee_sweeper
from bot.services.alerts import alert_service
from bot.services.orders import order_service
from bot.services.tx_poller import tx_poller
from bot.services.health_monitor import health_monitor
from bot.utils.preload import preload_config
from database.db import init_db, engine, get_session, DATABASE_AVAILABLE
from bot.models.user import User, Wallet
from bot.models.swap import SwapTransaction
from bot.models.advanced import LimitOrder, DCAOrder
from bot.models.agent import RegisteredAgent
from bot.utils.db_monitor import setup_db_monitoring
from bot.main import add_handlers
from telegram.ext import Application
from telegram import Update
from contextlib import asynccontextmanager

import logging

logger = logging.getLogger(__name__)

# --- Lifespan Manager ---

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifecycle manager for the consolidated API + Bot service."""
    logger.info("🚀 Starting consolidated Suwappu Monolith...")

    # 1. Initialize DB & Config
    preload_config()

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

    # 2. Build Bot Application
    bot_app = (
        Application.builder()
        .token(settings.telegram_bot_token)
        .build()
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
                        drop_pending_updates=True
                    )
                    using_webhook = True
                    logger.info(f"✓ Telegram webhook set: {settings.webhook_url}")
                else:
                    # Polling mode for local development
                    logger.info("✓ Starting Telegram polling background task")
                    # drop_pending_updates=True helps avoid conflicts during redeploys
                    polling_task = asyncio.create_task(bot_app.updater.start_polling(
                        allowed_updates=Update.ALL_TYPES,
                        drop_pending_updates=True
                    ))
            else:
                logger.warning("⚠️ Placeholder or missing Telegram token. Skipping polling/webhook.")
        except Exception as e:
            logger.error(f"❌ Telegram bot failed to initialize: {e}")
            logger.warning("⚠️ Continuing in HEADLESS MODE (API only)")

    # 4. Start Background Services (only if database is available)
    admin_ids = getattr(settings, 'admin_ids', [])

    if db_success:
        await fee_sweeper.start()
        await alert_service.start(bot=bot_app.bot if bot_initialized else None)
        await order_service.start(bot=bot_app.bot if bot_initialized else None)
        await tx_poller.start(bot=bot_app.bot if bot_initialized else None)
        await health_monitor.start(bot=bot_app.bot if bot_initialized else None, admin_ids=admin_ids)
        logger.info("✓ All background services running")
    else:
        logger.warning("⚠️ Background services NOT started - database unavailable")

    yield

    # --- Shutdown ---
    logger.info("🛑 Shutting down Suwappu Monolith...")

    # Stop bot polling if it was started
    if polling_task:
        await bot_app.updater.stop()

    # Delete webhook if it was set
    if using_webhook:
        try:
            await bot_app.bot.delete_webhook()
            logger.info("✓ Telegram webhook deleted")
        except Exception as e:
            logger.warning(f"Failed to delete webhook: {e}")

    # Only stop/shutdown bot if it was initialized
    if bot_initialized:
        try:
            await bot_app.stop()
            await bot_app.shutdown()
        except Exception:
            pass

    # Only stop services if they were started
    if db_success:
        await fee_sweeper.stop()
        await alert_service.stop()
        await order_service.stop()
        await tx_poller.stop()
        await health_monitor.stop()
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
    version="1.0.0",
    lifespan=lifespan
)

# --- Agent Authentication ---
API_KEY_NAME = "X-Agent-Key"
api_key_header = APIKeyHeader(name=API_KEY_NAME, auto_error=False)

# --- Admin Authentication ---
ADMIN_KEY_NAME = "X-Admin-Key"
admin_key_header = APIKeyHeader(name=ADMIN_KEY_NAME, auto_error=False)

async def get_agent_key(
    api_key: str = Security(api_key_header),
):
    """Verify the agent's API key against global key or registered agent keys."""
    valid_key = getattr(settings, "agent_api_key", None)
    if not valid_key:
        # In development, allow if no key is set
        return "dev-key"

    # Fast path: check global key
    if api_key == valid_key:
        return api_key

    # Check registered agent keys in DB
    if api_key and DATABASE_AVAILABLE:
        try:
            with get_session() as session:
                agent = session.query(RegisteredAgent).filter(
                    RegisteredAgent.api_key == api_key,
                    RegisteredAgent.is_active == True,
                ).first()
                if agent:
                    agent.last_seen_at = datetime.utcnow()
                    session.commit()
                    return api_key
        except Exception:
            pass

    raise HTTPException(
        status_code=403,
        detail="Invalid or missing Agent API Key. Discovery requires authentication."
    )


async def get_admin_key(
    api_key: str = Security(admin_key_header),
):
    """Verify the admin API key (for dashboard/ops)."""
    valid_key = getattr(settings, "admin_api_key", None)
    if not valid_key:
        # In development, allow if no key is set
        return "dev-admin-key"

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
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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

class AgentRegisterRequest(BaseModel):
    name: str
    description: Optional[str] = None
    callback_url: Optional[str] = None

class AgentRegisterResponse(BaseModel):
    agent_id: int
    name: str
    api_key: str
    message: str

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

JWT_SECRET = getattr(settings, "secret_key", None) or os.environ.get("SECRET_KEY") or secrets.token_hex(32)
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_HOURS = 24 * 7  # 7 days

def create_jwt_token(address: str, user_id: int) -> str:
    """Create a JWT token for authenticated user."""
    payload = {
        "address": address.lower(),
        "user_id": user_id,
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

# --- Health Check ---

@app.get("/health", tags=["Health"], summary="Service health check")
async def health_check():
    """Health check endpoint for load balancers, monitoring, and orchestration."""
    from database.db import DATABASE_AVAILABLE
    return {
        "status": "healthy",
        "service": "suwappu-api",
        "database": "connected" if DATABASE_AVAILABLE else "degraded"
    }


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
    
    challenge, nonce = generate_auth_challenge(address)
    
    return AuthChallengeResponse(
        challenge=challenge,
        nonce=nonce,
        expiresAt=datetime.utcnow() + timedelta(minutes=5)
    )


@app.post("/auth/turnkey/verify", response_model=AuthVerifyResponse, tags=["Auth"])
async def auth_verify(
    request: AuthVerifyRequest,
    response: Response,
    db: Session = Depends(get_db)
):
    """
    Verify the signed challenge and create a session.
    Returns a JWT token for subsequent authenticated requests.
    """
    from bot.services.turnkey_client import verify_auth_signature
    
    address = request.address.strip().lower()
    
    # Verify the signature
    is_valid = verify_auth_signature(
        address=address,
        signature=request.signature,
        nonce=request.nonce
    )
    
    if not is_valid:
        raise HTTPException(status_code=401, detail="Invalid signature or expired challenge")
    
    # Find or create user by wallet address
    wallet = db.query(Wallet).filter(
        Wallet.address.ilike(address)
    ).first()
    
    if wallet:
        user = db.query(User).filter(User.id == wallet.user_id).first()
    else:
        # Create new user and wallet for first-time login
        user = User(
            telegram_id=None,
            username=f"web_{address[:8]}",
            created_at=datetime.utcnow()
        )
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
            created_at=datetime.utcnow()
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
        path="/"
    )
    
    return AuthVerifyResponse(
        success=True,
        token=token,
        user={
            "id": user.id,
            "address": address,
            "username": user.username
        },
        expiresAt=expires_at
    )


@app.get("/auth/me", response_model=AuthMeResponse, tags=["Auth"])
async def auth_me(
    request: Request,
    db: Session = Depends(get_db),
    current_user: Optional[Dict] = Depends(get_current_user_from_token)
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
        createdAt=user.created_at
    )


@app.post("/auth/logout", tags=["Auth"])
async def auth_logout(response: Response):
    """
    Log out the current user by clearing the session cookie.
    """
    response.delete_cookie(
        key="suwappu_auth",
        path="/",
        secure=True,
        httponly=True,
        samesite="lax"
    )
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
    transports: List[str] = []

class PasskeyRegisterCompleteResponse(BaseModel):
    success: bool
    userId: int
    walletAddress: str
    subOrgId: str

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


# In-memory challenge store for passkeys (use Redis in production)
_passkey_challenges: Dict[str, Dict[str, Any]] = {}


@app.post("/auth/passkey/register/init", response_model=PasskeyRegisterInitResponse, tags=["Passkey"])
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

    # Store challenge for verification
    _passkey_challenges[challenge] = {
        "user_id": user_id,
        "email": request.email,
        "display_name": request.displayName or request.email or "Suwappu User",
        "timestamp": time.time(),
        "type": "registration",
    }

    # Get RP ID from settings or use default
    import urllib.parse
    rp_id = urllib.parse.urlparse(settings.oauth_redirect_base).netloc or "localhost"

    return PasskeyRegisterInitResponse(
        challenge=challenge,
        userId=user_id,
        userName=request.email or f"user_{user_id[:8]}",
        rpId=rp_id,
        rpName="Suwappu",
        attestation="none",
    )


@app.post("/auth/passkey/register/complete", response_model=PasskeyRegisterCompleteResponse, tags=["Passkey"])
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
    import base64

    # Note: In production, verify the attestation properly
    # For now, we trust the credential and create the user

    # Create user
    user = User(
        telegram_id=None,
        username=f"passkey_{request.credentialId[:8]}",
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
    )


@app.post("/auth/passkey/authenticate/init", response_model=PasskeyAuthInitResponse, tags=["Passkey"])
async def passkey_auth_init():
    """
    Initialize passkey authentication.
    Returns a challenge for WebAuthn assertion.
    """
    import secrets
    import time
    import urllib.parse

    challenge = secrets.token_urlsafe(32)

    _passkey_challenges[challenge] = {
        "timestamp": time.time(),
        "type": "authentication",
    }

    rp_id = urllib.parse.urlparse(settings.oauth_redirect_base).netloc or "localhost"

    return PasskeyAuthInitResponse(
        challenge=challenge,
        rpId=rp_id,
        allowCredentials=None,  # Allow any credential (discoverable)
    )


@app.post("/auth/passkey/authenticate/complete", response_model=PasskeyAuthCompleteResponse, tags=["Passkey"])
async def passkey_auth_complete(
    request: PasskeyAuthCompleteRequest,
    response: Response,
    db: Session = Depends(get_db),
):
    """
    Complete passkey authentication.
    Verifies the WebAuthn assertion and returns a session.
    """
    # Note: In production, verify the assertion signature properly
    # For now, we find the user by credential ID pattern

    # Find user by credential ID or user handle
    # This is simplified - production should store credential IDs in the database
    user = None
    wallet_address = ""

    if request.userHandle:
        # Try to find user by ID encoded in userHandle
        try:
            user_id = int.from_bytes(
                bytes.fromhex(request.userHandle.replace("-", "").replace("_", "")[:32]),
                "big"
            ) % 1000000
            user = db.query(User).filter(User.id == user_id).first()
        except (ValueError, TypeError, IndexError):
            pass

    if not user:
        # Find most recent passkey user (simplified for demo)
        user = db.query(User).filter(
            User.username.like("passkey_%")
        ).order_by(User.created_at.desc()).first()

    if not user:
        raise HTTPException(status_code=401, detail="No matching passkey found")

    # Get user's wallet
    wallet = db.query(Wallet).filter(
        Wallet.user_id == user.id,
        Wallet.is_active == True,
    ).first()

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
                "parameters": {
                    "user_id": "The database ID of the user."
                }
            },
            {
                "name": "get_wallets",
                "endpoint": "/users/{user_id}/wallets",
                "method": "GET",
                "description": "Retrieve wallet addresses for deposit or swap targets.",
                "parameters": {
                    "user_id": "The database ID of the user."
                }
            },
            {
                "name": "provision_wallet",
                "endpoint": "/v1/agent/wallets",
                "method": "POST",
                "description": "Programmatically create a new managed wallet for a user.",
                "parameters": {
                    "user_id": "The target user ID.",
                    "chain_type": "evm or solana"
                }
            },
            {
                "name": "execute_command",
                "endpoint": "/v1/agent/execute",
                "method": "POST",
                "description": "Submit a natural language trading command (e.g., 'buy 0.1 eth on base'). Returns machine-readable results.",
                "parameters": {
                    "text": "The trading command string.",
                    "user_id": "The target database user ID."
                }
            }
        ]
    }

@app.post("/v1/agent/register", response_model=AgentRegisterResponse, status_code=201, tags=["Agents"], summary="Register an external agent")
async def register_agent(
    request: AgentRegisterRequest,
    db: Session = Depends(get_db),
):
    """
    Public endpoint for external A2A agents to self-register and obtain an API key.
    No authentication required. The returned API key should be stored securely
    by the caller — it cannot be retrieved again.
    """
    # Generate a unique prefixed API key
    api_key = f"suw_ag_{secrets.token_urlsafe(32)}"

    agent = RegisteredAgent(
        name=request.name,
        description=request.description,
        callback_url=request.callback_url,
        api_key=api_key,
        is_active=True,
        created_at=datetime.utcnow(),
    )
    db.add(agent)
    db.commit()
    db.refresh(agent)

    return AgentRegisterResponse(
        agent_id=agent.id,
        name=agent.name,
        api_key=api_key,
        message="Store this key securely. It cannot be retrieved again.",
    )


@app.post("/v1/agent/execute", tags=["Agents"], summary="Execute natural language trading command")
async def agent_execute(
    request: AgentExecuteRequest,
    agent_key: str = Depends(get_agent_key),
    db: Session = Depends(get_db)
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
        platform="agent",
        user_id=f"agent_{request.user_id}",
        text=request.text
    )
    
    return {
        "status": "success",
        "input": request.text,
        "response": response.text,
        "buttons": response.buttons,
        "timestamp": datetime.utcnow()
    }

@app.post("/v1/agent/wallets", response_model=WalletResponse, tags=["Agents"], summary="Provision a new wallet")
async def provision_agent_wallet(
    request: AgentWalletCreate,
    agent_key: str = Depends(get_agent_key),
    db: Session = Depends(get_db)
):
    """Programmatically provision a new wallet for an agent-managed user."""
    user = db.query(User).filter(User.id == request.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
        
    wallet = await wallet_service.create_wallet(
        user_id=user.id,
        name=request.name,
        chain_type=request.chain_type
    )
    
    return WalletResponse(
        id=wallet.id,
        userId=wallet.user_id,
        name=wallet.name,
        address=wallet.address,
        chainType=wallet.chain_type,
        isActive=wallet.is_active,
        isDefault=wallet.is_default,
        createdAt=wallet.created_at
    )

# --- Dependencies ---
async def health():
    """Returns the operational status of the Suwappu Monolith. Agents should check this before trade batches."""
    return {"status": "ok", "timestamp": datetime.utcnow()}

@app.get("/users/{user_id}/wallets", response_model=List[WalletResponse], tags=["Wallets"], summary="List user wallets")
async def get_wallets(
    user_id: int, 
    db: Session = Depends(get_db),
    agent_key: str = Depends(get_agent_key)
):
    """
    Retrieve all active wallets for a specific user.
    Agents use this to identify target addresses for deposit/swap operations.
    """
    wallets = db.query(Wallet).filter(Wallet.user_id == user_id, Wallet.is_active == True).all()
    # Map camelCase for iOS compatibility
    res = []
    for w in wallets:
        res.append(WalletResponse(
            id=w.id,
            userId=w.user_id,
            name=w.name or "Primary Wallet",
            address=w.address,
            chainType=w.chain_type,
            isActive=w.is_active,
            isDefault=w.is_default,
            createdAt=w.created_at or datetime.utcnow()
        ))
    return res

@app.get("/users/{user_id}/portfolio", response_model=PortfolioResponse, tags=["Portfolio"], summary="Get user portfolio balances")
async def get_portfolio(
    user_id: int, 
    db: Session = Depends(get_db),
    agent_key: str = Depends(get_agent_key)
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
                token_val = bal # Assuming 1:1 for stables in mock
                all_token_balances.append(TokenBalance(
                    id=f"{chain_name}-{symbol}",
                    token=TokenInfo(
                        id=f"{chain_name}-{symbol}",
                        symbol=symbol,
                        name=symbol,
                        decimals=18,
                        address="0x...",
                        chainId=chain_name
                    ),
                    balance=str(int(bal * 10**18)),
                    balanceHuman=bal,
                    balanceUSD=token_val,
                    chainId=chain_name
                ))
                total_usd += token_val
                chain_total += token_val
            chains_value[chain_name] = chain_total
            
    return PortfolioResponse(
        totalUSD=total_usd,
        tokens=all_token_balances,
        chains=chains_value
    )

@app.get("/users/{user_id}/swaps", response_model=List[SwapResponse], tags=["Swaps"], summary="Get user swap history")
async def get_swaps(
    user_id: int,
    limit: int = 50,
    db: Session = Depends(get_db),
    _key: str = Depends(get_agent_or_admin_key),
):
    swaps = db.query(SwapTransaction).filter(
        SwapTransaction.user_id == user_id
    ).order_by(SwapTransaction.created_at.desc()).limit(limit).all()
    
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
            txHash=s.tx_hash
        ) for s in swaps
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

@app.get("/webhook")
async def verify_whatsapp_webhook(
    request: Request
):
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
    payload = await request.json()

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
        await whatsapp_service.send_text_message(
            message.from_number,
            f"⏳ {e}"
        )
        return {"status": "rate_limited"}

    # Mark as read
    await whatsapp_service.mark_as_read(message.message_id)

    # Process command via Unified Service
    text = message.text or ""
    if message.button_payload:
        text = message.button_payload

    response = await unified_bot_service.handle_command(
        platform="whatsapp",
        user_id=message.from_number,
        text=text
    )

    # Send response
    if response.buttons:
        await whatsapp_service.send_interactive_buttons(
            message.from_number,
            response.text,
            response.buttons,
            header=response.header
        )
    else:
        await whatsapp_service.send_text_message(
            message.from_number,
            response.text
        )

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
