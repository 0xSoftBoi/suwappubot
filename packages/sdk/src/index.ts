/**
 * @suwappu/sdk — Cross-chain DEX SDK for AI agents
 *
 * Usage:
 *   import { createClient } from "@suwappu/sdk";
 *   const client = createClient({ apiKey: process.env.SUWAPPU_API_KEY });
 *   const quote = await client.getQuote("ETH", "USDC", 1.0, "arbitrum");
 *   const tx = await client.executeSwap(quote.id);
 */

export {
  createClient,
  suwappu,
  suwappu as default,
} from "@suwappu/openclaw";

export type {
  SuwappuConfig,
  SuwappuClient,
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
  LendingMarket,
  LendingMarketDetail,
} from "@suwappu/openclaw";
