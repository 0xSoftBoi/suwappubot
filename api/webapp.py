"""
Telegram WebApp authentication and endpoints.

This module handles Telegram Mini App initData validation
per https://core.telegram.org/bots/webapps#validating-data
"""
import hmac
import hashlib
import json
from urllib.parse import parse_qs, unquote
from datetime import datetime
from typing import Optional, Dict, List

from fastapi import APIRouter, HTTPException, Header, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from bot.config.settings import settings
from bot.models.user import User, Wallet
from bot.models.swap import SwapTransaction
from database.db import get_session
from bot.services.turnkey_client import (
    generate_auth_challenge,
    verify_auth_signature,
)

router = APIRouter(prefix="/webapp", tags=["WebApp"])


# --- Models ---

class TelegramUser(BaseModel):
    id: int
    first_name: str
    last_name: Optional[str] = None
    username: Optional[str] = None
    language_code: Optional[str] = None
    photo_url: Optional[str] = None
    is_premium: Optional[bool] = None


class ValidateResponse(BaseModel):
    valid: bool
    user: Optional[TelegramUser] = None


class WebAppToken(BaseModel):
    symbol: str
    name: str
    address: str
    chain: str
    balance: str
    usdValue: float
    logoUrl: Optional[str] = None


class WebAppPortfolio(BaseModel):
    totalUsdValue: float
    tokens: List[WebAppToken]
    lastUpdated: str


class WebAppSwap(BaseModel):
    id: str
    fromChain: str
    toChain: str
    fromToken: str
    toToken: str
    fromAmount: str
    toAmount: Optional[str] = None
    fromAmountUsd: Optional[float] = None
    toAmountUsd: Optional[float] = None
    status: str
    txHash: Optional[str] = None
    bridgeTxHash: Optional[str] = None
    destinationTxHash: Optional[str] = None
    createdAt: str
    completedAt: Optional[str] = None
    errorMessage: Optional[str] = None


# --- Helpers ---

def validate_telegram_init_data(init_data: str, bot_token: str) -> Optional[Dict]:
    """
    Validate Telegram WebApp initData using HMAC-SHA256.

    See: https://core.telegram.org/bots/webapps#validating-data

    Returns parsed user data if valid, None if invalid.
    """
    if not init_data or not bot_token:
        return None

    try:
        # Parse the init_data query string
        parsed = parse_qs(init_data)

        # Extract and remove hash
        received_hash = parsed.pop('hash', [None])[0]
        if not received_hash:
            return None

        # Build the data check string (sorted alphabetically, newline-separated)
        data_check_string = '\n'.join(
            f'{k}={unquote(v[0])}' for k, v in sorted(parsed.items())
        )

        # Create secret key: HMAC-SHA256(bot_token, "WebAppData")
        secret_key = hmac.new(
            b'WebAppData',
            bot_token.encode('utf-8'),
            hashlib.sha256
        ).digest()

        # Calculate expected hash
        calculated_hash = hmac.new(
            secret_key,
            data_check_string.encode('utf-8'),
            hashlib.sha256
        ).hexdigest()

        # Constant-time comparison
        if not hmac.compare_digest(calculated_hash, received_hash):
            return None

        # Parse user data from initData
        user_data = parsed.get('user', [None])[0]
        if user_data:
            return json.loads(unquote(user_data))

        return {}

    except Exception:
        return None


def get_db():
    """Database session dependency."""
    with get_session() as session:
        yield session


async def get_telegram_user(
    x_telegram_init_data: Optional[str] = Header(None, alias="X-Telegram-Init-Data")
) -> TelegramUser:
    """
    Dependency to extract and validate Telegram user from initData header.
    Raises 401 if invalid.
    """
    if not x_telegram_init_data:
        raise HTTPException(status_code=401, detail="Missing Telegram authentication")

    user_data = validate_telegram_init_data(
        x_telegram_init_data,
        settings.telegram_bot_token
    )

    if not user_data:
        raise HTTPException(status_code=401, detail="Invalid Telegram authentication")

    return TelegramUser(**user_data)


# --- Endpoints ---

@router.post("/validate", response_model=ValidateResponse)
async def validate_webapp(
    x_telegram_init_data: Optional[str] = Header(None, alias="X-Telegram-Init-Data")
):
    """
    Validate Telegram WebApp initData.

    Send the initData string in the X-Telegram-Init-Data header.
    Returns the validated user data if successful.
    """
    if not x_telegram_init_data:
        return ValidateResponse(valid=False)

    user_data = validate_telegram_init_data(
        x_telegram_init_data,
        settings.telegram_bot_token
    )

    if not user_data:
        return ValidateResponse(valid=False)

    return ValidateResponse(
        valid=True,
        user=TelegramUser(**user_data) if user_data else None
    )


@router.get("/users/me/portfolio", response_model=WebAppPortfolio)
async def get_my_portfolio(
    tg_user: TelegramUser = Depends(get_telegram_user),
    db: Session = Depends(get_db)
):
    """
    Get the current user's portfolio based on Telegram authentication.
    """
    from bot.services.wallet import WalletService
    wallet_service = WalletService()

    # Find user by telegram_id
    user = db.query(User).filter(User.telegram_id == tg_user.id).first()
    if not user:
        return WebAppPortfolio(
            totalUsdValue=0.0,
            tokens=[],
            lastUpdated=datetime.utcnow().isoformat()
        )

    # Get all active wallets
    wallets = db.query(Wallet).filter(
        Wallet.user_id == user.id,
        Wallet.is_active == True
    ).all()

    tokens = []
    total_usd = 0.0

    for wallet in wallets:
        try:
            balances = await wallet_service.get_all_balances(wallet)
            for chain_name, chain_tokens in balances.items():
                for symbol, balance in chain_tokens.items():
                    if balance > 0:
                        # Simple USD estimation (would use price service in production)
                        usd_value = balance  # Placeholder
                        tokens.append(WebAppToken(
                            symbol=symbol,
                            name=symbol,
                            address="0x...",
                            chain=chain_name,
                            balance=str(balance),
                            usdValue=usd_value,
                        ))
                        total_usd += usd_value
        except Exception:
            continue

    return WebAppPortfolio(
        totalUsdValue=total_usd,
        tokens=tokens,
        lastUpdated=datetime.utcnow().isoformat()
    )


@router.get("/users/me/swaps", response_model=List[WebAppSwap])
async def get_my_swaps(
    limit: int = 20,
    offset: int = 0,
    tg_user: TelegramUser = Depends(get_telegram_user),
    db: Session = Depends(get_db)
):
    """
    Get the current user's swap history based on Telegram authentication.
    """
    # Find user by telegram_id
    user = db.query(User).filter(User.telegram_id == tg_user.id).first()
    if not user:
        return []

    # Get swaps
    swaps = db.query(SwapTransaction).filter(
        SwapTransaction.user_id == user.id
    ).order_by(
        SwapTransaction.created_at.desc()
    ).offset(offset).limit(limit).all()

    return [
        WebAppSwap(
            id=str(swap.id),
            fromChain=swap.from_chain,
            toChain=swap.to_chain,
            fromToken=swap.from_token,
            toToken=swap.to_token,
            fromAmount=swap.from_amount,
            toAmount=swap.to_amount,
            fromAmountUsd=swap.from_amount_usd,
            toAmountUsd=swap.to_amount_usd,
            status=swap.status,
            txHash=swap.tx_hash,
            bridgeTxHash=swap.bridge_tx_hash,
            destinationTxHash=swap.destination_tx_hash,
            createdAt=swap.created_at.isoformat() if swap.created_at else "",
            completedAt=swap.completed_at.isoformat() if swap.completed_at else None,
            errorMessage=swap.error_message,
        )
        for swap in swaps
    ]


# --- Wallet Management Endpoints ---

class LinkedWallet(BaseModel):
    address: str
    chainType: str
    linkedAt: str
    provider: str
    name: Optional[str] = None


class WalletCreateRequest(BaseModel):
    chainType: str = "evm"
    name: Optional[str] = None


class WalletCreateResponse(BaseModel):
    success: bool
    address: Optional[str] = None
    chain: Optional[str] = None
    message: Optional[str] = None


@router.get("/users/me/wallets", response_model=List[LinkedWallet])
async def get_my_wallets(
    tg_user: TelegramUser = Depends(get_telegram_user),
    db: Session = Depends(get_db)
):
    """
    Get all wallets linked to the current Telegram user.
    """
    # Find user by telegram_id
    user = db.query(User).filter(User.telegram_id == tg_user.id).first()
    if not user:
        return []

    # Get all active wallets
    wallets = db.query(Wallet).filter(
        Wallet.user_id == user.id,
        Wallet.is_active == True
    ).all()

    return [
        LinkedWallet(
            address=wallet.address,
            chainType=wallet.chain_type or "evm",
            linkedAt=wallet.created_at.isoformat() if wallet.created_at else "",
            provider=wallet.wallet_provider or "local",
            name=wallet.name,
        )
        for wallet in wallets
    ]


@router.post("/wallets/default", response_model=WalletCreateResponse)
async def get_or_create_wallet(
    tg_user: TelegramUser = Depends(get_telegram_user),
    db: Session = Depends(get_db)
):
    """
    Get the user's default wallet, or create one if none exists.
    Uses Turnkey for secure wallet creation when available.
    """
    from bot.services.wallet import WalletService
    from bot.services.turnkey_client import is_turnkey_configured, get_turnkey_client

    wallet_service = WalletService()

    # Find or create user
    user = db.query(User).filter(User.telegram_id == tg_user.id).first()
    if not user:
        user = User(
            telegram_id=tg_user.id,
            username=tg_user.username,
            first_name=tg_user.first_name,
            last_name=tg_user.last_name,
            created_at=datetime.utcnow(),
        )
        db.add(user)
        db.commit()
        db.refresh(user)

    # Check if user already has a default wallet
    default_wallet = db.query(Wallet).filter(
        Wallet.user_id == user.id,
        Wallet.is_active == True,
        Wallet.is_default == True
    ).first()

    if default_wallet:
        return WalletCreateResponse(
            success=True,
            address=default_wallet.address,
            chain=default_wallet.chain_type or "ethereum",
        )

    # Create new wallet using Turnkey if configured
    try:
        if is_turnkey_configured():
            turnkey = get_turnkey_client()
            
            # Create sub-organization for user
            sub_org_name = f"tg_user_{user.id}"
            sub_org = await turnkey.create_sub_organization(name=sub_org_name)
            
            # Create EVM wallet
            turnkey_wallet = await turnkey.create_wallet(
                wallet_name="Telegram Wallet",
                chain_type="evm",
                organization_id=sub_org.sub_org_id,
            )
            
            # Store wallet in database
            wallet = Wallet(
                user_id=user.id,
                name="Telegram Wallet",
                address=turnkey_wallet.address,
                chain_type="evm",
                wallet_provider="turnkey",
                turnkey_sub_org_id=sub_org.sub_org_id,
                turnkey_wallet_id=turnkey_wallet.wallet_id,
                turnkey_account_id=turnkey_wallet.account_id,
                is_active=True,
                is_default=True,
                created_at=datetime.utcnow(),
            )
            db.add(wallet)
            db.commit()
            
            return WalletCreateResponse(
                success=True,
                address=turnkey_wallet.address,
                chain="ethereum",
            )
        else:
            # Fallback to local wallet creation
            wallet = await wallet_service.create_wallet(
                user_id=user.id,
                name="Telegram Wallet",
                chain_type="evm",
            )
            return WalletCreateResponse(
                success=True,
                address=wallet.address,
                chain="ethereum",
            )
    except Exception as e:
        return WalletCreateResponse(
            success=False,
            message=str(e),
        )


@router.delete("/wallets/{address}")
async def unlink_wallet(
    address: str,
    tg_user: TelegramUser = Depends(get_telegram_user),
    db: Session = Depends(get_db)
):
    """
    Unlink (deactivate) a wallet from the current Telegram user.
    """
    # Find user by telegram_id
    user = db.query(User).filter(User.telegram_id == tg_user.id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Find the wallet
    wallet = db.query(Wallet).filter(
        Wallet.user_id == user.id,
        Wallet.address.ilike(address),
        Wallet.is_active == True
    ).first()

    if not wallet:
        raise HTTPException(status_code=404, detail="Wallet not found")

    # Deactivate instead of delete
    wallet.is_active = False
    db.commit()

    return {"success": True, "message": "Wallet unlinked successfully"}
