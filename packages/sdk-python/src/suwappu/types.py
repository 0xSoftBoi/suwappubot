from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class SuwappuConfig(BaseModel):
    api_key: str = ""
    base_url: str = "https://api.suwappu.bot"


class Quote(BaseModel):
    id: str
    from_token: str
    to_token: str
    from_amount: str
    to_amount: str
    route: str
    gas: str
    fee: str
    chain: str


class SwapResult(BaseModel):
    tx_hash: str
    status: Literal["confirmed", "pending", "failed"]
    chain: str


class TokenBalance(BaseModel):
    token: str
    balance: str
    usd_value: str
    chain: str


class TokenPrice(BaseModel):
    token: str
    price_usd: str
    change_24h: str


class Chain(BaseModel):
    id: int | str
    key: str
    name: str
    native_token: str
    type: str


class Token(BaseModel):
    symbol: str
    address: str
    decimals: int
    chain: str


# Perps types (Hyperliquid)
class PerpMarket(BaseModel):
    name: str
    asset: str
    sz_decimals: int
    max_leverage: int
    mark_price: float
    funding_rate: float


class PerpQuote(BaseModel):
    market: str
    side: Literal["long", "short"]
    size: float
    leverage: float
    entry_price: float
    margin: float
    liquidation_price: float
    funding_rate: float
    fee: float


class PerpPosition(BaseModel):
    id: str
    market: str
    side: Literal["long", "short"]
    size: float
    leverage: float
    entry_price: float
    mark_price: float
    margin: float
    unrealized_pnl: float
    liquidation_price: float
    funding_rate: float


# Prediction types (Polymarket)
class PredictionMarket(BaseModel):
    id: str
    question: str
    outcomes: list[str]
    outcome_prices: list[float]
    volume: float
    liquidity: float
    end_date: str
    active: bool
    category: str


class PredictionMarketDetail(PredictionMarket):
    description: str
    created_at: str
    resolved_outcome: str | None


# Lending types (Morpho)
class LendingMarket(BaseModel):
    id: str
    loan_token: str
    collateral_token: str
    lltv: float
    supply_apy: float
    borrow_apy: float
    total_supply: float
    total_borrow: float
    utilization: float
    chain_id: int


class LendingMarketDetail(LendingMarket):
    oracle: str
    irm: str
    created_at: str


# Agent account management types
AgentErrorCode = Literal[
    "UNAUTHORIZED",
    "INVALID_API_KEY",
    "INSUFFICIENT_SCOPE",
    "RATE_LIMITED",
    "PAYMENT_REQUIRED",
    "INSUFFICIENT_CREDITS",
    "VALIDATION_ERROR",
    "QUOTE_EXPIRED",
    "QUOTE_NOT_FOUND",
    "WALLET_NOT_FOUND",
    "POLICY_VIOLATION",
    "CHAIN_UNSUPPORTED",
    "TOKEN_UNKNOWN",
    "MARKET_NOT_FOUND",
    "UPSTREAM_ERROR",
    "NOT_FOUND",
    "INTERNAL",
]


class AgentProfile(BaseModel):
    id: str
    name: str
    description: str | None = None
    callback_url: str | None = None
    metadata: dict | None = None
    active: bool = True
    created_at: str | None = None


class RegisterAgentResult(BaseModel):
    agent: AgentProfile
    api_key: str
    message: str | None = None
    important: str | None = None


class RotateKeysResult(BaseModel):
    api_key: str
    message: str | None = None


class WalletPolicy(BaseModel):
    id: str
    type: str | None = None
    created_at: str | None = None
    model_config = {"extra": "allow"}


class WebhookEvent(BaseModel):
    id: str
    event_type: str
    status: str
    attempts: int
    last_error: str | None = None
    response_status: int | None = None
    callback_url: str
    created_at: str
    delivered_at: str | None = None


class WebhookPagination(BaseModel):
    total: int
    limit: int
    offset: int
    has_more: bool


class WebhookEventsResult(BaseModel):
    events: list[WebhookEvent]
    pagination: WebhookPagination


class WebhookTestResult(BaseModel):
    success: bool
    callback_url: str | None = None
    status_code: int | None = None
    response_time_ms: float | None = None
    error: str | None = None


class BillingStatus(BaseModel):
    model_config = {"extra": "allow"}


class BillingCheckoutResult(BaseModel):
    url: str


class BillingCryptoResult(BaseModel):
    model_config = {"extra": "allow"}
