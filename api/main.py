import sys
import os
import asyncio
from pathlib import Path
from typing import List, Optional, Dict
from datetime import datetime

from fastapi import FastAPI, Depends, HTTPException, Query, Request, Security
from fastapi.security.api_key import APIKeyHeader, APIKey
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse, JSONResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel, ConfigDict
import secrets
import json

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
from database.db import init_db, engine, get_session
from bot.models.user import User, Wallet
from bot.models.swap import SwapTransaction
from bot.models.advanced import LimitOrder, DCAOrder
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
    init_db(settings.database_url)
    if engine:
        setup_db_monitoring(engine)
    
    # 2. Build Bot Application
    bot_app = (
        Application.builder()
        .token(settings.telegram_bot_token)
        .build()
    )
    add_handlers(bot_app)
    
    # 3. Start Bot Hooks
    polling_task = None
    try:
        await bot_app.initialize()
        await bot_app.start()
        
        if settings.telegram_bot_token and settings.telegram_bot_token != "123456789:ABCDEF":
            logger.info("✓ Starting Telegram polling background task")
            polling_task = asyncio.create_task(bot_app.updater.start_polling(
                allowed_updates=Update.ALL_TYPES
            ))
        else:
            logger.warning("⚠️ Placeholder or missing Telegram token. Skipping polling.")
    except Exception as e:
        logger.error(f"❌ Telegram bot failed to initialize: {e}")
        logger.warning("⚠️ Continuing in HEADLESS MODE (Background services + API only)")

    # 4. Start Background Services
    admin_ids = getattr(settings, 'admin_ids', [])
    await fee_sweeper.start()
    await alert_service.start(bot=bot_app.bot)
    await order_service.start(bot=bot_app.bot)
    await tx_poller.start(bot=bot_app.bot)
    await health_monitor.start(bot=bot_app.bot, admin_ids=admin_ids)
    logger.info("✓ All background services running")

    yield
    
    # --- Shutdown ---
    logger.info("🛑 Shutting down Suwappu Monolith...")
    if polling_task:
        await bot_app.updater.stop()
    
    # Only stop/shutdown if it wasn't a total failure
    # We check if initialize was at least attempted and didn't crash before start
    try:
        await bot_app.stop()
        await bot_app.shutdown()
    except Exception:
        pass
    
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
    """Verify the agent's API key. Fallback to settings.agent_api_key."""
    valid_key = getattr(settings, "agent_api_key", None)
    if not valid_key:
        # In development, allow if no key is set
        return "dev-key"
    
    if api_key == valid_key:
        return api_key
    
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

# --- Dependencies ---

def get_db():
    with get_session() as session:
        yield session

# --- Health Check ---

@app.get("/health", tags=["Health"])
async def health_check():
    """Health check endpoint for Render and monitoring."""
    return {"status": "healthy", "service": "suwappu-api"}

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

@app.get("/tools", tags=["Agents"])
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

@app.post("/v1/agent/execute", tags=["Agents"])
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

@app.post("/v1/agent/wallets", response_model=WalletResponse, tags=["Agents"])
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

@app.get("/users/{user_id}/wallets", response_model=List[WalletResponse], tags=["Wallets"])
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

@app.get("/users/{user_id}/portfolio", response_model=PortfolioResponse, tags=["Portfolio"])
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

@app.get("/users/{user_id}/swaps", response_model=List[SwapResponse], tags=["Swaps"])
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

@app.get("/portfolio", response_model=PortfolioResponse)
async def get_portfolio_default(db: Session = Depends(get_db)):
    # Default to user 1 for now (mobile app poc)
    return await get_portfolio(user_id=1, db=db)

@app.get("/wallets", response_model=List[WalletResponse])
async def get_wallets_default(db: Session = Depends(get_db)):
    # Default to user 1 for now
    return await get_wallets(user_id=1, db=db)

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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
