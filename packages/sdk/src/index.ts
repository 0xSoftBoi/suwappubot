/**
 * @suwappu/sdk — TypeScript client for the Suwappu cross-chain DEX API.
 *
 * @example
 * ```ts
 * import { Suwappu } from "@suwappu/sdk";
 *
 * const client = new Suwappu({ apiKey: process.env.SUWAPPU_KEY });
 * const quote = await client.getQuote({ from: "USDC", to: "ETH", chain: "base", amount: "1000" });
 * const tx = await client.swap(quote);
 * ```
 */

export { Suwappu, SuwappuError, createClient, DEFAULT_BASE_URL } from "./client.js";

export type {
  SuwappuConfig,
  Quote,
  SwapResult,
  SwapStatus,
  TokenBalance,
  TokenPrice,
  Chain,
  Token,
  PerpMarket,
  PerpQuote,
  PerpPosition,
  PredictionMarket,
  PredictionMarketDetail,
  PredictionOrderbook,
  PredictionOutcomeBook,
  PredictionOrderbookLevel,
  PredictionPrices,
  PredictionPriceLevel,
  PredictionTrades,
  PredictionTrade,
  PredictionOrderRequest,
  PredictionOrderResult,
  PredictionPosition,
  PredictionOrder,
  LendingMarket,
  LendingMarketDetail,
  GetQuoteArgs,
  PerpQuoteArgs,
  PredictListArgs,
  RegisterAgentArgs,
  RegisterResult,
  AgentProfile,
  BillingInfo,
  BillingCredits,
  BillingSubscribe,
  BillingTopup,
} from "./types.js";
