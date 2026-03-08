import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { createClient } from "../index";

const MOCK_BASE = "https://test.suwappu.bot";
const MOCK_KEY = "test-api-key-123";

let fetchCalls: { url: string; init: RequestInit }[] = [];
let mockResponse: unknown = {};
let mockStatus = 200;

const originalFetch = globalThis.fetch;

beforeEach(() => {
  fetchCalls = [];
  mockResponse = {};
  mockStatus = 200;

  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    fetchCalls.push({ url, init: init ?? {} });
    return new Response(JSON.stringify(mockResponse), {
      status: mockStatus,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function client() {
  return createClient({ apiKey: MOCK_KEY, baseUrl: MOCK_BASE });
}

describe("createClient", () => {
  describe("getQuote", () => {
    it("POSTs to /v1/agent/quote with correct body", async () => {
      mockResponse = { id: "q1", fromToken: "ETH", toToken: "USDC", fromAmount: "1", toAmount: "2847", route: "uniswap", gas: "0.12", fee: "0.01", chain: "arbitrum" };

      const quote = await client().getQuote("ETH", "USDC", 1.0, "arbitrum");

      expect(fetchCalls).toHaveLength(1);
      expect(fetchCalls[0].url).toBe(`${MOCK_BASE}/v1/agent/quote`);
      expect(fetchCalls[0].init.method).toBe("POST");
      expect(JSON.parse(fetchCalls[0].init.body as string)).toEqual({
        fromToken: "ETH",
        toToken: "USDC",
        amount: 1.0,
        chain: "arbitrum",
      });
      expect(quote.id).toBe("q1");
      expect(quote.toAmount).toBe("2847");
    });
  });

  describe("executeSwap", () => {
    it("POSTs to /v1/agent/swap with quoteId", async () => {
      mockResponse = { txHash: "0xabc", status: "confirmed", chain: "arbitrum" };

      const result = await client().executeSwap("q1");

      expect(fetchCalls[0].url).toBe(`${MOCK_BASE}/v1/agent/swap`);
      expect(fetchCalls[0].init.method).toBe("POST");
      expect(JSON.parse(fetchCalls[0].init.body as string)).toEqual({ quoteId: "q1" });
      expect(result.txHash).toBe("0xabc");
      expect(result.status).toBe("confirmed");
    });
  });

  describe("getPortfolio", () => {
    it("GETs /v1/agent/portfolio without chain", async () => {
      mockResponse = [{ token: "ETH", balance: "1.5", usdValue: "4270", chain: "arbitrum" }];

      const portfolio = await client().getPortfolio();

      expect(fetchCalls[0].url).toBe(`${MOCK_BASE}/v1/agent/portfolio`);
      expect(fetchCalls[0].init.method).toBeUndefined(); // default GET
      expect(portfolio).toHaveLength(1);
      expect(portfolio[0].token).toBe("ETH");
    });

    it("GETs /v1/agent/portfolio with chain filter", async () => {
      mockResponse = [];
      await client().getPortfolio("solana");
      expect(fetchCalls[0].url).toBe(`${MOCK_BASE}/v1/agent/portfolio?chain=solana`);
    });
  });

  describe("getPrices", () => {
    it("GETs /v1/agent/prices with token param", async () => {
      mockResponse = { token: "ETH", priceUsd: "2847.32", change24h: "-1.2" };

      const price = await client().getPrices("ETH");

      expect(fetchCalls[0].url).toBe(`${MOCK_BASE}/v1/agent/prices?token=ETH`);
      expect(price.priceUsd).toBe("2847.32");
    });

    it("GETs /v1/agent/prices with chain filter", async () => {
      mockResponse = { token: "ETH", priceUsd: "2847", change24h: "0" };
      await client().getPrices("ETH", "arbitrum");
      expect(fetchCalls[0].url).toBe(`${MOCK_BASE}/v1/agent/prices?token=ETH&chain=arbitrum`);
    });
  });

  describe("listChains", () => {
    it("GETs /v1/agent/chains", async () => {
      mockResponse = [{ name: "arbitrum", chainId: 42161, status: "active" }];

      const chains = await client().listChains();

      expect(fetchCalls[0].url).toBe(`${MOCK_BASE}/v1/agent/chains`);
      expect(chains).toHaveLength(1);
      expect(chains[0].name).toBe("arbitrum");
    });
  });

  describe("listTokens", () => {
    it("GETs /v1/agent/tokens with chain", async () => {
      mockResponse = [{ symbol: "USDC", address: "0x123", decimals: 6, chain: "arbitrum" }];

      const tokens = await client().listTokens("arbitrum");

      expect(fetchCalls[0].url).toBe(`${MOCK_BASE}/v1/agent/tokens?chain=arbitrum`);
      expect(tokens[0].symbol).toBe("USDC");
    });
  });

  describe("auth header", () => {
    it("sets Bearer token from config", async () => {
      mockResponse = [];
      await client().listChains();

      const headers = fetchCalls[0].init.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe(`Bearer ${MOCK_KEY}`);
    });

    it("omits auth header when no apiKey", async () => {
      mockResponse = [];
      const noAuthClient = createClient({ baseUrl: MOCK_BASE });
      await noAuthClient.listChains();

      const headers = fetchCalls[0].init.headers as Record<string, string>;
      expect(headers["Authorization"]).toBeUndefined();
    });
  });

  describe("error handling", () => {
    it("throws on non-ok response", async () => {
      mockStatus = 401;
      mockResponse = "Unauthorized";

      await expect(client().listChains()).rejects.toThrow("Suwappu API error 401");
    });
  });

  describe("perps", () => {
    it("GETs /v1/agent/perps/markets", async () => {
      mockResponse = { markets: [{ name: "ETH-USD", asset: "ETH", szDecimals: 4, maxLeverage: 20, markPrice: 2847, fundingRate: 0.01 }] };
      const markets = await client().perps.markets();
      expect(fetchCalls[0].url).toBe(`${MOCK_BASE}/v1/agent/perps/markets`);
      expect(markets).toHaveLength(1);
      expect(markets[0].name).toBe("ETH-USD");
    });

    it("POSTs to /v1/agent/perps/quote", async () => {
      mockResponse = { market: "ETH-USD", side: "long", size: 1, leverage: 5, entryPrice: 2847, margin: 569.4, liquidationPrice: 2300, fundingRate: 0.01, fee: 0.57 };
      const quote = await client().perps.quote("ETH-USD", "long", 1, 5);
      expect(fetchCalls[0].url).toBe(`${MOCK_BASE}/v1/agent/perps/quote`);
      expect(fetchCalls[0].init.method).toBe("POST");
      expect(JSON.parse(fetchCalls[0].init.body as string)).toEqual({ market: "ETH-USD", side: "long", size: 1, leverage: 5 });
      expect(quote.entryPrice).toBe(2847);
    });

    it("GETs /v1/agent/perps/positions with address", async () => {
      mockResponse = { positions: [] };
      await client().perps.positions("0xabc");
      expect(fetchCalls[0].url).toBe(`${MOCK_BASE}/v1/agent/perps/positions?address=0xabc`);
    });
  });

  describe("predict", () => {
    it("GETs /v1/agent/predict/markets", async () => {
      mockResponse = { markets: [{ id: "m1", question: "Will ETH hit 5k?", outcomes: ["Yes", "No"], outcomePrices: [0.65, 0.35], volume: 100000, liquidity: 50000, endDate: "2026-12-31", active: true, category: "crypto" }] };
      const markets = await client().predict.markets();
      expect(fetchCalls[0].url).toBe(`${MOCK_BASE}/v1/agent/predict/markets`);
      expect(markets[0].question).toBe("Will ETH hit 5k?");
    });

    it("GETs /v1/agent/predict/markets with query", async () => {
      mockResponse = { markets: [] };
      await client().predict.markets("crypto", 10);
      expect(fetchCalls[0].url).toBe(`${MOCK_BASE}/v1/agent/predict/markets?query=crypto&limit=10`);
    });

    it("GETs /v1/agent/predict/market/:id", async () => {
      mockResponse = { id: "m1", question: "Test?", description: "desc", outcomes: [], outcomePrices: [], volume: 0, liquidity: 0, endDate: "", active: true, category: "", createdAt: "", resolvedOutcome: null };
      const market = await client().predict.market("m1");
      expect(fetchCalls[0].url).toBe(`${MOCK_BASE}/v1/agent/predict/market/m1`);
      expect(market.id).toBe("m1");
    });
  });

  describe("lend", () => {
    it("GETs /v1/agent/lend/markets", async () => {
      mockResponse = { markets: [{ id: "mk1", loanToken: "USDC", collateralToken: "ETH", lltv: 0.86, supplyApy: 5.2, borrowApy: 7.1, totalSupply: 1000000, totalBorrow: 800000, utilization: 80, chainId: 8453 }] };
      const markets = await client().lend.markets();
      expect(fetchCalls[0].url).toBe(`${MOCK_BASE}/v1/agent/lend/markets`);
      expect(markets[0].loanToken).toBe("USDC");
    });

    it("GETs /v1/agent/lend/markets with chainId", async () => {
      mockResponse = { markets: [] };
      await client().lend.markets(1);
      expect(fetchCalls[0].url).toBe(`${MOCK_BASE}/v1/agent/lend/markets?chainId=1`);
    });

    it("GETs /v1/agent/lend/market/:id", async () => {
      mockResponse = { id: "mk1", loanToken: "USDC", collateralToken: "ETH", lltv: 0.86, supplyApy: 5, borrowApy: 7, totalSupply: 1000000, totalBorrow: 800000, utilization: 80, chainId: 8453, oracle: "0x1", irm: "0x2", createdAt: "2024-01-01" };
      const market = await client().lend.market("mk1");
      expect(fetchCalls[0].url).toBe(`${MOCK_BASE}/v1/agent/lend/market/mk1`);
      expect(market.oracle).toBe("0x1");
    });
  });
});
