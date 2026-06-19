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
  route: string;
  gas: string;
  fee: string;
  chain: string;
  /** Extended fields surfaced by the EVM (Li.Fi) quote path. */
  exchangeRate: string;
  priceImpact: string;
  slippage: string;
  estimatedTimeSeconds: number;
  dex: string;
}

export interface SwapResult {
  txHash: string;
  status: "confirmed" | "pending" | "failed" | "ready" | string;
  chain: string;
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

// --- Ergonomic argument shapes (match the showcase examples) ---

export interface GetQuoteArgs {
  from: string;
  to: string;
  chain: string;
  amount: string | number;
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
