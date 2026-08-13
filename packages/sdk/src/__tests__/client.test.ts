/**
 * Endpoint-contract tests.
 *
 * These exist because of a real incident: the SDK shipped to npm pointing at
 * raw `src/*.ts`, and separately a whole namespace's routes could drift from
 * the API without anything failing. Asserting the exact method, path, query
 * string and JSON body catches both classes of mistake before a publish.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Suwappu, SuwappuError } from "../index.js";

interface Seen {
  method: string;
  path: string;
  body: unknown;
}

let seen: Seen[] = [];
let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;
/** Overrides the next response body, for error-path tests. */
let nextStatus = 200;
let nextBody: unknown = null;
let lastIdempotencyKey: string | null = null;

const OK = {
  success: true,
  approvals: [],
  events: [],
  killswitches: [],
  wallets: [],
  swaps: [],
  pagination: { total: 3, limit: 5, offset: 0, has_more: true },
  code: "ABC123",
  expires_at: "2026-01-01T00:00:00Z",
  challenge: "chal",
  valid: true,
  scope: "org",
  active: true,
};

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      lastIdempotencyKey = req.headers.get("Idempotency-Key");
      let body: unknown = null;
      if (req.method !== "GET") {
        const text = await req.text();
        body = text ? JSON.parse(text) : null;
      }
      seen.push({ method: req.method, path: url.pathname + url.search, body });
      const status = nextStatus;
      const payload = nextBody ?? OK;
      nextStatus = 200;
      nextBody = null;
      return new Response(JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json" },
      });
    },
  });
  baseUrl = `http://127.0.0.1:${server.port}`;
});

afterAll(() => server.stop(true));

function client() {
  seen = [];
  lastIdempotencyKey = null;
  return new Suwappu({ apiKey: "test-key", baseUrl });
}

describe("prediction contracts", () => {
  it("returns outcome token ids and URL-encodes the market id", async () => {
    const c = client();
    nextBody = {
      id: "market/one",
      conditionId: "0xcondition",
      question: "Will it happen?",
      outcomes: ["Yes", "No"],
      outcomePrices: [0.42, 0.58],
      tokens: [
        { tokenId: "yes-token", outcome: "Yes" },
        { tokenId: "no-token", outcome: "No" },
      ],
      volume: 100,
      liquidity: 50,
      endDate: "2026-12-31",
      active: true,
      category: "test",
      description: "",
      createdAt: "2026-01-01",
      resolvedOutcome: null,
    };

    const market = await c.predict.market("market/one");

    expect(seen[0].path).toBe("/v1/agent/predict/market/market%2Fone");
    expect(market.conditionId).toBe("0xcondition");
    expect(market.tokens[0]?.tokenId).toBe("yes-token");
  });

  it("sends only fields supported by the current GTC order route", async () => {
    const c = client();
    nextBody = { order: { id: "order-1" } };

    await c.predict.order({ tokenId: "yes-token", price: "0.42", size: "10", side: "BUY" });

    expect(seen[0]).toEqual({
      method: "POST",
      path: "/v1/agent/predict/order",
      body: { tokenId: "yes-token", price: "0.42", size: "10", side: "BUY" },
    });
  });
});

describe("perps contracts", () => {
  it("preserves the effective and venue leverage caps plus live funding", async () => {
    const c = client();
    nextBody = {
      markets: [
        {
          name: "ETH-USD",
          asset: "ETH",
          szDecimals: 4,
          maxLeverage: 20,
          venueMaxLeverage: 25,
          markPrice: 3200,
          fundingRate: 0.000125,
        },
      ],
    };

    const markets = await c.perps.markets();

    expect(seen[0]).toEqual({ method: "GET", path: "/v1/agent/perps/markets", body: null });
    expect(markets[0]?.maxLeverage).toBe(20);
    expect(markets[0]?.venueMaxLeverage).toBe(25);
    expect(markets[0]?.fundingRate).toBe(0.000125);
  });

  it("posts only the documented perps quote fields", async () => {
    const c = client();
    nextBody = {
      market: "ETH-USD",
      side: "long",
      size: 1,
      leverage: 5,
      entryPrice: 3199,
      margin: 639.8,
      liquidationPrice: 2623.18,
      fundingRate: 0.000125,
      fee: 0.6398,
    };

    await c.perps.quote({ market: "ETH-USD", side: "long", size: 1, leverage: 5 });

    expect(seen[0]).toEqual({
      method: "POST",
      path: "/v1/agent/perps/quote",
      body: { market: "ETH-USD", side: "long", size: 1, leverage: 5 },
    });
  });
});

describe("lending contracts", () => {
  it("preserves explicit USD liquidity, listing status, and Morpho warnings", async () => {
    const c = client();
    nextBody = {
      markets: [
        {
          id: "market-one",
          loanToken: "USDC",
          collateralToken: "WETH",
          lltv: 0.86,
          supplyApy: 4.2,
          borrowApy: 5.8,
          totalSupply: 12_500_000,
          totalBorrow: 8_900_000,
          totalSupplyUsd: 12_500_000,
          totalBorrowUsd: 8_900_000,
          availableLiquidityUsd: 3_600_000,
          utilization: 71.2,
          chainId: 8453,
          listed: true,
          warnings: [{ type: "oracle_price_derivation", level: "RED" }],
        },
      ],
    };

    const markets = await c.lend.markets(8453);

    expect(seen[0]).toEqual({
      method: "GET",
      path: "/v1/agent/lend/markets?chainId=8453",
      body: null,
    });
    expect(markets[0]?.totalSupplyUsd).toBe(12_500_000);
    expect(markets[0]?.availableLiquidityUsd).toBe(3_600_000);
    expect(markets[0]?.warnings[0]?.level).toBe("RED");
  });

  it("URL-encodes market IDs and scopes detail reads by chain", async () => {
    const c = client();
    nextBody = {
      id: "market/one",
      loanToken: "USDC",
      collateralToken: "WETH",
      lltv: 0.86,
      supplyApy: 4.2,
      borrowApy: 5.8,
      totalSupply: null,
      totalBorrow: null,
      totalSupplyUsd: null,
      totalBorrowUsd: null,
      availableLiquidityUsd: null,
      utilization: 71.2,
      chainId: 1,
      listed: false,
      warnings: [],
      oracle: "0xoracle",
      irm: "0xirm",
      createdAt: "2026-01-01T00:00:00.000Z",
    };

    const market = await c.lend.market("market/one", 1);

    expect(seen[0]).toEqual({
      method: "GET",
      path: "/v1/agent/lend/market/market%2Fone?chainId=1",
      body: null,
    });
    expect(market.listed).toBe(false);
    expect(market.totalSupplyUsd).toBeNull();
  });
});

describe("swap custody boundary", () => {
  it("executeManagedSwap uses the managed execution endpoint", async () => {
    const c = client();
    nextBody = {
      swap_id: 7,
      status: "pending",
      tx_hash: null,
      tracking: { poll_url: "/v1/agent/swap/status/7" },
    };

    const result = await c.executeManagedSwap("q-managed", {
      idempotencyKey: "strategy-run-7",
    });

    expect(seen[0]).toEqual({
      method: "POST",
      path: "/v1/agent/swap/execute",
      body: { quote_id: "q-managed" },
    });
    expect(result.swapId).toBe(7);
    expect(lastIdempotencyKey).toBe("strategy-run-7");
  });

  it("legacy swap remains managed and ignores the old walletAddress argument", async () => {
    const c = client();
    nextBody = { swap_id: 8, status: "pending", tx_hash: null };

    await c.swap("q-legacy", "0xnot-forwarded");

    expect(seen[0]).toEqual({
      method: "POST",
      path: "/v1/agent/swap/execute",
      body: { quote_id: "q-legacy" },
    });
  });

  it("prepareSwap uses the unsigned self-custody endpoint", async () => {
    const c = client();
    nextBody = { status: "ready", transaction: { to: "0xabc" } };

    await c.prepareSwap({
      quoteId: "q-self-custody",
      walletAddress: "0x123",
    });

    expect(seen[0]).toEqual({
      method: "POST",
      path: "/v1/agent/swap",
      body: {
        quote_id: "q-self-custody",
        wallet_address: "0x123",
      },
    });
  });
});

describe("swap simulation & history", () => {
  it("simulateSwap posts snake_case fields and maps the report to camelCase", async () => {
    const c = client();
    nextBody = {
      success: true,
      would_execute: true,
      quote_id: "q1",
      chain_type: "evm",
      expected_output: { token: "USDC", amount: "100", amount_usd: "100" },
      min_output_after_slippage: "99.5",
      price_impact_pct: 0.1,
      fees: { protocol: "0.10", gas_estimate: "0.02" },
      checks: [{ name: "balance_sufficient", status: "pass", detail: "ok" }],
      warnings: [],
    };
    const simulation = await c.simulateSwap({ quoteId: "q1", walletAddress: "0xabc" });
    expect(seen[0]).toEqual({
      method: "POST",
      path: "/v1/agent/swap/simulate",
      body: { quote_id: "q1", wallet_address: "0xabc" },
    });
    expect(simulation.wouldExecute).toBe(true);
    expect(simulation.expectedOutput).toEqual({ token: "USDC", amount: "100", amountUsd: "100" });
    expect(simulation.minOutputAfterSlippage).toBe("99.5");
    expect(simulation.fees.gasEstimate).toBe("0.02");
  });

  it("listSwaps forwards filters and maps pagination to camelCase", async () => {
    const c = client();
    const res = await c.listSwaps({ status: "completed", limit: 5 });
    expect(seen[0].method).toBe("GET");
    expect(seen[0].path).toBe("/v1/agent/swaps?status=completed&limit=5");
    expect(res.pagination).toEqual({ total: 3, limit: 5, offset: 0, hasMore: true });
  });

  it("listSwaps omits undefined params rather than sending 'undefined'", async () => {
    const c = client();
    await c.listSwaps();
    expect(seen[0].path).toBe("/v1/agent/swaps");
  });
});

describe("agent wallets & linking", () => {
  it("createWallet unwraps the wallet envelope", async () => {
    const c = client();
    nextBody = { wallet: { address: "0xdead" } };
    const w = await c.agent.createWallet();
    expect(seen[0]).toMatchObject({ method: "POST", path: "/v1/agent/wallets" });
    expect(w.address).toBe("0xdead");
  });

  it("listWallets returns [] when the agent has no wallet yet", async () => {
    const c = client();
    expect(await c.agent.listWallets()).toEqual([]);
  });

  it("linkCode maps expires_at to expiresAt", async () => {
    const c = client();
    const r = await c.agent.linkCode();
    expect(seen[0].path).toBe("/v1/agent/link/code");
    expect(r).toEqual({ code: "ABC123", expiresAt: "2026-01-01T00:00:00Z" });
  });
});

describe("approvals", () => {
  it("list forwards the status filter", async () => {
    const c = client();
    await c.approvals.list({ status: "pending" });
    expect(seen[0].path).toBe("/v1/agent/approvals?status=pending");
  });

  it("url-encodes ids so they cannot escape the path", async () => {
    const c = client();
    await c.approvals.get("a/../b 1");
    expect(seen[0].path).toBe("/v1/agent/approvals/a%2F..%2Fb%201");
  });

  it("approve sends the step-up challenge under its wire name", async () => {
    const c = client();
    await c.approvals.approve("a1", { stepUpChallenge: "ch" });
    expect(seen[0]).toEqual({
      method: "POST",
      path: "/v1/agent/approvals/a1/approve",
      body: { step_up_challenge: "ch" },
    });
  });

  it("deny and stepUpChallenge hit their routes", async () => {
    const c = client();
    await c.approvals.deny("a1");
    await c.approvals.stepUpChallenge("a1");
    expect(seen.map((s) => s.path)).toEqual([
      "/v1/agent/approvals/a1/deny",
      "/v1/agent/approvals/a1/step-up/challenge",
    ]);
  });
});

describe("audit chain", () => {
  it("maps snake_case event fields to camelCase", async () => {
    const c = client();
    nextBody = {
      events: [
        { id: 7, event_type: "swap.executed", agent_id: "ag1", created_at: "2026-01-01" },
      ],
    };
    const [e] = await c.audit.list({ eventType: "swap.executed", limit: 10 });
    expect(seen[0].path).toBe("/v1/agent/audit?event_type=swap.executed&limit=10");
    expect(e).toMatchObject({ id: 7, eventType: "swap.executed", agentId: "ag1" });
  });

  it("verify hits the verify route", async () => {
    const c = client();
    const r = await c.audit.verify();
    expect(seen[0].path).toBe("/v1/agent/audit/verify");
    expect(r.valid).toBe(true);
  });
});

describe("kill switch", () => {
  it("set posts scope/active/reason", async () => {
    const c = client();
    await c.killswitch.set({ scope: "org", active: true, reason: "incident" });
    expect(seen[0]).toEqual({
      method: "POST",
      path: "/v1/agent/killswitch",
      body: { scope: "org", active: true, reason: "incident" },
    });
  });

  it("list maps scope_id to scopeId", async () => {
    const c = client();
    nextBody = { killswitches: [{ scope: "agent", scope_id: "ag1", active: false }] };
    const [k] = await c.killswitch.list();
    expect(k).toEqual({ scope: "agent", scopeId: "ag1", active: false, reason: null });
  });
});

describe("error handling", () => {
  it("surfaces the API error_code on SuwappuError", async () => {
    const c = client();
    nextStatus = 403;
    nextBody = { success: false, error_code: "POLICY_VIOLATION", message: "blocked" };
    try {
      await c.killswitch.list();
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SuwappuError);
      expect((err as SuwappuError).status).toBe(403);
      expect((err as SuwappuError).code).toBe("POLICY_VIOLATION");
    }
  });

  it("does not choke on a non-JSON error body", async () => {
    const c = client();
    nextStatus = 502;
    nextBody = "upstream exploded";
    await expect(c.audit.verify()).rejects.toBeInstanceOf(SuwappuError);
  });
});

describe("auth header", () => {
  it("is omitted entirely when no api key is configured", async () => {
    const bare = new Suwappu({ apiKey: "", baseUrl });
    seen = [];
    await bare.listSwaps();
    expect(seen).toHaveLength(1);
  });
});

describe("market data (/v1/data/*)", () => {
  it("builds the OHLCV query string and preserves the DB/fallback source", async () => {
    const c = client();
    nextBody = {
      symbol: "ETH",
      chain: "base",
      timeframe: "1h",
      source: "db",
      candles: [
        {
          ts: "2026-01-01T00:00:00.000Z",
          open: "100",
          high: "110",
          low: "90",
          close: "105",
          volume: null,
          source: "coingecko",
        },
      ],
    };

    const result = await c.getOhlcv({
      symbol: "eth",
      chain: "base",
      timeframe: "1h",
      start: 1735689600,
      limit: 5000,
    });

    expect(seen[0]?.method).toBe("GET");
    expect(seen[0]?.path).toBe(
      "/v1/data/history/ohlcv?symbol=eth&chain=base&timeframe=1h&start=1735689600&limit=5000",
    );
    expect(result.source).toBe("db");
    expect(result.candles).toHaveLength(1);
    expect(result.candles[0]?.close).toBe("105");
  });

  it("omits the chain param when getting the full reference-tokens registry", async () => {
    const c = client();
    nextBody = {
      chains: [{ chain_id: 8453, tokens: [{ symbol: "USDC", address: "0xUSDC", decimals: 6 }] }],
    };

    const result = await c.getReferenceTokens();

    expect(seen[0]).toEqual({ method: "GET", path: "/v1/data/reference/tokens", body: null });
    expect("chains" in result && result.chains[0]?.tokens[0]?.symbol).toBe("USDC");
  });

  it("returns a single chain's token registry when chain is passed", async () => {
    const c = client();
    nextBody = {
      chain: "base",
      chain_id: 8453,
      tokens: [{ symbol: "USDC", address: "0xUSDC", decimals: 6 }],
    };

    const result = await c.getReferenceTokens("base");

    expect(seen[0]?.path).toBe("/v1/data/reference/tokens?chain=base");
    expect("chain" in result && result.chain).toBe("base");
    expect("tokens" in result && result.tokens[0]?.address).toBe("0xUSDC");
  });

  it("resolves a known symbol/chain to its canonical address and decimals", async () => {
    const c = client();
    nextBody = {
      symbol: "USDC",
      chain: "base",
      chain_id: 8453,
      address: "0xUSDCBase",
      decimals: 6,
      coingecko_id: "usd-coin",
    };

    const resolved = await c.resolveSymbol("usdc", "base");

    expect(seen[0]).toEqual({
      method: "GET",
      path: "/v1/data/reference/resolve?symbol=usdc&chain=base",
      body: null,
    });
    expect(resolved).toEqual({
      symbol: "USDC",
      chain: "base",
      chainId: 8453,
      address: "0xUSDCBase",
      decimals: 6,
      coingeckoId: "usd-coin",
    });
  });

  it("surfaces TOKEN_UNKNOWN as a SuwappuError for an unresolved symbol", async () => {
    const c = client();
    nextStatus = 404;
    nextBody = { success: false, error_code: "TOKEN_UNKNOWN", message: "Token not found" };

    try {
      await c.resolveSymbol("NOTAREALTOKEN", "base");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SuwappuError);
      expect((err as SuwappuError).status).toBe(404);
      expect((err as SuwappuError).code).toBe("TOKEN_UNKNOWN");
    }
  });

  it("maps snake_case usage fields to camelCase", async () => {
    const c = client();
    nextBody = {
      total_requests: 42,
      first_seen_at: "2026-01-01T00:00:00Z",
      last_seen_at: "2026-01-02T00:00:00Z",
      by_endpoint: { "/v1/data/history/ohlcv": 42 },
    };

    const usage = await c.getDataUsage();

    expect(seen[0]).toEqual({ method: "GET", path: "/v1/data/usage", body: null });
    expect(usage).toEqual({
      totalRequests: 42,
      firstSeenAt: "2026-01-01T00:00:00Z",
      lastSeenAt: "2026-01-02T00:00:00Z",
      byEndpoint: { "/v1/data/history/ohlcv": 42 },
    });
  });
});
