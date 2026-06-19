/**
 * Suwappu — TypeScript client for the Suwappu cross-chain DEX API.
 *
 * Mirrors `packages/sdk-python/src/suwappu/client.py`. All endpoints live
 * under `/v1/agent`. Auth is `Authorization: Bearer <apiKey>`; the API key
 * falls back to the `SUWAPPU_API_KEY` environment variable.
 */

import type {
  Chain,
  GetQuoteArgs,
  LendingMarket,
  LendingMarketDetail,
  PerpMarket,
  PerpPosition,
  PerpQuote,
  PerpQuoteArgs,
  PredictionMarket,
  PredictionMarketDetail,
  PredictionOrder,
  PredictionOrderbook,
  PredictionOrderRequest,
  PredictionOrderResult,
  PredictionPosition,
  PredictionPrices,
  PredictionTrades,
  Quote,
  SuwappuConfig,
  SwapResult,
  Token,
  TokenBalance,
  TokenPrice,
} from "./types.js";

export const DEFAULT_BASE_URL = "https://api.suwappu.bot";

/** Error thrown when the Suwappu API returns a non-2xx response. */
export class SuwappuError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`Suwappu API error ${status}: ${body}`);
    this.name = "SuwappuError";
    this.status = status;
    this.body = body;
  }
}

interface RequestOptions {
  params?: Record<string, string | undefined>;
  json?: unknown;
}

export class Suwappu {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  /** Hyperliquid perpetuals. */
  readonly perps: PerpsNamespace;
  /** Polymarket prediction markets. */
  readonly predict: PredictNamespace;
  /** Morpho lending markets. */
  readonly lend: LendNamespace;

  constructor(config: SuwappuConfig = {}) {
    this.apiKey =
      config.apiKey ??
      (typeof process !== "undefined" ? process.env?.SUWAPPU_API_KEY : undefined) ??
      "";
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;

    this.perps = new PerpsNamespace(this);
    this.predict = new PredictNamespace(this);
    this.lend = new LendNamespace(this);
  }

  /** @internal Low-level request helper used by the client and namespaces. */
  async _request<T = unknown>(
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    let url = `${this.baseUrl}${path}`;
    if (options.params) {
      const search = new URLSearchParams();
      for (const [key, value] of Object.entries(options.params)) {
        if (value !== undefined) search.set(key, value);
      }
      const qs = search.toString();
      if (qs) url += `?${qs}`;
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    const res = await fetch(url, {
      method,
      headers,
      ...(options.json !== undefined ? { body: JSON.stringify(options.json) } : {}),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new SuwappuError(res.status, text);
    }

    return (await res.json()) as T;
  }

  // --- Swap ---

  /**
   * Get a swap quote. Object-arg form matching the showcase:
   *   client.getQuote({ from: 'USDC', to: 'ETH', chain: 'base', amount: '1000' })
   */
  async getQuote(args: GetQuoteArgs): Promise<Quote> {
    const data = await this._request<Record<string, any>>("POST", "/v1/agent/quote", {
      json: {
        from_token: args.from,
        to_token: args.to,
        amount: String(args.amount),
        chain: args.chain,
      },
    });
    return {
      id: String(data.quote_id ?? data.id ?? ""),
      fromToken: data.from_token?.symbol ?? data.fromToken ?? args.from,
      toToken: data.to_token?.symbol ?? data.toToken ?? args.to,
      fromAmount: String(data.amount_in ?? data.fromAmount ?? args.amount),
      toAmount: String(data.amount_out ?? data.toAmount ?? "0"),
      route: String(data.route ?? ""),
      gas: String(data.estimated_gas_usd ?? data.gas ?? "0"),
      fee: String(data.bridge_fee_usd ?? data.fee ?? "0"),
      chain: String(data.from_chain ?? data.chain ?? args.chain),
      exchangeRate: String(data.exchange_rate ?? "0"),
      priceImpact: String(data.price_impact ?? "0"),
      slippage: String(data.slippage ?? "0"),
      estimatedTimeSeconds: Number(data.estimated_time_seconds ?? 0),
      dex: String(data.dex ?? ""),
    };
  }

  /**
   * Execute a previously obtained quote. Accepts either a Quote object
   * (as returned by getQuote) or a raw quote id string.
   */
  async swap(quoteOrId: Quote | string): Promise<SwapResult> {
    const quoteId = typeof quoteOrId === "string" ? quoteOrId : quoteOrId.id;
    const data = await this._request<Record<string, any>>("POST", "/v1/agent/swap", {
      json: { quote_id: quoteId },
    });
    return {
      txHash: data.txHash ?? data.transaction?.hash ?? "",
      status: data.status ?? "pending",
      chain: data.chain ?? data.chain_type ?? "",
    };
  }

  /** Alias for swap(), mirroring the Python client's execute_swap. */
  executeSwap(quoteId: string): Promise<SwapResult> {
    return this.swap(quoteId);
  }

  async getPortfolio(walletAddress: string, chain?: string): Promise<TokenBalance[]> {
    const data = await this._request<{ balances?: any[] }>("GET", "/v1/agent/portfolio", {
      params: { wallet_address: walletAddress, chain },
    });
    return (data.balances ?? []).map((b) => ({
      token: b.symbol ?? b.token ?? "",
      balance: String(b.balance ?? ""),
      usdValue: String(b.usd_value ?? b.usdValue ?? ""),
      chain: b.chain ?? "",
    }));
  }

  async getPrices(symbols: string, chain?: string): Promise<TokenPrice[]> {
    const data = await this._request<{ prices?: Record<string, any> }>(
      "GET",
      "/v1/agent/prices",
      { params: { symbols, chain } },
    );
    return Object.entries(data.prices ?? {}).map(([token, info]) => ({
      token,
      priceUsd: String(info?.usd ?? ""),
      change24h: String(info?.change_24h ?? 0),
    }));
  }

  async listChains(): Promise<Chain[]> {
    const data = await this._request<{ chains?: Chain[] }>("GET", "/v1/agent/chains");
    return data.chains ?? [];
  }

  async listTokens(chain: string): Promise<Token[]> {
    const data = await this._request<{ tokens?: Token[] } | Token[]>("GET", "/v1/agent/tokens", {
      params: { chain },
    });
    if (Array.isArray(data)) return data;
    return data.tokens ?? [];
  }
}

class PerpsNamespace {
  constructor(private readonly c: Suwappu) {}

  /** GET /v1/agent/perps/markets */
  async markets(): Promise<PerpMarket[]> {
    const data = await this.c._request<{ markets?: PerpMarket[] }>(
      "GET",
      "/v1/agent/perps/markets",
    );
    return data.markets ?? [];
  }

  /** POST /v1/agent/perps/quote */
  async quote(args: PerpQuoteArgs): Promise<PerpQuote> {
    return this.c._request<PerpQuote>("POST", "/v1/agent/perps/quote", {
      json: {
        market: args.market,
        side: args.side,
        size: args.size,
        leverage: args.leverage,
      },
    });
  }

  /** GET /v1/agent/perps/positions */
  async positions(address: string): Promise<PerpPosition[]> {
    const data = await this.c._request<{ positions?: PerpPosition[] }>(
      "GET",
      "/v1/agent/perps/positions",
      { params: { address } },
    );
    return data.positions ?? [];
  }
}

class PredictNamespace {
  constructor(private readonly c: Suwappu) {}

  /**
   * List prediction markets. The showcase calls this `client.predict.list(...)`;
   * exposed under both `list` and `markets` for ergonomics.
   * GET /v1/agent/predict/markets
   */
  async list(args: { query?: string; limit?: number } = {}): Promise<PredictionMarket[]> {
    const data = await this.c._request<{ markets?: PredictionMarket[] }>(
      "GET",
      "/v1/agent/predict/markets",
      { params: { query: args.query, limit: args.limit?.toString() } },
    );
    return data.markets ?? [];
  }

  /** Alias for list(), mirroring the Python client's predict.markets. */
  markets(args: { query?: string; limit?: number } = {}): Promise<PredictionMarket[]> {
    return this.list(args);
  }

  /** GET /v1/agent/predict/market/:id */
  market(id: string): Promise<PredictionMarketDetail> {
    return this.c._request<PredictionMarketDetail>("GET", `/v1/agent/predict/market/${id}`);
  }

  /** GET /v1/agent/predict/market/:id/book */
  book(id: string): Promise<PredictionOrderbook> {
    return this.c._request<PredictionOrderbook>("GET", `/v1/agent/predict/market/${id}/book`);
  }

  /** GET /v1/agent/predict/market/:id/price */
  price(id: string): Promise<PredictionPrices> {
    return this.c._request<PredictionPrices>("GET", `/v1/agent/predict/market/${id}/price`);
  }

  /** GET /v1/agent/predict/market/:id/trades */
  trades(id: string, limit?: number): Promise<PredictionTrades> {
    return this.c._request<PredictionTrades>("GET", `/v1/agent/predict/market/${id}/trades`, {
      params: { limit: limit?.toString() },
    });
  }

  /**
   * Place a CLOB order. POST /v1/agent/predict/order
   *
   * The showcase shows `predict.buy({ marketId, outcome, amount })`, but the
   * real endpoint takes a token id + limit price + side (PlaceOrderSchema).
   * `order()` is the faithful wrapper; `buy()` is intentionally NOT provided
   * because the illustrative `{ marketId, outcome, amount }` shape has no
   * direct backing endpoint (no market-order-by-outcome route exists).
   */
  async order(req: PredictionOrderRequest): Promise<PredictionOrderResult> {
    const data = await this.c._request<{ order?: PredictionOrderResult }>(
      "POST",
      "/v1/agent/predict/order",
      { json: req },
    );
    return data.order ?? {};
  }

  /** GET /v1/agent/predict/positions */
  async positions(): Promise<PredictionPosition[]> {
    const data = await this.c._request<{ positions?: PredictionPosition[] }>(
      "GET",
      "/v1/agent/predict/positions",
    );
    return data.positions ?? [];
  }

  /** GET /v1/agent/predict/orders */
  async orders(status?: string): Promise<PredictionOrder[]> {
    const data = await this.c._request<{ orders?: PredictionOrder[] } | PredictionOrder[]>(
      "GET",
      "/v1/agent/predict/orders",
      { params: { status } },
    );
    if (Array.isArray(data)) return data;
    return data.orders ?? [];
  }
}

class LendNamespace {
  constructor(private readonly c: Suwappu) {}

  /** GET /v1/agent/lend/markets */
  async markets(chainId?: number): Promise<LendingMarket[]> {
    const data = await this.c._request<{ markets?: LendingMarket[] }>(
      "GET",
      "/v1/agent/lend/markets",
      { params: { chainId: chainId?.toString() } },
    );
    return data.markets ?? [];
  }

  /** GET /v1/agent/lend/market/:id */
  market(id: string): Promise<LendingMarketDetail> {
    return this.c._request<LendingMarketDetail>("GET", `/v1/agent/lend/market/${id}`);
  }
}

/** Create a Suwappu client. */
export function createClient(config: SuwappuConfig = {}): Suwappu {
  return new Suwappu(config);
}
