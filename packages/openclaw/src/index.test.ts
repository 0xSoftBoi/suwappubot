import { afterEach, describe, expect, mock, test } from "bun:test";
import { createClient } from "./index";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** Stub global fetch to return `body` as JSON, capturing the last request. */
function stubFetch(body: unknown, status = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    } as Response;
  }) as unknown as typeof fetch;
  return calls;
}

const client = createClient({ apiKey: "test-key", baseUrl: "https://api.test" });

describe("getQuote", () => {
  test("normalizes snake_case API response to camelCase Quote", async () => {
    const calls = stubFetch({
      quote_id: "q_123",
      from_token: { symbol: "ETH" },
      to_token: { symbol: "USDC" },
      amount_in: "1.0",
      amount_out: "3200.50",
      route: "Li.Fi",
      estimated_gas_usd: "2.10",
      bridge_fee_usd: "0",
      from_chain: "arbitrum",
      exchange_rate: "3200.5",
      price_impact: "0.01",
      slippage: "0.5",
      estimated_time_seconds: 30,
      dex: "uniswap",
    });

    const quote = await client.getQuote("ETH", "USDC", 1.0, "arbitrum");

    expect(quote.id).toBe("q_123");
    expect(quote.fromToken).toBe("ETH");
    expect(quote.toToken).toBe("USDC");
    expect(quote.toAmount).toBe("3200.50");
    expect(quote.gas).toBe("2.10");
    expect(quote.estimatedTimeSeconds).toBe(30);

    const req = calls[0];
    expect(req.url).toBe("https://api.test/v1/agent/quote");
    expect(req.init?.method).toBe("POST");
    expect(JSON.parse(String(req.init?.body))).toEqual({
      from_token: "ETH",
      to_token: "USDC",
      amount: "1",
      chain: "arbitrum",
    });
  });

  test("falls back to provided symbols when API omits them", async () => {
    stubFetch({ quote_id: "q_1" });
    const quote = await client.getQuote("ETH", "USDC", 2, "base");
    expect(quote.fromToken).toBe("ETH");
    expect(quote.toToken).toBe("USDC");
    expect(quote.fromAmount).toBe("2");
  });
});

describe("executeSwap", () => {
  test("normalizes an EVM unsigned-transaction response", async () => {
    const calls = stubFetch({
      success: true,
      status: "ready",
      quote_id: "q_123",
      chain_type: "evm",
      swap: {
        from_chain: "arbitrum",
        to_chain: "arbitrum",
        from_token: "ETH",
        to_token: "USDC",
        amount_in: "1.0",
        expected_amount_out: "3200.5",
        minimum_amount_out: "3184.5",
      },
      transaction: {
        to: "0xRouter",
        from: "0xWallet",
        value: "1000000000000000000",
        data: "0xdeadbeef",
        chain_id: 42161,
        gas_limit: "210000",
        gas_price: "100000000",
      },
      instructions: ["1. Sign", "2. Broadcast"],
    });

    const res = await client.executeSwap("q_123", "0xWallet");

    expect(res.status).toBe("ready");
    expect(res.chainType).toBe("evm");
    expect(res.swap.minimumAmountOut).toBe("3184.5");
    expect(res.transaction.type).toBe("evm");
    if (res.transaction.type === "evm") {
      expect(res.transaction.to).toBe("0xRouter");
      expect(res.transaction.chainId).toBe(42161);
      expect(res.transaction.gasLimit).toBe("210000");
    }
    expect(res.instructions).toHaveLength(2);

    // wallet_address must be forwarded (API requires it for ownership check)
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      quote_id: "q_123",
      wallet_address: "0xWallet",
    });
  });

  test("normalizes a Solana serialized-transaction response", async () => {
    stubFetch({
      success: true,
      status: "ready",
      quote_id: "q_sol",
      chain: "solana",
      swap: {
        from_token: "SOL",
        to_token: "USDC",
        amount_in: "1",
        expected_amount_out: "150",
        minimum_amount_out: "149",
      },
      transaction: {
        type: "solana",
        serialized_transaction: "BASE64TX",
        last_valid_block_height: 12345,
      },
      instructions: ["sign"],
    });

    const res = await client.executeSwap("q_sol", "SoLwallet");
    expect(res.chainType).toBe("solana");
    expect(res.transaction.type).toBe("solana");
    if (res.transaction.type === "solana") {
      expect(res.transaction.serializedTransaction).toBe("BASE64TX");
      expect(res.transaction.lastValidBlockHeight).toBe(12345);
    }
  });
});

describe("getPortfolio", () => {
  test("unwraps balances and forwards wallet_address + chain", async () => {
    const calls = stubFetch({
      balances: [{ token: "USDC", balance: "100", usdValue: "100", chain: "base" }],
    });
    const balances = await client.getPortfolio("0xabc", "base");
    expect(balances).toHaveLength(1);
    expect(balances[0].token).toBe("USDC");
    expect(calls[0].url).toContain("wallet_address=0xabc");
    expect(calls[0].url).toContain("chain=base");
  });
});

describe("getPrices", () => {
  test("flattens the price map into TokenPrice[]", async () => {
    stubFetch({
      prices: {
        ETH: { usd: 3200, change_24h: 1.5 },
        BTC: { usd: 65000, change_24h: null },
      },
    });
    const prices = await client.getPrices("ETH,BTC");
    const eth = prices.find((p) => p.token === "ETH");
    const btc = prices.find((p) => p.token === "BTC");
    expect(eth?.priceUsd).toBe("3200");
    expect(eth?.change24h).toBe("1.5");
    expect(btc?.change24h).toBe("0");
  });
});

describe("listChains / listTokens", () => {
  test("listChains unwraps chains", async () => {
    stubFetch({ chains: [{ id: 1, key: "eth", name: "Ethereum", native_token: "ETH", type: "evm" }] });
    const chains = await client.listChains();
    expect(chains[0].name).toBe("Ethereum");
  });

  test("listTokens forwards chain param", async () => {
    const calls = stubFetch({ tokens: [{ symbol: "USDC", address: "0x", decimals: 6, chain: "base" }] });
    const tokens = await client.listTokens("base");
    expect(tokens[0].symbol).toBe("USDC");
    expect(calls[0].url).toContain("tokens?chain=base");
  });
});

describe("perps namespace", () => {
  test("markets unwraps", async () => {
    stubFetch({ markets: [{ name: "ETH-PERP", asset: "ETH", szDecimals: 4, maxLeverage: 50, markPrice: 3200, fundingRate: 0.0001 }] });
    const markets = await client.perps.markets();
    expect(markets[0].name).toBe("ETH-PERP");
  });

  test("quote posts side/size/leverage", async () => {
    const calls = stubFetch({ market: "ETH-PERP", side: "long", size: 1, leverage: 10, entryPrice: 3200, margin: 320, liquidationPrice: 2900, fundingRate: 0.0001, fee: 1 });
    const q = await client.perps.quote("ETH-PERP", "long", 1, 10);
    expect(q.side).toBe("long");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ market: "ETH-PERP", side: "long", size: 1, leverage: 10 });
  });

  test("positions forwards address", async () => {
    const calls = stubFetch({ positions: [] });
    await client.perps.positions("0xabc");
    expect(calls[0].url).toContain("positions?address=0xabc");
  });
});

describe("predict namespace", () => {
  test("markets passes query + limit", async () => {
    const calls = stubFetch({ markets: [] });
    await client.predict.markets("election", 5);
    expect(calls[0].url).toContain("query=election");
    expect(calls[0].url).toContain("limit=5");
  });

  test("market fetches by id", async () => {
    const calls = stubFetch({ id: "m1", question: "?", outcomes: [], outcomePrices: [], volume: 0, liquidity: 0, endDate: "", active: true, category: "", description: "", createdAt: "", resolvedOutcome: null });
    const m = await client.predict.market("m1");
    expect(m.id).toBe("m1");
    expect(calls[0].url).toContain("/predict/market/m1");
  });
});

describe("lend namespace", () => {
  test("markets passes chainId", async () => {
    const calls = stubFetch({ markets: [] });
    await client.lend.markets(8453);
    expect(calls[0].url).toContain("chainId=8453");
  });

  test("market fetches by id", async () => {
    const calls = stubFetch({ id: "lm1", loanToken: "USDC", collateralToken: "WETH", lltv: 0.86, supplyApy: 0.05, borrowApy: 0.07, totalSupply: 1, totalBorrow: 1, utilization: 0.5, chainId: 8453, oracle: "0x", irm: "0x", createdAt: "" });
    const m = await client.lend.market("lm1");
    expect(m.id).toBe("lm1");
    expect(calls[0].url).toContain("/lend/market/lm1");
  });
});

describe("auth + errors", () => {
  test("sends Authorization bearer header when apiKey is set", async () => {
    const calls = stubFetch({ chains: [] });
    await client.listChains();
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-key");
  });

  test("throws on non-ok response with status + body", async () => {
    stubFetch("rate limited", 429);
    await expect(client.listChains()).rejects.toThrow("Suwappu API error 429: rate limited");
  });
});
