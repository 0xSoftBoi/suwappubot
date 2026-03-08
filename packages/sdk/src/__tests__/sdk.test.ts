import { describe, it, expect } from "bun:test";
import {
  createClient,
  suwappu,
} from "../index";
import type {
  SuwappuConfig,
  SuwappuClient,
  Quote,
  SwapResult,
  TokenBalance,
  TokenPrice,
  Chain,
  Token,
} from "../index";

describe("@suwappu/sdk", () => {
  it("re-exports createClient from openclaw", () => {
    expect(typeof createClient).toBe("function");
  });

  it("re-exports default suwappu client", () => {
    expect(suwappu).toBeDefined();
    expect(typeof suwappu.getQuote).toBe("function");
    expect(typeof suwappu.executeSwap).toBe("function");
    expect(typeof suwappu.getPortfolio).toBe("function");
    expect(typeof suwappu.getPrices).toBe("function");
    expect(typeof suwappu.listChains).toBe("function");
    expect(typeof suwappu.listTokens).toBe("function");
  });

  it("createClient returns object with all 6 methods", () => {
    const client = createClient({ apiKey: "test" });
    const methods = ["getQuote", "executeSwap", "getPortfolio", "getPrices", "listChains", "listTokens"];
    for (const method of methods) {
      expect(typeof (client as Record<string, unknown>)[method]).toBe("function");
    }
  });

  it("exports all type interfaces (compile-time check)", () => {
    // These are compile-time checks — if any type is missing, this file won't compile
    const _config: SuwappuConfig = { apiKey: "k", baseUrl: "u" };
    const _quote: Quote = { id: "1", fromToken: "ETH", toToken: "USDC", fromAmount: "1", toAmount: "2847", route: "uni", gas: "0.1", fee: "0.01", chain: "arb", exchangeRate: "2847", priceImpact: "0.01", slippage: "0.5", estimatedTimeSeconds: 30, dex: "uniswap" };
    const _swap: SwapResult = { txHash: "0x1", status: "confirmed", chain: "arb" };
    const _bal: TokenBalance = { token: "ETH", balance: "1", usdValue: "2847", chain: "arb" };
    const _price: TokenPrice = { token: "ETH", priceUsd: "2847", change24h: "-1" };
    const _chain: Chain = { name: "arb", chainId: 42161, status: "active" };
    const _token: Token = { symbol: "ETH", address: "0x0", decimals: 18, chain: "arb" };
    const _client: SuwappuClient = createClient();

    expect(true).toBe(true); // if we got here, all types resolve
  });
});
