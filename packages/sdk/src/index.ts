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

export { Suwappu, SuwappuError, SuwappuApiError, createClient, DEFAULT_BASE_URL } from "./client.js";

export type {
  SuwappuConfig,
  Quote,
  SwapResult,
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
  AgentProfile,
  RegisterAgentArgs,
  RegisterAgentResult,
  UpdateAgentArgs,
  RotateKeysResult,
  CreatePolicyArgs,
  WalletPolicy,
  WebhookEvent,
  WebhookEventsResult,
  WebhookTestResult,
  BillingCheckoutResult,
  BillingCryptoArgs,
  BillingStatus,
  AgentTopupArgs,
} from "./types.js";
