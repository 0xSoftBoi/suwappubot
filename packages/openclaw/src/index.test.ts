import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  createClient,
  register,
  SuwappuError,
  SuwappuRateLimitError,
  SuwappuServerError,
  SuwappuValidationError,
} from "./index";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** Stub global fetch to return `body` as JSON, capturing each request. */
function stubFetch(body: unknown, status = 200, headersInit?: Record<string, string>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers(headersInit),
      json: async () => body,
      text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    } as Response;
  }) as unknown as typeof fetch;
  return calls;
}

/** Stub global fetch to return a sequence of responses, one per call. */
function stubSequence(responses: { body: unknown; status?: number; headers?: Record<string, string> }[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  let i = 0;
  globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    const status = r.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers(r.headers),
      json: async () => r.body,
      text: async () => (typeof r.body === "string" ? r.body : JSON.stringify(r.body)),
    } as Response;
  }) as unknown as typeof fetch;
  return calls;
}

const client = createClient({ apiKey: "test-key", baseUrl: "https://api.test" });
// Fast, deterministic client for retry/error tests (no real backoff waits).
const fastClient = createClient({
  apiKey: "test-key",
  baseUrl: "https://api.test",
  retryBaseMs: 1,
  retryMaxMs: 1,
});
const noRetry = createClient({ apiKey: "test-key", baseUrl: "https://api.test", maxRetries: 0 });

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

    // wallet_address must be forwarded as the address that will sign the transaction
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

describe("simulateSwap", () => {
  test("maps the dry-run report and forwards the optional wallet address", async () => {
    const calls = stubFetch({
      success: true,
      would_execute: true,
      quote_id: "q_sim",
      chain_type: "evm",
      expected_output: { token: "USDC", amount: "3190", amount_usd: "3190" },
      min_output_after_slippage: "3174.05",
      price_impact_pct: 0.12,
      fees: { protocol: "25.52", gas_estimate: "0.08" },
      checks: [{ name: "balance", status: "pass", detail: "sufficient" }],
      warnings: [],
    });

    const res = await client.simulateSwap("q_sim", "0xWallet");

    expect(res.wouldExecute).toBe(true);
    expect(res.expectedOutput.amountUsd).toBe("3190");
    expect(res.fees.gasEstimate).toBe("0.08");
    expect(res.checks[0]?.status).toBe("pass");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      quote_id: "q_sim",
      wallet_address: "0xWallet",
    });
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
    stubFetch({ markets: [{ name: "ETH-USD", asset: "ETH", szDecimals: 4, maxLeverage: 20, venueMaxLeverage: 25, markPrice: 3200, fundingRate: 0.0001 }] });
    const markets = await client.perps.markets();
    expect(markets[0].name).toBe("ETH-USD");
    expect(markets[0].maxLeverage).toBe(20);
    expect(markets[0].venueMaxLeverage).toBe(25);
    expect(markets[0].fundingRate).toBe(0.0001);
  });

  test("quote posts side/size/leverage", async () => {
    const calls = stubFetch({ market: "ETH-USD", side: "long", size: 1, leverage: 10, entryPrice: 3200, margin: 320, liquidationPrice: 2900, fundingRate: 0.0001, fee: 1 });
    const q = await client.perps.quote("ETH-USD", "long", 1, 10);
    expect(q.side).toBe("long");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ market: "ETH-USD", side: "long", size: 1, leverage: 10 });
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
    const calls = stubFetch({
      id: "m1",
      conditionId: "0xcondition",
      question: "?",
      outcomes: ["Yes"],
      outcomePrices: [0.5],
      tokens: [{ tokenId: "yes-token", outcome: "Yes" }],
      volume: 0,
      liquidity: 0,
      endDate: "",
      active: true,
      category: "",
      description: "",
      createdAt: "",
      resolvedOutcome: null,
    });
    const m = await client.predict.market("m/1");
    expect(m.id).toBe("m1");
    expect(m.conditionId).toBe("0xcondition");
    expect(m.tokens[0]?.tokenId).toBe("yes-token");
    expect(calls[0].url).toContain("/predict/market/m%2F1");
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

describe("agent lifecycle", () => {
  test("register maps api_key from the agent envelope", async () => {
    const calls = stubFetch({
      success: true,
      agent: { id: "ag_1", name: "bot", api_key: "suwappu_sk_xyz", created_at: "2026-01-01" },
    });
    const creds = await register({ name: "bot" }, { baseUrl: "https://api.test" });
    expect(creds.apiKey).toBe("suwappu_sk_xyz");
    expect(creds.id).toBe("ag_1");
    expect(calls[0].url).toBe("https://api.test/v1/agent/register");
    expect(JSON.parse(String(calls[0].init?.body)).name).toBe("bot");
  });

  test("getProfile maps snake_case stats", async () => {
    stubFetch({
      success: true,
      agent: {
        id: "ag_1",
        name: "bot",
        rate_limit_tier: "agent",
        stats: { total_requests: 12, total_swaps: 3 },
        created_at: "2026-01-01",
      },
    });
    const me = await client.getProfile();
    expect(me.rateLimitTier).toBe("agent");
    expect(me.stats.totalSwaps).toBe(3);
  });

  test("executeManagedSwap returns a receipt with pollUrl", async () => {
    const calls = stubFetch({
      success: true,
      swap_id: 42,
      status: "submitted",
      tx_hash: "0xhash",
      tracking: { poll_url: "/v1/agent/swap/status/42" },
    });
    const r = await client.executeManagedSwap("q_1", "0xWallet", {
      idempotencyKey: "strategy-run-42",
    });
    expect(r.swapId).toBe(42);
    expect(r.pollUrl).toBe("/v1/agent/swap/status/42");
    expect(new Headers(calls[0].init?.headers).get("Idempotency-Key")).toBe("strategy-run-42");
  });

  test("getSwapStatus maps fields and forwards id", async () => {
    const calls = stubFetch({
      success: true,
      swap_id: 42,
      status: "completed",
      tx_hash: "0xhash",
      from_token: "ETH",
      to_token: "USDC",
    });
    const s = await client.getSwapStatus(42);
    expect(s.status).toBe("completed");
    expect(s.txHash).toBe("0xhash");
    expect(calls[0].url).toContain("/swap/status/42");
  });
});

describe("auth + errors", () => {
  test("sends Authorization bearer + client identifier headers", async () => {
    const calls = stubFetch({ chains: [] });
    await client.listChains();
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-key");
    expect(headers["X-Suwappu-Client"]).toContain("@suwappu/openclaw/");
  });

  test("throws a typed SuwappuRateLimitError on 429", async () => {
    stubFetch("rate limited", 429);
    const err = await noRetry.listChains().catch((e) => e);
    expect(err).toBeInstanceOf(SuwappuRateLimitError);
    expect(err).toBeInstanceOf(SuwappuError);
    expect(err.status).toBe(429);
    expect(err.isRetryable).toBe(true);
  });

  test("parses the handler validation envelope into .fields", async () => {
    stubFetch({ success: false, error: "Validation error", fields: { amount: "required" } }, 400);
    const err = await noRetry.getQuote("ETH", "USDC", 1, "base").catch((e) => e);
    expect(err).toBeInstanceOf(SuwappuValidationError);
    expect(err.fields?.amount).toBe("required");
  });

  test("surfaces the gateway requestId envelope", async () => {
    stubFetch({ error: "Internal error", requestId: "req_abc" }, 500);
    const err = await noRetry.listChains().catch((e) => e);
    expect(err).toBeInstanceOf(SuwappuServerError);
    expect(err.requestId).toBe("req_abc");
  });
});

describe("resilience", () => {
  test("retries a GET on 429 then succeeds", async () => {
    const calls = stubSequence([
      { body: "slow down", status: 429 },
      { body: { chains: [{ id: 1, key: "eth", name: "Ethereum", native_token: "ETH", type: "evm" }] }, status: 200 },
    ]);
    const chains = await fastClient.listChains();
    expect(chains[0].name).toBe("Ethereum");
    expect(calls.length).toBe(2);
  });

  test("retries a GET on 503 up to maxRetries then throws", async () => {
    const calls = stubFetch("unavailable", 503);
    const err = await fastClient.listChains().catch((e) => e);
    expect(err).toBeInstanceOf(SuwappuServerError);
    expect(calls.length).toBe(3); // initial + 2 retries (default maxRetries=2)
  });

  test("does NOT retry a non-idempotent POST on 500 (no double-execute)", async () => {
    const calls = stubFetch({ error: "boom" }, 500);
    const err = await fastClient.executeSwap("q_1", "0xWallet").catch((e) => e);
    expect(err).toBeInstanceOf(SuwappuServerError);
    expect(calls.length).toBe(1);
  });

  test("retries a POST on 429 (rejected before side effects)", async () => {
    const calls = stubSequence([
      { body: "slow down", status: 429 },
      { body: { quote_id: "q_1" }, status: 200 },
    ]);
    const q = await fastClient.getQuote("ETH", "USDC", 1, "base");
    expect(q.id).toBe("q_1");
    expect(calls.length).toBe(2);
  });

  test("fires retry hook with the delay", async () => {
    const seen: number[] = [];
    const hooked = createClient({
      baseUrl: "https://api.test",
      retryBaseMs: 1,
      retryMaxMs: 1,
      hooks: { onRetry: ({ delayMs }) => seen.push(delayMs) },
    });
    stubSequence([
      { body: "x", status: 429 },
      { body: { chains: [] }, status: 200 },
    ]);
    await hooked.listChains();
    expect(seen.length).toBe(1);
  });
});
