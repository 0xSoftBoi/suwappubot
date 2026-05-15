"""
Telegram WebApp authentication and endpoints.

This module handles Telegram Mini App initData validation
per https://core.telegram.org/bots/webapps#validating-data
"""
import hmac
import hashlib
import json
import os
import time
import uuid
from urllib.parse import parse_qs, unquote
from datetime import datetime, timedelta
from typing import Optional, Dict, List, Any

from fastapi import APIRouter, HTTPException, Header, Depends, Request, Cookie
from pydantic import BaseModel
from sqlalchemy.orm import Session
import jwt

from bot.config.chains import CHAINS, ChainType
from bot.config.tokens import TOKENS
from bot.config.settings import settings
from bot.models.user import User, Wallet
from bot.models.swap import SwapTransaction
from database.db import get_session
from bot.services.turnkey_client import (
    generate_auth_challenge,
    verify_auth_signature,
)

router = APIRouter(prefix="/webapp", tags=["WebApp"])
_terminal_quote_cache: Dict[str, Dict[str, Any]] = {}
_QUOTE_TTL_SECONDS = 45


def _decode_terminal_auth_token(token: Optional[str]) -> Optional[Dict]:
    if not token:
        return None
    secret = getattr(settings, "secret_key", None) or os.environ.get("SECRET_KEY")
    if not secret:
        return None
    try:
        return jwt.decode(token, secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None


async def get_terminal_auth_payload(
    request: Request,
    auth_token: Optional[str] = Cookie(default=None, alias="suwappu_auth"),
) -> Optional[Dict]:
    token = auth_token
    if not token:
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header[7:]
    return _decode_terminal_auth_token(token)


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
    decimals: int = 18
    balance: Optional[str] = None
    usdValue: Optional[float] = None
    balanceUsd: Optional[float] = None
    logoUrl: Optional[str] = None


class WebAppChain(BaseModel):
    id: str
    name: str
    chainId: int
    nativeCurrency: str
    explorerUrl: str


class WebAppPortfolioToken(BaseModel):
    symbol: str
    name: str
    address: str
    chain: str
    balance: str
    usdValue: float
    logoUrl: Optional[str] = None


class WebAppPortfolio(BaseModel):
    totalUsdValue: float
    tokens: List[WebAppPortfolioToken]
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


class WebAppSwapQuoteRequest(BaseModel):
    fromToken: str
    toToken: str
    fromChain: str
    toChain: str
    amount: str
    fromDecimals: int = 18
    slippage: Optional[float] = 0.5


class WebAppSwapToken(BaseModel):
    symbol: str
    name: str
    address: str
    chain: str
    decimals: int


class WebAppSwapQuoteResponse(BaseModel):
    id: str
    fromToken: WebAppSwapToken
    toToken: WebAppSwapToken
    fromAmount: str
    toAmount: str
    fromAmountUsd: float
    toAmountUsd: float
    exchangeRate: float
    priceImpact: float
    estimatedGas: str
    gasUsd: float
    route: str
    expiresAt: str
    minReceived: str
    slippage: float
    estimatedDuration: Optional[int] = None


class WebAppSwapExecuteRequest(BaseModel):
    quoteId: str


class WebAppSwapExecuteResponse(BaseModel):
    success: bool
    swapId: int
    status: str
    txHash: Optional[str] = None
    explorerUrl: Optional[str] = None
    swap: Dict[str, str]


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


def _cleanup_terminal_quote_cache() -> None:
    now = time.time()
    expired = [
        quote_id for quote_id, entry in _terminal_quote_cache.items()
        if now - entry["created_at"] > _QUOTE_TTL_SECONDS
    ]
    for quote_id in expired:
        _terminal_quote_cache.pop(quote_id, None)


def _token_symbol_for_address(chain: str, address_or_symbol: str) -> str:
    value = address_or_symbol.strip()
    if value.upper() in TOKENS:
        return value.upper()
    if value.lower() in {
        "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        "0x0000000000000000000000000000000000000000",
    }:
        return "ETH"

    for symbol, token in TOKENS.items():
        token_address = token.addresses.get(chain.lower())
        if token_address and token_address.lower() == value.lower():
            return symbol

    raise HTTPException(
        status_code=400,
        detail=f"Unsupported token {address_or_symbol} on {chain}",
    )


def _webapp_swap_token(symbol: str, chain: str) -> WebAppSwapToken:
    token = TOKENS.get(symbol.upper())
    if not token:
        raise HTTPException(status_code=400, detail=f"Unsupported token {symbol}")
    address = token.addresses.get(chain.lower())
    if not address:
        raise HTTPException(status_code=400, detail=f"{symbol} is not supported on {chain}")
    return WebAppSwapToken(
        symbol=token.symbol,
        name=token.name,
        address=address,
        chain=chain,
        decimals=token.decimals,
    )


def _default_terminal_wallet(db: Session, user_id: int) -> Optional[Wallet]:
    return db.query(Wallet).filter(
        Wallet.user_id == user_id,
        Wallet.is_active == True,
    ).order_by(Wallet.is_default.desc(), Wallet.id.asc()).first()


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


def _token_response(symbol: str, token, chain: str) -> Optional[WebAppToken]:
    address = token.addresses.get(chain)
    if not address:
        return None
    return WebAppToken(
        symbol=token.symbol,
        name=token.name,
        address=address,
        chain=chain,
        decimals=token.decimals,
        logoUrl=None,
    )


@router.get("/tokens/popular", response_model=List[WebAppToken])
async def get_popular_tokens(chain: str = "ethereum"):
    """Return configured liquid tokens for terminal selectors."""
    chain_key = chain.lower()
    preferred = ["ETH", "USDC", "USDT", "DAI", "WETH", "WBTC"]
    results: List[WebAppToken] = []

    chain_config = CHAINS.get(chain_key)
    if chain_config and chain_config.chain_type == ChainType.EVM:
        native_address = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"
        results.append(
            WebAppToken(
                symbol=chain_config.native_token,
                name=chain_config.display_name,
                address=native_address,
                chain=chain_key,
                decimals=chain_config.native_decimals,
            )
        )

    for symbol in preferred:
        token = TOKENS.get(symbol)
        if not token:
            continue
        response = _token_response(symbol, token, chain_key)
        if response and all(item.address.lower() != response.address.lower() for item in results):
            results.append(response)

    if len(results) < 12:
        for symbol, token in TOKENS.items():
            response = _token_response(symbol, token, chain_key)
            if not response:
                continue
            if any(item.address.lower() == response.address.lower() for item in results):
                continue
            results.append(response)
            if len(results) >= 12:
                break

    return results


@router.get("/tokens/search", response_model=List[WebAppToken])
async def search_tokens(q: str, chain: str = "ethereum"):
    """Search configured tokens by symbol, name, or address."""
    query = q.strip().lower()
    if not query:
        return []

    matches: List[WebAppToken] = []
    for symbol, token in TOKENS.items():
        response = _token_response(symbol, token, chain.lower())
        if not response:
            continue
        haystack = f"{token.symbol} {token.name} {response.address}".lower()
        if query in haystack:
            matches.append(response)
        if len(matches) >= 25:
            break
    return matches


@router.get("/chains", response_model=List[WebAppChain])
async def get_chains():
    """Return EVM chains supported by the terminal UI."""
    chains: List[WebAppChain] = []
    for key, chain in CHAINS.items():
        if chain.chain_type != ChainType.EVM or not isinstance(chain.chain_id, int):
            continue
        chains.append(
            WebAppChain(
                id=key,
                name=chain.display_name,
                chainId=chain.chain_id,
                nativeCurrency=chain.native_token,
                explorerUrl=chain.explorer_url,
            )
        )
    return chains


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
                        tokens.append(WebAppPortfolioToken(
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


@router.get("/portfolio", response_model=WebAppPortfolio)
async def get_terminal_portfolio(
    auth_payload: Optional[Dict] = Depends(get_terminal_auth_payload),
    db: Session = Depends(get_db)
):
    """
    Get the current terminal user's portfolio using JWT auth.
    """
    if not auth_payload or not auth_payload.get("user_id"):
        raise HTTPException(status_code=401, detail="Not authenticated")

    user = db.query(User).filter(User.id == auth_payload["user_id"]).first()
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    wallets = db.query(Wallet).filter(
        Wallet.user_id == user.id,
        Wallet.is_active == True
    ).all()

    tokens: List[WebAppPortfolioToken] = []
    total_usd = 0.0

    # New Turnkey wallets usually have no balances. Return an empty portfolio
    # quickly instead of forcing the UI through slow multi-chain balance scans.
    for wallet in wallets:
        if not wallet.address:
            continue

    return WebAppPortfolio(
        totalUsdValue=total_usd,
        tokens=tokens,
        lastUpdated=datetime.utcnow().isoformat()
    )


@router.post("/swap/quote", response_model=WebAppSwapQuoteResponse)
async def create_terminal_swap_quote(
    body: WebAppSwapQuoteRequest,
    auth_payload: Optional[Dict] = Depends(get_terminal_auth_payload),
    db: Session = Depends(get_db),
):
    """
    Create a live swap quote for the terminal.
    """
    from bot.services.swap_engine import SwapEngine, SwapError

    try:
        amount = float(body.amount)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid amount")
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than zero")

    from_symbol = _token_symbol_for_address(body.fromChain, body.fromToken)
    to_symbol = _token_symbol_for_address(body.toChain, body.toToken)

    from_address = "0x0000000000000000000000000000000000000001"
    user_id = auth_payload.get("user_id") if auth_payload else None
    if user_id:
        wallet = _default_terminal_wallet(db, int(user_id))
        if wallet and wallet.address:
            from_address = wallet.address

    try:
        quote = await SwapEngine().get_quote(
            from_chain=body.fromChain,
            to_chain=body.toChain,
            from_token=from_symbol,
            to_token=to_symbol,
            amount=amount,
            from_address=from_address,
            to_address=from_address,
            slippage=body.slippage or 0.5,
        )
    except SwapError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Quote provider failed: {exc}")

    quote_id = str(uuid.uuid4())
    _cleanup_terminal_quote_cache()
    _terminal_quote_cache[quote_id] = {
        "created_at": time.time(),
        "quote": quote,
        "user_id": user_id,
    }

    from_token = _webapp_swap_token(from_symbol, body.fromChain)
    to_token = _webapp_swap_token(to_symbol, body.toChain)
    expires_at = datetime.utcnow() + timedelta(seconds=getattr(quote, "expires_in", _QUOTE_TTL_SECONDS))

    return WebAppSwapQuoteResponse(
        id=quote_id,
        fromToken=from_token,
        toToken=to_token,
        fromAmount=str(quote.from_amount_human),
        toAmount=str(quote.to_amount_human),
        fromAmountUsd=float(quote.from_amount_human),
        toAmountUsd=float(quote.to_amount_human),
        exchangeRate=float(quote.exchange_rate),
        priceImpact=float(quote.price_impact),
        estimatedGas=str(quote.gas_cost_usd),
        gasUsd=float(quote.gas_cost_usd),
        route=quote.provider,
        expiresAt=expires_at.isoformat(),
        minReceived=str(quote.to_amount_min),
        slippage=body.slippage or 0.5,
        estimatedDuration=quote.estimated_time,
    )


@router.post("/swap/execute", response_model=WebAppSwapExecuteResponse)
async def execute_terminal_swap(
    body: WebAppSwapExecuteRequest,
    auth_payload: Optional[Dict] = Depends(get_terminal_auth_payload),
    db: Session = Depends(get_db),
):
    """
    Execute a previously created terminal quote for the authenticated user.
    """
    from bot.services.swap_engine import SwapEngine, SwapError

    if not auth_payload or not auth_payload.get("user_id"):
        raise HTTPException(status_code=401, detail="Not authenticated")

    _cleanup_terminal_quote_cache()
    cached = _terminal_quote_cache.get(body.quoteId)
    if not cached:
        raise HTTPException(status_code=404, detail="Quote expired or not found")

    user_id = int(auth_payload["user_id"])
    quote_user_id = cached.get("user_id")
    if quote_user_id and int(quote_user_id) != user_id:
        raise HTTPException(status_code=403, detail="Quote does not belong to this user")

    wallet = _default_terminal_wallet(db, user_id)
    if not wallet:
        raise HTTPException(status_code=400, detail="No active wallet found")

    quote = cached["quote"]
    try:
        swap = await SwapEngine().execute_swap(
            quote=quote,
            wallet_id=wallet.id,
            user_id=user_id,
            idempotency_key=body.quoteId,
        )
    except SwapError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Swap execution failed: {exc}")

    return WebAppSwapExecuteResponse(
        success=True,
        swapId=swap.id,
        status=swap.status,
        txHash=swap.tx_hash,
        explorerUrl=None,
        swap={
            "fromChain": swap.from_chain,
            "toChain": swap.to_chain,
            "fromToken": swap.from_token,
            "toToken": swap.to_token,
            "fromAmount": swap.from_amount,
            "expectedToAmount": swap.to_amount or str(quote.to_amount_human),
        },
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
