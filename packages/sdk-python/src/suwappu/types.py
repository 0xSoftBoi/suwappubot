from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class SuwappuConfig(BaseModel):
    api_key: str = ""
    base_url: str = "https://api.suwappu.bot"


class TokenRef(BaseModel):
    symbol: str
    address: str
    decimals: int = 0


class Quote(BaseModel):
    """Mirrors the response of POST /v1/agent/quote (api-ts agent.ts).

    EVM quotes include from_chain/to_chain/estimated_gas_usd/bridge_fee_usd;
    Solana quotes include chain/requires_wallet/wallet_type instead. Both
    shapes share quote_id, from_token/to_token, amount_in/out, route, etc.
    """

    quote_id: str
    chain_type: str = ""
    from_token: TokenRef
    to_token: TokenRef
    amount_in: str
    amount_out: str
    amount_out_min: str = ""
    exchange_rate: str = ""
    price_impact: str = ""
    route: str = ""
    slippage: str = ""
    dex: str = ""
    expires_in_seconds: int = 60
    chain: str | None = None
    from_chain: str | None = None
    to_chain: str | None = None
    estimated_gas_usd: str | None = None
    bridge_fee_usd: str | None = None
    estimated_time_seconds: float | None = None
    model_config = {"extra": "allow"}


class SwapResult(BaseModel):
    """Mirrors the response of POST /v1/agent/swap/execute."""

    swap_id: int
    status: str
    tx_hash: str | None = None
    poll_url: str | None = None


class TokenBalance(BaseModel):
    symbol: str
    name: str = ""
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
    decimals: int = 0


# --- Market data (/v1/data/*, docs/plans/market-data-parity.md Phase 4) ---


class ReferenceChain(BaseModel):
    slug: str
    chain_id: int | str
    name: str
    native_token: str
    type: str


class ReferenceToken(BaseModel):
    symbol: str
    address: str
    decimals: int = 0
    name: str | None = None


class ReferenceChainTokens(BaseModel):
    """One entry of the `chains` list returned when `/reference/tokens` is
    called without a `chain` filter."""

    chain_id: int | str
    tokens: list[ReferenceToken] = Field(default_factory=list)


class ReferenceTokensResult(BaseModel):
    """GET /v1/data/reference/tokens response.

    When `chain` is passed to the request, `chain`/`chain_id`/`tokens` are
    populated. When omitted, `chains` holds every chain's registry instead.
    """

    chain: str | None = None
    chain_id: int | str | None = None
    tokens: list[ReferenceToken] | None = None
    chains: list[ReferenceChainTokens] | None = None
    model_config = {"extra": "allow"}


class ResolvedSymbol(BaseModel):
    symbol: str
    chain: str
    chain_id: int | str | None = None
    address: str
    decimals: int = 0
    coingecko_id: str | None = None


class OhlcvCandle(BaseModel):
    ts: str
    open: str
    high: str
    low: str
    close: str
    volume: str | None = None
    source: str


class OhlcvResult(BaseModel):
    symbol: str
    chain: str
    timeframe: str
    source: str
    candles: list[OhlcvCandle] = Field(default_factory=list)
    note: str | None = None
    # Present when more rows may exist (Round 2 cursor pagination) — pass
    # back into get_ohlcv(cursor=...) to page forward.
    next_cursor: str | None = None


class OhlcvSymbolGroup(BaseModel):
    """One symbol's entry within an OhlcvMultiResult."""

    source: str
    candles: list[OhlcvCandle] = Field(default_factory=list)


class OhlcvMultiResult(BaseModel):
    """GET /v1/data/history/ohlcv?symbols=A,B — grouped multi-symbol response."""

    chain: str
    timeframe: str
    symbols: dict[str, OhlcvSymbolGroup] = Field(default_factory=dict)
    next_cursor: str | None = None


class DataUsage(BaseModel):
    total_requests: int = 0
    first_seen_at: str | None = None
    last_seen_at: str | None = None
    by_endpoint: dict[str, int] = Field(default_factory=dict)


class DataMetadataTimeframeCoverage(BaseModel):
    """One (symbol, chain, timeframe) bucket within a DataMetadata dataset."""

    candles: int = 0
    start: str
    end: str


class DataMetadataDataset(BaseModel):
    """GET /v1/data/metadata — per-(symbol, chain) dataset coverage, one entry per timeframe."""

    symbol: str
    chain: str
    timeframes: dict[str, DataMetadataTimeframeCoverage] = Field(default_factory=dict)


class VenueDatasetCoverage(BaseModel):
    """Round 5 — per-dataset counts/ranges under `venue_datasets` on DataMetadata."""

    count: int = 0
    start: str | None = None
    end: str | None = None


class VenueDatasetFreshness(BaseModel):
    """Round 5 — per-dataset freshness under `venue_datasets` on DataStatus.

    `healthy` is trivially True when `count` is 0 — an empty (not-yet-capturing)
    dataset never drags down the overall `.healthy` flag.
    """

    count: int = 0
    latest_ts: str | None = None
    age_seconds: int | None = None
    healthy: bool = True


class MetadataVenueDatasets(BaseModel):
    """Round 5 `venue_datasets` shape on DataMetadata (counts/ranges)."""

    perps: VenueDatasetCoverage = Field(default_factory=VenueDatasetCoverage)
    predictions: VenueDatasetCoverage = Field(default_factory=VenueDatasetCoverage)
    lend: VenueDatasetCoverage = Field(default_factory=VenueDatasetCoverage)


class StatusVenueDatasets(BaseModel):
    """Round 5 `venue_datasets` shape on DataStatus (freshness)."""

    perps: VenueDatasetFreshness = Field(default_factory=VenueDatasetFreshness)
    predictions: VenueDatasetFreshness = Field(default_factory=VenueDatasetFreshness)
    lend: VenueDatasetFreshness = Field(default_factory=VenueDatasetFreshness)


class DataMetadata(BaseModel):
    """GET /v1/data/metadata response."""

    datasets: list[DataMetadataDataset] = Field(default_factory=list)
    total_candles: int = 0
    # True when `datasets` was capped (at 500) — narrow with symbol/chain to see more.
    truncated: bool | None = None
    note: str | None = None
    # Round 5 — counts/ranges for perp_metrics/prediction_snapshots/lend_metrics.
    venue_datasets: MetadataVenueDatasets | None = None


class DataStatusTimeframe(BaseModel):
    latest_ts: str | None = None
    age_seconds: int | None = None


class DataStatus(BaseModel):
    """GET /v1/data/status — capture freshness per timeframe + per-source counts."""

    timeframes: dict[str, DataStatusTimeframe] = Field(default_factory=dict)
    sources: dict[str, int] = Field(default_factory=dict)
    # True when 1m data is fresher than 5 minutes AND every non-empty Round 5
    # venue dataset is fresh.
    healthy: bool = False
    # Round 5 — freshness for perp_metrics/prediction_snapshots/lend_metrics.
    venue_datasets: StatusVenueDatasets | None = None


# ===========================================
# Round 5 — perps / predictions / lend (docs/plans/market-data-parity.md)
# ===========================================


class PerpMarketSnapshot(BaseModel):
    """GET /v1/data/perps/markets — one entry per (venue, symbol), latest snapshot."""

    venue: str
    symbol: str
    ts: str
    funding_rate: str | None = None
    open_interest: str | None = None
    mark_price: str | None = None
    index_price: str | None = None
    volume_24h: str | None = None


class PerpsMarketsResult(BaseModel):
    venues: list[str] = Field(default_factory=list)
    markets: list[PerpMarketSnapshot] = Field(default_factory=list)


class PerpHistoryPoint(BaseModel):
    ts: str
    funding_rate: str | None = None
    open_interest: str | None = None
    mark_price: str | None = None
    index_price: str | None = None
    volume_24h: str | None = None


class PerpsHistoryResult(BaseModel):
    symbol: str
    venue: str
    metrics: list[PerpHistoryPoint] = Field(default_factory=list)
    next_cursor: str | None = None


class PredictionMarketSnapshot(BaseModel):
    """GET /v1/data/predictions/markets — one entry per (market_id, outcome), latest snapshot."""

    venue: str
    market_id: str
    condition_id: str | None = None
    question: str | None = None
    outcome: str
    ts: str
    price: str | None = None
    volume: str | None = None
    liquidity: str | None = None
    end_date: str | None = None


class PredictionMarketsResult(BaseModel):
    markets: list[PredictionMarketSnapshot] = Field(default_factory=list)


class PredictionHistoryPoint(BaseModel):
    ts: str
    price: str | None = None
    volume: str | None = None
    liquidity: str | None = None


class PredictionHistoryResult(BaseModel):
    """`history` is set when `outcome` was passed to `get_prediction_history`;
    `outcomes` (grouped by outcome) otherwise."""

    market_id: str
    outcome: str | None = None
    history: list[PredictionHistoryPoint] | None = None
    outcomes: dict[str, list[PredictionHistoryPoint]] | None = None
    next_cursor: str | None = None


class LendMarketSnapshot(BaseModel):
    """GET /v1/data/lend/markets — one entry per market_id, latest snapshot."""

    venue: str
    market_id: str
    chain_id: int | None = None
    loan_symbol: str | None = None
    collateral_symbol: str | None = None
    ts: str
    supply_apy: str | None = None
    borrow_apy: str | None = None
    tvl: str | None = None
    utilization: str | None = None


class LendMarketsResult(BaseModel):
    markets: list[LendMarketSnapshot] = Field(default_factory=list)


class LendHistoryPoint(BaseModel):
    ts: str
    supply_apy: str | None = None
    borrow_apy: str | None = None
    tvl: str | None = None
    utilization: str | None = None


class LendHistoryResult(BaseModel):
    market_id: str
    metrics: list[LendHistoryPoint] = Field(default_factory=list)
    next_cursor: str | None = None


class LiveTick(BaseModel):
    """Server push from WS /v1/data/live: {"type":"tick","symbol","price_usd","ts"}."""

    type: str = "tick"
    symbol: str
    price_usd: float
    ts: str


class LiveCandle(BaseModel):
    """Server push from WS /v1/data/live on the `ohlcv` channel: the current
    in-progress 1m candle; `final=True` once when the minute closes."""

    type: str = "candle"
    channel: str = "ohlcv"
    timeframe: str = "1m"
    symbol: str
    final: bool = False
    ts: str
    open: float
    high: float
    low: float
    close: float


# Perps types (Hyperliquid)
class PerpMarket(BaseModel):
    name: str
    asset: str
    sz_decimals: int
    max_leverage: int
    venue_max_leverage: int
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
class PredictionMarketToken(BaseModel):
    token_id: str
    outcome: str


class PredictionMarket(BaseModel):
    id: str
    condition_id: str = ""
    question: str
    outcomes: list[str]
    outcome_prices: list[float]
    tokens: list[PredictionMarketToken] = Field(default_factory=list)
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
class LendingMarketWarning(BaseModel):
    type: str
    level: str


class LendingMarket(BaseModel):
    id: str
    loan_token: str
    collateral_token: str
    lltv: float
    supply_apy: float
    borrow_apy: float
    # Backwards-compatible aliases for the explicit USD fields below.
    total_supply: float | None
    total_borrow: float | None
    total_supply_usd: float | None
    total_borrow_usd: float | None
    available_liquidity_usd: float | None
    utilization: float
    chain_id: int
    listed: bool
    warnings: list[LendingMarketWarning]


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


# --- Swap simulation & history ---


class SwapSimulationExpectedOutput(BaseModel):
    token: str = ""
    amount: str = ""
    amount_usd: str | None = None


class SwapSimulationFees(BaseModel):
    protocol: str | None = None
    gas_estimate: str | None = None


class SwapSimulationCheck(BaseModel):
    name: str = ""
    status: Literal["pass", "warn", "fail"] = "warn"
    detail: str = ""
    unverified: bool | None = None


class SwapSimulation(BaseModel):
    """Result of POST /v1/agent/swap/simulate — a dry run, nothing broadcast."""

    success: bool = False
    would_execute: bool = False
    quote_id: str = ""
    chain_type: str = ""
    expected_output: SwapSimulationExpectedOutput = SwapSimulationExpectedOutput()
    min_output_after_slippage: str = ""
    price_impact_pct: float | None = None
    fees: SwapSimulationFees = SwapSimulationFees()
    checks: list[SwapSimulationCheck] = []
    warnings: list[str] = []
    model_config = {"extra": "allow"}


class SwapHistoryItem(BaseModel):
    id: int | str
    status: str
    from_token: str | None = None
    to_token: str | None = None
    from_amount: str | None = None
    to_amount: str | None = None
    chain: str | None = None
    tx_hash: str | None = None
    created_at: str | None = None
    model_config = {"extra": "allow"}


class SwapHistoryPagination(BaseModel):
    total: int = 0
    limit: int = 20
    offset: int = 0
    has_more: bool = False


class SwapHistoryResult(BaseModel):
    swaps: list[SwapHistoryItem] = []
    pagination: SwapHistoryPagination = SwapHistoryPagination()


# --- Agent wallets ---


class AgentWallet(BaseModel):
    address: str
    chain_type: str | None = None
    provider: str | None = None
    model_config = {"extra": "allow"}


class LinkCodeResult(BaseModel):
    code: str
    expires_at: str | None = None
    model_config = {"extra": "allow"}


# --- Approvals (human-in-the-loop control plane) ---

ApprovalStatus = Literal["pending", "approved", "denied", "expired"]


class Approval(BaseModel):
    id: str
    status: str
    agent_id: str | None = None
    action: str | None = None
    reason: str | None = None
    created_at: str | None = None
    decided_at: str | None = None
    model_config = {"extra": "allow"}


class StepUpChallenge(BaseModel):
    challenge: str
    expires_at: str | None = None
    model_config = {"extra": "allow"}


# --- Audit chain ---


class AuditEvent(BaseModel):
    id: int | str
    event_type: str
    agent_id: str | None = None
    org_id: str | None = None
    details: dict | None = None
    created_at: str | None = None
    model_config = {"extra": "allow"}


class AuditVerifyResult(BaseModel):
    valid: bool = False
    count: int | None = None
    first_break_id: int | str | None = None
    model_config = {"extra": "allow"}


# --- Kill switch ---


class KillSwitch(BaseModel):
    scope: str
    scope_id: str | None = None
    active: bool = False
    reason: str | None = None
    model_config = {"extra": "allow"}
