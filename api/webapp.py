"""
Telegram WebApp authentication and endpoints.

This module handles Telegram Mini App initData validation
per https://core.telegram.org/bots/webapps#validating-data
"""

import hmac
import hashlib
import json
import logging
import re
import time
import uuid
from urllib.parse import parse_qs, unquote
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Optional, Dict, List, Any, Literal

from fastapi import APIRouter, HTTPException, Header, Depends, Request, Cookie, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.orm import Session
import jwt
import httpx

from api.authz import require_proof_of_possession
from bot.config.chains import CHAINS, ChainType
from bot.config.tokens import TOKENS, NATIVE_TOKEN_ADDRESS, get_token_by_symbol, get_token_decimals
from bot.config.settings import settings
from bot.models.user import User, Wallet
from bot.models.swap import SwapTransaction
from bot.models.support import SupportTicket, TicketKind, TicketStatus
from database.db import get_session

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/webapp", tags=["WebApp"])
_terminal_quote_cache: Dict[str, Dict[str, Any]] = {}
_QUOTE_TTL_SECONDS = 45
# user_id -> (expires_at_monotonic, activities list)
_terminal_activity_cache: Dict[int, tuple] = {}
_ACTIVITY_TTL_SECONDS = 30
_MORPHO_API_URL = "https://api.morpho.org/graphql"
_MORPHO_CHAIN_IDS = [1, 8453, 42161, 10]
_MORPHO_CHAIN_NAMES = {
    "Ethereum": "Ethereum",
    "Base": "Base",
    "Arbitrum One": "Arbitrum",
    "Optimism": "Optimism",
}


def _decode_terminal_auth_token(token: Optional[str]) -> Optional[Dict]:
    if not token:
        return None
    # Verify with the exact same secret the tokens were signed with. Importing
    # JWT_SECRET from api.main (single source of truth) avoids the previous
    # divergence where this re-resolved the secret differently and rejected every
    # valid token. Lazy import to avoid a circular import at module load.
    from api.main import JWT_SECRET as secret

    if not secret:
        return None
    try:
        return jwt.decode(token, secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None


def _as_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _normalize_morpho_market(item: Dict[str, Any]) -> Optional["WebAppLendingMarket"]:
    state = item.get("state") or {}
    loan_asset = item.get("loanAsset") or {}
    collateral_asset = item.get("collateralAsset") or {}
    chain = item.get("chain") or {}
    market_id = item.get("marketId") or item.get("uniqueKey")
    loan_symbol = loan_asset.get("symbol")
    collateral_symbol = collateral_asset.get("symbol")

    if not market_id or not loan_symbol or not collateral_symbol:
        return None

    return WebAppLendingMarket(
        id=market_id,
        asset=f"{loan_symbol} / {collateral_symbol}",
        chain=_MORPHO_CHAIN_NAMES.get(chain.get("network"), chain.get("network") or "Ethereum"),
        supplyAPY=_as_float(state.get("supplyApy")),
        borrowAPY=_as_float(state.get("borrowApy")),
        utilization=max(0.0, min(_as_float(state.get("utilization")), 1.0)),
        totalSupplied=max(0.0, _as_float(state.get("supplyAssetsUsd"))),
        totalBorrowed=max(0.0, _as_float(state.get("borrowAssetsUsd"))),
        lltv=_as_float(item.get("lltv")) / 1e18,
    )


async def _fetch_morpho_lending_markets(limit: int = 24) -> List["WebAppLendingMarket"]:
    query = """
    query TerminalMorphoMarkets($first: Int!, $chainIds: [Int!]!) {
      markets(
        first: $first
        orderBy: SupplyAssetsUsd
        orderDirection: Desc
        where: {
          chainId_in: $chainIds
          listed: true
          supplyAssetsUsd_gte: 1000000
          supplyApy_lte: 1
          borrowApy_lte: 1
        }
      ) {
        items {
          marketId
          lltv
          chain { id network }
          loanAsset { symbol decimals }
          collateralAsset { symbol decimals }
          state {
            supplyApy
            borrowApy
            utilization
            supplyAssetsUsd
            borrowAssetsUsd
          }
        }
      }
    }
    """
    async with httpx.AsyncClient(timeout=8.0) as client:
        response = await client.post(
            _MORPHO_API_URL,
            json={"query": query, "variables": {"first": limit, "chainIds": _MORPHO_CHAIN_IDS}},
        )
        response.raise_for_status()
    payload = response.json()
    if payload.get("errors"):
        raise HTTPException(
            status_code=502, detail="Morpho lending market provider returned an error"
        )

    markets: List[WebAppLendingMarket] = []
    for item in ((payload.get("data") or {}).get("markets") or {}).get("items") or []:
        market = _normalize_morpho_market(item)
        if market:
            markets.append(market)
    return markets


async def get_terminal_auth_payload(
    request: Request,
    auth_token: Optional[str] = Cookie(default=None, alias="suwappu_auth"),
) -> Optional[Dict]:
    # Match /auth/me, /terminal/* and api-ts: an explicit bearer token wins
    # over a potentially stale OAuth cookie so every surface acts as one user.
    auth_header = request.headers.get("Authorization")
    token = auth_header[7:] if auth_header and auth_header.startswith("Bearer ") else auth_token
    return _decode_terminal_auth_token(token)


# --- Models ---


class EnterpriseLeadRequest(BaseModel):
    """Inbound enterprise/sales lead from the website "Talk to the team" form.

    Public (no auth) — anyone on the marketing site can submit. Kept minimal and
    qualification-oriented per high-converting B2B form practice (no phone field).
    ``website`` is a hidden honeypot: real users leave it blank; bots fill it.
    """

    name: str
    company: str
    email: str
    country: Optional[str] = None
    monthly_volume: Optional[str] = None
    use_case: Optional[str] = None
    telegram: Optional[str] = None
    website: Optional[str] = None  # honeypot — must stay empty
    attribution: Optional[dict] = None  # optional marketing attribution pass-through


class EnterpriseLeadResponse(BaseModel):
    ok: bool
    id: Optional[int] = None
    error: Optional[str] = None


class MobileWaitlistRequest(BaseModel):
    """Inbound mobile-app (iOS/Android + Suwappu Card by Rain) waitlist signup
    from the marketing site.

    Public (no auth). Kept minimal to maximize conversion. ``website`` is a
    hidden honeypot: real users leave it blank; bots fill it.
    """

    email: str
    name: Optional[str] = None
    platform: Optional[str] = None  # "ios" | "android" | "both"
    telegram: Optional[str] = None
    website: Optional[str] = None  # honeypot — must stay empty
    attribution: Optional[dict] = None  # optional marketing attribution pass-through


class MobileWaitlistResponse(BaseModel):
    ok: bool
    id: Optional[int] = None
    position: Optional[int] = None
    error: Optional[str] = None


class NewsletterSignupRequest(BaseModel):
    """Inbound newsletter/email-list signup from the marketing site.

    Public (no auth). Kept minimal to maximize conversion. ``website`` is a
    hidden honeypot: real users leave it blank; bots fill it.
    """

    email: str
    website: Optional[str] = None  # honeypot — must stay empty
    attribution: Optional[dict] = None  # optional marketing attribution pass-through


class NewsletterSignupResponse(BaseModel):
    ok: bool
    error: Optional[str] = None


class WaitlistAvailabilityResponse(BaseModel):
    ok: bool
    handle: str
    available: bool
    reason: Optional[str] = None  # null | "taken" | "invalid" | "reserved"


class WaitlistReserveRequest(BaseModel):
    """Inbound handle reservation for the waitlist referral leaderboard.

    Public (no auth). ``website`` is the honeypot (same pattern as
    MobileWaitlistRequest). ``ref`` is an optional inviter referral code.
    """

    handle: str
    email: str
    telegram: Optional[str] = None
    ref: Optional[str] = None
    website: Optional[str] = None  # honeypot — must stay empty
    attribution: Optional[dict] = None


class WaitlistReserveResponse(BaseModel):
    ok: bool
    handle: Optional[str] = None
    position: Optional[int] = None
    referral_code: Optional[str] = None
    referral_url: Optional[str] = None
    referral_count: Optional[int] = None
    total_signups: Optional[int] = None
    seed: Optional[int] = None
    already: Optional[bool] = None


class WaitlistStatusResponse(BaseModel):
    ok: bool
    handle: str
    position: int
    referral_count: int
    total_signups: int
    referrals_to_next_rank: int
    seed: int


class WaitlistLeaderboardEntry(BaseModel):
    rank: int
    handle: str
    referral_count: int


class WaitlistLeaderboardResponse(BaseModel):
    ok: bool
    total_signups: int
    entries: List[WaitlistLeaderboardEntry]


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


class WebAppLendingMarket(BaseModel):
    id: str
    asset: str
    chain: str
    supplyAPY: float
    borrowAPY: float
    utilization: float
    totalSupplied: float
    totalBorrowed: float
    lltv: float


class WebAppPortfolioToken(BaseModel):
    symbol: str
    name: str
    address: str
    chain: str
    balance: str
    usdValue: float
    logoUrl: Optional[str] = None
    decimals: Optional[int] = None


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


class WebAppBridgeRoutesRequest(BaseModel):
    fromChain: str
    toChain: str
    token: str
    #: HUMAN units as typed ("250", "0.5") — converted to raw base units
    #: server-side. /bridge/build's `amount` is RAW units echoed from a quote.
    amount: str
    fromAddress: Optional[str] = None
    toAddress: Optional[str] = None
    #: Clamped: an absurd slippage floor is a signed invitation to be sandwiched.
    slippageBps: Optional[int] = Field(50, ge=1, le=500)


class WebAppBridgeRoute(BaseModel):
    """One cross-chain route.

    `settlement` and `trustModel` come straight from BridgeQuote and are the
    reason this is not just a SwapQuote: they describe what happens during the
    window where the funds are on neither chain.
    """

    provider: str
    fromChain: str
    toChain: str
    token: str
    fromAmount: str
    toAmount: str
    toAmountMin: str
    toAmountHuman: float
    gasCostUsd: float
    feeCostUsd: float
    totalCostUsd: float
    estimatedTime: int
    settlement: str
    trustModel: str
    zeroSlippage: bool
    depositAddress: Optional[str] = None


class WebAppBridgeRoutesResponse(BaseModel):
    routes: List[WebAppBridgeRoute]


class WebAppBridgeBuildRequest(BaseModel):
    provider: str
    fromChain: str
    toChain: str
    token: str
    #: RAW base units, echoed from a /bridge/routes quote's fromAmount.
    amount: str
    fromAddress: str
    toAddress: Optional[str] = None
    slippageBps: Optional[int] = Field(50, ge=1, le=500)


class WebAppBridgeTx(BaseModel):
    to: str
    data: str
    value: str
    gas: Optional[int] = None


class WebAppBridgeBuildResponse(BaseModel):
    """Unsigned transaction(s) for an external wallet, plus the transfer to track.

    `transferId` is issued here, before anything is signed, so the client always
    has something to report a broadcast against.
    """

    transferId: int
    chainId: Optional[int] = None
    settlement: str
    trustModel: str
    approval: Optional[WebAppBridgeTx] = None
    tx: Optional[WebAppBridgeTx] = None
    depositAddress: Optional[str] = None


class WebAppBridgeRecordRequest(BaseModel):
    transferId: int
    txHash: str


class WebAppBridgeTransferResponse(BaseModel):
    id: str
    state: str
    provider: str
    fromChain: str
    toChain: str
    token: str
    amountHuman: float
    trustModel: str
    settlement: str
    sourceTxHash: Optional[str] = None
    destinationTxHash: Optional[str] = None
    depositAddress: Optional[str] = None
    startedAt: str
    updatedAt: str
    estimatedTime: int
    statusDetail: Optional[str] = None


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
    fromAmountUsd: Optional[float] = None
    toAmountUsd: Optional[float] = None
    exchangeRate: float
    priceImpact: float
    estimatedGas: str
    gasUsd: float
    route: str
    expiresAt: str
    minReceived: str
    slippage: float
    estimatedDuration: Optional[int] = None
    # Execution-savings receipt: USD edge of the winning route over the
    # race runner-up, estimated at quote time (see swap_engine's
    # _compute_price_improvement_usd). Null when nothing honest to show:
    # single-quote race, or ranking had no trusted USD price.
    priceImprovementUsd: Optional[float] = None
    runnerUpProvider: Optional[str] = None


class WebAppSwapExecuteRequest(BaseModel):
    quoteId: str


class WebAppSwapExecuteResponse(BaseModel):
    success: bool
    swapId: int
    status: str
    txHash: Optional[str] = None
    explorerUrl: Optional[str] = None
    swap: Dict[str, str]


# --- Non-custodial (external wallet) swap models ---


class WebAppSwapBuildRequest(BaseModel):
    fromToken: str
    toToken: str
    fromChain: str
    toChain: str
    amount: str
    slippage: Optional[float] = 0.5
    fromAddress: str  # the connected external wallet (MetaMask / WalletConnect)
    # Solana priority-fee tier (landing speed under congestion). Maps to a
    # Jupiter priorityLevel + lamports cap server-side. EVM swaps ignore it.
    priority: Optional[str] = "normal"
    # Optional live per-CU priority price (micro-lamports), e.g. a Helius network
    # estimate from the client. When set (non-turbo), it sets the exact priority
    # price instead of the tier's priorityLevel cap. EVM swaps ignore it.
    computeUnitPriceMicroLamports: Optional[int] = None


# Solana speed tiers. normal/fast use a Jupiter priority fee (priorityLevel +
# lamports cap). turbo uses a Jito tip → the tx is submitted to the Jito block
# engine for MEV-protected bundle landing. 1_000_000 lamports = 0.001 SOL.
# Tune here without a client deploy.
_SOLANA_PRIORITY_TIERS: Dict[str, dict] = {
    "normal": {"priority_level": "medium", "max_lamports": 1_000_000, "jito_tip_lamports": None},
    "fast": {"priority_level": "high", "max_lamports": 5_000_000, "jito_tip_lamports": None},
    # turbo: MEV-protected Jito bundle, ~0.005 SOL tip.
    "turbo": {
        "priority_level": "veryHigh",
        "max_lamports": 10_000_000,
        "jito_tip_lamports": 5_000_000,
    },
}


class WebAppUnsignedTx(BaseModel):
    to: str
    data: str
    value: str  # hex quantity, e.g. "0x0"
    chainId: int
    gas: Optional[str] = None  # hex quantity; absent => wallet estimates


class WebAppSwapBuildResponse(BaseModel):
    quoteId: str
    chain: str = "evm"  # "evm" | "solana"
    # EVM (MetaMask / WalletConnect): unsigned tx + optional ERC-20 approval.
    chainId: Optional[int] = None
    tx: Optional[WebAppUnsignedTx] = None
    approval: Optional[WebAppUnsignedTx] = None
    spender: Optional[str] = None
    # Solana (Phantom): base64 VersionedTransaction the wallet signs + sends.
    swapTransaction: Optional[str] = None
    # When true (turbo tier), the signed tx must go to /swap/submit-jito for
    # MEV-protected bundle landing rather than being broadcast via a normal RPC.
    jito: bool = False
    fromToken: WebAppSwapToken
    toToken: WebAppSwapToken
    fromAmount: str
    toAmount: str
    minReceived: str
    priceImpact: float
    gasUsd: float
    route: str
    expiresAt: str


class WebAppSwapRecordRequest(BaseModel):
    quoteId: str
    txHash: str


class WebAppSwapRecordResponse(BaseModel):
    success: bool
    swapId: int
    status: str
    txHash: str
    explorerUrl: Optional[str] = None


class WebAppFollowSettings(BaseModel):
    copyMode: Literal["notify", "fixed", "percentage"] = "notify"
    fixedAmount: Optional[float] = Field(default=None, gt=0, le=1_000_000)
    percentageAmount: Optional[float] = Field(default=None, gt=0, le=100)
    maxPerTrade: Optional[float] = Field(default=None, gt=0, le=1_000_000)
    dailyLimit: Optional[float] = Field(default=None, gt=0, le=10_000_000)
    autoSellEnabled: Optional[bool] = None
    stopLossPercent: Optional[float] = None
    takeProfitPercent: Optional[float] = None
    chainFilter: Optional[
        List[
            Literal[
                "ethereum",
                "arbitrum",
                "base",
                "optimism",
                "polygon",
                "bsc",
                "avalanche",
                "solana",
            ]
        ]
    ] = Field(default=None, max_length=8)
    maxSlippage: Optional[float] = Field(default=None, gt=0, le=10)

    @model_validator(mode="after")
    def validate_automatic_copy_settings(self):
        if self.copyMode == "notify":
            return self
        if not self.chainFilter:
            raise ValueError("Automatic copy requires at least one chain")
        if self.copyMode == "fixed" and self.fixedAmount is None:
            raise ValueError("Fixed auto-copy requires a fixed amount")
        if self.copyMode == "percentage" and self.percentageAmount is None:
            raise ValueError("Percentage auto-copy requires a percentage amount")
        return self


class WebAppCreateAlertRequest(BaseModel):
    tokenSymbol: str
    tokenAddress: Optional[str] = None
    chain: Optional[str] = "ethereum"
    alertType: str
    targetValue: float


class WebAppCreateDCARequest(BaseModel):
    fromToken: str
    toToken: str
    totalAmount: float
    frequency: str
    numberOfOrders: int


class WebAppCreateLimitOrderRequest(BaseModel):
    orderType: str
    fromToken: str
    toToken: str
    fromChain: str = "ethereum"
    toChain: str = "ethereum"
    amount: float
    triggerPrice: float
    slippage: float = 0.5
    expiresInHours: Optional[int] = None


class WebAppTrackedWalletRequest(BaseModel):
    address: str
    label: Optional[str] = None
    chain: Optional[str] = None


class WebAppTrackedTwitterAccountRequest(BaseModel):
    handle: str


class WebAppCopilotRequest(BaseModel):
    text: str


class WebAppCopilotResponse(BaseModel):
    type: str
    content: str
    data: Optional[Dict[str, Any]] = None


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
        received_hash = parsed.pop("hash", [None])[0]
        if not received_hash:
            return None

        # Build the data check string (sorted alphabetically, newline-separated)
        data_check_string = "\n".join(f"{k}={unquote(v[0])}" for k, v in sorted(parsed.items()))

        # Create secret key: HMAC-SHA256(bot_token, "WebAppData")
        secret_key = hmac.new(b"WebAppData", bot_token.encode("utf-8"), hashlib.sha256).digest()

        # Calculate expected hash
        calculated_hash = hmac.new(
            secret_key, data_check_string.encode("utf-8"), hashlib.sha256
        ).hexdigest()

        # Constant-time comparison
        if not hmac.compare_digest(calculated_hash, received_hash):
            return None

        # Replay protection: the HMAC alone is valid forever, so captured initData
        # could be replayed indefinitely. Telegram includes auth_date (unix seconds);
        # reject anything older than 24h, or missing/non-numeric.
        auth_date_raw = parsed.get("auth_date", [None])[0]
        if auth_date_raw is None:
            return None
        try:
            auth_date = int(auth_date_raw)
        except (TypeError, ValueError):
            return None
        if time.time() - auth_date > 86400:
            return None

        # Parse user data from initData
        user_data = parsed.get("user", [None])[0]
        if user_data:
            return json.loads(unquote(user_data))

        return {}

    except Exception:
        return None


def _cleanup_terminal_quote_cache() -> None:
    now = time.time()
    expired = [
        quote_id
        for quote_id, entry in _terminal_quote_cache.items()
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


def _extract_copilot_chain(text: str, fallback: str = "ethereum") -> str:
    lowered = text.lower()
    for chain in CHAINS:
        if re.search(rf"\b{re.escape(chain.lower())}\b", lowered):
            return chain.lower()
    for chain_key, chain in CHAINS.items():
        display = chain.display_name.lower()
        if display and re.search(rf"\b{re.escape(display)}\b", lowered):
            return chain_key
    return fallback


def _extract_copilot_symbol(text: str) -> Optional[str]:
    upper_text = text.upper()
    for symbol in sorted(TOKENS.keys(), key=len, reverse=True):
        token = TOKENS[symbol]
        if re.search(rf"\b{re.escape(symbol.upper())}\b", upper_text):
            return symbol
        if re.search(rf"\b{re.escape(token.symbol.upper())}\b", upper_text):
            return symbol
    return None


def _preferred_market_chain(symbol: str, requested_chain: Optional[str] = None) -> str:
    token = TOKENS.get(symbol.upper())
    if not token:
        raise HTTPException(status_code=400, detail=f"Unsupported token {symbol}")
    if requested_chain and requested_chain in token.addresses:
        return requested_chain
    if symbol.upper() == "SOL" and "solana" in token.addresses:
        return "solana"
    if "ethereum" in token.addresses:
        return "ethereum"
    return next(iter(token.addresses.keys()))


def _parse_copilot_swap(text: str) -> WebAppSwapQuoteRequest:
    normalized = text.strip()
    lowered = normalized.lower()
    chain = _extract_copilot_chain(normalized)
    amount_match = re.search(r"(?<![\w.])(\d+(?:\.\d+)?)", normalized)
    amount = amount_match.group(1) if amount_match else "0.01"

    from_symbol: Optional[str] = None
    to_symbol: Optional[str] = None

    swap_match = re.search(
        r"\bswap\s+(?:(\d+(?:\.\d+)?)\s+)?([a-z0-9]+)\s+(?:to|for|into)\s+([a-z0-9]+)",
        lowered,
        flags=re.IGNORECASE,
    )
    buy_match = re.search(
        r"\bbuy\s+(?:(\d+(?:\.\d+)?)\s+)?([a-z0-9]+)\s+(?:of|with|for)\s+([a-z0-9]+)",
        lowered,
        flags=re.IGNORECASE,
    )

    if swap_match:
        amount = swap_match.group(1) or amount
        from_symbol = swap_match.group(2).upper()
        to_symbol = swap_match.group(3).upper()
    elif buy_match:
        amount = buy_match.group(1) or amount
        from_symbol = buy_match.group(2).upper()
        to_symbol = buy_match.group(3).upper()
    else:
        symbols = []
        for match in re.finditer(r"\b[A-Za-z0-9]{2,12}\b", normalized):
            candidate = match.group(0).upper()
            if candidate in TOKENS and candidate not in symbols:
                symbols.append(candidate)
        if len(symbols) >= 2:
            from_symbol, to_symbol = symbols[0], symbols[1]

    if not from_symbol or not to_symbol:
        raise HTTPException(
            status_code=400,
            detail='Tell me the swap as "Swap ETH to USDC" or "Buy 0.1 ETH of PEPE".',
        )

    from_symbol = _token_symbol_for_address(chain, from_symbol)
    to_symbol = _token_symbol_for_address(chain, to_symbol)
    from_token = _webapp_swap_token(from_symbol, chain)
    to_token = _webapp_swap_token(to_symbol, chain)

    return WebAppSwapQuoteRequest(
        fromToken=from_token.address,
        toToken=to_token.address,
        fromChain=chain,
        toChain=chain,
        amount=amount,
        fromDecimals=from_token.decimals,
        slippage=0.5,
    )


async def _fetch_live_token_price(
    symbol: str, requested_chain: Optional[str] = None
) -> WebAppCopilotResponse:
    token = TOKENS.get(symbol.upper())
    if not token:
        raise HTTPException(status_code=400, detail=f"Unsupported token {symbol}")

    chain = _preferred_market_chain(symbol, requested_chain)
    address = token.addresses.get(chain)
    if not address:
        raise HTTPException(status_code=400, detail=f"{token.symbol} is not supported on {chain}")

    url = f"https://api.dexscreener.com/latest/dex/tokens/{address}"
    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            response = await client.get(url)
            response.raise_for_status()
            payload = response.json()
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Price backend failed for {token.symbol}: {exc}",
        )

    pairs = payload.get("pairs") or []
    if not pairs:
        raise HTTPException(
            status_code=404,
            detail=f"Price backend could not find live market data for {token.symbol}.",
        )

    best_pair = max(
        pairs,
        key=lambda pair: float((pair.get("liquidity") or {}).get("usd") or 0),
    )
    price = best_pair.get("priceUsd")
    change_24h = (best_pair.get("priceChange") or {}).get("h24")
    liquidity = (best_pair.get("liquidity") or {}).get("usd")
    chain_label = (best_pair.get("chainId") or chain).title()
    dex_label = best_pair.get("dexId") or "DexScreener"

    if price is None:
        raise HTTPException(
            status_code=404,
            detail=f"Price backend did not return a USD price for {token.symbol}.",
        )

    change_text = ""
    if isinstance(change_24h, (int, float)):
        sign = "+" if change_24h >= 0 else ""
        change_text = f" 24h: {sign}{change_24h:.2f}%."
    liquidity_text = ""
    if isinstance(liquidity, (int, float)):
        liquidity_text = f" Liquidity: ${liquidity:,.0f}."

    return WebAppCopilotResponse(
        type="text",
        content=(
            f"{token.symbol} is ${float(price):,.6g} on {chain_label} via {dex_label}."
            f"{change_text}{liquidity_text}"
        ),
        data={
            "symbol": token.symbol,
            "name": token.name,
            "chain": chain,
            "address": address,
            "priceUsd": float(price),
            "change24h": change_24h,
            "liquidityUsd": liquidity,
            "pairUrl": best_pair.get("url"),
            "source": "dexscreener",
        },
    )


def _default_terminal_wallet(db: Session, user_id: int) -> Optional[Wallet]:
    return (
        db.query(Wallet)
        .filter(
            Wallet.user_id == user_id,
            Wallet.is_active == True,  # noqa: E712
        )
        .order_by(Wallet.is_default.desc(), Wallet.id.asc())
        .first()
    )


def _terminal_chain_type(chain: str) -> str:
    normalized = (chain or "").strip().lower()
    if normalized in {"solana", "tron", "starknet"}:
        return normalized
    return "evm"


def _reject_cross_family_terminal_swap(from_chain: str, to_chain: str) -> None:
    """Fail closed until Terminal can bind an explicit destination wallet.

    The current Terminal swap request only carries a source wallet address. An
    EVM address is not a valid Solana recipient (and vice versa), so reusing the
    source address for a cross-family quote can produce provider calldata for
    the wrong recipient. Same-family cross-chain swaps (for example Base to
    Arbitrum) remain supported.
    """
    if _terminal_chain_type(from_chain) != _terminal_chain_type(to_chain):
        raise HTTPException(
            status_code=409,
            detail=(
                "Cross-family swaps need an explicit destination wallet. "
                "Choose chains using the same wallet family for now."
            ),
        )


def _terminal_wallet_for_chain(db: Session, user_id: int, chain: str) -> Optional[Wallet]:
    """Select the user's active wallet for the quote source chain."""
    return (
        db.query(Wallet)
        .filter(
            Wallet.user_id == user_id,
            Wallet.is_active == True,  # noqa: E712
            Wallet.chain_type == _terminal_chain_type(chain),
        )
        .order_by(Wallet.is_default.desc(), Wallet.id.asc())
        .first()
    )


def _wallet_address_matches(wallet: Wallet, address: str) -> bool:
    if wallet.chain_type == "evm":
        return wallet.address.lower() == address.lower()
    return wallet.address == address


def _require_server_signing_wallet(wallet: Wallet) -> None:
    """Fail closed unless Python actually has a signing capability for this wallet."""
    if wallet.can_server_sign:
        return
    raise HTTPException(
        status_code=409,
        detail="This wallet signs in the browser. Reconnect it and request a fresh quote.",
    )


def _require_session_wallet_address(
    db: Session,
    auth_payload: Optional[Dict],
    address: str,
    chain: str,
) -> Wallet:
    """Bind a client-signing request to the wallet that proved this session."""
    user_id = require_proof_of_possession(auth_payload)
    session_address = str((auth_payload or {}).get("address") or "")
    chain_type = _terminal_chain_type(chain)
    address_matches_session = (
        session_address.lower() == address.lower()
        if chain_type == "evm"
        else session_address == address
    )
    if not session_address or not address_matches_session:
        raise HTTPException(status_code=403, detail="Reconnect the wallet you are trading from")

    wallet_query = db.query(Wallet).filter(
        Wallet.user_id == user_id,
        Wallet.is_active == True,  # noqa: E712
        Wallet.chain_type == chain_type,
    )
    if chain_type == "evm":
        wallet_query = wallet_query.filter(Wallet.address.ilike(address))
    else:
        wallet_query = wallet_query.filter(Wallet.address == address)
    wallet = wallet_query.first()
    if not wallet or not _wallet_address_matches(wallet, address):
        raise HTTPException(status_code=403, detail="Trading wallet is not bound to this session")
    return wallet


def _require_terminal_user(auth_payload: Optional[Dict]) -> int:
    if not auth_payload or not auth_payload.get("user_id"):
        raise HTTPException(status_code=401, detail="Not authenticated")
    return int(auth_payload["user_id"])


_TRACKED_WALLET_RE = re.compile(r"^(0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$")


def _normalize_tracked_wallet_address(address: str) -> str:
    normalized = address.strip()
    if not _TRACKED_WALLET_RE.match(normalized):
        raise HTTPException(status_code=400, detail="Invalid wallet address")
    if normalized.startswith("0x"):
        return normalized.lower()
    return normalized


def _chain_for_tracked_wallet(address: str, chain: Optional[str]) -> str:
    if chain:
        return chain.strip().lower()
    return "ethereum" if address.startswith("0x") else "solana"


def _tracked_wallet_response(wallet) -> Dict[str, Any]:
    return {
        "address": wallet.address,
        "label": wallet.label,
        "chain": wallet.chain,
        "addedAt": _iso_utc(wallet.created_at) if wallet.created_at else "",
    }


_TWITTER_HANDLE_RE = re.compile(r"^[A-Za-z0-9_]{1,15}$")
_TWITTER_AVATAR_COLORS = [
    "#28A0F0",
    "#22C55E",
    "#627EEA",
    "#9945FF",
    "#F0B90B",
    "#6FBCF0",
    "#E84142",
]


def _normalize_twitter_handle(handle: str) -> str:
    normalized = handle.strip().lstrip("@")
    if not _TWITTER_HANDLE_RE.match(normalized):
        raise HTTPException(status_code=400, detail="Invalid Twitter handle")
    return normalized


def _twitter_account_response(account) -> Dict[str, Any]:
    return {
        "handle": account.handle,
        "displayName": account.display_name,
        "avatarColor": account.avatar_color,
        "addedAt": _iso_utc(account.created_at) if account.created_at else "",
    }


def _copy_mode_for_response(follow) -> str:
    if follow.copy_mode == "notify":
        return "notify"
    return follow.copy_type or "fixed"


def _apply_copy_settings(follow, settings: WebAppFollowSettings) -> None:
    if settings.copyMode == "notify":
        follow.copy_mode = "notify"
        follow.copy_type = "fixed"
    elif settings.copyMode == "percentage":
        follow.copy_mode = "auto"
        follow.copy_type = "percentage"
    else:
        follow.copy_mode = "auto"
        follow.copy_type = "fixed"

    if settings.fixedAmount is not None:
        follow.copy_amount_usd = settings.fixedAmount
    if settings.percentageAmount is not None:
        follow.copy_percentage = settings.percentageAmount
    if settings.maxPerTrade is not None:
        follow.max_trade_usd = settings.maxPerTrade
    if settings.dailyLimit is not None:
        follow.daily_limit_usd = settings.dailyLimit
    if settings.maxSlippage is not None:
        follow.max_slippage_percent = settings.maxSlippage
    if settings.chainFilter is not None and hasattr(follow, "chains_filter"):
        follow.chains_filter = ",".join(settings.chainFilter)
    if settings.autoSellEnabled is not None and hasattr(follow, "auto_sell_enabled"):
        follow.auto_sell_enabled = settings.autoSellEnabled


def _copy_settings_response(follow) -> Dict[str, Any]:
    chains_filter = getattr(follow, "chains_filter", None)
    return {
        "copyMode": _copy_mode_for_response(follow),
        "fixedAmount": follow.copy_amount_usd,
        "percentageAmount": follow.copy_percentage,
        "maxPerTrade": follow.max_trade_usd,
        "dailyLimit": follow.daily_limit_usd,
        "autoSellEnabled": getattr(follow, "auto_sell_enabled", True),
        "chainFilter": chains_filter.split(",") if chains_filter else None,
        "maxSlippage": follow.max_slippage_percent,
    }


async def _require_automatic_copy_access(
    db: Session, auth_payload: Optional[Dict], user_id: int
) -> None:
    """Fail closed before persisting settings that can move funds later.

    Notify-only follows are social state and may use any authenticated session.
    Automatic copy is different: it authorizes a future server-side swap without
    another browser signature, so it requires both a possession-backed session,
    a wallet the server can actually sign with, and the existing Pro entitlement.
    """
    proven_user_id = require_proof_of_possession(auth_payload)
    if proven_user_id != user_id:
        raise HTTPException(status_code=403, detail="Copy-trading session mismatch")

    wallet = _default_terminal_wallet(db, user_id)
    if not wallet:
        raise HTTPException(status_code=409, detail="Create a Suwappu signing wallet first")
    try:
        _require_server_signing_wallet(wallet)
    except HTTPException as exc:
        raise HTTPException(
            status_code=409,
            detail=(
                "Automatic copy needs a Suwappu signing wallet. External wallets can "
                "follow signals and review each trade before signing."
            ),
        ) from exc

    from bot.models.subscription import SubscriptionTier
    from bot.services.x402_service import x402_service

    tier = await x402_service.get_tier(user_id)
    if tier not in {
        SubscriptionTier.PRO,
        SubscriptionTier.PREMIUM,
        SubscriptionTier.ENTERPRISE,
    }:
        raise HTTPException(status_code=403, detail="Automatic copy trading requires Pro")


def _trader_address(db: Session, user_id: int) -> str:
    wallet = _default_terminal_wallet(db, user_id)
    if wallet and wallet.address:
        return wallet.address
    return f"user:{user_id}"


def _trader_addresses_by_user(db: Session, user_ids: List[int]) -> Dict[int, str]:
    """Resolve public trader display addresses without an N+1 wallet query."""
    if not user_ids:
        return {}
    wallets = (
        db.query(Wallet)
        .filter(
            Wallet.user_id.in_(set(user_ids)),
            Wallet.is_active == True,  # noqa: E712
        )
        .order_by(Wallet.user_id.asc(), Wallet.is_default.desc(), Wallet.id.asc())
        .all()
    )
    addresses: Dict[int, str] = {}
    for wallet in wallets:
        if wallet.address and wallet.user_id not in addresses:
            addresses[wallet.user_id] = wallet.address
    return {user_id: addresses.get(user_id, f"user:{user_id}") for user_id in user_ids}


def _trader_name(profile, user: Optional[User] = None) -> Optional[str]:
    return profile.display_name or (user.username if user else None)


def _jelly_claims_by_user(db: Session, user_ids: List[int]) -> Dict[int, Any]:
    """Load public Jelly linkage in one query for trader discovery.

    A claim proves control of a Jelly account with a wallet-backed Suwappu
    session; it is not a legal-identity/KYC assertion.  The API therefore calls
    this relationship ``jellyLinked`` and always links back to JellyJelly's
    canonical watch page instead of proxying media.
    """
    if not user_ids:
        return {}
    from bot.models.social import JellyAccountClaim

    claims = db.query(JellyAccountClaim).filter(JellyAccountClaim.user_id.in_(user_ids)).all()
    return {claim.user_id: claim for claim in claims}


def _jelly_claim_response(claim) -> Dict[str, Any]:
    if not claim:
        return {
            "jellyLinked": False,
            "jellyUsername": None,
            "jellyWatchUrl": None,
        }
    return {
        "jellyLinked": True,
        "jellyUsername": claim.jelly_username,
        "jellyWatchUrl": f"https://jellyjelly.com/watch/{claim.claim_jelly_id}",
    }


def _trader_track_record_days_by_user(db: Session, user_ids: List[int]) -> Dict[int, int]:
    """Age of each trader's first observed Suwappu trade, without N+1 queries."""
    if not user_ids:
        return {}
    from sqlalchemy import func

    from bot.models.copy_trading import TraderTrade

    rows = (
        db.query(TraderTrade.trader_id, func.min(TraderTrade.created_at).label("first_trade_at"))
        .filter(TraderTrade.trader_id.in_(set(user_ids)))
        .group_by(TraderTrade.trader_id)
        .all()
    )
    now = datetime.utcnow()
    return {
        row.trader_id: max(0, (now - row.first_trade_at.replace(tzinfo=None)).days)
        for row in rows
        if row.first_trade_at is not None
    }


def _public_trader_trade(trade) -> Dict[str, Any]:
    stablecoins = {"USDC", "USDT", "DAI", "USDS", "USDG"}
    funding_assets = {
        "ETH",
        "WETH",
        "SOL",
        "WSOL",
        "BNB",
        "POL",
        "MATIC",
        "AVAX",
        "TRX",
        "BTC",
        "WBTC",
    }
    from_symbol = trade.from_token.upper()
    to_symbol = trade.to_token.upper()
    # Stable/native assets are common funding legs for on-chain buys. In
    # particular, pump-style Solana trades are SOL -> MEME, not USDC -> MEME;
    # treating every non-stable source as a sell hid the token the trader was
    # actually buying. Prefer stablecoin direction first, then native funding.
    if from_symbol in stablecoins and to_symbol not in stablecoins:
        is_buy = True
    elif to_symbol in stablecoins and from_symbol not in stablecoins:
        is_buy = False
    elif from_symbol in funding_assets and to_symbol not in funding_assets:
        is_buy = True
    else:
        is_buy = False
    token = trade.to_token if is_buy else trade.from_token
    chain = trade.to_chain if is_buy else trade.from_chain
    return {
        "id": str(trade.id),
        "action": "buy" if is_buy else "sell",
        "token": token,
        "tokenPair": f"{trade.from_token}/{trade.to_token}",
        "chain": chain,
        "fromToken": trade.from_token,
        "toToken": trade.to_token,
        "fromChain": trade.from_chain,
        "toChain": trade.to_chain,
        "amountUsd": float(trade.amount_usd or 0),
        "pnlUsd": float(trade.pnl_usd or 0),
        "timestamp": _iso_utc(trade.created_at) if trade.created_at else "",
    }


def _alert_response(alert) -> Dict[str, Any]:
    status = "triggered" if alert.is_triggered else ("active" if alert.is_active else "inactive")
    return {
        "id": str(alert.id),
        "tokenSymbol": alert.token_symbol,
        "chain": alert.chain,
        "alertType": alert.alert_type,
        "targetValue": float(alert.target_price or alert.percent_threshold or 0),
        "currentPrice": alert.triggered_price,
        "status": status,
        "createdAt": _iso_utc(alert.created_at) if alert.created_at else "",
        "triggeredAt": _iso_utc(alert.triggered_at) if alert.triggered_at else None,
    }


_DCA_FREQUENCY_TO_HOURS = {
    "hourly": 1,
    "daily": 24,
    "weekly": 168,
    "monthly": 720,
}


def _dca_frequency_from_hours(hours: Optional[int]) -> str:
    for frequency, interval_hours in _DCA_FREQUENCY_TO_HOURS.items():
        if hours == interval_hours:
            return frequency
    return "daily"


def _float_value(value: Any, default: float = 0.0) -> float:
    if value is None:
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _dca_order_response(order) -> Dict[str, Any]:
    amount_per_order = _float_value(order.amount_per_execution)
    total_amount = _float_value(
        order.max_total_amount, amount_per_order * float(order.max_executions or 0)
    )
    return {
        "id": str(order.id),
        "fromToken": order.from_token,
        "toToken": order.to_token,
        "amountPerOrder": amount_per_order,
        "totalAmount": total_amount,
        "totalInvested": _float_value(order.total_spent),
        "frequency": _dca_frequency_from_hours(order.interval_hours),
        "totalOrders": int(order.max_executions or 0),
        "completedOrders": int(order.executions_completed or 0),
        "status": order.status,
        "nextExecution": _iso_utc(order.next_execution_at) if order.next_execution_at else None,
        "createdAt": _iso_utc(order.created_at) if order.created_at else "",
    }


def _limit_order_response(order) -> Dict[str, Any]:
    return {
        "id": str(order.id),
        "orderType": order.order_type,
        "status": order.status,
        "fromToken": order.from_token,
        "toToken": order.to_token,
        "fromChain": order.from_chain,
        "toChain": order.to_chain,
        "amountRaw": order.amount,
        "triggerPrice": float(order.trigger_price or 0),
        "executionPrice": order.execution_price,
        "slippage": float(order.slippage or 0),
        "expiresAt": _iso_utc(order.expires_at) if order.expires_at else None,
        "executedAt": _iso_utc(order.executed_at) if order.executed_at else None,
        "txHash": order.tx_hash,
        "createdAt": _iso_utc(order.created_at) if order.created_at else "",
    }


def _limit_order_target_symbol(order_type: str, from_token: str, to_token: str) -> str:
    if order_type == "limit_buy":
        return to_token
    return from_token


async def _validate_limit_order_market(
    order_type: str, from_token: str, to_token: str, trigger_price: float
) -> float:
    from bot.services.price_service import price_service

    target_symbol = _limit_order_target_symbol(order_type, from_token, to_token)
    current_price = await price_service.get_price(target_symbol)
    if current_price is None or current_price <= 0:
        raise HTTPException(
            status_code=400, detail=f"Live USD price is not available for {target_symbol}"
        )

    if order_type == "limit_buy" and trigger_price > current_price:
        raise HTTPException(
            status_code=400, detail="Limit buy target must be at or below the current market price"
        )
    if order_type in {"limit_sell", "take_profit"} and trigger_price < current_price:
        raise HTTPException(
            status_code=400, detail="Sell target must be at or above the current market price"
        )
    if order_type == "stop_loss" and trigger_price > current_price:
        raise HTTPException(
            status_code=400, detail="Stop-loss target must be at or below the current market price"
        )

    return float(current_price)


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

    user_data = validate_telegram_init_data(x_telegram_init_data, settings.telegram_bot_token)

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

    user_data = validate_telegram_init_data(x_telegram_init_data, settings.telegram_bot_token)

    if not user_data:
        return ValidateResponse(valid=False)

    return ValidateResponse(valid=True, user=TelegramUser(**user_data) if user_data else None)


@router.post("/enterprise-lead", response_model=EnterpriseLeadResponse)
async def submit_enterprise_lead(payload: EnterpriseLeadRequest):
    """Capture an inbound enterprise/sales lead from the marketing site.

    Public, no auth. Persists the lead as a ``SupportTicket`` of kind
    ``enterprise_lead`` so the existing support_notifier fans it out to admins,
    the support group, and Linear within its poll interval (instant routing =
    the #1 conversion lever). Returns ``{ok: true, id}`` on success.
    """
    # Honeypot: bots fill the hidden "website" field; humans never see it.
    if (payload.website or "").strip():
        # Pretend success so the bot doesn't retry, but persist nothing.
        return EnterpriseLeadResponse(ok=True)

    name = (payload.name or "").strip()
    company = (payload.company or "").strip()
    email = (payload.email or "").strip()

    if not name or not company or not email:
        raise HTTPException(status_code=422, detail="Name, company, and work email are required.")
    # Lightweight email sanity check (full validation happens on follow-up).
    if "@" not in email or "." not in email.split("@")[-1] or len(email) > 254:
        raise HTTPException(status_code=422, detail="Please enter a valid work email.")

    # Trim every free-text field to keep one bad actor from filling the DB.
    def _clip(v: Optional[str], n: int) -> Optional[str]:
        v = (v or "").strip()
        return v[:n] if v else None

    country = _clip(payload.country, 80)
    monthly_volume = _clip(payload.monthly_volume, 80)
    use_case = _clip(payload.use_case, 2000)
    telegram = _clip(payload.telegram, 120)

    # Human-readable body for the Telegram/Linear alert.
    lines = [
        f"Name: {name[:200]}",
        f"Company: {company[:200]}",
        f"Email: {email}",
    ]
    if country:
        lines.append(f"Country: {country}")
    if monthly_volume:
        lines.append(f"Monthly volume: {monthly_volume}")
    if telegram:
        lines.append(f"Telegram: {telegram}")
    if use_case:
        lines.append(f"\nUse case:\n{use_case}")
    message = "\n".join(lines)

    context = {
        "name": name[:200],
        "company": company[:200],
        "email": email,
        "country": country,
        "monthly_volume": monthly_volume,
        "telegram": telegram,
        "use_case": use_case,
    }
    if isinstance(payload.attribution, dict):
        context["attribution"] = payload.attribution

    try:
        with get_session() as session:
            ticket = SupportTicket(
                kind=TicketKind.ENTERPRISE_LEAD,
                source="website",
                category="enterprise",
                priority="high",
                username=None,
                telegram_id=None,
                message=message,
                context_json=json.dumps(context),
                status=TicketStatus.OPEN,
            )
            session.add(ticket)
            session.commit()
            lead_id = ticket.id
    except Exception:  # noqa: BLE001
        logger.exception("Failed to persist enterprise lead")
        raise HTTPException(status_code=500, detail="Could not submit right now. Please try again.")

    logger.info("Enterprise lead #%s captured from %s (%s)", lead_id, company[:80], email)
    return EnterpriseLeadResponse(ok=True, id=lead_id)


@router.post("/mobile-waitlist", response_model=MobileWaitlistResponse)
async def submit_mobile_waitlist(payload: MobileWaitlistRequest):
    """Capture a mobile-app (iOS/Android + Suwappu Card by Rain) waitlist signup
    from the marketing site.

    Public, no auth. Persists the signup as a ``SupportTicket`` of kind
    ``mobile_waitlist`` so the existing support_notifier fans it out to admins,
    the support group, and Linear within its poll interval. Returns
    ``{ok: true, id}`` on success.
    """
    # Honeypot: bots fill the hidden "website" field; humans never see it.
    if (payload.website or "").strip():
        # Pretend success so the bot doesn't retry, but persist nothing.
        return MobileWaitlistResponse(ok=True)

    email = (payload.email or "").strip()
    if not email:
        raise HTTPException(status_code=422, detail="Email is required.")
    # Lightweight email sanity check (full validation happens on follow-up).
    if "@" not in email or "." not in email.split("@")[-1] or len(email) > 254:
        raise HTTPException(status_code=422, detail="Please enter a valid email.")

    def _clip(v: Optional[str], n: int) -> Optional[str]:
        v = (v or "").strip()
        return v[:n] if v else None

    name = _clip(payload.name, 200)
    platform = _clip(payload.platform, 20)
    if platform and platform.lower() not in ("ios", "android", "both"):
        platform = None
    telegram = _clip(payload.telegram, 120)

    # Human-readable body for the Telegram/Linear alert.
    lines = [f"Email: {email}"]
    if name:
        lines.append(f"Name: {name}")
    if platform:
        lines.append(f"Platform: {platform}")
    if telegram:
        lines.append(f"Telegram: {telegram}")
    message = "\n".join(lines)

    context = {
        "email": email,
        "name": name,
        "platform": platform,
        "telegram": telegram,
    }
    if isinstance(payload.attribution, dict):
        context["attribution"] = payload.attribution

    try:
        with get_session() as session:
            ticket = SupportTicket(
                kind=TicketKind.MOBILE_WAITLIST,
                source="website",
                category="mobile_waitlist",
                priority="normal",
                username=None,
                telegram_id=None,
                message=message,
                context_json=json.dumps(context),
                status=TicketStatus.OPEN,
            )
            session.add(ticket)
            session.commit()
            waitlist_id = ticket.id
            position = (
                session.query(SupportTicket)
                .filter(
                    SupportTicket.category == "mobile_waitlist",
                    SupportTicket.id <= waitlist_id,
                )
                .count()
            )
    except Exception:  # noqa: BLE001
        logger.exception("Failed to persist mobile waitlist signup")
        raise HTTPException(status_code=500, detail="Could not submit right now. Please try again.")

    logger.info(
        "Mobile waitlist signup #%s captured (%s), position %s", waitlist_id, email, position
    )

    try:
        from bot.services.waitlist_email import send_waitlist_confirmation

        await send_waitlist_confirmation(email, position, name)
    except Exception:  # noqa: BLE001
        logger.warning("Failed to trigger waitlist confirmation email", exc_info=True)

    return MobileWaitlistResponse(ok=True, id=waitlist_id, position=position)


# ---------------------------------------------------------------------------
# Handle-reservation waitlist + referral leaderboard.
#
# A DIFFERENT feature from /mobile-waitlist above: visitors reserve a handle
# pre-launch, get a referral code, and climb a live-ranked leaderboard by
# inviting friends. Backed by the dedicated `waitlist_signups` table (see
# bot/models/waitlist.py + bot/services/waitlist_service.py), not
# SupportTicket. API contract is fixed — field names/status codes/ranking
# rule must not change without updating the frontend in lockstep.
# ---------------------------------------------------------------------------


async def _waitlist_rate_limit(
    endpoint_func, request: Request, max_requests: int, window_seconds: int
):
    """Per-IP rate limit for a waitlist route. Same UserRateLimiter pattern as
    terminal_token_intel (api/routes/terminal.py) — lazy-inits one limiter
    per endpoint function and keys it by client IP."""
    from bot.utils.rate_limiter import RateLimitExceeded, UserRateLimiter

    limiter = getattr(endpoint_func, "_limiter", None)
    if limiter is None:
        limiter = UserRateLimiter(max_requests=max_requests, window_seconds=window_seconds)
        endpoint_func._limiter = limiter
    client_ip = request.client.host if request.client else "unknown"
    try:
        await limiter.check(client_ip)
    except RateLimitExceeded as e:
        raise HTTPException(
            status_code=429,
            detail="Rate limit exceeded, try again shortly",
            headers={"Retry-After": str(max(1, int(getattr(e, "retry_after", 60))))},
        )


@router.get("/waitlist/availability", response_model=WaitlistAvailabilityResponse)
async def waitlist_availability(request: Request, handle: str = Query(...)):
    """Live handle-availability check for the reservation waitlist's keystroke
    debounce. Public, no auth. Rate-limited per IP (called on every keystroke,
    must respond fast) — see contract at /webapp/waitlist/availability."""
    # 60/min per IP: generous enough for keystroke debounce, still bounds abuse.
    await _waitlist_rate_limit(waitlist_availability, request, 60, 60)

    from bot.models.waitlist import WaitlistSignup
    from bot.services.waitlist_service import normalize_handle, validate_handle_format

    norm = normalize_handle(handle)
    reason = validate_handle_format(norm)
    if reason is not None:
        return WaitlistAvailabilityResponse(ok=True, handle=norm, available=False, reason=reason)

    with get_session() as session:
        taken = (
            session.query(WaitlistSignup.id).filter(WaitlistSignup.handle == norm).first()
            is not None
        )

    if taken:
        return WaitlistAvailabilityResponse(ok=True, handle=norm, available=False, reason="taken")
    return WaitlistAvailabilityResponse(ok=True, handle=norm, available=True, reason=None)


@router.post("/waitlist/reserve", response_model=WaitlistReserveResponse)
async def waitlist_reserve(payload: WaitlistReserveRequest, request: Request):
    """Reserve a handle on the waitlist referral leaderboard.

    Public, no auth. One reservation per email — a repeat submission from
    the same email returns the existing record with ``already: true``
    instead of erroring or creating a second row. ``website`` is the
    honeypot (same pattern as /mobile-waitlist): a non-empty value returns a
    fake success and persists nothing.
    """
    await _waitlist_rate_limit(waitlist_reserve, request, 10, 60)

    if (payload.website or "").strip():
        return WaitlistReserveResponse(ok=True)

    from bot.models.waitlist import WaitlistSignup
    from bot.services.waitlist_service import (
        derive_seed,
        generate_referral_code,
        get_ranked_row,
        get_total_signups,
        hash_ip,
        normalize_handle,
        referral_url as build_referral_url,
        validate_handle_format,
    )

    email = (payload.email or "").strip().lower()
    if not email or "@" not in email or "." not in email.split("@")[-1] or len(email) > 254:
        return JSONResponse(status_code=400, content={"ok": False, "error": "invalid_email"})

    handle = normalize_handle(payload.handle)
    reason = validate_handle_format(handle)
    if reason is not None:
        return JSONResponse(status_code=400, content={"ok": False, "error": "invalid_handle"})

    telegram = (payload.telegram or "").strip()[:64] or None
    attribution_json = (
        json.dumps(payload.attribution) if isinstance(payload.attribution, dict) else None
    )
    client_ip = request.client.host if request.client else None
    ip_hash_val = hash_ip(client_ip)

    try:
        with get_session() as session:
            existing = session.query(WaitlistSignup).filter(WaitlistSignup.email == email).first()
            already = existing is not None

            if not already:
                taken = (
                    session.query(WaitlistSignup.id).filter(WaitlistSignup.handle == handle).first()
                )
                if taken is not None:
                    return JSONResponse(
                        status_code=409, content={"ok": False, "error": "handle_taken"}
                    )

                # Referral credit rules: unknown ref code -> ignore silently;
                # self-referral (same email as the inviter) -> ignore, no credit.
                referred_by_id = None
                ref_code = (payload.ref or "").strip()
                if ref_code:
                    ref_row = (
                        session.query(WaitlistSignup)
                        .filter(WaitlistSignup.referral_code == ref_code)
                        .first()
                    )
                    if ref_row is not None and ref_row.email != email:
                        referred_by_id = ref_row.id

                existing = WaitlistSignup(
                    handle=handle,
                    email=email,
                    telegram=telegram,
                    referral_code=generate_referral_code(session, handle),
                    referred_by_id=referred_by_id,
                    seed=derive_seed(handle),
                    attribution_json=attribution_json,
                    ip_hash=ip_hash_val,
                )
                session.add(existing)
                session.flush()

            signup_id = existing.id
            result_handle = existing.handle
            result_referral_code = existing.referral_code
            result_seed = existing.seed
        # `with` block above has committed (get_session commits on exit).

        with get_session() as session2:
            ranked = get_ranked_row(session2, signup_id)
            total = get_total_signups(session2)
    except Exception:  # noqa: BLE001
        logger.exception("Failed to persist waitlist reservation")
        raise HTTPException(
            status_code=500, detail="Could not reserve right now. Please try again."
        )

    if not already:
        logger.info("Waitlist reservation #%s captured: handle=%s", signup_id, result_handle)
        try:
            from bot.services.waitlist_email import send_waitlist_confirmation

            await send_waitlist_confirmation(email, ranked.position if ranked else 0, None)
        except Exception:  # noqa: BLE001
            logger.warning("Failed to trigger waitlist confirmation email", exc_info=True)

    return WaitlistReserveResponse(
        ok=True,
        handle=result_handle,
        position=ranked.position if ranked else None,
        referral_code=result_referral_code,
        referral_url=build_referral_url(result_referral_code),
        referral_count=ranked.referral_count if ranked else 0,
        total_signups=total,
        seed=result_seed,
        already=already,
    )


@router.get("/waitlist/status", response_model=WaitlistStatusResponse)
async def waitlist_status(request: Request, code: str = Query(...)):
    """Look up a waitlist signup's live rank/referral stats by referral code.

    Public, no auth. Never exposes email/telegram/attribution/ip_hash.
    """
    await _waitlist_rate_limit(waitlist_status, request, 30, 60)

    from bot.models.waitlist import WaitlistSignup
    from bot.services.waitlist_service import (
        get_ranked_row,
        get_row_above,
        get_total_signups,
        referrals_to_next_rank,
    )

    code = (code or "").strip()
    with get_session() as session:
        row = session.query(WaitlistSignup).filter(WaitlistSignup.referral_code == code).first()
        if row is None:
            return JSONResponse(status_code=404, content={"ok": False, "error": "not_found"})

        ranked = get_ranked_row(session, row.id)
        if ranked is None:
            return JSONResponse(status_code=404, content={"ok": False, "error": "not_found"})

        above = get_row_above(session, ranked.position)
        total = get_total_signups(session)
        to_next = referrals_to_next_rank(ranked, above)

    return WaitlistStatusResponse(
        ok=True,
        handle=row.handle,
        position=ranked.position,
        referral_count=ranked.referral_count,
        total_signups=total,
        referrals_to_next_rank=to_next,
        seed=row.seed,
    )


@router.get("/waitlist/leaderboard", response_model=WaitlistLeaderboardResponse)
async def waitlist_leaderboard(request: Request, limit: int = Query(10)):
    """Public referral leaderboard. Only ever exposes rank/handle/referral_count
    — never email, telegram, or attribution."""
    await _waitlist_rate_limit(waitlist_leaderboard, request, 30, 60)

    from bot.services.waitlist_service import get_leaderboard, get_total_signups

    clamped_limit = max(1, min(50, limit))
    with get_session() as session:
        rows = get_leaderboard(session, clamped_limit)
        total = get_total_signups(session)

    entries = [
        WaitlistLeaderboardEntry(rank=r.position, handle=r.handle, referral_count=r.referral_count)
        for r in rows
    ]
    return WaitlistLeaderboardResponse(ok=True, total_signups=total, entries=entries)


@router.post("/newsletter", response_model=NewsletterSignupResponse)
async def submit_newsletter_signup(payload: NewsletterSignupRequest):
    """Capture a newsletter/email-list signup from the marketing site.

    Public, no auth. Persists the signup as a ``SupportTicket`` of kind
    ``newsletter`` so the existing support_notifier fans it out to admins,
    the support group, and Linear within its poll interval. Returns
    ``{ok: true}`` on success (no id/position needed for this surface).
    """
    # Honeypot: bots fill the hidden "website" field; humans never see it.
    if (payload.website or "").strip():
        # Pretend success so the bot doesn't retry, but persist nothing.
        return NewsletterSignupResponse(ok=True)

    email = (payload.email or "").strip()
    if not email:
        raise HTTPException(status_code=422, detail="Email is required.")
    # Lightweight email sanity check (full validation happens on follow-up).
    if "@" not in email or "." not in email.split("@")[-1] or len(email) > 254:
        raise HTTPException(status_code=422, detail="Please enter a valid email.")

    message = f"Email: {email}"

    context = {"email": email}
    if isinstance(payload.attribution, dict):
        context["attribution"] = payload.attribution

    try:
        with get_session() as session:
            ticket = SupportTicket(
                kind=TicketKind.NEWSLETTER,
                source="website",
                category="newsletter",
                priority="low",
                username=None,
                telegram_id=None,
                message=message,
                context_json=json.dumps(context),
                status=TicketStatus.OPEN,
            )
            session.add(ticket)
            session.commit()
            ticket_id = ticket.id
    except Exception:  # noqa: BLE001
        logger.exception("Failed to persist newsletter signup")
        raise HTTPException(status_code=500, detail="Could not submit right now. Please try again.")

    logger.info("Newsletter signup #%s captured (%s)", ticket_id, email)
    return NewsletterSignupResponse(ok=True)


@router.get("/billing/stripe/checkout")
async def webapp_stripe_checkout(
    tier: str = Query(..., description="Subscription tier: pro or premium"),
    user: TelegramUser = Depends(get_telegram_user),
):
    """Create a Stripe card-checkout session for the authenticated webapp user.

    Stripe is owned by api-ts (checkout + webhook). We proxy there server-to-server
    and return the checkout URL so the Mini App can open it via WebApp.openLink.
    """
    from bot.services.api_client import api_client, APIClientError

    if tier not in ("pro", "premium"):
        raise HTTPException(status_code=400, detail="Invalid tier. Must be pro or premium.")

    try:
        session = await api_client.create_stripe_checkout(user.id, tier)
    except APIClientError as e:
        logger.warning("[webapp] Stripe checkout unavailable: %s", e)
        raise HTTPException(status_code=502, detail="Card payments are temporarily unavailable.")

    url = session.get("url")
    if not url:
        raise HTTPException(status_code=502, detail="Card payments are temporarily unavailable.")

    return {"url": url}


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


def _is_native_token_address(address: str) -> bool:
    return address.lower() in {
        "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        "0x0000000000000000000000000000000000000000",
    }


def _native_token_response(chain_key: str) -> Optional[WebAppToken]:
    chain_config = CHAINS.get(chain_key)
    if not chain_config or chain_config.chain_type != ChainType.EVM:
        return None

    token_config = TOKENS.get(chain_config.native_token.upper())
    return WebAppToken(
        symbol=chain_config.native_token,
        name=token_config.name if token_config else chain_config.name.title(),
        address="0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
        chain=chain_key,
        decimals=chain_config.native_decimals,
    )


def _append_unique_token(results: List[WebAppToken], token: WebAppToken) -> None:
    token_key = (
        token.chain,
        token.symbol.upper(),
        "native" if _is_native_token_address(token.address) else token.address.lower(),
    )
    for existing in results:
        existing_key = (
            existing.chain,
            existing.symbol.upper(),
            "native" if _is_native_token_address(existing.address) else existing.address.lower(),
        )
        if existing_key == token_key:
            return
    results.append(token)


_DEX_CHAIN_IDS = {
    "ethereum": "ethereum",
    "base": "base",
    "arbitrum": "arbitrum",
    "solana": "solana",
    "bsc": "bsc",
    "polygon": "polygon",
    "optimism": "optimism",
}

_DEX_SEARCH_QUERY = {
    "ethereum": "ETH USDC",
    "base": "BASE USDC",
    "arbitrum": "ARB USDC",
    "solana": "SOL USDC",
    "bsc": "BNB USDT",
    "polygon": "MATIC USDC",
    "optimism": "OP USDC",
}


def _dex_pair_to_pool(pair: Dict[str, Any]) -> Dict[str, Any]:
    base_token = pair.get("baseToken") or {}
    quote_token = pair.get("quoteToken") or {}
    volume = pair.get("volume") or {}
    liquidity = pair.get("liquidity") or {}
    price_change = pair.get("priceChange") or {}
    created_at = pair.get("pairCreatedAt")
    return {
        "name": pair.get("pairAddress")
        or f"{base_token.get('symbol', 'UNKNOWN')}/{quote_token.get('symbol', 'UNKNOWN')}",
        "address": pair.get("pairAddress") or "",
        "createdAt": _iso_utc(datetime.utcfromtimestamp(created_at / 1000)) if created_at else "",
        "baseToken": {
            "symbol": base_token.get("symbol") or "UNKNOWN",
            "address": base_token.get("address") or "",
        },
        "quoteToken": {
            "symbol": quote_token.get("symbol") or "UNKNOWN",
            "address": quote_token.get("address") or "",
        },
        "priceUsd": pair.get("priceUsd"),
        "fdvUsd": str(pair.get("fdv")) if pair.get("fdv") is not None else None,
        "volumeH24": str(volume.get("h24")) if volume.get("h24") is not None else None,
        "reserveUsd": str(liquidity.get("usd")) if liquidity.get("usd") is not None else None,
        "priceChangeH1": price_change.get("h1"),
        "priceChangeH24": price_change.get("h24"),
    }


# GeckoTerminal network ids for the discovery feeds. The previous source was a
# DexScreener *text search* ("ETH USDC") filtered by chain, which for Ethereum
# returned a single years-old pool named by its address — the New Pairs and
# Trending tabs looked broken. GeckoTerminal has real per-network
# new_pools / trending_pools feeds; DexScreener stays as the fallback.
_GECKO_DISCOVERY_NETWORK = {
    "ethereum": "eth",
    "eth": "eth",
    "base": "base",
    "arbitrum": "arbitrum",
    "solana": "solana",
    "bsc": "bsc",
    "polygon": "polygon_pos",
    "optimism": "optimism",
    "avalanche": "avax",
}


def _gecko_pool_to_pool(
    pool: Dict[str, Any], included: Dict[str, Dict[str, Any]]
) -> Dict[str, Any]:
    attrs = pool.get("attributes") or {}
    rel = pool.get("relationships") or {}

    def token(kind: str) -> Dict[str, str]:
        ref = ((rel.get(kind) or {}).get("data") or {}).get("id") or ""
        inc = included.get(ref) or {}
        address = inc.get("address") or (ref.split("_", 1)[1] if "_" in ref else "")
        return {"symbol": inc.get("symbol") or "UNKNOWN", "address": address}

    volume = attrs.get("volume_usd") or {}
    change = attrs.get("price_change_percentage") or {}

    def num(value: Any) -> Optional[float]:
        try:
            return float(value) if value is not None else None
        except (TypeError, ValueError):
            return None

    return {
        "name": attrs.get("name") or "",
        "address": attrs.get("address") or "",
        "createdAt": attrs.get("pool_created_at") or "",
        "baseToken": token("base_token"),
        "quoteToken": token("quote_token"),
        "priceUsd": attrs.get("base_token_price_usd"),
        "fdvUsd": attrs.get("fdv_usd"),
        "volumeH24": volume.get("h24"),
        "reserveUsd": attrs.get("reserve_in_usd"),
        "priceChangeH1": num(change.get("h1")),
        "priceChangeH24": num(change.get("h24")),
    }


async def _fetch_gecko_pools(network: str, limit: int, mode: str) -> List[Dict[str, Any]]:
    feed = "new_pools" if mode == "new" else "trending_pools"
    async with httpx.AsyncClient(timeout=8.0) as client:
        response = await client.get(
            f"https://api.geckoterminal.com/api/v2/networks/{network}/{feed}",
            params={"include": "base_token,quote_token", "page": 1},
            headers={"Accept": "application/json"},
        )
        response.raise_for_status()
        payload = response.json()
    included = {
        item.get("id"): (item.get("attributes") or {})
        for item in payload.get("included") or []
        if item.get("type") == "token"
    }
    pools = [_gecko_pool_to_pool(pool, included) for pool in payload.get("data") or []]
    return pools[:limit]


async def _fetch_dexscreener_pools(chain_key: str, limit: int, mode: str) -> List[Dict[str, Any]]:
    dex_chain_id = _DEX_CHAIN_IDS.get(chain_key, chain_key)
    query = _DEX_SEARCH_QUERY.get(chain_key, chain_key)
    async with httpx.AsyncClient(timeout=8.0) as client:
        response = await client.get(
            "https://api.dexscreener.com/latest/dex/search", params={"q": query}
        )
        response.raise_for_status()
        payload = response.json()

    pairs = [
        pair
        for pair in payload.get("pairs", [])
        if str(pair.get("chainId", "")).lower() == dex_chain_id
    ]
    if mode == "new":
        pairs.sort(key=lambda pair: pair.get("pairCreatedAt") or 0, reverse=True)
    else:
        pairs.sort(
            key=lambda pair: float(((pair.get("volume") or {}).get("h24")) or 0),
            reverse=True,
        )
    return [_dex_pair_to_pool(pair) for pair in pairs[:limit]]


async def _fetch_dex_pools(chain: str, limit: int, mode: str) -> List[Dict[str, Any]]:
    chain_key = chain.lower()
    network = _GECKO_DISCOVERY_NETWORK.get(chain_key)
    if network:
        try:
            pools = await _fetch_gecko_pools(network, limit, mode)
            if pools:
                return pools
        except Exception as exc:
            logger.debug(f"GeckoTerminal {mode} pools unavailable for {chain_key}: {exc}")
    try:
        return await _fetch_dexscreener_pools(chain_key, limit, mode)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Discovery provider failed: {exc}")


@router.get("/tokens/popular", response_model=List[WebAppToken])
async def get_popular_tokens(chain: str = "ethereum"):
    """Return configured liquid tokens for terminal selectors."""
    chain_key = chain.lower()
    preferred = ["ETH", "USDC", "USDT", "DAI", "WETH", "WBTC"]
    results: List[WebAppToken] = []

    native_token = _native_token_response(chain_key)
    if native_token:
        results.append(native_token)

    for symbol in preferred:
        token = TOKENS.get(symbol)
        if not token:
            continue
        response = _token_response(symbol, token, chain_key)
        if response:
            _append_unique_token(results, response)

    if len(results) < 12:
        for symbol, token in TOKENS.items():
            response = _token_response(symbol, token, chain_key)
            if not response:
                continue
            _append_unique_token(results, response)
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
    native_token = _native_token_response(chain.lower())
    if native_token:
        native_haystack = (
            f"{native_token.symbol} {native_token.name} {native_token.address}".lower()
        )
        if query in native_haystack:
            matches.append(native_token)

    for symbol, token in TOKENS.items():
        response = _token_response(symbol, token, chain.lower())
        if not response:
            continue
        haystack = f"{token.symbol} {token.name} {response.address}".lower()
        if query in haystack:
            _append_unique_token(matches, response)
        if len(matches) >= 25:
            break
    return matches


@router.get("/discovery/new")
async def get_terminal_new_pools(
    chain: str = "ethereum", limit: int = Query(default=20, ge=1, le=50)
):
    return await _fetch_dex_pools(chain, limit, "new")


@router.get("/discovery/trending")
async def get_terminal_trending_pools(
    chain: str = "ethereum", limit: int = Query(default=20, ge=1, le=50)
):
    return await _fetch_dex_pools(chain, limit, "trending")


# ── Solana data proxy ─────────────────────────────────────────────────────────
# Keeps the Helius key SERVER-SIDE (never shipped to the client bundle). Only a
# fixed set of read-only methods may be proxied — this is NOT an open RPC
# passthrough — and responses are briefly cached so repeated mints/addresses
# don't burn Helius credits.

_HELIUS_RPC_METHODS = {
    "getTokenSupply",
    "getTokenLargestAccounts",
    "getAccountInfo",
    "getTokenAccounts",
    "getAssetsByOwner",
    "getPriorityFeeEstimate",
}
_SOLANA_ADDR_RE = re.compile(r"^[1-9A-HJ-NP-Za-km-z]{32,44}$")
_helius_cache: Dict[str, tuple] = {}  # cache_key -> (expires_at, payload)
_HELIUS_CACHE_TTL = 30.0


class SolanaRpcRequest(BaseModel):
    method: str
    params: Any = None


@router.post("/solana/rpc")
async def solana_rpc_proxy(body: SolanaRpcRequest):
    """Method-allowlisted Solana RPC/DAS proxy — the Helius key stays server-side."""
    if not settings.helius_api_key:
        raise HTTPException(status_code=503, detail="Solana data provider is not configured.")
    if body.method not in _HELIUS_RPC_METHODS:
        raise HTTPException(status_code=400, detail=f"Method not allowed: {body.method}")

    cache_key = body.method + ":" + json.dumps(body.params, sort_keys=True, default=str)
    now = time.time()
    cached = _helius_cache.get(cache_key)
    if cached and cached[0] > now:
        return cached[1]

    url = f"https://mainnet.helius-rpc.com/?api-key={settings.helius_api_key}"
    payload = {"jsonrpc": "2.0", "id": 1, "method": body.method, "params": body.params}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(url, json=payload)
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Solana data provider failed: {exc}")

    if len(_helius_cache) > 500:
        _helius_cache.clear()
    _helius_cache[cache_key] = (now + _HELIUS_CACHE_TTL, data)
    return data


@router.get("/solana/tx-history")
async def solana_tx_history(address: str, limit: int = Query(default=15, ge=1, le=50)):
    """Proxy the Helius Enhanced Transactions API (parsed activity) for an address."""
    if not settings.helius_api_key:
        raise HTTPException(status_code=503, detail="Solana data provider is not configured.")
    if not _SOLANA_ADDR_RE.match(address):
        raise HTTPException(status_code=400, detail="Invalid Solana address.")
    url = f"https://api.helius.xyz/v0/addresses/{address}/transactions"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                url, params={"api-key": settings.helius_api_key, "limit": limit}
            )
            resp.raise_for_status()
            return resp.json()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Solana data provider failed: {exc}")


def _windowed_trader_pnl(db, trader_user_ids):
    """Real realized 7d/30d PnL per trader, summed from TraderTrade.pnl_usd (now
    populated by the copy-trade settlement pipeline). One grouped query, no N+1."""
    from bot.models.copy_trading import TraderTrade
    from sqlalchemy import func, case

    if not trader_user_ids:
        return {}
    now = datetime.utcnow()
    d7, d30 = now - timedelta(days=7), now - timedelta(days=30)
    rows = (
        db.query(
            TraderTrade.trader_id,
            func.sum(case((TraderTrade.created_at >= d7, TraderTrade.pnl_usd), else_=0.0)).label(
                "p7"
            ),
            func.sum(case((TraderTrade.created_at >= d30, TraderTrade.pnl_usd), else_=0.0)).label(
                "p30"
            ),
        )
        .filter(
            TraderTrade.trader_id.in_(trader_user_ids),
            TraderTrade.created_at >= d30,
        )
        .group_by(TraderTrade.trader_id)
        .all()
    )
    return {r.trader_id: (float(r.p7 or 0), float(r.p30 or 0)) for r in rows}


@router.get("/copy-trading/top-traders")
async def get_terminal_top_traders(
    timeframe: Optional[str] = None,
    q: Optional[str] = Query(default=None, max_length=80),
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """Return opted-in trader profiles for public Terminal discovery.

    This is intentionally read-only and does not require a session.  Following,
    copy settings, and copy history remain behind authenticated routes below.
    """
    from sqlalchemy import func, or_

    from bot.models.copy_trading import TraderProfile, TraderTrade
    from bot.models.social import JellyAccountClaim

    # Rank the full public population in SQL. Re-ranking an all-time top-N pool
    # would permanently hide a breakout 7d/30d trader who sat outside that
    # cohort before the selected window.
    profile_query = (
        db.query(TraderProfile, User)
        .join(User, TraderProfile.user_id == User.id)
        .filter(
            TraderProfile.is_public == True,  # noqa: E712
        )
    )
    search_term = (q or "").strip()
    if search_term:
        pattern = f"%{search_term}%"
        matching_jelly_users = (
            db.query(JellyAccountClaim.user_id)
            .filter(JellyAccountClaim.jelly_username.ilike(pattern))
            .scalar_subquery()
        )
        matching_wallet_users = (
            db.query(Wallet.user_id)
            .filter(
                Wallet.is_active == True,  # noqa: E712
                Wallet.is_default == True,  # noqa: E712
                Wallet.address.ilike(pattern),
            )
            .scalar_subquery()
        )
        profile_query = profile_query.filter(
            or_(
                TraderProfile.display_name.ilike(pattern),
                User.username.ilike(pattern),
                TraderProfile.user_id.in_(matching_jelly_users),
                TraderProfile.user_id.in_(matching_wallet_users),
            )
        )

    tf = (timeframe or "").lower()
    if tf in ("7d", "30d"):
        window_start = datetime.utcnow() - timedelta(days=7 if tf == "7d" else 30)
        window_pnl = (
            db.query(
                TraderTrade.trader_id.label("trader_id"),
                func.sum(TraderTrade.pnl_usd).label("window_pnl"),
            )
            .filter(TraderTrade.created_at >= window_start)
            .group_by(TraderTrade.trader_id)
            .subquery()
        )
        profile_query = profile_query.outerjoin(
            window_pnl, window_pnl.c.trader_id == TraderProfile.user_id
        ).order_by(
            func.coalesce(window_pnl.c.window_pnl, 0.0).desc(),
            TraderProfile.rank_score.desc(),
            TraderProfile.total_pnl_usd.desc(),
            TraderProfile.total_trades.desc(),
        )
    else:
        profile_query = profile_query.order_by(
            TraderProfile.rank_score.desc(),
            TraderProfile.total_pnl_usd.desc(),
            TraderProfile.total_trades.desc(),
        )

    profiles = profile_query.limit(limit).all()

    pnl_windows = _windowed_trader_pnl(db, [p.user_id for p, _u in profiles])
    jelly_claims = _jelly_claims_by_user(db, [p.user_id for p, _u in profiles])
    trader_addresses = _trader_addresses_by_user(db, [p.user_id for p, _u in profiles])
    track_record_days = _trader_track_record_days_by_user(db, [p.user_id for p, _u in profiles])

    return [
        {
            "id": str(profile.id),
            "address": trader_addresses[profile.user_id],
            "name": _trader_name(profile, user),
            "pnl7d": pnl_windows.get(profile.user_id, (0.0, 0.0))[0],
            "pnl30d": pnl_windows.get(profile.user_id, (0.0, 0.0))[1],
            "winRate": float(profile.win_rate or 0),
            "followers": int(profile.follower_count or 0),
            "copiers": int(profile.times_copied or 0),
            "totalTrades": int(profile.total_trades or 0),
            "trackRecordDays": track_record_days.get(profile.user_id, 0),
            **_jelly_claim_response(jelly_claims.get(profile.user_id)),
        }
        for profile, user in profiles
    ]


@router.get("/copy-trading/traders/{trader_id}")
async def get_terminal_trader_profile(
    trader_id: int,
    auth_payload: Optional[Dict] = Depends(get_terminal_auth_payload),
    db: Session = Depends(get_db),
):
    from bot.models.copy_trading import CopyFollow, TraderProfile, TraderTrade

    profile = (
        db.query(TraderProfile)
        .filter(
            TraderProfile.id == trader_id,
            TraderProfile.is_public == True,  # noqa: E712
        )
        .first()
    )
    if not profile:
        raise HTTPException(status_code=404, detail="Trader not found")

    viewer_user_id = (
        int(auth_payload["user_id"]) if auth_payload and auth_payload.get("user_id") else None
    )
    follow = None
    if viewer_user_id is not None:
        follow = (
            db.query(CopyFollow)
            .filter(
                CopyFollow.follower_id == viewer_user_id,
                CopyFollow.trader_id == profile.user_id,
                CopyFollow.is_active == True,  # noqa: E712
            )
            .first()
        )

    user = db.query(User).filter(User.id == profile.user_id).first()
    jelly_claim = _jelly_claims_by_user(db, [profile.user_id]).get(profile.user_id)
    recent_trades = (
        db.query(TraderTrade)
        .filter(TraderTrade.trader_id == profile.user_id)
        .order_by(TraderTrade.created_at.desc())
        .limit(12)
        .all()
    )
    track_record_days = _trader_track_record_days_by_user(db, [profile.user_id]).get(
        profile.user_id, 0
    )

    _pw = _windowed_trader_pnl(db, [profile.user_id]).get(profile.user_id, (0.0, 0.0))
    return {
        "id": str(profile.id),
        "address": _trader_address(db, profile.user_id),
        "name": _trader_name(profile, user),
        "bio": profile.bio,
        "pnl7d": _pw[0],
        "pnl30d": _pw[1],
        "winRate": float(profile.win_rate or 0),
        "followers": int(profile.follower_count or 0),
        "totalTrades": int(profile.total_trades or 0),
        "bestTrade": float(profile.best_trade_pnl_usd or 0),
        "worstTrade": float(profile.worst_trade_pnl_usd or 0),
        "avgTradeSize": float(profile.avg_trade_size_usd or 0),
        "isFollowing": bool(follow),
        "trackRecordDays": track_record_days,
        "recentTrades": [_public_trader_trade(trade) for trade in recent_trades],
        **_jelly_claim_response(jelly_claim),
    }


@router.get("/copy-trading/feed")
async def get_terminal_trader_feed(
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """Recent real trades from opted-in public trader profiles.

    This is the social discovery tape: public/read-only like the leaderboard,
    sourced only from Suwappu-recorded trades. It contains no copier state and
    cannot authorize an execution.
    """
    from bot.models.copy_trading import TraderProfile, TraderTrade

    rows = (
        db.query(TraderTrade, TraderProfile, User)
        .join(TraderProfile, TraderTrade.trader_id == TraderProfile.user_id)
        .join(User, TraderTrade.trader_id == User.id)
        .filter(TraderProfile.is_public == True)  # noqa: E712
        .order_by(TraderTrade.created_at.desc())
        .limit(limit)
        .all()
    )
    trader_user_ids = [profile.user_id for _trade, profile, _user in rows]
    jelly_claims = _jelly_claims_by_user(db, trader_user_ids)
    trader_addresses = _trader_addresses_by_user(db, trader_user_ids)

    return [
        {
            **_public_trader_trade(trade),
            "traderId": str(profile.id),
            "traderName": _trader_name(profile, user),
            "traderAddress": trader_addresses[profile.user_id],
            "winRate": float(profile.win_rate or 0),
            **_jelly_claim_response(jelly_claims.get(profile.user_id)),
        }
        for trade, profile, user in rows
    ]


@router.post("/copy-trading/follow/{trader_id}")
async def follow_terminal_trader(
    trader_id: int,
    settings: WebAppFollowSettings,
    auth_payload: Optional[Dict] = Depends(get_terminal_auth_payload),
    db: Session = Depends(get_db),
):
    user_id = _require_terminal_user(auth_payload)
    from bot.models.copy_trading import CopyFollow, TraderProfile

    profile = (
        db.query(TraderProfile)
        .filter(
            TraderProfile.id == trader_id,
            TraderProfile.is_public == True,  # noqa: E712
        )
        .first()
    )
    if not profile:
        raise HTTPException(status_code=404, detail="Trader not found")
    if profile.user_id == user_id:
        raise HTTPException(status_code=400, detail="You cannot follow yourself")
    if settings.copyMode != "notify":
        await _require_automatic_copy_access(db, auth_payload, user_id)

    follow = (
        db.query(CopyFollow)
        .filter(
            CopyFollow.follower_id == user_id,
            CopyFollow.trader_id == profile.user_id,
        )
        .first()
    )
    if follow and follow.is_active:
        raise HTTPException(status_code=409, detail="Already following this trader")
    if not follow:
        follow = CopyFollow(follower_id=user_id, trader_id=profile.user_id)
        db.add(follow)

    follow.is_active = True
    _apply_copy_settings(follow, settings)
    profile.follower_count = int(profile.follower_count or 0) + 1
    db.commit()
    return {"success": True}


@router.post("/copy-trading/unfollow/{trader_id}")
async def unfollow_terminal_trader(
    trader_id: int,
    auth_payload: Optional[Dict] = Depends(get_terminal_auth_payload),
    db: Session = Depends(get_db),
):
    user_id = _require_terminal_user(auth_payload)
    from bot.models.copy_trading import CopyFollow, TraderProfile

    profile = db.query(TraderProfile).filter(TraderProfile.id == trader_id).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Trader not found")

    follow = (
        db.query(CopyFollow)
        .filter(
            CopyFollow.follower_id == user_id,
            CopyFollow.trader_id == profile.user_id,
            CopyFollow.is_active == True,  # noqa: E712
        )
        .first()
    )
    if not follow:
        raise HTTPException(status_code=404, detail="Not following this trader")

    follow.is_active = False
    profile.follower_count = max(0, int(profile.follower_count or 0) - 1)
    db.commit()
    return {"success": True}


@router.get("/copy-trading/following")
async def get_terminal_following(
    auth_payload: Optional[Dict] = Depends(get_terminal_auth_payload),
    db: Session = Depends(get_db),
):
    user_id = _require_terminal_user(auth_payload)
    from bot.models.copy_trading import CopyFollow, TraderProfile

    rows = (
        db.query(CopyFollow, TraderProfile)
        .join(
            TraderProfile,
            CopyFollow.trader_id == TraderProfile.user_id,
        )
        .filter(
            CopyFollow.follower_id == user_id,
            CopyFollow.is_active == True,  # noqa: E712
        )
        .all()
    )

    return [
        {
            "traderId": str(profile.id),
            "address": _trader_address(db, profile.user_id),
            "name": _trader_name(profile),
            "copyMode": _copy_mode_for_response(follow),
            "dailyPnl": 0,
            "totalPnl": float(follow.total_copy_pnl or 0),
            "settings": _copy_settings_response(follow),
        }
        for follow, profile in rows
    ]


@router.get("/copy-trading/trades")
async def get_terminal_copy_trades(
    limit: int = Query(default=50, ge=1, le=200),
    auth_payload: Optional[Dict] = Depends(get_terminal_auth_payload),
    db: Session = Depends(get_db),
):
    user_id = _require_terminal_user(auth_payload)
    from bot.models.copy_trading import CopyTrade

    trades = (
        db.query(CopyTrade)
        .filter(
            CopyTrade.copier_id == user_id,
        )
        .order_by(CopyTrade.created_at.desc())
        .limit(limit)
        .all()
    )

    return [
        {
            "id": str(trade.id),
            "traderAddress": _trader_address(db, trade.trader_id),
            "action": "buy" if trade.from_token.upper() in {"USDC", "USDT", "DAI"} else "sell",
            "tokenPair": f"{trade.from_token}/{trade.to_token}",
            "amount": float(trade.copy_amount_usd or 0),
            "pnl": float(trade.pnl_usd or 0),
            "status": trade.status,
            "timestamp": _iso_utc(trade.created_at) if trade.created_at else "",
        }
        for trade in trades
    ]


@router.put("/copy-trading/follow/{trader_id}/settings")
async def update_terminal_follow_settings(
    trader_id: int,
    settings: WebAppFollowSettings,
    auth_payload: Optional[Dict] = Depends(get_terminal_auth_payload),
    db: Session = Depends(get_db),
):
    user_id = _require_terminal_user(auth_payload)
    from bot.models.copy_trading import CopyFollow, TraderProfile

    profile = db.query(TraderProfile).filter(TraderProfile.id == trader_id).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Trader not found")
    if settings.copyMode != "notify":
        await _require_automatic_copy_access(db, auth_payload, user_id)

    follow = (
        db.query(CopyFollow)
        .filter(
            CopyFollow.follower_id == user_id,
            CopyFollow.trader_id == profile.user_id,
            CopyFollow.is_active == True,  # noqa: E712
        )
        .first()
    )
    if not follow:
        raise HTTPException(status_code=404, detail="Not following this trader")

    _apply_copy_settings(follow, settings)
    db.commit()
    return {"success": True}


@router.get("/alerts")
async def get_terminal_alerts(
    auth_payload: Optional[Dict] = Depends(get_terminal_auth_payload),
    db: Session = Depends(get_db),
):
    user_id = _require_terminal_user(auth_payload)
    from bot.models.advanced import AdvancedPriceAlert

    alerts = (
        db.query(AdvancedPriceAlert)
        .filter(
            AdvancedPriceAlert.user_id == user_id,
        )
        .order_by(AdvancedPriceAlert.created_at.desc())
        .all()
    )

    return [_alert_response(alert) for alert in alerts]


@router.post("/alerts")
async def create_terminal_alert(
    body: WebAppCreateAlertRequest,
    auth_payload: Optional[Dict] = Depends(get_terminal_auth_payload),
    db: Session = Depends(get_db),
):
    user_id = _require_terminal_user(auth_payload)
    if body.targetValue <= 0:
        raise HTTPException(status_code=400, detail="Target value must be greater than zero")

    from bot.models.advanced import AdvancedPriceAlert

    alert = AdvancedPriceAlert(
        user_id=user_id,
        token_symbol=body.tokenSymbol.strip().upper(),
        chain=(body.chain or "ethereum").strip().lower(),
        alert_type=body.alertType,
        target_price=body.targetValue,
        is_active=True,
        is_triggered=False,
    )
    db.add(alert)
    db.commit()
    db.refresh(alert)
    return _alert_response(alert)


@router.delete("/alerts/{alert_id}")
async def delete_terminal_alert(
    alert_id: int,
    auth_payload: Optional[Dict] = Depends(get_terminal_auth_payload),
    db: Session = Depends(get_db),
):
    user_id = _require_terminal_user(auth_payload)
    from bot.models.advanced import AdvancedPriceAlert

    alert = (
        db.query(AdvancedPriceAlert)
        .filter(
            AdvancedPriceAlert.id == alert_id,
            AdvancedPriceAlert.user_id == user_id,
        )
        .first()
    )
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    db.delete(alert)
    db.commit()
    return {"success": True}


@router.get("/wallet-tracker/wallets")
async def get_terminal_tracked_wallets(
    auth_payload: Optional[Dict] = Depends(get_terminal_auth_payload),
    db: Session = Depends(get_db),
):
    user_id = _require_terminal_user(auth_payload)
    from bot.models.tracking import TrackedWallet

    wallets = (
        db.query(TrackedWallet)
        .filter(
            TrackedWallet.user_id == user_id,
            TrackedWallet.is_active == True,  # noqa: E712
        )
        .order_by(TrackedWallet.created_at.desc())
        .all()
    )
    return [_tracked_wallet_response(wallet) for wallet in wallets]


@router.post("/wallet-tracker/wallets")
async def create_terminal_tracked_wallet(
    body: WebAppTrackedWalletRequest,
    auth_payload: Optional[Dict] = Depends(get_terminal_auth_payload),
    db: Session = Depends(get_db),
):
    user_id = _require_terminal_user(auth_payload)
    from bot.models.tracking import TrackedWallet

    address = _normalize_tracked_wallet_address(body.address)
    label = body.label.strip() if body.label and body.label.strip() else None
    chain = _chain_for_tracked_wallet(address, body.chain)

    wallet = (
        db.query(TrackedWallet)
        .filter(
            TrackedWallet.user_id == user_id,
            TrackedWallet.address.ilike(address),
        )
        .first()
    )
    if wallet:
        wallet.label = label
        wallet.chain = chain
        wallet.is_active = True
        wallet.updated_at = datetime.utcnow()
    else:
        wallet = TrackedWallet(
            user_id=user_id,
            address=address,
            label=label,
            chain=chain,
            is_active=True,
        )
        db.add(wallet)

    db.commit()
    db.refresh(wallet)
    return _tracked_wallet_response(wallet)


@router.delete("/wallet-tracker/wallets/{address}")
async def delete_terminal_tracked_wallet(
    address: str,
    auth_payload: Optional[Dict] = Depends(get_terminal_auth_payload),
    db: Session = Depends(get_db),
):
    user_id = _require_terminal_user(auth_payload)
    from bot.models.tracking import TrackedWallet

    normalized = _normalize_tracked_wallet_address(address)
    wallet = (
        db.query(TrackedWallet)
        .filter(
            TrackedWallet.user_id == user_id,
            TrackedWallet.address.ilike(normalized),
            TrackedWallet.is_active == True,  # noqa: E712
        )
        .first()
    )
    if not wallet:
        raise HTTPException(status_code=404, detail="Tracked wallet not found")

    wallet.is_active = False
    wallet.updated_at = datetime.utcnow()
    db.commit()
    return {"success": True}


@router.get("/wallet-tracker/activities")
async def get_terminal_wallet_activities(
    auth_payload: Optional[Dict] = Depends(get_terminal_auth_payload),
    db: Session = Depends(get_db),
):
    """Recent on-chain transfers for the user's tracked wallets.

    Aggregates incoming/outgoing transfers across every active tracked wallet
    via Alchemy's ``alchemy_getAssetTransfers``, normalizes to the terminal's
    ``WalletActivity`` shape, sorts newest-first and caps the result.
    Returns ``[]`` gracefully when there are no tracked wallets or Alchemy is
    unavailable.
    """
    user_id = _require_terminal_user(auth_payload)

    # Short-lived per-user cache to avoid hammering Alchemy on each poll.
    cached = _terminal_activity_cache.get(user_id)
    if cached and cached[0] > time.monotonic():
        return cached[1]

    from bot.models.tracking import TrackedWallet

    wallets = (
        db.query(TrackedWallet)
        .filter(
            TrackedWallet.user_id == user_id,
            TrackedWallet.is_active == True,  # noqa: E712
        )
        .all()
    )
    if not wallets:
        _terminal_activity_cache[user_id] = (time.monotonic() + _ACTIVITY_TTL_SECONDS, [])
        return []

    try:
        activities = await _build_wallet_activities(wallets)
    except Exception as exc:  # never break the panel on upstream errors
        logger.warning("wallet-tracker activities failed for user %s: %s", user_id, exc)
        activities = []

    _terminal_activity_cache[user_id] = (time.monotonic() + _ACTIVITY_TTL_SECONDS, activities)
    return activities


# Categories Alchemy understands for getAssetTransfers (native + tokens).
_ACTIVITY_TRANSFER_CATEGORIES = ["external", "erc20", "erc1155", "erc721"]
_ACTIVITY_MAX = 50
_ACTIVITY_PER_WALLET = 25
# Cache symbol -> usd price within a single request to avoid duplicate lookups.


async def _build_wallet_activities(wallets) -> List[Dict[str, Any]]:
    from bot.services.alchemy_client import get_alchemy_client
    from bot.services.price_service import price_service

    client = get_alchemy_client()
    if not client.is_configured:
        return []

    raw: List[Dict[str, Any]] = []
    symbols_seen: set = set()

    for wallet in wallets:
        chain = (wallet.chain or "ethereum").lower()
        if not client.supports_chain(chain):
            continue
        address = wallet.address
        try:
            transfers = await client.get_asset_transfers(
                address=address,
                chain=chain,
                category=_ACTIVITY_TRANSFER_CATEGORIES,
                max_count=_ACTIVITY_PER_WALLET,
            )
        except Exception as exc:
            logger.debug("asset transfers failed for %s on %s: %s", address, chain, exc)
            continue

        addr_lower = address.lower()
        for t in transfers:
            qty = t.value
            if qty is None or qty <= 0:
                continue
            is_incoming = (t.to_address or "").lower() == addr_lower
            symbol = (t.asset or "").upper() or "?"
            symbols_seen.add(symbol)
            token_address = ""
            if isinstance(t.raw_contract, dict):
                token_address = t.raw_contract.get("address") or ""
            raw.append(
                {
                    "wallet": wallet,
                    "transfer": t,
                    "qty": float(qty),
                    "action": "buy" if is_incoming else "sell",
                    "symbol": symbol,
                    "tokenAddress": token_address,
                    "timestamp": t.block_timestamp,
                    "block_num": t.block_num,
                }
            )

    if not raw:
        return []

    # Price lookups (best-effort; missing prices -> 0 USD).
    prices: Dict[str, float] = {}
    try:
        fetched = await price_service.get_prices(list(symbols_seen))
        prices = {sym: (val or 0.0) for sym, val in (fetched or {}).items()}
    except Exception as exc:
        logger.debug("price lookup failed for activities: %s", exc)

    activities: List[Dict[str, Any]] = []
    for item in raw:
        t = item["transfer"]
        price = float(prices.get(item["symbol"], 0.0) or 0.0)
        activities.append(
            {
                "id": f"{t.tx_hash}:{item['wallet'].address.lower()}:{item['action']}",
                "walletAddress": item["wallet"].address,
                "walletLabel": item["wallet"].label,
                "action": item["action"],
                "tokenSymbol": item["symbol"],
                "tokenAddress": item["tokenAddress"],
                "amount": item["qty"] * price,
                "priceUsd": price,
                "chain": (item["wallet"].chain or "ethereum").lower(),
                "timestamp": item["timestamp"] or "",
                "txHash": t.tx_hash,
            }
        )

    activities.sort(key=lambda a: a["timestamp"], reverse=True)
    return activities[:_ACTIVITY_MAX]


@router.get("/tweets/accounts")
async def get_terminal_tweet_accounts(
    auth_payload: Optional[Dict] = Depends(get_terminal_auth_payload),
    db: Session = Depends(get_db),
):
    user_id = _require_terminal_user(auth_payload)
    from bot.models.tracking import TrackedTwitterAccount

    accounts = (
        db.query(TrackedTwitterAccount)
        .filter(
            TrackedTwitterAccount.user_id == user_id,
            TrackedTwitterAccount.is_active == True,  # noqa: E712
        )
        .order_by(TrackedTwitterAccount.created_at.desc())
        .all()
    )
    return [_twitter_account_response(account) for account in accounts]


@router.post("/tweets/accounts")
async def create_terminal_tweet_account(
    body: WebAppTrackedTwitterAccountRequest,
    auth_payload: Optional[Dict] = Depends(get_terminal_auth_payload),
    db: Session = Depends(get_db),
):
    user_id = _require_terminal_user(auth_payload)
    from bot.models.tracking import TrackedTwitterAccount

    handle = _normalize_twitter_handle(body.handle)
    account_count = (
        db.query(TrackedTwitterAccount)
        .filter(
            TrackedTwitterAccount.user_id == user_id,
            TrackedTwitterAccount.is_active == True,  # noqa: E712
        )
        .count()
    )

    account = (
        db.query(TrackedTwitterAccount)
        .filter(
            TrackedTwitterAccount.user_id == user_id,
            TrackedTwitterAccount.handle.ilike(handle),
        )
        .first()
    )
    if account:
        account.is_active = True
        account.display_name = handle
        account.updated_at = datetime.utcnow()
    else:
        account = TrackedTwitterAccount(
            user_id=user_id,
            handle=handle,
            display_name=handle,
            avatar_color=_TWITTER_AVATAR_COLORS[account_count % len(_TWITTER_AVATAR_COLORS)],
            is_active=True,
        )
        db.add(account)

    db.commit()
    db.refresh(account)
    return _twitter_account_response(account)


@router.delete("/tweets/accounts/{handle}")
async def delete_terminal_tweet_account(
    handle: str,
    auth_payload: Optional[Dict] = Depends(get_terminal_auth_payload),
    db: Session = Depends(get_db),
):
    user_id = _require_terminal_user(auth_payload)
    from bot.models.tracking import TrackedTwitterAccount

    normalized = _normalize_twitter_handle(handle)
    account = (
        db.query(TrackedTwitterAccount)
        .filter(
            TrackedTwitterAccount.user_id == user_id,
            TrackedTwitterAccount.handle.ilike(normalized),
            TrackedTwitterAccount.is_active == True,  # noqa: E712
        )
        .first()
    )
    if not account:
        raise HTTPException(status_code=404, detail="Tracked account not found")

    account.is_active = False
    account.updated_at = datetime.utcnow()
    db.commit()
    return {"success": True}


@router.get("/tweets/feed")
async def get_terminal_tweet_feed(
    auth_payload: Optional[Dict] = Depends(get_terminal_auth_payload),
):
    _require_terminal_user(auth_payload)
    return []


@router.get("/limit-orders")
async def get_terminal_limit_orders(
    auth_payload: Optional[Dict] = Depends(get_terminal_auth_payload),
    db: Session = Depends(get_db),
):
    user_id = _require_terminal_user(auth_payload)
    from bot.models.advanced import LimitOrder

    orders = (
        db.query(LimitOrder)
        .filter(
            LimitOrder.user_id == user_id,
        )
        .order_by(LimitOrder.created_at.desc())
        .all()
    )
    return [_limit_order_response(order) for order in orders]


@router.post("/limit-orders")
async def create_terminal_limit_order(
    body: WebAppCreateLimitOrderRequest,
    auth_payload: Optional[Dict] = Depends(get_terminal_auth_payload),
    db: Session = Depends(get_db),
):
    user_id = _require_terminal_user(auth_payload)
    order_type = body.orderType.strip().lower()
    if order_type not in {"limit_buy", "limit_sell", "stop_loss", "take_profit"}:
        raise HTTPException(status_code=400, detail="Unsupported limit order type")
    if body.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than zero")
    if body.triggerPrice <= 0:
        raise HTTPException(status_code=400, detail="Target price must be greater than zero")
    if body.expiresInHours is not None and body.expiresInHours <= 0:
        raise HTTPException(status_code=400, detail="Expiry must be greater than zero")

    wallet = _default_terminal_wallet(db, user_id)
    if not wallet:
        raise HTTPException(status_code=400, detail="Connect Turnkey first to create a limit order")

    from_chain = body.fromChain.strip().lower()
    to_chain = body.toChain.strip().lower()
    from_token = body.fromToken.strip().upper()
    to_token = body.toToken.strip().upper()
    await _validate_limit_order_market(order_type, from_token, to_token, body.triggerPrice)

    from bot.config.tokens import get_token_decimals
    from bot.models.advanced import LimitOrder, OrderStatus

    decimals = get_token_decimals(from_token, from_chain)
    amount_raw = str(int(Decimal(str(body.amount)) * (Decimal(10) ** decimals)))

    order = LimitOrder(
        user_id=user_id,
        wallet_id=wallet.id,
        order_type=order_type,
        status=OrderStatus.PENDING.value,
        from_chain=from_chain,
        from_token=from_token,
        to_chain=to_chain,
        to_token=to_token,
        amount=amount_raw,
        trigger_price=body.triggerPrice,
        slippage=body.slippage,
        expires_at=(
            datetime.utcnow() + timedelta(hours=body.expiresInHours)
            if body.expiresInHours
            else None
        ),
    )
    db.add(order)
    db.commit()
    db.refresh(order)
    return _limit_order_response(order)


@router.post("/limit-orders/{order_id}/cancel")
async def cancel_terminal_limit_order(
    order_id: int,
    auth_payload: Optional[Dict] = Depends(get_terminal_auth_payload),
    db: Session = Depends(get_db),
):
    user_id = _require_terminal_user(auth_payload)
    from bot.models.advanced import LimitOrder, OrderStatus

    order = (
        db.query(LimitOrder)
        .filter(
            LimitOrder.id == order_id,
            LimitOrder.user_id == user_id,
        )
        .first()
    )
    if not order:
        raise HTTPException(status_code=404, detail="Limit order not found")
    if order.status not in {OrderStatus.PENDING.value, OrderStatus.TRIGGERED.value}:
        raise HTTPException(
            status_code=400, detail="Only pending or triggered orders can be cancelled"
        )

    order.status = OrderStatus.CANCELLED.value
    db.commit()
    return {"success": True}


@router.get("/dca/orders")
async def get_terminal_dca_orders(
    auth_payload: Optional[Dict] = Depends(get_terminal_auth_payload),
    db: Session = Depends(get_db),
):
    user_id = _require_terminal_user(auth_payload)
    from bot.models.advanced import DCAOrder

    orders = (
        db.query(DCAOrder)
        .filter(
            DCAOrder.user_id == user_id,
        )
        .order_by(DCAOrder.created_at.desc())
        .all()
    )

    return [_dca_order_response(order) for order in orders]


@router.post("/dca/orders")
async def create_terminal_dca_order(
    body: WebAppCreateDCARequest,
    auth_payload: Optional[Dict] = Depends(get_terminal_auth_payload),
    db: Session = Depends(get_db),
):
    user_id = _require_terminal_user(auth_payload)
    if body.totalAmount <= 0:
        raise HTTPException(status_code=400, detail="Total amount must be greater than zero")
    if body.numberOfOrders <= 0:
        raise HTTPException(status_code=400, detail="Number of orders must be greater than zero")

    interval_hours = _DCA_FREQUENCY_TO_HOURS.get(body.frequency)
    if interval_hours is None:
        raise HTTPException(status_code=400, detail="Unsupported DCA frequency")

    wallet = _default_terminal_wallet(db, user_id)
    if not wallet:
        raise HTTPException(status_code=400, detail="Connect Turnkey first to create a DCA order")

    from bot.models.advanced import DCAOrder

    amount_per_order = body.totalAmount / body.numberOfOrders
    order = DCAOrder(
        user_id=user_id,
        wallet_id=wallet.id,
        status="active",
        from_chain="ethereum",
        from_token=body.fromToken.strip().upper(),
        to_chain="ethereum",
        to_token=body.toToken.strip().upper(),
        amount_per_execution=str(amount_per_order),
        interval_hours=interval_hours,
        next_execution_at=datetime.utcnow() + timedelta(hours=interval_hours),
        max_executions=body.numberOfOrders,
        max_total_amount=str(body.totalAmount),
        executions_completed=0,
        total_spent="0",
    )
    db.add(order)
    db.commit()
    db.refresh(order)
    return _dca_order_response(order)


@router.post("/dca/orders/{order_id}/pause")
async def pause_terminal_dca_order(
    order_id: int,
    auth_payload: Optional[Dict] = Depends(get_terminal_auth_payload),
    db: Session = Depends(get_db),
):
    user_id = _require_terminal_user(auth_payload)
    from bot.models.advanced import DCAOrder

    order = (
        db.query(DCAOrder)
        .filter(
            DCAOrder.id == order_id,
            DCAOrder.user_id == user_id,
        )
        .first()
    )
    if not order:
        raise HTTPException(status_code=404, detail="DCA order not found")
    if order.status == "cancelled":
        raise HTTPException(status_code=400, detail="Cancelled DCA orders cannot be paused")

    order.status = "paused"
    db.commit()
    return {"success": True}


@router.post("/dca/orders/{order_id}/cancel")
async def cancel_terminal_dca_order(
    order_id: int,
    auth_payload: Optional[Dict] = Depends(get_terminal_auth_payload),
    db: Session = Depends(get_db),
):
    user_id = _require_terminal_user(auth_payload)
    from bot.models.advanced import DCAOrder

    order = (
        db.query(DCAOrder)
        .filter(
            DCAOrder.id == order_id,
            DCAOrder.user_id == user_id,
        )
        .first()
    )
    if not order:
        raise HTTPException(status_code=404, detail="DCA order not found")

    order.status = "cancelled"
    db.commit()
    return {"success": True}


@router.get("/lending/markets", response_model=List[WebAppLendingMarket])
async def get_terminal_lending_markets(
    auth_payload: Optional[Dict] = Depends(get_terminal_auth_payload),
):
    _require_terminal_user(auth_payload)
    try:
        return await _fetch_morpho_lending_markets()
    except HTTPException:
        raise
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502, detail="Morpho lending market provider is unavailable"
        ) from exc


@router.get("/lending/markets/{market_id}", response_model=WebAppLendingMarket)
async def get_terminal_lending_market(
    market_id: str,
    auth_payload: Optional[Dict] = Depends(get_terminal_auth_payload),
):
    _require_terminal_user(auth_payload)
    try:
        markets = await _fetch_morpho_lending_markets(limit=100)
    except HTTPException:
        raise
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502, detail="Morpho lending market provider is unavailable"
        ) from exc
    for market in markets:
        if market.id == market_id:
            return market
    raise HTTPException(status_code=404, detail="Lending market not found")


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
    tg_user: TelegramUser = Depends(get_telegram_user), db: Session = Depends(get_db)
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
            totalUsdValue=0.0, tokens=[], lastUpdated=_iso_utc(datetime.utcnow())
        )

    # Get all active wallets
    wallets = (
        db.query(Wallet)
        .filter(Wallet.user_id == user.id, Wallet.is_active == True)  # noqa: E712
        .all()  # noqa: E712
    )  # noqa: E712

    tokens = []
    total_usd = 0.0

    # Native-coin sentinel expected by the webapp's isNativeToken() allowlist.
    # Empty string is treated as "native" client-side and is used consistently
    # for every chain's native asset (ETH/BNB/POL/SOL/...).
    NATIVE_ADDRESS_SENTINEL = ""
    # Explicit placeholder for ERC-20-like tokens whose contract address we do
    # NOT have in bot/config/tokens.py for a given chain. This is intentionally
    # NOT a valid address (and NOT the native sentinel) so the webapp's
    # isAddress()-based send gate stays disabled for it.
    UNKNOWN_ADDRESS_PLACEHOLDER = "0x..."
    # Addresses/markers in bot/config/tokens.py that actually mean "this is the
    # chain's native asset", not a real ERC-20 contract. Some TOKENS entries
    # (e.g. BTC on citrea, which is really native cBTC) resolve to one of
    # these for a given chain. The webapp's isNativeToken() allowlist accepts
    # the zero address as native too, so shipping it verbatim would both
    # mislabel the row AND double-count the same underlying native balance
    # (once from the chain's native_token key, once from this TOKENS entry).
    NATIVE_ADDRESS_MARKERS = {
        NATIVE_TOKEN_ADDRESS.lower(),  # 0x000...000
        "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        "native",
    }

    for wallet in wallets:
        try:
            balances = await wallet_service.get_all_balances(wallet)
            for chain_name, chain_tokens in balances.items():
                chain_config = CHAINS.get(chain_name)
                for symbol, balance in chain_tokens.items():
                    if balance > 0:
                        # Simple USD estimation (would use price service in production)
                        usd_value = balance  # Placeholder

                        is_native = bool(chain_config and symbol == chain_config.native_token)
                        if is_native:
                            address = NATIVE_ADDRESS_SENTINEL
                            decimals = chain_config.native_decimals if chain_config else None
                        else:
                            token_config = TOKENS.get(symbol.upper())
                            token_address = (
                                token_config.addresses.get(chain_name) if token_config else None
                            )
                            if token_address and token_address.lower() in NATIVE_ADDRESS_MARKERS:
                                # This TOKENS entry is actually the chain's native
                                # asset under a different symbol (e.g. BTC ==
                                # native cBTC on citrea). The chain's real
                                # native_token balance is already emitted above
                                # (or will be, from its own dict key) — emitting
                                # this row too would double-count the same
                                # underlying balance, so skip it entirely.
                                continue
                            elif token_address:
                                address = token_address
                                decimals = get_token_decimals(symbol, chain_name)
                            else:
                                # No known contract address for this token on this
                                # chain — keep the send gate disabled client-side.
                                address = UNKNOWN_ADDRESS_PLACEHOLDER
                                decimals = None

                        tokens.append(
                            WebAppPortfolioToken(
                                symbol=symbol,
                                name=symbol,
                                address=address,
                                chain=chain_name,
                                balance=_plain_amount(balance),
                                usdValue=usd_value,
                                decimals=decimals,
                            )
                        )
                        total_usd += usd_value
        except Exception:
            continue

    return WebAppPortfolio(
        totalUsdValue=total_usd, tokens=tokens, lastUpdated=_iso_utc(datetime.utcnow())
    )


@router.get("/portfolio", response_model=WebAppPortfolio)
async def get_terminal_portfolio(
    auth_payload: Optional[Dict] = Depends(get_terminal_auth_payload), db: Session = Depends(get_db)
):
    """
    Get the current terminal user's portfolio using JWT auth.
    """
    if not auth_payload or not auth_payload.get("user_id"):
        raise HTTPException(status_code=401, detail="Not authenticated")

    user = db.query(User).filter(User.id == auth_payload["user_id"]).first()
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    wallets = (
        db.query(Wallet)
        .filter(Wallet.user_id == user.id, Wallet.is_active == True)  # noqa: E712
        .all()  # noqa: E712
    )  # noqa: E712

    tokens: List[WebAppPortfolioToken] = []
    total_usd = 0.0

    # New Turnkey wallets usually have no balances. Return an empty portfolio
    # quickly instead of forcing the UI through slow multi-chain balance scans.
    for wallet in wallets:
        if not wallet.address:
            continue

    return WebAppPortfolio(
        totalUsdValue=total_usd, tokens=tokens, lastUpdated=_iso_utc(datetime.utcnow())
    )


@router.post("/copilot", response_model=WebAppCopilotResponse)
async def terminal_copilot_command(
    body: WebAppCopilotRequest,
    auth_payload: Optional[Dict] = Depends(get_terminal_auth_payload),
):
    """
    Execute terminal Co-Pilot commands against real backend services.
    """
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Command is required")

    lowered = text.lower()

    if any(word in lowered for word in ["portfolio", "holdings", "balance"]):
        if not auth_payload or not auth_payload.get("user_id"):
            raise HTTPException(
                status_code=401,
                detail="Connect Turnkey first to load your real portfolio.",
            )
        with get_session() as db:
            portfolio = await get_terminal_portfolio(auth_payload=auth_payload, db=db)
        return WebAppCopilotResponse(
            type="portfolio",
            content=(
                f"Portfolio loaded from your Turnkey wallet. "
                f"Total value: ${portfolio.totalUsdValue:,.2f}."
            ),
            data=portfolio.dict(),
        )

    if any(word in lowered for word in ["swap", "buy", "sell", "trade"]):
        quote_request = _parse_copilot_swap(text)
        with get_session() as db:
            quote = await create_terminal_swap_quote(
                body=quote_request,
                auth_payload=auth_payload,
                db=db,
            )
        return WebAppCopilotResponse(
            type="quote",
            content=(
                f"Live quote: {quote.fromAmount} {quote.fromToken.symbol} -> "
                f"{quote.toAmount} {quote.toToken.symbol} via {quote.route}."
            ),
            data=quote.dict(),
        )

    if any(word in lowered for word in ["price", "worth", "market", "quote"]):
        symbol = _extract_copilot_symbol(text)
        if not symbol:
            raise HTTPException(
                status_code=400,
                detail='Tell me the token symbol, like "Price of SOL".',
            )
        requested_chain = _extract_copilot_chain(text, fallback="")
        return await _fetch_live_token_price(symbol, requested_chain or None)

    if any(word in lowered for word in ["alert", "notify", "watch"]):
        raise HTTPException(
            status_code=501,
            detail="Price alert creation is not wired to the terminal backend yet.",
        )

    return WebAppCopilotResponse(
        type="text",
        content=(
            'Try "Price of SOL", "Swap ETH to USDC", '
            '"Buy 0.1 ETH of PEPE", or "Show my portfolio".'
        ),
        data={"supported": ["price", "swap_quote", "portfolio"]},
    )


@router.post("/bridge/routes", response_model=WebAppBridgeRoutesResponse)
async def list_terminal_bridge_routes(
    body: WebAppBridgeRoutesRequest,
    auth_payload: Optional[Dict] = Depends(get_terminal_auth_payload),
    db: Session = Depends(get_db),
):
    """Cross-chain routes for a token, ranked by the registry.

    Separate from /swap/quote because a bridge carries information a swap
    quote has nowhere to put: how it settles, and who holds the funds while
    they are in flight. The terminal surfaces both, so they must survive the
    trip over the wire rather than being flattened into a provider name.

    Returns an empty list rather than erroring when no provider can serve the
    pair — every bridge provider is behind a default-OFF flag, so "no routes"
    is the normal answer until one is enabled.
    """
    from bot.services.bridge.registry import get_bridge_quotes

    if body.fromChain == body.toChain:
        raise HTTPException(status_code=400, detail="Bridging requires two different chains")

    # Quote-only sentinel sender. Providers validate from_address against the
    # destination chain's format and reject an empty one, so a routes request
    # made before a wallet is connected returned [] for everyone — the
    # terminal's bridge looked permanently empty. Listing routes is
    # informational; the /bridge/build step still requires the real connected
    # address, so the sentinel can never end up in a transaction.
    quote_sender = body.fromAddress or "0x000000000000000000000000000000000000dEaD"

    # Only registry symbols quote here: get_token_decimals returns a default
    # for unknown symbols and get_token_address can pass raw addresses
    # through, both of which would let a caller fabricate a token pair
    # (money-path review finding). Fail closed with a clear 400 instead.
    if get_token_by_symbol(body.token) is None:
        raise HTTPException(status_code=400, detail=f"Unknown token: {body.token}")

    # The terminal sends the amount as typed — human units ("250", "0.5") —
    # while every provider's normalize_amount() takes raw base units and
    # rejects decimal points outright. Convert here, where token decimals are
    # known. (/bridge/build is unaffected: it receives the raw fromAmount
    # echoed from a quote in this response.) Decimal hardening per the
    # money-path review: Infinity/NaN raise OverflowError/InvalidOperation
    # outside the default except tuple, and the default 28-digit context
    # silently rounds very large amounts.
    from decimal import ROUND_DOWN, Decimal, InvalidOperation, localcontext

    src_decimals = get_token_decimals(body.token, body.fromChain)
    try:
        human = Decimal(body.amount)
        if not human.is_finite():
            raise HTTPException(status_code=400, detail="Invalid amount")
        with localcontext() as ctx:
            ctx.prec = 60
            raw_amount = int(human.scaleb(src_decimals).to_integral_value(rounding=ROUND_DOWN))
    except (InvalidOperation, ValueError, OverflowError):
        raise HTTPException(status_code=400, detail="Invalid amount")
    if raw_amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be above zero")

    try:
        quotes = await get_bridge_quotes(
            from_chain=body.fromChain,
            to_chain=body.toChain,
            from_token=body.token,
            from_amount=str(raw_amount),
            from_address=quote_sender,
            to_address=body.toAddress,
            slippage_bps=body.slippageBps or 50,
        )
    except Exception as exc:  # noqa: BLE001 — a provider fault must not 500 the page
        logger.warning(f"bridge routes failed {body.fromChain}->{body.toChain}: {exc}")
        return WebAppBridgeRoutesResponse(routes=[])

    # A deposit-address rail with the sentinel as recipient would be a burn
    # address the user sends funds to first. No provider mints one on a dry
    # quote today; this keeps that true if one ever does.
    if not body.fromAddress:
        quotes = [q for q in quotes if not q.deposit_address]

    decimals = get_token_decimals(body.token, body.toChain)

    routes: List[WebAppBridgeRoute] = []
    for quote in quotes:
        try:
            to_amount_human = int(quote.to_amount) / (10**decimals)
        except (TypeError, ValueError):
            # A quote whose amount we cannot parse cannot be ranked or shown
            # honestly, so drop it rather than render a wrong number.
            continue

        routes.append(
            WebAppBridgeRoute(
                provider=quote.provider,
                fromChain=quote.from_chain,
                toChain=quote.to_chain,
                token=quote.from_token,
                fromAmount=quote.from_amount,
                toAmount=quote.to_amount,
                toAmountMin=quote.to_amount_min,
                toAmountHuman=to_amount_human,
                gasCostUsd=quote.gas_cost_usd,
                feeCostUsd=quote.fee_cost_usd,
                totalCostUsd=quote.gas_cost_usd + quote.fee_cost_usd,
                estimatedTime=quote.estimated_time,
                settlement=quote.settlement,
                trustModel=quote.trust_model,
                # 1:1 mint/burn rails have no price impact by construction.
                # Anything we cannot positively identify as such is reported as
                # pooled, so the UI never claims a guarantee we cannot make.
                zeroSlippage=quote.provider in ("cctp", "usdt0"),
                depositAddress=quote.deposit_address,
            )
        )

    return WebAppBridgeRoutesResponse(routes=routes)


def _cctp_relayer_state(session, source_tx_hash: str) -> Optional[tuple]:
    """Live (state, detail) for a CCTP transfer, read from the relayer's row.

    The relayer's table is the authority on relay progress; bridge_transfers is
    the user-facing record. Deriving here rather than copying on every relayer
    tick means the two can't drift into disagreeing about whether funds landed.
    """
    try:
        from bot.models.cctp import CctpGenericDeposit
    except Exception:  # noqa: BLE001 — model unavailable is not a request error
        return None

    row = (
        session.query(CctpGenericDeposit)
        .filter(CctpGenericDeposit.burn_tx_hash == source_tx_hash)
        .first()
    )
    if not row:
        return None

    if row.status == "failed":
        return (
            "failed",
            "This transfer stopped and needs to be completed manually. Support can recover it.",
        )
    # A stall is "not moving but safe" — usually the relayer is out of gas on
    # the destination chain. Distinct from failed, which no longer retries.
    if getattr(row, "stall_count", 0) and row.status != "minted":
        return ("stalled", "Waiting on the relayer. Your funds are safe and this will retry.")

    return {
        "pending_broadcast": ("pending_broadcast", None),
        "burned": ("attesting", None),
        "attested": ("destination_pending", None),
        "minted": ("complete", None),
    }.get(row.status, (None, None))


@router.post("/bridge/build", response_model=WebAppBridgeBuildResponse)
async def build_terminal_bridge_transfer(
    body: WebAppBridgeBuildRequest,
    auth_payload: Optional[Dict] = Depends(get_terminal_auth_payload),
    db: Session = Depends(get_db),
):
    """Build the unsigned transaction(s) for a bridge, and start tracking it.

    The transfer row is written BEFORE the response, so it exists before the
    user can sign anything. That ordering is deliberate and is the same lesson
    as swap_engine's pre-broadcast recording: a signed transaction with no row
    is invisible forever, while a row whose transaction is never signed is
    harmless — nothing moved, and it simply stays in pending_broadcast.
    """
    from bot.config.chains import get_chain_by_name
    from bot.models.bridge import BridgeTransfer
    from bot.services.bridge.registry import get_bridge_quotes

    if not auth_payload or not auth_payload.get("user_id"):
        raise HTTPException(status_code=401, detail="Not authenticated")
    user_id = auth_payload["user_id"]

    if body.fromChain == body.toChain:
        raise HTTPException(status_code=400, detail="Bridging requires two different chains")

    sender = (body.fromAddress or "").strip()
    if not sender:
        raise HTTPException(status_code=400, detail="Connect a wallet first")
    # The quote-only sentinel from /bridge/routes must never build a transfer.
    if sender.lower() == "0x000000000000000000000000000000000000dead":
        raise HTTPException(status_code=400, detail="Connect a wallet first")
    if get_token_by_symbol(body.token) is None:
        raise HTTPException(status_code=400, detail=f"Unknown token: {body.token}")
    recipient = (body.toAddress or sender).strip()

    # Validate both addresses against the chain they will be used on, before
    # anything is quoted or persisted. The providers validate too, but a bad
    # address must fail with a clear message rather than surfacing as "no route"
    # — and the recipient is sealed into the transfer, so a malformed one sends
    # funds somewhere nobody controls. Matches the /swap/build check.
    from bot.services.bridge.base import validate_address_for_chain

    if not validate_address_for_chain(sender, body.fromChain):
        raise HTTPException(
            status_code=400, detail=f"That wallet address isn't valid on {body.fromChain}"
        )
    if not validate_address_for_chain(recipient, body.toChain):
        raise HTTPException(
            status_code=400,
            detail=f"The destination address isn't valid on {body.toChain}. "
            "Cross-chain transfers need an address in the destination chain's format.",
        )

    quotes = await get_bridge_quotes(
        from_chain=body.fromChain,
        to_chain=body.toChain,
        from_token=body.token,
        from_amount=body.amount,
        from_address=sender,
        to_address=recipient,
        slippage_bps=body.slippageBps or 50,
    )
    quote = next((q for q in quotes if q.provider == body.provider), None)
    if quote is None:
        # Re-quoting can legitimately lose a route (a fee moved, a provider went
        # away). Say that rather than silently substituting a different one —
        # the user chose this rail for its trust model, not just its price.
        raise HTTPException(
            status_code=409,
            detail="That route is no longer available. Refresh to see current routes.",
        )

    tx = quote.transaction_request or {}
    approval = tx.get("approval_tx")
    is_deposit_address = quote.settlement == "deposit_address"

    if is_deposit_address and not quote.deposit_address:
        raise HTTPException(status_code=502, detail="Provider did not return a deposit address")
    if not is_deposit_address and not (tx.get("to") and tx.get("data")):
        raise HTTPException(
            status_code=502, detail="Provider did not return a signable transaction"
        )

    decimals = get_token_decimals(body.token, body.fromChain)

    # Raw base units must be an exact integer. A provider handing back something
    # unparseable is a bug on their side, but persisting it would store a wrong
    # amount against real funds — refuse rather than coerce.
    try:
        amount_raw = int(quote.from_amount)
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=502, detail="Provider returned an amount that could not be read"
        )

    transfer = BridgeTransfer(
        user_id=user_id,
        provider=quote.provider,
        from_chain=quote.from_chain,
        to_chain=quote.to_chain,
        token=quote.from_token,
        amount_raw=amount_raw,
        decimals=decimals,
        sender_address=sender,
        recipient_address=recipient,
        settlement=quote.settlement,
        trust_model=quote.trust_model,
        estimated_time=quote.estimated_time,
        state="awaiting_deposit" if is_deposit_address else "pending_broadcast",
        deposit_address=quote.deposit_address,
    )
    db.add(transfer)
    db.commit()
    db.refresh(transfer)

    chain_id = None
    if not is_deposit_address:
        chain = get_chain_by_name(quote.from_chain)
        chain_id = getattr(chain, "chain_id", None)
        if not isinstance(chain_id, int):
            # A non-EVM source can't be signed by an EVM wallet; the row stays
            # for the record but the client is told plainly.
            raise HTTPException(
                status_code=400,
                detail=f"{quote.from_chain} transfers can't be signed by a connected EVM wallet",
            )

    return WebAppBridgeBuildResponse(
        transferId=transfer.id,
        chainId=chain_id,
        settlement=quote.settlement,
        trustModel=quote.trust_model,
        approval=(
            WebAppBridgeTx(
                to=approval["to"], data=approval["data"], value=str(approval.get("value", 0))
            )
            if approval
            else None
        ),
        tx=(
            None
            if is_deposit_address
            else WebAppBridgeTx(
                to=tx["to"], data=tx["data"], value=str(tx.get("value", 0)), gas=tx.get("gas")
            )
        ),
        depositAddress=quote.deposit_address,
    )


@router.post("/bridge/record", response_model=WebAppBridgeTransferResponse)
async def record_terminal_bridge_transfer(
    body: WebAppBridgeRecordRequest,
    auth_payload: Optional[Dict] = Depends(get_terminal_auth_payload),
    db: Session = Depends(get_db),
):
    """Attach the broadcast hash to a transfer built earlier."""
    from bot.models.bridge import BridgeTransfer

    if not auth_payload or not auth_payload.get("user_id"):
        raise HTTPException(status_code=401, detail="Not authenticated")

    transfer = (
        db.query(BridgeTransfer)
        .filter(
            BridgeTransfer.id == body.transferId,
            BridgeTransfer.user_id == auth_payload["user_id"],
        )
        .first()
    )
    if not transfer:
        raise HTTPException(status_code=404, detail="Transfer not found")

    tx_hash = (body.txHash or "").strip()
    if not tx_hash:
        raise HTTPException(status_code=400, detail="Missing transaction hash")

    # Idempotent: a client retrying the record call must not reset progress the
    # relayer has already made.
    if not transfer.source_tx_hash:
        transfer.source_tx_hash = tx_hash
        if transfer.state == "pending_broadcast":
            transfer.state = "source_pending"
        db.commit()
        db.refresh(transfer)

    return _bridge_transfer_response(db, transfer)


@router.get("/bridge/transfers/{transfer_id}", response_model=WebAppBridgeTransferResponse)
async def get_terminal_bridge_transfer(
    transfer_id: int,
    auth_payload: Optional[Dict] = Depends(get_terminal_auth_payload),
    db: Session = Depends(get_db),
):
    """Current position of one transfer.

    Polled by the terminal while the transfer is in flight, which is the window
    where funds have left the source chain and not yet arrived.
    """
    from bot.models.bridge import BridgeTransfer

    if not auth_payload or not auth_payload.get("user_id"):
        raise HTTPException(status_code=401, detail="Not authenticated")

    transfer = (
        db.query(BridgeTransfer)
        .filter(
            BridgeTransfer.id == transfer_id,
            BridgeTransfer.user_id == auth_payload["user_id"],
        )
        .first()
    )
    if not transfer:
        raise HTTPException(status_code=404, detail="Transfer not found")

    return _bridge_transfer_response(db, transfer)


def _bridge_transfer_response(db, transfer) -> WebAppBridgeTransferResponse:
    """Serialise a transfer, preferring the relayer's live view where it has one."""
    state = transfer.state
    detail = transfer.status_detail

    if transfer.provider == "cctp" and transfer.source_tx_hash:
        derived = _cctp_relayer_state(db, transfer.source_tx_hash)
        if derived and derived[0]:
            state = derived[0]
            detail = derived[1] or detail

    try:
        amount_human = int(transfer.amount_raw) / (10 ** (transfer.decimals or 6))
    except (TypeError, ValueError):
        amount_human = 0.0

    return WebAppBridgeTransferResponse(
        id=str(transfer.id),
        state=state,
        provider=transfer.provider,
        fromChain=transfer.from_chain,
        toChain=transfer.to_chain,
        token=transfer.token,
        amountHuman=amount_human,
        trustModel=transfer.trust_model,
        settlement=transfer.settlement,
        sourceTxHash=transfer.source_tx_hash,
        destinationTxHash=transfer.destination_tx_hash,
        depositAddress=transfer.deposit_address,
        startedAt=(_iso_utc(transfer.created_at) if transfer.created_at else ""),
        updatedAt=(_iso_utc(transfer.updated_at) if transfer.updated_at else ""),
        estimatedTime=transfer.estimated_time or 0,
        statusDetail=detail,
    )


def _iso_utc(dt: datetime) -> str:
    """Serialize a server timestamp with an explicit UTC offset.

    `datetime.utcnow().isoformat()` yields a *naive* string ("...T11:25:49").
    Browsers parse a naive ISO string as LOCAL time, so every client east of
    UTC saw quotes/sessions as already expired the instant they arrived.
    """
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _plain_amount(value) -> str:
    """Render a token amount as a plain decimal string — never `4.2e-05`."""
    try:
        d = Decimal(str(value))
    except Exception:
        return str(value)
    if not d.is_finite():
        return str(value)
    text = format(d, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"


def _min_received_human(quote, to_symbol: str, to_chain: str) -> str:
    """Human-readable minimum output for a quote.

    Providers report `to_amount_min` in base units (wei / lamports), so the raw
    string reached the terminal as e.g. "2904646066843236691869696 PEPE". Convert
    using the destination token's decimals and sanity-check the result against
    the quoted output; fall back to a slippage-derived figure if that fails.
    """
    from bot.config.tokens import get_token_decimals

    to_human = float(getattr(quote, "to_amount_human", 0) or 0)
    raw = str(getattr(quote, "to_amount_min", "") or "").strip()
    candidates = []
    if raw:
        try:
            raw_dec = Decimal(raw)
            if raw.isdigit():
                try:
                    decimals = int(get_token_decimals(to_symbol, to_chain))
                except Exception:
                    decimals = 18
                candidates.append(raw_dec / (Decimal(10) ** decimals))
            candidates.append(raw_dec)
        except Exception:
            pass
    if to_human > 0:
        hi = Decimal(str(to_human))
        lo = hi * Decimal("0.5")
        for c in candidates:
            if lo <= c <= hi:
                return _plain_amount(c)
        # Nothing plausible from the provider — derive from the quoted output
        # and the slippage the quote was priced at.
        try:
            slip = float(getattr(quote, "slippage", 0.5) or 0.5)
        except Exception:
            slip = 0.5
        return _plain_amount(hi * (Decimal(1) - Decimal(str(slip)) / Decimal(100)))
    return _plain_amount(candidates[0]) if candidates else raw


_SWAP_ENGINE = None


def _swap_engine():
    """Process-wide SwapEngine, like the Telegram handlers use.

    Each request used to construct a fresh engine (re-initialising every
    aggregator client and logging "Swap aggregators ready" per quote); the
    engine's in-flight quote de-duplication only works when callers share one.
    """
    global _SWAP_ENGINE
    from bot.services.swap_engine import SwapEngine

    # Rebuild if the class was swapped (tests monkeypatch
    # bot.services.swap_engine.SwapEngine) so a cached instance from another
    # test or an older class never leaks across.
    if _SWAP_ENGINE is None or type(_SWAP_ENGINE) is not SwapEngine:
        _SWAP_ENGINE = SwapEngine()
    return _SWAP_ENGINE


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
    _reject_cross_family_terminal_swap(body.fromChain, body.toChain)

    from_address = "0x0000000000000000000000000000000000000001"
    user_id = auth_payload.get("user_id") if auth_payload else None
    wallet = None
    if user_id:
        wallet = _terminal_wallet_for_chain(db, int(user_id), body.fromChain)
        if wallet and wallet.address:
            from_address = wallet.address

    try:
        quote = await _swap_engine().get_quote(
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
        # Provider calldata is built for this exact sender/recipient. Execution
        # must never silently switch to a newly-selected default wallet while the
        # quote is still live.
        "wallet_id": wallet.id if wallet else None,
        "wallet_address": wallet.address if wallet else None,
    }

    from_token = _webapp_swap_token(from_symbol, body.fromChain)
    to_token = _webapp_swap_token(to_symbol, body.toChain)
    expires_at = datetime.utcnow() + timedelta(
        seconds=getattr(quote, "expires_in", _QUOTE_TTL_SECONDS)
    )

    # Real USD values (was: `float(quote.to_amount_human)` — a TOKEN amount
    # reported as if it were USD, e.g. quoting 1000 PEPE would have shown
    # "$1000"). Priced via the same cached price service used for balances/
    # portfolio; None (never 0, never the old lie) when a price genuinely
    # isn't available — the webapp is expected to omit the "~$X" line
    # rather than render a wrong number.
    from_amount_usd = None
    to_amount_usd = None
    try:
        from bot.services.price_service import price_service

        from_price, to_price = None, None
        try:
            from_price = await price_service.get_price(from_symbol)
        except Exception:
            from_price = None
        try:
            to_price = await price_service.get_price(to_symbol)
        except Exception:
            to_price = None
        if from_price:
            from_amount_usd = quote.from_amount_human * from_price
        if to_price:
            to_amount_usd = quote.to_amount_human * to_price
    except Exception as exc:
        logger.debug(f"Terminal quote USD pricing unavailable (non-fatal): {exc}")

    return WebAppSwapQuoteResponse(
        id=quote_id,
        fromToken=from_token,
        toToken=to_token,
        fromAmount=_plain_amount(quote.from_amount_human),
        toAmount=_plain_amount(quote.to_amount_human),
        fromAmountUsd=from_amount_usd,
        toAmountUsd=to_amount_usd,
        exchangeRate=float(quote.exchange_rate),
        priceImpact=float(quote.price_impact),
        estimatedGas=_plain_amount(quote.gas_cost_usd),
        gasUsd=float(quote.gas_cost_usd),
        route=quote.provider,
        priceImprovementUsd=getattr(quote, "price_improvement_usd", None),
        runnerUpProvider=getattr(quote, "runner_up_provider", None),
        expiresAt=_iso_utc(expires_at),
        minReceived=_min_received_human(quote, to_symbol, body.toChain),
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

    user_id = require_proof_of_possession(auth_payload)

    _cleanup_terminal_quote_cache()
    cached = _terminal_quote_cache.get(body.quoteId)
    if not cached:
        raise HTTPException(status_code=404, detail="Quote expired or not found")

    quote_user_id = cached.get("user_id")
    if quote_user_id and int(quote_user_id) != user_id:
        raise HTTPException(status_code=403, detail="Quote does not belong to this user")

    quote = cached["quote"]
    wallet_id = cached.get("wallet_id")
    wallet_address = cached.get("wallet_address")
    if not wallet_id or not wallet_address:
        raise HTTPException(status_code=409, detail="Quote is not bound to a trading wallet")

    wallet = (
        db.query(Wallet)
        .filter(
            Wallet.id == int(wallet_id),
            Wallet.user_id == user_id,
            Wallet.is_active == True,  # noqa: E712
            Wallet.chain_type == _terminal_chain_type(quote.from_chain),
        )
        .first()
    )
    if not wallet or not _wallet_address_matches(wallet, str(wallet_address)):
        raise HTTPException(
            status_code=409,
            detail="Trading wallet changed after this quote. Request a fresh quote.",
        )
    _require_server_signing_wallet(wallet)

    try:
        swap = await _swap_engine().execute_swap(
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


@router.post("/swap/build", response_model=WebAppSwapBuildResponse)
async def build_terminal_swap(
    body: WebAppSwapBuildRequest,
    auth_payload: Optional[Dict] = Depends(get_terminal_auth_payload),
    db: Session = Depends(get_db),
):
    """
    Build the unsigned transaction(s) for a NON-CUSTODIAL (external wallet) swap.

    The connected wallet (MetaMask / WalletConnect / etc.) signs and broadcasts
    client-side; the server never holds the key. Returns the unsigned swap tx plus
    an optional ERC-20 approval tx. Pair with POST /swap/record after broadcast.
    """
    from bot.services.swap_engine import SwapEngine, SwapError

    try:
        amount = float(body.amount)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid amount")
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than zero")

    address = body.fromAddress.strip()
    is_solana = body.fromChain.lower() == "solana"
    if not is_solana and not (address.startswith("0x") and len(address) == 42):
        raise HTTPException(status_code=400, detail="Invalid wallet address")
    _reject_cross_family_terminal_swap(body.fromChain, body.toChain)
    _require_session_wallet_address(db, auth_payload, address, body.fromChain)

    from_symbol = _token_symbol_for_address(body.fromChain, body.fromToken)
    to_symbol = _token_symbol_for_address(body.toChain, body.toToken)

    try:
        if is_solana:
            tier = _SOLANA_PRIORITY_TIERS.get(
                (body.priority or "normal").lower(), _SOLANA_PRIORITY_TIERS["normal"]
            )
            quote, payload = await _swap_engine().build_external_solana_swap(
                from_token=from_symbol,
                to_token=to_symbol,
                amount=amount,
                from_address=address,
                slippage=body.slippage or 0.5,
                priority_level=tier["priority_level"],
                max_lamports=tier["max_lamports"],
                jito_tip_lamports=tier["jito_tip_lamports"],
                # Jito (turbo) ignores a per-CU price; only forward it otherwise.
                compute_unit_price_micro_lamports=(
                    body.computeUnitPriceMicroLamports if not tier["jito_tip_lamports"] else None
                ),
            )
        else:
            quote, payload = await _swap_engine().build_external_evm_swap(
                from_chain=body.fromChain,
                to_chain=body.toChain,
                from_token=from_symbol,
                to_token=to_symbol,
                amount=amount,
                from_address=address,
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
        "user_id": auth_payload.get("user_id"),
        "external": True,
        "from_address": address,
        "from_chain": body.fromChain,
        "to_chain": body.toChain,
        "from_symbol": from_symbol,
        "to_symbol": to_symbol,
    }

    expires_at = datetime.utcnow() + timedelta(
        seconds=getattr(quote, "expires_in", _QUOTE_TTL_SECONDS)
    )

    common = dict(
        quoteId=quote_id,
        fromToken=_webapp_swap_token(from_symbol, body.fromChain),
        toToken=_webapp_swap_token(to_symbol, body.toChain),
        fromAmount=_plain_amount(quote.from_amount_human),
        toAmount=_plain_amount(quote.to_amount_human),
        minReceived=_min_received_human(quote, to_symbol, body.toChain),
        priceImpact=float(quote.price_impact),
        gasUsd=float(quote.gas_cost_usd),
        route=quote.provider,
        priceImprovementUsd=getattr(quote, "price_improvement_usd", None),
        runnerUpProvider=getattr(quote, "runner_up_provider", None),
        expiresAt=_iso_utc(expires_at),
    )

    if is_solana:
        return WebAppSwapBuildResponse(
            chain="solana",
            swapTransaction=payload["swapTransaction"],
            jito=bool(payload.get("jito")),
            **common,
        )

    approval_model = WebAppUnsignedTx(**payload["approval"]) if payload.get("approval") else None
    return WebAppSwapBuildResponse(
        chain="evm",
        chainId=payload["chainId"],
        tx=WebAppUnsignedTx(**payload["tx"]),
        approval=approval_model,
        spender=payload["spender"],
        **common,
    )


class WebAppJitoSubmitRequest(BaseModel):
    signedTransaction: str  # base64-encoded, Phantom-signed VersionedTransaction


@router.post("/swap/submit-jito")
async def submit_jito_swap(
    body: WebAppJitoSubmitRequest,
    auth_payload: Optional[Dict] = Depends(get_terminal_auth_payload),
):
    """Submit a Phantom-signed Solana tx to the Jito block engine (MEV-protected).

    For a non-custodial swap built with a Jito tip (turbo tier), the client signs
    WITHOUT broadcasting and posts the signed tx here. We forward it to Jito's
    block engine so it lands as a bundle (the server never holds the key). Returns
    the transaction signature for /swap/record.
    """
    require_proof_of_possession(auth_payload)

    from bot.services.jito_api import jito_api, JitoError

    try:
        signature = await jito_api.send_transaction(body.signedTransaction)
    except JitoError as exc:
        raise HTTPException(status_code=502, detail=f"Jito submission failed: {exc}")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Jito submission failed: {exc}")

    if not signature:
        raise HTTPException(status_code=502, detail="Jito did not return a signature.")
    return {"signature": signature}


@router.post("/swap/record", response_model=WebAppSwapRecordResponse)
async def record_terminal_swap(
    body: WebAppSwapRecordRequest,
    auth_payload: Optional[Dict] = Depends(get_terminal_auth_payload),
    db: Session = Depends(get_db),
):
    """
    Record a client-broadcast (non-custodial) swap so it shows in history/portfolio.

    The external wallet already signed + broadcast the tx; we only log the result
    against the user. The cached quote is consumed so it can't be replayed.
    """
    from bot.config.chains import get_chain_by_name
    from bot.models.swap import SwapTransaction, SwapStatus

    user_id = require_proof_of_possession(auth_payload)

    tx_hash = body.txHash.strip()
    # EVM tx hash: 0x + 64 hex. Solana signature: base58, ~64–90 chars (no 0x).
    is_evm_hash = tx_hash.startswith("0x") and len(tx_hash) == 66
    is_solana_sig = not tx_hash.startswith("0x") and 43 <= len(tx_hash) <= 100
    if not (is_evm_hash or is_solana_sig):
        raise HTTPException(status_code=400, detail="Invalid transaction hash")

    _cleanup_terminal_quote_cache()
    cached = _terminal_quote_cache.get(body.quoteId)
    if not cached:
        raise HTTPException(status_code=404, detail="Quote expired or not found")

    quote_user_id = cached.get("user_id")
    if quote_user_id and int(quote_user_id) != user_id:
        raise HTTPException(status_code=403, detail="Quote does not belong to this user")

    quote = cached["quote"]
    from_chain = cached.get("from_chain", quote.from_chain)

    swap = SwapTransaction(
        user_id=user_id,
        from_chain=from_chain,
        from_token=cached.get("from_symbol", quote.from_token),
        from_amount=str(quote.from_amount_human),
        to_chain=cached.get("to_chain", quote.to_chain),
        to_token=cached.get("to_symbol", quote.to_token),
        to_amount=str(quote.to_amount_human),
        status=SwapStatus.PENDING.value,
        tx_hash=tx_hash,
        idempotency_key=f"ext:{tx_hash}",
        route_provider=quote.provider,
        slippage=50,
    )
    db.add(swap)
    db.commit()
    db.refresh(swap)

    # One-shot: drop the quote so the same broadcast can't be recorded twice.
    _terminal_quote_cache.pop(body.quoteId, None)

    explorer = None
    chain = get_chain_by_name(from_chain)
    base = getattr(chain, "explorer_url", None) or getattr(chain, "explorer", None)
    if base:
        explorer = f"{str(base).rstrip('/')}/tx/{tx_hash}"

    return WebAppSwapRecordResponse(
        success=True,
        swapId=swap.id,
        status=swap.status,
        txHash=tx_hash,
        explorerUrl=explorer,
    )


@router.get("/swaps", response_model=List[WebAppSwap])
async def get_terminal_swaps(
    limit: int = 20,
    offset: int = 0,
    auth_payload: Optional[Dict] = Depends(get_terminal_auth_payload),
    db: Session = Depends(get_db),
):
    """
    Swap history for the authenticated terminal/web user (session-JWT auth).

    The Telegram webapp's /users/me/swaps requires Telegram initData, which a
    terminal or external-wallet (SIWE/Phantom) session never has. This is the
    JWT-native parallel so those users can see their swaps — including the status
    the tx_poller reconciles (pending -> completed/failed) for client-broadcast
    (non-custodial) swaps.
    """
    if not auth_payload or not auth_payload.get("user_id"):
        raise HTTPException(status_code=401, detail="Not authenticated")

    swaps = (
        db.query(SwapTransaction)
        .filter(SwapTransaction.user_id == int(auth_payload["user_id"]))
        .order_by(SwapTransaction.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

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
            createdAt=_iso_utc(swap.created_at) if swap.created_at else "",
            completedAt=_iso_utc(swap.completed_at) if swap.completed_at else None,
            errorMessage=swap.error_message,
        )
        for swap in swaps
    ]


@router.get("/users/me/swaps", response_model=List[WebAppSwap])
async def get_my_swaps(
    limit: int = 20,
    offset: int = 0,
    tg_user: TelegramUser = Depends(get_telegram_user),
    db: Session = Depends(get_db),
):
    """
    Get the current user's swap history based on Telegram authentication.
    """
    # Find user by telegram_id
    user = db.query(User).filter(User.telegram_id == tg_user.id).first()
    if not user:
        return []

    # Get swaps
    swaps = (
        db.query(SwapTransaction)
        .filter(SwapTransaction.user_id == user.id)
        .order_by(SwapTransaction.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

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
            createdAt=_iso_utc(swap.created_at) if swap.created_at else "",
            completedAt=_iso_utc(swap.completed_at) if swap.completed_at else None,
            errorMessage=swap.error_message,
        )
        for swap in swaps
    ]


@router.get("/users/me/swaps/{swap_id}", response_model=WebAppSwap)
async def get_my_swap_detail(
    swap_id: str,
    tg_user: TelegramUser = Depends(get_telegram_user),
    db: Session = Depends(get_db),
):
    """
    Get a single swap by id for the current Telegram-authenticated user.

    Scoped to the requesting user — returns 404 (not 403) for swaps that
    exist but belong to someone else, so IDs can't be used to probe for
    other users' swap history.
    """
    user = db.query(User).filter(User.telegram_id == tg_user.id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Swap not found")

    try:
        swap_id_int = int(swap_id)
    except (TypeError, ValueError):
        raise HTTPException(status_code=404, detail="Swap not found")

    swap = (
        db.query(SwapTransaction)
        .filter(SwapTransaction.id == swap_id_int, SwapTransaction.user_id == user.id)
        .first()
    )
    if not swap:
        raise HTTPException(status_code=404, detail="Swap not found")

    return WebAppSwap(
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
        createdAt=_iso_utc(swap.created_at) if swap.created_at else "",
        completedAt=_iso_utc(swap.completed_at) if swap.completed_at else None,
        errorMessage=swap.error_message,
    )


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
    tg_user: TelegramUser = Depends(get_telegram_user), db: Session = Depends(get_db)
):
    """
    Get all wallets linked to the current Telegram user.
    """
    # Find user by telegram_id
    user = db.query(User).filter(User.telegram_id == tg_user.id).first()
    if not user:
        return []

    # Get all active wallets
    wallets = (
        db.query(Wallet)
        .filter(Wallet.user_id == user.id, Wallet.is_active == True)  # noqa: E712
        .all()  # noqa: E712
    )  # noqa: E712

    return [
        LinkedWallet(
            address=wallet.address,
            chainType=wallet.chain_type or "evm",
            linkedAt=_iso_utc(wallet.created_at) if wallet.created_at else "",
            provider=wallet.wallet_provider or "local",
            name=wallet.name,
        )
        for wallet in wallets
    ]


@router.post("/wallets/default", response_model=WalletCreateResponse)
async def get_or_create_wallet(
    tg_user: TelegramUser = Depends(get_telegram_user), db: Session = Depends(get_db)
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
    default_wallet = (
        db.query(Wallet)
        .filter(
            Wallet.user_id == user.id,
            Wallet.is_active == True,  # noqa: E712
            Wallet.is_default == True,  # noqa: E712
        )  # noqa: E712
        .first()
    )

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
    address: str, tg_user: TelegramUser = Depends(get_telegram_user), db: Session = Depends(get_db)
):
    """
    Unlink (deactivate) a wallet from the current Telegram user.
    """
    # Find user by telegram_id
    user = db.query(User).filter(User.telegram_id == tg_user.id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Find the wallet
    wallet = (
        db.query(Wallet)
        .filter(
            Wallet.user_id == user.id,
            Wallet.address.ilike(address),
            Wallet.is_active == True,  # noqa: E712
        )  # noqa: E712
        .first()
    )

    if not wallet:
        raise HTTPException(status_code=404, detail="Wallet not found")

    # Deactivate instead of delete
    wallet.is_active = False
    db.commit()

    return {"success": True, "message": "Wallet unlinked successfully"}


# --- Points (aliases of /v1/mobile/points/* used by the terminal SPA) ---
# The terminal calls /webapp/points/*, but the implementation lives on the mobile
# router (/v1/mobile/points/*) which isn't reachable via api.suwappu.bot. Delegate to
# the same handlers (identical JWT auth) so the rewards dashboard + check-in work.


@router.get("/points/profile")
async def webapp_points_profile(request: Request):
    from api.routes.mobile import get_points

    return await get_points(request)


@router.post("/points/checkin")
async def webapp_points_checkin(request: Request):
    from api.routes.mobile import daily_checkin

    return await daily_checkin(request)


@router.get("/points/milestones")
async def webapp_points_milestones(request: Request):
    from api.routes.mobile import get_milestones

    return await get_milestones(request)


@router.get("/points/rewards")
async def webapp_points_rewards(request: Request):
    from api.routes.mobile import get_rewards

    return await get_rewards(request)


@router.post("/points/rewards/{reward_id}/redeem")
async def webapp_points_redeem(request: Request, reward_id: int):
    from api.routes.mobile import redeem_reward

    return await redeem_reward(request, reward_id)


@router.get("/points/leaderboard")
async def webapp_points_leaderboard(request: Request, limit: int = Query(default=50, le=100)):
    from api.routes.mobile import get_leaderboard

    return await get_leaderboard(request, limit)


# ---------------------------------------------------------------------------
# Battle endpoints
# ---------------------------------------------------------------------------
# Auth: X-Telegram-Init-Data header, validated via validate_telegram_init_data.
# User is resolved from init_data's telegram id — never from the request body.
# Money-path safety lives in battle_service (already reviewed); these endpoints
# only delegate and translate ValueError -> HTTP 400.
# ---------------------------------------------------------------------------


class WebAppBattleConfig(BaseModel):
    markets: List[str]
    multiplier: float
    backings: List[str]
    durations_minutes: List[int]
    max_open: int


class WebAppBattleEntry(BaseModel):
    id: int
    market: str
    direction: str
    stake_usd: float
    backing: str
    status: str
    outcome: Optional[str] = None
    pnl_usd: Optional[float] = None
    expiry_at: str
    created_at: str


class WebAppBattleOpenRequest(BaseModel):
    market: str
    direction: str  # "up" | "down"
    stake_usd: float
    backing: str  # "perps" | "prediction"
    duration_minutes: int


def _battle_response(battle) -> WebAppBattleEntry:
    """Serialize a Battle ORM row to the webapp response shape."""
    return WebAppBattleEntry(
        id=battle.id,
        market=battle.market,
        direction=battle.direction,
        stake_usd=float(battle.stake_usd),
        backing=battle.backing,
        status=battle.status,
        outcome=battle.outcome,
        pnl_usd=float(battle.pnl_usd) if battle.pnl_usd is not None else None,
        expiry_at=_iso_utc(battle.expiry_at) if battle.expiry_at else "",
        created_at=_iso_utc(battle.created_at) if battle.created_at else "",
    )


@router.get("/battle/config", response_model=WebAppBattleConfig)
async def get_battle_config():
    """Return static battle configuration for the Mini App UI.

    Public (no auth) — the frontend needs this to render selectors before
    the user authenticates.
    """
    from bot.services.battle_service import (
        BATTLE_MARKETS,
        BATTLE_MAX_OPEN,
        BATTLE_DURATIONS,
        PREDICTION_WIN_MULTIPLIER,
    )

    return WebAppBattleConfig(
        markets=[m.replace("-USD", "") for m in BATTLE_MARKETS],
        multiplier=float(PREDICTION_WIN_MULTIPLIER),
        backings=["perps", "prediction"],
        durations_minutes=sorted(set(BATTLE_DURATIONS.values())),
        max_open=BATTLE_MAX_OPEN,
    )


@router.get("/battle/list", response_model=List[WebAppBattleEntry])
async def get_battle_list(
    tg_user: TelegramUser = Depends(get_telegram_user),
    db: Session = Depends(get_db),
):
    """Return the authenticated user's open and recently settled battles."""
    from bot.services.battle_service import battle_service

    user = db.query(User).filter(User.telegram_id == tg_user.id).first()
    if not user:
        return []

    battles = battle_service.get_user_battles(user.id, limit=50)
    return [_battle_response(b) for b in battles]


@router.post("/battle/open", response_model=WebAppBattleEntry)
async def open_battle(
    body: WebAppBattleOpenRequest,
    tg_user: TelegramUser = Depends(get_telegram_user),
    db: Session = Depends(get_db),
):
    """Open a new directional battle for the authenticated user.

    MONEY-PATH: user_id is resolved exclusively from the validated init_data
    (via get_telegram_user -> tg_user.id -> DB lookup). The request body
    MUST NOT and does not supply user_id. All balance safety checks and
    per-user caps are enforced inside battle_service.open_battle().
    """
    from bot.services.battle_service import battle_service, BATTLE_MARKETS

    # Resolve DB user from the Telegram identity in the init_data token.
    user = db.query(User).filter(User.telegram_id == tg_user.id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User account not found")

    # Normalise market: accept both "BTC" and "BTC-USD" from the client.
    market = body.market.strip().upper()
    if not market.endswith("-USD"):
        market = f"{market}-USD"
    if market not in BATTLE_MARKETS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported market. Choose from: {', '.join(m.replace('-USD', '') for m in BATTLE_MARKETS)}",
        )

    try:
        battle = await battle_service.open_battle(
            user_id=user.id,
            market=market,
            direction=body.direction.strip().lower(),
            stake_usd=Decimal(str(body.stake_usd)),
            backing=body.backing.strip().lower(),
            duration_minutes=body.duration_minutes,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.error("battle/open failed for tg_user=%s: %s", tg_user.id, exc)
        raise HTTPException(status_code=502, detail="Battle could not be opened. Please try again.")

    return _battle_response(battle)


# ---------------------------------------------------------------------------
# Stocks (xStocks) endpoint
# ---------------------------------------------------------------------------
# Auth: X-Telegram-Init-Data header validated by get_telegram_user.
# Geo-gate: xstocks_region_allowed() is the single authoritative check.
# Stock mints are NEVER returned to a geo-blocked user.
# Market-hours logic is replicated from bot/handlers/stocks.py (same rule,
# kept in one place there; imported here to stay DRY).
# ---------------------------------------------------------------------------


class WebAppStockEntry(BaseModel):
    ticker: str
    name: str
    mint: str
    confidence: str


class WebAppStocksResponse(BaseModel):
    allowed: bool
    region_status: str  # "ok" | "blocked" | "unknown" | "error"
    blocked_message: Optional[str] = None
    stocks: List[WebAppStockEntry]
    market_open: bool
    off_hours_warning: Optional[str] = None


@router.get("/stocks", response_model=WebAppStocksResponse)
async def get_stocks(
    tg_user: TelegramUser = Depends(get_telegram_user),
):
    """Return xStocks listing with geo-gate and market-hours status.

    The ``stocks`` list is only populated when the user is in an allowed region.
    Geo-blocked users receive allowed=false and an empty stocks list — mints
    are never transmitted to prohibited regions.
    """
    from bot.config.xstocks import (
        get_all_xstocks,
        xstocks_region_allowed,
        XSTOCKS_BLOCKED_REGION_NAMES,
    )
    from bot.handlers.stocks import _is_market_hours, _market_hours_warning

    allowed, region_status = xstocks_region_allowed(tg_user.id)

    if not allowed:
        if region_status == "blocked":
            blocked_message = (
                f"xStocks are not available in your region. Trading of tokenized equities "
                f"is restricted in {XSTOCKS_BLOCKED_REGION_NAMES} due to regulatory "
                f"requirements from the token issuer (Backed Finance)."
            )
        elif region_status == "unknown":
            blocked_message = (
                f"xStocks require region verification. Tokenized equity trading is only "
                f"available in jurisdictions outside {XSTOCKS_BLOCKED_REGION_NAMES}. "
                f"Contact support to complete region verification."
            )
        else:
            blocked_message = "xStocks are temporarily unavailable. Please try again later."

        return WebAppStocksResponse(
            allowed=False,
            region_status=region_status,
            blocked_message=blocked_message,
            stocks=[],
            market_open=False,
            off_hours_warning=None,
        )

    market_open = _is_market_hours()
    warning_text = _market_hours_warning()
    off_hours_warning = warning_text.strip() if warning_text.strip() else None

    stocks = [
        WebAppStockEntry(
            ticker=entry["ticker"],
            name=entry["name"],
            mint=entry["solana_mint"],
            confidence=entry["confidence"],
        )
        for entry in get_all_xstocks()
    ]

    return WebAppStocksResponse(
        allowed=True,
        region_status=region_status,
        blocked_message=None,
        stocks=stocks,
        market_open=market_open,
        off_hours_warning=off_hours_warning,
    )


# ---------------------------------------------------------------------------
# Referral endpoints (read-only display; writes/claims stay in the Telegram bot)
# ---------------------------------------------------------------------------


@router.get("/referrals/stats")
async def webapp_referral_stats(
    auth_payload: Optional[Dict] = Depends(get_terminal_auth_payload),
):
    from bot.services.referral_service import referral_service
    from bot.config.settings import settings

    user_id = _require_terminal_user(auth_payload)
    stats = referral_service.get_referral_stats(user_id)
    # NOTE: terminal JWT carries no username, so a webapp-first user's auto-created
    # code is user_id-derived. Common path (bot /ref) already seeds a username-based
    # code; readable-code-from-webapp is a minor follow-up (would need a User lookup).
    code_obj = referral_service.get_or_create_code(user_id)
    bot_username = settings.telegram_bot_username
    referral_link = f"https://t.me/{bot_username}?start={code_obj.code}"
    tier = code_obj.referrer_tier or "standard"
    reward_rate_pct = 40 if tier == "elite" else 30
    return {
        "referral_code": stats.get("referral_code", code_obj.code),
        "referral_link": referral_link,
        "total_referrals": stats.get("total_referrals", 0),
        "active_referrals": stats.get("active_referrals", 0),
        "total_earnings_usd": stats.get("total_earnings_usd", 0.0),
        "pending_rewards_usd": stats.get("pending_rewards_usd", 0.0),
        "pending_rewards_count": stats.get("pending_rewards_count", 0),
        "code_times_used": stats.get("code_times_used", 0),
        "tier": tier,
        "reward_rate_pct": reward_rate_pct,
    }


@router.get("/referrals")
async def webapp_referrals_list(
    auth_payload: Optional[Dict] = Depends(get_terminal_auth_payload),
    limit: int = Query(default=20, ge=1, le=100),
):
    from bot.services.referral_service import referral_service

    user_id = _require_terminal_user(auth_payload)
    referrals = referral_service.get_referrals_list(user_id, limit=limit)
    return {"referrals": referrals}


@router.get("/referrals/code")
async def webapp_referral_code(
    auth_payload: Optional[Dict] = Depends(get_terminal_auth_payload),
):
    from bot.services.referral_service import referral_service
    from bot.config.settings import settings

    user_id = _require_terminal_user(auth_payload)
    code_obj = referral_service.get_or_create_code(user_id)
    bot_username = settings.telegram_bot_username
    return {
        "code": code_obj.code,
        "link": f"https://t.me/{bot_username}?start={code_obj.code}",
    }


@router.get("/referrals/leaderboard")
async def webapp_referral_leaderboard(
    auth_payload: Optional[Dict] = Depends(get_terminal_auth_payload),
):
    from bot.services.referral_service import referral_service

    _require_terminal_user(auth_payload)
    leaderboard = referral_service.get_leaderboard(limit=20)
    return {
        "leaderboard": [
            {
                "rank": idx + 1,
                "username": entry.get("username"),
                "total_reward_usd": entry.get("total_reward_usd", 0.0),
            }
            for idx, entry in enumerate(leaderboard)
        ]
    }


# ---------------------------------------------------------------------------
# Support tickets (webapp Support page; fan-out/notify handled by support_notifier)
# ---------------------------------------------------------------------------


def _ticket_to_webapp(ticket: SupportTicket) -> Dict:
    return {
        "id": str(ticket.id),
        "kind": ticket.kind,
        "status": ticket.status,
        "message": ticket.message,
        "category": ticket.category,
        "adminReply": ticket.admin_reply,
        "createdAt": _iso_utc(ticket.created_at) if ticket.created_at else None,
    }


@router.get("/support/tickets")
async def webapp_support_tickets(
    auth_payload: Optional[Dict] = Depends(get_terminal_auth_payload),
):
    user_id = _require_terminal_user(auth_payload)
    with get_session() as session:
        tickets = (
            session.query(SupportTicket)
            .filter(SupportTicket.user_id == user_id)
            .order_by(SupportTicket.created_at.desc())
            .limit(50)
            .all()
        )
        return [_ticket_to_webapp(t) for t in tickets]


class WebAppSupportTicketRequest(BaseModel):
    kind: str = TicketKind.SUPPORT
    message: str


@router.post("/support/tickets")
async def webapp_create_support_ticket(
    body: WebAppSupportTicketRequest,
    auth_payload: Optional[Dict] = Depends(get_terminal_auth_payload),
):
    user_id = _require_terminal_user(auth_payload)
    message = (body.message or "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="Message is required")
    kind = body.kind if body.kind in (TicketKind.SUPPORT, TicketKind.BUG) else TicketKind.SUPPORT
    with get_session() as session:
        ticket = SupportTicket(
            user_id=user_id,
            kind=kind,
            source="webapp",
            message=message[:4000],
            status=TicketStatus.OPEN,
        )
        session.add(ticket)
        session.commit()
        session.refresh(ticket)
        return _ticket_to_webapp(ticket)


@router.get("/execution/benchmark")
async def get_execution_benchmark(
    from_token: str = Query(..., max_length=40),
    to_token: str = Query(..., max_length=40),
    window_days: int = Query(30, ge=1, le=180),
    tg_user: TelegramUser = Depends(get_telegram_user),
    db: Session = Depends(get_db),
):
    """Where this user's execution sits versus everyone trading the same shape.

    EXECUTION INTELLIGENCE (phase 3). This is the thing a trader cannot compute
    from their own history — a percentile needs everyone else's fills.

    PRIVACY: cohort suppression below MIN_COHORT_USERS distinct users is
    enforced inside ExecutionBenchmark's query layer, not here, so no route or
    future export can bypass it by forgetting the check. A suppressed response
    says so explicitly rather than masquerading as "no data".

    Every percentile is returned with a concrete remedy where one applies — a
    benchmark that only tells a user they underperformed gives them a reason
    to leave and no way to act on it.
    """
    from bot.services.execution_benchmark import execution_benchmark

    user = db.query(User).filter(User.telegram_id == tg_user.id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    try:
        return execution_benchmark.user_percentile(
            user_id=user.id,
            from_token=from_token.upper(),
            to_token=to_token.upper(),
            window_days=window_days,
        )
    except Exception as e:
        logger.error(f"[execution_benchmark] failed: {e}")
        raise HTTPException(status_code=503, detail="Benchmark temporarily unavailable")


@router.get("/execution/receipt/{swap_id}")
async def get_execution_receipt(
    swap_id: int,
    tg_user: TelegramUser = Depends(get_telegram_user),
    db: Session = Depends(get_db),
):
    """What actually happened to one fill, and whether it was us or the market.

    EXECUTION INTELLIGENCE (phase 4). The scoring pipeline has been marking
    every completed swap in production since phase 2; this is the first surface
    that shows a user their own numbers.

    OWNERSHIP: the swap lookup is scoped by user_id inside the service, and a
    swap belonging to someone else returns the same 404 as one that does not
    exist — a distinguishable response would let a caller enumerate swap ids.

    PRIVACY: the cohort percentile is delegated to ExecutionBenchmark, which
    enforces the k-anonymity floor in its query layer. This route never touches
    cohort rows directly and so cannot bypass it.
    """
    from bot.services.execution_receipt import execution_receipt

    user = db.query(User).filter(User.telegram_id == tg_user.id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    try:
        receipt = execution_receipt.build(user_id=user.id, swap_id=swap_id)
    except Exception as e:
        logger.error(f"[execution_receipt] failed for swap {swap_id}: {e}")
        raise HTTPException(status_code=503, detail="Receipt temporarily unavailable")

    if receipt is None:
        raise HTTPException(status_code=404, detail="Swap not found")
    return receipt
