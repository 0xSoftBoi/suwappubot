import sys
import os
import asyncio
from pathlib import Path
from typing import List, Optional, Dict
from datetime import datetime

from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from pydantic import BaseModel, ConfigDict

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
        
        if settings.telegram_bot_token and "123456" not in settings.telegram_bot_token:
            logger.info("✓ Starting Telegram polling background task")
            polling_task = asyncio.create_task(bot_app.updater.start_polling())
        else:
            logger.warning("⚠️ No valid Telegram token provided. Skipping polling.")
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

app = FastAPI(title="Suwappu Monolith API", lifespan=lifespan)

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

# --- Endpoints ---

@app.get("/health")
async def health():
    return {"status": "ok", "timestamp": datetime.utcnow()}

@app.get("/users/{user_id}/wallets", response_model=List[WalletResponse])
async def get_wallets(user_id: int, db: Session = Depends(get_db)):
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

@app.get("/users/{user_id}/portfolio", response_model=PortfolioResponse)
async def get_portfolio(user_id: int, db: Session = Depends(get_db)):
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

@app.get("/users/{user_id}/swaps", response_model=List[SwapResponse])
async def get_swaps(user_id: int, limit: int = 50, db: Session = Depends(get_db)):
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
