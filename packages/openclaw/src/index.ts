/**
 * @suwappu/openclaw — OpenClaw skill module for cross-chain swaps
 *
 * Usage:
 *   import { suwappu } from "@suwappu/openclaw";
 *   const quote = await suwappu.getQuote("ETH", "USDC", 1.0, "arbitrum");
 *   const tx = await suwappu.executeSwap(quote.id);
 */

export interface SuwappuConfig {
  apiKey?: string;
  baseUrl?: string;
}

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
  exchangeRate: string;
  priceImpact: string;
  slippage: string;
  estimatedTimeSeconds: number;
  dex: string;
}

export interface SwapResult {
  txHash: string;
  status: "confirmed" | "pending" | "failed";
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

// Perps types (Hyperliquid)
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

// Prediction types (Polymarket)
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

// Lending types (Morpho)
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

const DEFAULT_BASE_URL = "https://api.suwappu.bot";

function getConfig(config?: SuwappuConfig) {
  return {
    apiKey: config?.apiKey ?? process.env.SUWAPPU_API_KEY ?? "",
    baseUrl: config?.baseUrl ?? DEFAULT_BASE_URL,
  };
}

async function request<T>(
  path: string,
  config: SuwappuConfig | undefined,
  options?: RequestInit
): Promise<T> {
  const { apiKey, baseUrl } = getConfig(config);
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Suwappu API error ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export type SuwappuClient = ReturnType<typeof createClient>;

export function createClient(config?: SuwappuConfig) {
  return {
    async getQuote(
      fromToken: string,
      toToken: string,
      amount: number,
      chain: string
    ): Promise<Quote> {
      const raw = await request<Record<string, unknown>>("/v1/agent/quote", config, {
        method: "POST",
        body: JSON.stringify({
          from_token: fromToken,
          to_token: toToken,
          amount: String(amount),
          chain,
        }),
      });
      return {
        id: String(raw.quote_id ?? ""),
        fromToken: (raw.from_token as Record<string, string>)?.symbol ?? fromToken,
        toToken: (raw.to_token as Record<string, string>)?.symbol ?? toToken,
        fromAmount: String(raw.amount_in ?? amount),
        toAmount: String(raw.amount_out ?? "0"),
        route: String(raw.route ?? ""),
        gas: String(raw.estimated_gas_usd ?? "0"),
        fee: String(raw.bridge_fee_usd ?? "0"),
        chain: String(raw.from_chain ?? chain),
        exchangeRate: String(raw.exchange_rate ?? "0"),
        priceImpact: String(raw.price_impact ?? "0"),
        slippage: String(raw.slippage ?? "0"),
        estimatedTimeSeconds: Number(raw.estimated_time_seconds ?? 0),
        dex: String(raw.dex ?? ""),
      };
    },

    async executeSwap(quoteId: string): Promise<SwapResult> {
      return request<SwapResult>("/v1/agent/swap", config, {
        method: "POST",
        body: JSON.stringify({ quote_id: quoteId }),
      });
    },

    async getPortfolio(walletAddress: string, chain?: string): Promise<TokenBalance[]> {
      const params = new URLSearchParams({ wallet_address: walletAddress });
      if (chain) params.set("chain", chain);
      const res = await request<{ balances: TokenBalance[] }>(
        `/v1/agent/portfolio?${params.toString()}`,
        config
      );
      return res.balances;
    },

    async getPrices(symbols: string, chain?: string): Promise<TokenPrice[]> {
      const q = chain ? `&chain=${chain}` : "";
      const res = await request<{ prices: Record<string, { usd: number; change_24h: number | null }> }>(
        `/v1/agent/prices?symbols=${encodeURIComponent(symbols)}${q}`,
        config
      );
      return Object.entries(res.prices).map(([token, data]) => ({
        token,
        priceUsd: String(data.usd),
        change24h: String(data.change_24h ?? 0),
      }));
    },

    async listChains(): Promise<Chain[]> {
      const res = await request<{ chains: Chain[] }>(
        "/v1/agent/chains",
        config
      );
      return res.chains;
    },

    async listTokens(chain: string): Promise<Token[]> {
      const res = await request<{ tokens: Token[] }>(
        `/v1/agent/tokens?chain=${chain}`,
        config
      );
      return res.tokens;
    },

    // Perps (Hyperliquid)
    perps: {
      async markets(): Promise<PerpMarket[]> {
        const res = await request<{ markets: PerpMarket[] }>(
          "/v1/agent/perps/markets",
          config
        );
        return res.markets;
      },
      async quote(
        market: string,
        side: "long" | "short",
        size: number,
        leverage: number
      ): Promise<PerpQuote> {
        return request<PerpQuote>("/v1/agent/perps/quote", config, {
          method: "POST",
          body: JSON.stringify({ market, side, size, leverage }),
        });
      },
      async positions(address: string): Promise<PerpPosition[]> {
        const res = await request<{ positions: PerpPosition[] }>(
          `/v1/agent/perps/positions?address=${address}`,
          config
        );
        return res.positions;
      },
    },

    // Predictions (Polymarket)
    predict: {
      async markets(query?: string, limit?: number): Promise<PredictionMarket[]> {
        const params = new URLSearchParams();
        if (query) params.set("query", query);
        if (limit) params.set("limit", String(limit));
        const qs = params.toString();
        const res = await request<{ markets: PredictionMarket[] }>(
          `/v1/agent/predict/markets${qs ? `?${qs}` : ""}`,
          config
        );
        return res.markets;
      },
      async market(id: string): Promise<PredictionMarketDetail> {
        return request<PredictionMarketDetail>(
          `/v1/agent/predict/market/${id}`,
          config
        );
      },
    },

    // Lending (Morpho)
    lend: {
      async markets(chainId?: number): Promise<LendingMarket[]> {
        const qs = chainId ? `?chainId=${chainId}` : "";
        const res = await request<{ markets: LendingMarket[] }>(
          `/v1/agent/lend/markets${qs}`,
          config
        );
        return res.markets;
      },
      async market(id: string): Promise<LendingMarketDetail> {
        return request<LendingMarketDetail>(
          `/v1/agent/lend/market/${id}`,
          config
        );
      },
    },
  };
}

/** Default client using env vars */
export const suwappu = createClient();

export default suwappu;
