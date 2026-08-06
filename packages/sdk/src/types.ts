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
  maxLeverage: number;
  markPrice: number;
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

export interface PredictionMarket {
  id: string;
  question: string;
  outcomes: string[];
  outcomePrices: number[];
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
  expiration?: number;
  feeRateBps?: number;
}

/** CLOB responses are loosely typed; expose the raw object. */
export type PredictionOrderResult = Record<string, unknown>;
export type PredictionPosition = Record<string, unknown>;
export type PredictionOrder = Record<string, unknown>;

// --- Lending (Morpho) ---

export interface LendingMarket {
  id: string;
  loanToken: string;
  collateralToken: string;
  lltv: number;
  supplyApy: number;
  borrowApy: number;
  totalSupply: number;
  totalBorrow: number;
  utilization: number;
  chainId: number;
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
  status: "pass" | "warn" | "fail" | string;
  detail: string;
  unverified?: boolean;
}

/** Camel-cased view of POST /v1/agent/swap/simulate. Nothing is broadcast. */
export interface SwapSimulation {
  success: boolean;
  /** True only when the server's safety-critical preflight checks allow execution. */
  wouldExecute: boolean;
  quoteId: string;
  chainType: "evm" | "solana" | string;
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
