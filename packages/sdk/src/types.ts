/**
 * Public types for the Suwappu TypeScript SDK.
 *
 * Field names are camelCase to match the JSON keys the API returns
 * (e.g. `fromToken`, `usdValue`, `markPrice`). This mirrors
 * `packages/sdk-python/src/suwappu/types.py`, with the snake_case →
 * camelCase mapping the Python client performs at the boundary.
 */

export interface SuwappuConfig {
  /** API key. Falls back to the SUWAPPU_API_KEY env var. */
  apiKey?: string;
  /** API base URL. Defaults to https://api.suwappu.bot. */
  baseUrl?: string;
}

// --- Swap ---

export interface Quote {
  id: string;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  toAmount: string;
  /** Worst-case amount the caller will receive after slippage — surface this to end users. */
  amountOutMin: string;
  route: string;
  gas: string;
  fee: string;
  chain: string;
  /** Extended fields surfaced by the EVM (Li.Fi) quote path. */
  exchangeRate: string;
  priceImpact: string;
  slippage: string;
  estimatedTimeSeconds: number;
  /** Seconds until this quote id expires and must be re-fetched before executing. */
  expiresInSeconds: number;
  dex: string;
}

export interface SwapResult {
  /** Numeric id of the swap_transactions row; poll GET /v1/agent/swap/status/:swapId. */
  swapId: number;
  txHash: string | null;
  status: "confirmed" | "pending" | "failed" | "ready" | string;
  /** e.g. `/v1/agent/swap/status/42`. */
  pollUrl?: string;
}

export interface TokenBalance {
  token: string;
  balance: string;
  usdValue: string;
  chain: string;
}

export interface TokenPrice {
  token: string;
  priceUsd: string;
  change24h: string;
}

export interface Chain {
  id: number | string;
  key: string;
  name: string;
  native_token: string;
  type: string;
}

// --- NEAR (/v1/near/*) ---

export interface NearAsset {
  symbol: string;
  /** Id on intents.near (nep141:/nep245:). Use for swap token_in/out. */
  defuseAssetId: string;
  contractId?: string;
  decimals: number;
  chain: string;
}

export type NearResolveResult =
  | { status: "ok"; asset: NearAsset }
  | { status: "ambiguous"; candidates: NearAsset[]; hint: string }
  | { status: "not_found"; hint: string };

export interface NearAmount {
  asset: NearAsset;
  human: string;
  atomic: string;
}

export interface Token {
  symbol: string;
  address: string;
  decimals: number;
  chain: string;
}

// --- Perps (Hyperliquid) ---

export interface PerpMarket {
  name: string;
  asset: string;
  szDecimals: number;
  /** Maximum leverage accepted by the current Suwappu quote route for this market. */
  maxLeverage: number;
  /** Raw maximum leverage reported by Hyperliquid for the venue market. */
  venueMaxLeverage: number;
  markPrice: number;
  /** Current raw market funding rate reported by Hyperliquid. */
  fundingRate: number;
}

export interface PerpQuote {
  market: string;
  side: "long" | "short";
  size: number;
  leverage: number;
  entryPrice: number;
  margin: number;
  liquidationPrice: number;
  fundingRate: number;
  fee: number;
}

export interface PerpPosition {
  id: string;
  market: string;
  side: "long" | "short";
  size: number;
  leverage: number;
  entryPrice: number;
  markPrice: number;
  margin: number;
  unrealizedPnl: number;
  liquidationPrice: number;
  fundingRate: number;
}

// --- Predictions (Polymarket) ---

export interface PredictionMarketToken {
  tokenId: string;
  outcome: string;
}

export interface PredictionMarket {
  id: string;
  /** On-chain condition id used by the venue for settlement. */
  conditionId: string;
  question: string;
  outcomes: string[];
  outcomePrices: number[];
  /** Outcome-token ids returned by the API. Orders use tokenId, not market id. */
  tokens: PredictionMarketToken[];
  volume: number;
  liquidity: number;
  endDate: string;
  active: boolean;
  category: string;
}

export interface PredictionMarketDetail extends PredictionMarket {
  description: string;
  createdAt: string;
  resolvedOutcome: string | null;
}

/** A single outcome's order book entry, as returned by the CLOB. */
export interface PredictionOrderbookLevel {
  price: string;
  size: string;
}

export interface PredictionOutcomeBook {
  outcome: string;
  tokenId: string;
  bids?: PredictionOrderbookLevel[];
  asks?: PredictionOrderbookLevel[];
  [key: string]: unknown;
}

export interface PredictionOrderbook {
  marketId: string;
  question: string;
  outcomes: PredictionOutcomeBook[];
}

export interface PredictionPriceLevel {
  outcome: string;
  tokenId: string;
  mid: string;
}

export interface PredictionPrices {
  marketId: string;
  question: string;
  prices: PredictionPriceLevel[];
}

export interface PredictionTrade {
  outcome: string;
  tokenId: string;
  timestamp: string;
  [key: string]: unknown;
}

export interface PredictionTrades {
  marketId: string;
  question: string;
  trades: PredictionTrade[];
}

/** Order placement request body — mirrors the CLOB PlaceOrderSchema. */
export interface PredictionOrderRequest {
  tokenId: string;
  /** Limit price, 0 < price <= 1. */
  price: string;
  size: string;
  side: "BUY" | "SELL";
}

/** CLOB responses are loosely typed; expose the raw object. */
export type PredictionOrderResult = Record<string, unknown>;
export type PredictionPosition = Record<string, unknown>;
export type PredictionOrder = Record<string, unknown>;

// --- Lending (Morpho) ---

export interface LendingMarketWarning {
  type: string;
  level: string;
}

export interface LendingMarket {
  id: string;
  loanToken: string;
  collateralToken: string;
  lltv: number;
  supplyApy: number;
  borrowApy: number;
  /** @deprecated Use totalSupplyUsd; retained for backwards compatibility. */
  totalSupply: number | null;
  /** @deprecated Use totalBorrowUsd; retained for backwards compatibility. */
  totalBorrow: number | null;
  totalSupplyUsd: number | null;
  totalBorrowUsd: number | null;
  availableLiquidityUsd: number | null;
  utilization: number;
  chainId: number;
  /** Morpho interface listing status; not a guarantee or endorsement. */
  listed: boolean;
  /** Active Morpho market warnings reported by the upstream API. */
  warnings: LendingMarketWarning[];
}

export interface LendingMarketDetail extends LendingMarket {
  oracle: string;
  irm: string;
  createdAt: string;
}

// --- Agent account (register / me / billing / swap status) ---
// NOTE: `AgentProfile` and `RegisterAgentArgs` are defined once, further
// down in the "Agent lifecycle" section, and reused by both the top-level
// convenience methods (register/me) and the richer `agent.*` namespace.

/** @deprecated kept for callers that used the old flat register() shape; prefer `RegisterAgentResult`. */
export interface RegisterResult {
  id: string;
  name: string;
  /** Returned once at registration time — the API never re-exposes it. */
  apiKey: string;
  createdAt: string;
}

export interface BillingCredits {
  balance: number;
  lifetimePurchased: number;
  lifetimeUsed: number;
}

export interface BillingSubscribe {
  endpoint: string;
  tierPricesUsd: Record<string, number>;
  periodDays: number;
  active: { tier: string; expiresAt: string } | null;
}

export interface BillingTopup {
  endpoint: string;
  note: string;
}

export interface BillingInfo {
  agentId: string;
  tier: string;
  meteringEnabled: boolean;
  bypassTiers: string[];
  isMetered: boolean;
  credits: BillingCredits;
  creditUsdValue: number;
  costWeights: Record<string, number>;
  topup: BillingTopup;
  subscribe: BillingSubscribe;
}

export interface SwapStatus {
  swapId: number;
  status: string;
  txHash: string | null;
  fromChain: string;
  toChain: string;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  toAmount: string;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

// --- Ergonomic argument shapes (match the showcase examples) ---

export interface GetQuoteArgs {
  from: string;
  to: string;
  /** Single-chain convenience form. Ignored if fromChain/toChain are set. */
  chain?: string;
  /** Source chain for a cross-chain quote. Falls back to `chain`. */
  fromChain?: string;
  /** Destination chain for a cross-chain quote. Falls back to `chain`. */
  toChain?: string;
  amount: string | number;
  /** Bind the quote to the sender used for simulation or self-custody preparation. */
  walletAddress?: string;
  slippage?: number;
}

export interface PerpQuoteArgs {
  market: string;
  side: "long" | "short";
  size: number;
  leverage: number;
}

export interface PredictListArgs {
  query?: string;
  limit?: number;
}

// --- Agent lifecycle ---

export interface AgentProfile {
  id: string;
  name: string;
  description?: string | null;
  callbackUrl?: string | null;
  metadata?: Record<string, unknown> | null;
  rateLimitTier?: string;
  stats?: { totalRequests: number; totalSwaps: number };
  createdAt?: string;
  lastActiveAt?: string | null;
  updatedAt?: string;
}

export interface RegisterAgentArgs {
  name: string;
  description?: string;
  callbackUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface RegisterAgentResult {
  agent: AgentProfile & { apiKey: string };
  message: string;
  important: string;
}

export interface UpdateAgentArgs {
  description?: string;
  callbackUrl?: string | null;
  metadata?: Record<string, unknown>;
}

export interface RotateKeysResult {
  apiKey: string;
  message: string;
}

// --- Wallet policies ---

export interface CreatePolicyArgs {
  type: "spending_limit" | "whitelist";
  params: {
    maxAmountWei?: string;
    /** @deprecated Rejected with 400: only per-transaction limits are supported. */
    timeWindowSeconds?: number;
    allowedAddresses?: string[];
  };
}

export type WalletPolicy = Record<string, unknown>;

// --- Webhooks ---

export interface WebhookEvent {
  id: string | number;
  eventType: string;
  status: string;
  attempts: number;
  lastError?: string | null;
  responseStatus?: number | null;
  callbackUrl: string;
  createdAt: string;
  deliveredAt?: string | null;
}

export interface WebhookEventsResult {
  events: WebhookEvent[];
  pagination: { total: number; limit: number; offset: number; hasMore: boolean };
}

export interface WebhookTestResult {
  success: boolean;
  callbackUrl: string;
  statusCode?: number;
  responseTimeMs: number;
  error?: string;
}

// --- Billing ---

export interface BillingCheckoutResult {
  url: string;
}

export interface BillingCryptoArgs {
  txHash: string;
  chain?: string;
  amount: number;
  tier: "pro" | "premium" | "enterprise";
}

export interface BillingStatus {
  tier: string;
  feeRatePercent: number;
  expiresAt: string | null;
  active: boolean;
}

export interface AgentTopupArgs {
  txHash: string;
  chain?: string;
  amount: number | string;
}

// --- Swap simulation & history ---

export interface SwapSimulationCheck {
  name: string;
  status: "pass" | "warn" | "fail";
  detail: string;
  unverified?: boolean;
}

/** Camel-cased view of POST /v1/agent/swap/simulate. Nothing is broadcast. */
export interface SwapSimulation {
  success: boolean;
  /** True only when the server's safety-critical preflight checks allow execution. */
  wouldExecute: boolean;
  quoteId: string;
  chainType: "evm" | "solana";
  expectedOutput: {
    token: string;
    amount: string;
    amountUsd: string | null;
  };
  minOutputAfterSlippage: string;
  priceImpactPct: number | null;
  fees: {
    protocol: string | null;
    gasEstimate: string | null;
  };
  checks: SwapSimulationCheck[];
  warnings: string[];
}

export interface SwapHistoryItem {
  id: number | string;
  status: string;
  fromToken?: string;
  toToken?: string;
  fromAmount?: string;
  toAmount?: string;
  chain?: string;
  txHash?: string | null;
  createdAt?: string;
  [key: string]: unknown;
}

export interface SwapHistoryResult {
  swaps: SwapHistoryItem[];
  pagination: { total: number; limit: number; offset: number; hasMore: boolean };
}

// --- Agent wallets ---

export interface AgentWallet {
  address: string;
  chainType?: string;
  provider?: string;
  [key: string]: unknown;
}

export interface LinkCodeResult {
  code: string;
  expiresAt?: string;
  [key: string]: unknown;
}

// --- Approvals (human-in-the-loop control plane) ---

export type ApprovalStatus = "pending" | "approved" | "denied" | "expired" | (string & {});

export interface Approval {
  id: string;
  status: ApprovalStatus;
  agentId?: string;
  action?: string;
  reason?: string | null;
  createdAt?: string;
  decidedAt?: string | null;
  [key: string]: unknown;
}

export interface StepUpChallenge {
  challenge: string;
  expiresAt?: string;
  [key: string]: unknown;
}

// --- Audit chain ---

export interface AuditEvent {
  id: number | string;
  eventType: string;
  agentId?: string | null;
  orgId?: string | null;
  details?: Record<string, unknown>;
  createdAt?: string;
  [key: string]: unknown;
}

export interface AuditListArgs {
  eventType?: string;
  agentId?: string;
  /** ISO-8601 timestamp; only events at or after this are returned. */
  since?: string;
  /** 1–500, clamped server-side. */
  limit?: number;
}

export interface AuditVerifyResult {
  valid: boolean;
  count?: number;
  firstBreakId?: number | string | null;
  [key: string]: unknown;
}

// --- Kill switch ---

export type KillSwitchScope = "org" | "agent" | "global" | (string & {});

export interface KillSwitch {
  scope: KillSwitchScope;
  scopeId?: string | null;
  active: boolean;
  reason?: string | null;
  [key: string]: unknown;
}

export interface SetKillSwitchArgs {
  scope: KillSwitchScope;
  active: boolean;
  reason?: string;
}

// --- Market data (/v1/data/*, docs/plans/market-data-parity.md Phase 4) ---

export interface ReferenceChain {
  slug: string;
  chainId: number | string;
  name: string;
  nativeToken: string;
  type: string;
}

export interface ReferenceToken {
  symbol: string;
  address: string;
  decimals: number;
  name?: string;
}

/** GET /v1/data/reference/tokens?chain=... — shape when a single chain is requested. */
export interface ReferenceTokensForChain {
  chain: string;
  chainId?: number | string;
  tokens: ReferenceToken[];
}

/** GET /v1/data/reference/tokens (no chain param) — every chain's registry. */
export interface ReferenceTokensAllChains {
  chains: Array<{ chainId: number | string; tokens: ReferenceToken[] }>;
}

export type ReferenceTokensResult = ReferenceTokensForChain | ReferenceTokensAllChains;

export interface ResolvedSymbol {
  symbol: string;
  chain: string;
  chainId?: number | string;
  address: string;
  decimals: number;
  coingeckoId: string | null;
}

export type Timeframe = "1m" | "5m" | "1h" | "1d";

export interface GetOhlcvArgs {
  symbol: string;
  chain: string;
  timeframe?: Timeframe;
  /** ISO 8601 string or unix seconds. */
  start?: string | number;
  /** ISO 8601 string or unix seconds. */
  end?: string | number;
  limit?: number;
  /** Opaque cursor from a previous result's `nextCursor` — pages forward. */
  cursor?: string;
}

/** GET /v1/data/history/ohlcv?symbols=A,B — multi-symbol variant of GetOhlcvArgs. */
export interface GetOhlcvMultiArgs {
  symbols: string[];
  chain: string;
  timeframe?: Timeframe;
  start?: string | number;
  end?: string | number;
  limit?: number;
  cursor?: string;
}

export interface OhlcvCandle {
  ts: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string | null;
  source: string;
}

export interface OhlcvResult {
  symbol: string;
  chain: string;
  timeframe: Timeframe;
  /** "db" when served from persisted candles, "external_fallback" otherwise. */
  source: string;
  candles: OhlcvCandle[];
  note?: string;
  /** Present when more rows may exist — pass back into `cursor` to page forward. */
  nextCursor?: string;
}

/** Grouped response shape for `getOhlcvMulti` (`symbols=A,B`). */
export interface OhlcvMultiResult {
  chain: string;
  timeframe: Timeframe;
  symbols: Record<string, { source: string; candles: OhlcvCandle[] }>;
  nextCursor?: string;
}

export interface DataUsage {
  totalRequests: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  byEndpoint: Record<string, number>;
}

/** GET /v1/data/metadata — per-(symbol, chain) dataset coverage, one entry per timeframe. */
export interface DataMetadataDataset {
  symbol: string;
  chain: string;
  timeframes: Record<string, { candles: number; start: string; end: string }>;
}

export interface DataMetadata {
  datasets: DataMetadataDataset[];
  totalCandles: number;
  /** True when `datasets` was capped (at 500) — narrow with `symbol`/`chain` to see more. */
  truncated?: boolean;
  note?: string;
  /** Round 5 — counts/ranges for perp_metrics/prediction_snapshots/lend_metrics. */
  venueDatasets?: {
    perps: VenueDatasetCoverage;
    predictions: VenueDatasetCoverage;
    lend: VenueDatasetCoverage;
  };
}

/** GET /v1/data/status — capture freshness, one entry per timeframe, plus per-source counts. */
export interface DataStatusTimeframe {
  latestTs: string | null;
  ageSeconds: number | null;
}

/** Round 5 — per-dataset coverage reported under `venue_datasets` on `getDataMetadata`. */
export interface VenueDatasetCoverage {
  count: number;
  start: string | null;
  end: string | null;
}

/** Round 5 — per-dataset freshness reported under `venue_datasets` on `getDataStatus`. */
export interface VenueDatasetFreshness {
  count: number;
  latestTs: string | null;
  ageSeconds: number | null;
  /** Trivially true when `count` is 0 — an empty (not-yet-capturing) dataset never drags down overall `healthy`. */
  healthy: boolean;
}

export interface DataStatus {
  timeframes: Record<string, DataStatusTimeframe>;
  sources: Record<string, number>;
  /** True when 1m data is fresher than 5 minutes AND every non-empty Round 5 venue dataset is fresh. */
  healthy: boolean;
  /** Round 5 — freshness for perp_metrics/prediction_snapshots/lend_metrics. */
  venueDatasets?: {
    perps: VenueDatasetFreshness;
    predictions: VenueDatasetFreshness;
    lend: VenueDatasetFreshness;
  };
}

// ===========================================
// Round 5 — perps / predictions / lend (docs/plans/market-data-parity.md)
// ===========================================

/** GET /v1/data/perps/markets — one entry per (venue, symbol), latest snapshot. */
export interface PerpMarketSnapshot {
  venue: string;
  symbol: string;
  ts: string;
  fundingRate: string | null;
  openInterest: string | null;
  markPrice: string | null;
  indexPrice: string | null;
  volume24h: string | null;
}

export interface PerpsMarketsResult {
  venues: string[];
  markets: PerpMarketSnapshot[];
}

export interface GetPerpsHistoryArgs {
  symbol: string;
  /** Defaults to "hyperliquid" server-side when omitted. */
  venue?: string;
  start?: string | number;
  end?: string | number;
  limit?: number;
  cursor?: string;
}

export interface PerpHistoryPoint {
  ts: string;
  fundingRate: string | null;
  openInterest: string | null;
  markPrice: string | null;
  indexPrice: string | null;
  volume24h: string | null;
}

export interface PerpsHistoryResult {
  symbol: string;
  venue: string;
  metrics: PerpHistoryPoint[];
  nextCursor?: string;
}

/** GET /v1/data/predictions/markets — one entry per (market_id, outcome), latest snapshot. */
export interface PredictionMarketSnapshot {
  venue: string;
  marketId: string;
  conditionId: string | null;
  question: string | null;
  outcome: string;
  ts: string;
  price: string | null;
  volume: string | null;
  liquidity: string | null;
  endDate: string | null;
}

export interface GetPredictionMarketsArgs {
  /** Case-insensitive substring filter on `question`. */
  q?: string;
  /** Default 50, capped at 200. */
  limit?: number;
}

export interface PredictionMarketsResult {
  markets: PredictionMarketSnapshot[];
}

export interface GetPredictionHistoryArgs {
  marketId: string;
  /** Omit to get every outcome, grouped — see `PredictionHistoryResult.outcomes`. */
  outcome?: string;
  start?: string | number;
  end?: string | number;
  limit?: number;
  cursor?: string;
}

export interface PredictionHistoryPoint {
  ts: string;
  price: string | null;
  volume: string | null;
  liquidity: string | null;
}

/** `history` is set when `outcome` was passed; `outcomes` (grouped) otherwise. */
export interface PredictionHistoryResult {
  marketId: string;
  outcome?: string;
  history?: PredictionHistoryPoint[];
  outcomes?: Record<string, PredictionHistoryPoint[]>;
  nextCursor?: string;
}

/** GET /v1/data/lend/markets — one entry per market_id, latest snapshot. */
export interface LendMarketSnapshot {
  venue: string;
  marketId: string;
  chainId: number | null;
  loanSymbol: string | null;
  collateralSymbol: string | null;
  ts: string;
  supplyApy: string | null;
  borrowApy: string | null;
  tvl: string | null;
  utilization: string | null;
}

export interface GetLendMarketsArgs {
  chainId?: number;
}

export interface LendMarketsResult {
  markets: LendMarketSnapshot[];
}

export interface GetLendHistoryArgs {
  marketId: string;
  start?: string | number;
  end?: string | number;
  limit?: number;
  cursor?: string;
}

export interface LendHistoryPoint {
  ts: string;
  supplyApy: string | null;
  borrowApy: string | null;
  tvl: string | null;
  utilization: string | null;
}

export interface LendHistoryResult {
  marketId: string;
  metrics: LendHistoryPoint[];
  nextCursor?: string;
}

/** GET /v1/data/live server push: {"type":"tick","symbol","price_usd","ts"}. */
export interface LiveTick {
  type: "tick";
  symbol: string;
  priceUsd: number;
  ts: string;
}

/**
 * GET /v1/data/live server push on the `ohlcv` channel: the current
 * in-progress 1m candle, pushed on price change; `final: true` once when the
 * minute closes.
 */
export interface LiveCandle {
  type: "candle";
  channel: "ohlcv";
  timeframe: "1m";
  symbol: string;
  final: boolean;
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface SubscribeLiveArgs {
  /** Symbols to subscribe to on connect, e.g. ["ETH", "SOL"]. */
  symbols: string[];
  onTick: (tick: LiveTick) => void;
  /** Symbols to also subscribe to the 1m OHLCV candle channel on connect. */
  candleSymbols?: string[];
  onCandle?: (candle: LiveCandle) => void;
  onOpen?: () => void;
  onClose?: (event: { code: number; reason: string }) => void;
  onError?: (err: unknown) => void;
}

export interface LiveSubscription {
  /** Add symbols to the live tick subscription. */
  subscribe(symbols: string[]): void;
  /** Remove symbols from the live tick subscription. */
  unsubscribe(symbols: string[]): void;
  /** Add symbols to the 1m OHLCV candle subscription. */
  subscribeCandles(symbols: string[]): void;
  /** Remove symbols from the 1m OHLCV candle subscription. */
  unsubscribeCandles(symbols: string[]): void;
  /** Close the WebSocket connection. */
  close(): void;
}

// ============================================================================
// Bank — Suwappu Bank (`/v1/agent/bank/*`, agent API key required)
// ----------------------------------------------------------------------------
// Mirrors api-ts/src/routes/bank/*.ts (zod request schemas) and
// api-ts/src/services/bank/* (return shapes). ADD-ONLY section: nothing above
// this line may be changed by Bank work (api-ts, webapp and mobile import it).
// Money is ALWAYS a minor-unit integer string (e.g. "1500000" = 1.50 USDC at 6
// decimals). `amount` (human decimal string) is accepted by some routes and is
// converted server-side using the source account's asset decimals.
// ============================================================================

/** Codes from api-ts/src/services/bank/errors.ts (BankErrorCode) plus the route-level validation code. */
export type BankErrorCode =
  | "VALIDATION"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "CONFLICT"
  | "INSUFFICIENT_FUNDS"
  | "LIMIT_EXCEEDED"
  | "POLICY_BLOCKED"
  | "ACCOUNT_STATE"
  | "ASSET_UNSUPPORTED"
  | "WALLET_UNAVAILABLE"
  | "SIGNING_UNAVAILABLE"
  | "UPSTREAM"
  | "DB"
  | "NOT_CONFIGURED"
  | "LENDER_POOL_UNFUNDED"
  | "POOL_UNFUNDED"
  | "EXPOSURE_LIMIT"
  | "RAMP_UNAVAILABLE"
  | "RECEIVABLES_UNAVAILABLE"
  | "PROVIDER_NOT_CONFIGURED"
  | "PROVIDER_DOCS_REQUIRED"
  | "RAIL_NO_PROVIDER"
  | "ISSUER_NOT_CONFIGURED"
  | "INSUFFICIENT_AVAILABLE"
  | "LOCK_BUSY";

/** Every successful bank response is `{ success: true, ...payload }`. */
export type BankEnvelope<T> = { success: true } & T;

/** Response payloads whose service return type is not mirrored field-by-field. */
export type BankRecord = Record<string, unknown>;

export type BankOwnerType = "user" | "agent" | "org" | "partner_customer" | "system";
export type BankAccountKind = "checking" | "savings" | "credit" | "escrow" | "pool" | "treasury";
export type BankAccountStatus = "active" | "frozen" | "closed";
export type BankTransferStatus = "pending" | "submitted" | "confirmed" | "failed" | "reversed";
export type BankRail = "ach" | "wire" | "fednow" | "sepa" | "spei" | "pix" | "upi" | "vietqr" | "bre_b" | "swift";
export type BankRampProvider = "bridge" | "due";

/** Exactly one of `amountMinor` (minor units) or `amount` (human decimal) is required. */
export type BankAmountInput =
  | { amountMinor: string; amount?: undefined }
  | { amount: string; amountMinor?: undefined };

/** Exactly one of `amountMinor`, `amount` or `all: true`. */
export type BankAmountOrAllInput = BankAmountInput | { all: true; amountMinor?: undefined; amount?: undefined };

export interface BankOwnerRef {
  ownerType: "user" | "agent" | "org" | "partner_customer";
  ownerId: string;
}

export interface BankAccount {
  id: string;
  ownerType: BankOwnerType;
  ownerId: string;
  kind: BankAccountKind;
  currency: string;
  asset: string;
  chain: string;
  walletId: number | null;
  walletUserId: number | null;
  address: string | null;
  status: BankAccountStatus;
  segmentProfile: string | null;
  /** Ledger balance, minor units. */
  balanceMinor: string;
  label: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  /** Human decimal balance (presentAccount); null when the asset is unknown. */
  balance: string | null;
  decimals: number | null;
}

export interface BankTransfer {
  id: string;
  ownerType: BankOwnerType;
  ownerId: string;
  idempotencyKey: string;
  requestHash: string;
  type: string;
  fromAccount: string | null;
  toAccount: string | null;
  toExternal: { address: string; chain: string } | null;
  amountMinor: string;
  asset: string;
  chain: string;
  status: BankTransferStatus;
  txHash: string | null;
  failureReason: string | null;
  memo: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
  [k: string]: unknown;
}

export interface BankLedgerEntry {
  id: string;
  transferId: string;
  accountId: string;
  direction: "debit" | "credit";
  amountMinor: string;
  asset: string;
  balanceAfter: string | null;
  phase: string;
  createdAt: string;
}

export interface BankStatementPage {
  entries: Array<BankLedgerEntry & { cursor: string }>;
  nextCursor: string | null;
}

export interface BankReconcileReport {
  accountId: string;
  chain: string;
  asset: string;
  address: string | null;
  accountsInGroup: string[];
  ledgerMinor: string;
  onchainMinor: string;
  components: {
    walletMinor: string;
    vaultPositionMinor: string;
    collateralPostedMinor: string;
    unrealizedYieldMinor: string;
  };
  deltaMinor: string;
  inFlightTransfers: number;
  status: "in_sync" | "pending_settlement" | "drift";
}

export interface BankAsset {
  symbol: string;
  chain: string;
  decimals: number;
  family: "evm" | "solana";
  [k: string]: unknown;
}

// ---- accounts / transfers / assets ----
export interface BankOpenAccountArgs {
  /** escrow/pool accounts are service-opened only. Default `checking`. */
  kind?: "checking" | "savings" | "credit" | "treasury";
  asset: string;
  chain: string;
  label?: string;
  segmentProfile?: string;
}
export interface BankStatementArgs { limit?: number; cursor?: string }
export interface BankListAssetsArgs { chain?: string; currency?: string }
export type BankTransferArgs = BankAmountInput & {
  /** REQUIRED. 8-128 chars of A-Za-z0-9_.:- . Reuse the same key to retry safely. */
  idempotencyKey: string;
  fromAccountId: string;
  memo?: string;
} & (
    | { toAccountId: string; toExternal?: undefined }
    | { toExternal: { address: string }; toAccountId?: undefined }
  );
export interface BankListTransfersArgs { accountId?: string; status?: string; limit?: number; before?: string }

// ---- fx ----
export type BankFxQuoteArgs = BankAmountInput & {
  fromAccountId: string;
  toAccountId: string;
  /** 0.0001 - 0.05 */
  slippage?: number;
  requireDirect?: boolean;
};
export type BankFxExecuteArgs = BankFxQuoteArgs & { idempotencyKey: string; minToMinor?: string };

// ---- earn ----
export interface BankEarnVaultsArgs { asset: string; chain: string }
export interface BankEarnHistoryArgs { accountId?: string; limit?: number }
export type BankEarnDepositArgs = BankAmountInput & { idempotencyKey: string; accountId: string; vault: string };
export type BankEarnWithdrawArgs = BankAmountOrAllInput & { idempotencyKey: string; accountId: string; vault: string };
export interface BankEarnSettingsArgs {
  accountId: string;
  /** EVM address of the vault. */
  vault: string;
  /** Default true. */
  enabled?: boolean;
  floorMinor?: string;
  floor?: string;
  minSweepMinor?: string;
}

// ---- credit ----
export interface BankCreditMarketsArgs { chain?: string; asset?: string; collateral?: string }
export interface BankCreditOpenLineArgs {
  idempotencyKey: string;
  accountId: string;
  /** Morpho market id (bytes32 hex). */
  marketId: string;
  collateral: { source?: "wallet" | "vault_shares"; amountMinor: string; savingsAccountId?: string };
}
export type BankCreditAmountArgs = BankAmountOrAllInput & { idempotencyKey: string; lineId: string };
export interface BankCreditEventsArgs { lineId?: string; since?: string; limit?: number }
export interface BankCreditScoreArgs { asset?: string; chain?: string }
export interface BankCreditUnsecuredArgs { idempotencyKey: string; accountId: string }
export interface BankCreditReceivableArgs { idempotencyKey: string; accountId: string; invoiceId: string }

// ---- ramps ----
export type BankRampQuoteArgs = BankAmountInput & {
  direction: "offramp" | "onramp";
  rail: BankRail;
  asset: string;
  currency?: string;
};
export interface BankRampKycArgs {
  provider?: BankRampProvider;
  email: string;
  fullName: string;
  type?: "individual" | "business";
}
export interface BankRampExternalAccountArgs {
  provider?: BankRampProvider;
  accountType: "us" | "iban" | "clabe";
  ownerName: string;
  bankName?: string;
  label?: string;
  account: Record<string, string>;
  address?: { street_line_1: string; city: string; country: string; state?: string; postal_code?: string };
}
export interface BankRampVirtualAccountArgs {
  provider?: BankRampProvider;
  accountId: string;
  sourceCurrency: "usd" | "eur" | "mxn" | "brl" | "cop" | "gbp";
}
export interface BankRampOfframpArgs {
  idempotencyKey: string;
  provider?: BankRampProvider;
  fromAccountId: string;
  externalAccountId: string;
  amountMinor: string;
}

// ---- remittance ----
export type BankRemitQuoteArgs = BankAmountInput & { fromAccountId: string; rail?: BankRail; currency?: string };
export type BankRemitRecipient =
  | { kind: "user"; telegramId?: number; username?: string }
  | { kind: "address"; address: string }
  | { kind: "claim"; label?: string }
  | { kind: "payout"; rail: BankRail; externalAccountId: string };
export type BankRemitSendArgs = BankAmountInput & {
  idempotencyKey: string;
  fromAccountId: string;
  memo?: string;
  autoEarn?: boolean;
  recipient: BankRemitRecipient;
};
export interface BankRemitClaimArgs { accountId?: string; choice?: "keep" | "cashout"; externalAccountId?: string }

// ---- cards ----
export interface BankCardAddress {
  line1: string; line2?: string; city: string; state?: string; postalCode: string;
  /** ISO 3166-1 alpha-2 */
  country: string;
}
export interface BankCardIssueArgs {
  accountId: string;
  idempotencyKey: string;
  type?: "virtual" | "physical";
  provider?: "stripe" | "rain";
  label?: string;
  rules?: Record<string, unknown>;
  orgId?: string; memberId?: string; teamId?: string;
  expenseCategory?: string;
  memo?: string;
  termsAccepted?: boolean;
  cardholder?: {
    name: string; email?: string; phoneNumber?: string; billing: BankCardAddress;
    individual?: { firstName: string; lastName: string; dob: { day: number; month: number; year: number } };
  };
  shipping?: BankCardAddress & { name: string; speed?: "standard" | "express" | "priority" };
}
export interface BankCardListArgs { accountId?: string; memberId?: string; orgId?: string; [k: string]: string | undefined }
export interface BankCardSimulateArgs {
  amountMinor: string; merchantName?: string; merchantId?: string;
  /** 4-digit MCC. */
  mcc?: string; country?: string; at?: string; rules?: Record<string, unknown>;
}

// ---- payments ----
export interface BankInvoiceLineItem { description: string; quantity: number; unitAmountMinor: string }
export interface BankInvoiceCreateArgs {
  payeeAccountId: string;
  payer?: BankOwnerRef;
  amountMinor?: string;
  lineItems?: BankInvoiceLineItem[];
  /** ISO date. */
  dueAt?: string;
  memo?: string;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
  publish?: boolean;
}
export interface BankInvoiceListArgs { role?: "payer" | "payee"; status?: string }
export interface BankInvoicePayArgs {
  idempotencyKey: string;
  /** invoiceId or slug. */
  invoiceId?: string;
  slug?: string;
  fromAccountId: string;
  amountMinor?: string;
}
export interface BankEscrowMilestone { amountMinor: string; description?: string; deliverBy?: string }
export interface BankEscrowCreateArgs {
  idempotencyKey: string;
  payee: BankOwnerRef;
  payerAccountId: string;
  payeeAccountId: string;
  amountMinor?: string;
  milestones?: BankEscrowMilestone[];
  arbiter?: BankOwnerRef;
  description?: string;
  deliverBy?: string;
  autoReleaseSeconds?: number;
}
export interface BankStreamCreateArgs {
  idempotencyKey: string;
  payerAccountId: string;
  payeeAccountId: string;
  kind: "rate" | "metered";
  rateMinor?: string;
  periodSeconds?: number;
  unitPriceMinor?: string;
  capMinor: string;
  dustMinor?: string;
  ewaBps?: number;
  metadata?: Record<string, unknown>;
}

// ---- payroll ----
export interface BankPayeeArgs {
  kind: "worker" | "contractor";
  name: string;
  method: "bank_account" | "wallet" | "local_rail";
  accountId?: string; address?: string; chain?: string; railAccountId?: string; rail?: string;
  /** 3-letter currency code. */
  currency: string;
  linkedOwner?: BankOwnerRef;
  tax?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}
export type BankPayrollRunItem = { payeeId: string; memo?: string } & BankAmountInput;
export interface BankPayrollRunArgs { fundingAccountId: string; label?: string; poolId?: string; items: BankPayrollRunItem[] }
export interface BankPayrollScheduleArgs {
  fundingAccountId: string;
  name: string;
  frequency: "weekly" | "biweekly" | "monthly";
  timezone: string;
  dayOfWeek?: number; dayOfMonth?: number;
  /** HH:MM */
  localTime?: string;
  items: Array<{ payeeId: string; amountMinor: string; memo?: string; ewaBps?: number }>;
  poolId?: string;
  autoApprove?: boolean;
}
export interface BankPayrollPoolArgs {
  accountId?: string; asset?: string; chain?: string;
  defaultPayerLimitMinor?: string;
  payerLimits?: Record<string, string>;
}

// ---- business ----
export type BankOrgRole = "owner" | "admin" | "approver" | "accountant" | "member" | "viewer";
export interface BankOrgCreateArgs { name: string; reportingCurrency?: string }
export interface BankOrgUpdateArgs { name?: string; reportingCurrency?: string }
export interface BankMemberPatchArgs { role?: BankOrgRole; team?: string | null }
export interface BankOrgInviteArgs { role: BankOrgRole; team?: string; email?: string; telegramId?: number; ttlHours?: number }
export interface BankOrgAccountArgs { kind?: "checking" | "savings" | "treasury"; asset: string; chain: string; label?: string }
export interface BankOrgTransferArgs {
  idempotencyKey: string;
  fromAccountId: string;
  amountMinor: string;
  memo?: string;
  categoryId?: string;
  approvalToken?: string;
  toAccountId?: string;
  toExternal?: { address: string };
}
export interface BankApprovalPolicyArgs {
  ruleType: "transfer_over" | "new_payee" | "payroll_run";
  thresholdMinor?: string;
  requiredApprovals?: number;
  approverRoles: BankOrgRole[];
  expiryHours?: number;
}
export interface BankApprovalRequestArgs { action: "payroll_run" | "new_payee"; payload: Record<string, unknown> }
export interface BankTreasuryPolicyArgs {
  accountId: string; floorMinor: string; sweepEnabled?: boolean; sweepVaultId?: string; minSweepMinor?: string;
}
export interface BankVendorArgs { name: string; email?: string; payAddress?: string; payChain?: string; categoryId?: string }
export interface BankBillArgs {
  vendorId: string; reference?: string; amountMinor: string; asset: string; chain: string;
  /** ISO date. */
  dueDate: string; categoryId?: string;
}
export interface BankBillScheduleArgs { payFromAccountId: string; scheduledFor: string }
export interface BankBooksCategoryArgs {
  code: string; name: string; kind: "income" | "expense" | "transfer" | "asset" | "liability" | "equity";
}
export interface BankBooksRangeArgs { from?: string; to?: string }
export interface BankBooksEntriesArgs extends BankBooksRangeArgs { categoryId?: string; limit?: number }
export interface BankCardBudgetArgs {
  scope: "member" | "team"; scopeId: string;
  monthlyCapMinor?: string | null; perTxCapMinor?: string | null;
  categoryBudgets?: Record<string, string>;
}

// ---- agents (x402) ----
export interface BankAgentMandate {
  perCallMaxMinor: string;
  dailyCapMinor: string;
  allowedHosts?: string[];
  /** EVM addresses. */
  allowedPayees?: string[];
  allowedAssets: string[];
  expiresAt?: string;
}
export interface BankAgentAccountArgs { asset: string; chain: string; label?: string; mandate: BankAgentMandate }
export interface BankAgentPayArgs {
  mandateId: string;
  url: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: string;
  headers?: Record<string, string>;
}
export interface BankAgentResourceArgs {
  accountId: string; title: string; description?: string; upstreamUrl: string; priceMinor: string; slug?: string;
}
export interface BankAgentDirectoryArgs { asset?: string; limit?: number }
export interface BankAgentStreamArgs {
  idempotencyKey: string; payerAccountId: string; payeeAccountId: string; unitPriceMinor: string; unit: string;
}
export interface BankAgentUsageArgs { idempotencyKey: string; streamId: string; units: string }

// ---- platform (partner API) ----
export interface BankPlatformConfigArgs { feeBpsTransfer?: number; feeBpsFx?: number; webhookUrl?: string | null }
export interface BankPlatformCustomerArgs { externalRef: string; displayName?: string; email?: string; country?: string }
export interface BankPlatformAccountArgs { asset: string; chain: string; kind?: "checking" | "savings"; label?: string }
export interface BankPlatformTransferArgs {
  idempotencyKey: string; customerId: string; fromAccountId: string; amountMinor: string; memo?: string;
  toAccountId?: string; toExternal?: { address: string };
}
export interface BankPlatformFxArgs {
  idempotencyKey: string; customerId: string; fromAccountId: string; toAccountId: string; amountMinor: string; slippage?: number;
}
export interface BankPlatformUsageArgs { from?: string; to?: string }

// ---- chains / privacy / segments ----
export type BankFeeModelArgs = {
  asset: string;
  chains: string[];
} & ({ amountMinor: string; amount?: undefined } | { amount: string; amountMinor?: undefined });
export interface BankPrivacyPayoutArgs {
  payeeMetaAddress: string; payoutRef: string; token?: { address: string; amountMinor: string };
}
export interface BankPrivacyAnnouncedArgs { payoutRef: string; txHash: string; chain: string }
export interface BankPrivacyAnnouncementsArgs {
  chain: string;
  /** Hex block number or `earliest`. */
  fromBlock: string;
  /** Hex block number or `latest`. */
  toBlock?: string;
  /** Resume point: the response cursor is the next fromBlock (spans are bounded). */
  cursor?: number;
  /** 1-500 */
  limit?: number;
}
/** Escrow/stream/pay-invoice responses carry the ledger transfer id. Invoices carry `acceptance` state (see POST /payments/invoices/:id/accept). */
export interface BankTransferRef { transferId?: string; [k: string]: unknown }
// ============================ end Bank section =============================
