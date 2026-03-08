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
  name: string;
  chainId: number;
  status: "active" | "degraded" | "down";
}

export interface Token {
  symbol: string;
  address: string;
  decimals: number;
  chain: string;
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

export function createClient(config?: SuwappuConfig) {
  return {
    async getQuote(
      fromToken: string,
      toToken: string,
      amount: number,
      chain: string
    ): Promise<Quote> {
      return request<Quote>(
        `/v1/quote?from=${fromToken}&to=${toToken}&amount=${amount}&chain=${chain}`,
        config
      );
    },

    async executeSwap(quoteId: string): Promise<SwapResult> {
      return request<SwapResult>("/v1/swap", config, {
        method: "POST",
        body: JSON.stringify({ quoteId }),
      });
    },

    async getPortfolio(chain?: string): Promise<TokenBalance[]> {
      const q = chain ? `?chain=${chain}` : "";
      return request<TokenBalance[]>(`/v1/portfolio${q}`, config);
    },

    async getPrices(token: string, chain?: string): Promise<TokenPrice> {
      const q = chain ? `?chain=${chain}` : "";
      return request<TokenPrice>(`/v1/prices/${token}${q}`, config);
    },

    async listChains(): Promise<Chain[]> {
      return request<Chain[]>("/v1/chains", config);
    },

    async listTokens(chain: string): Promise<Token[]> {
      return request<Token[]>(`/v1/tokens?chain=${chain}`, config);
    },
  };
}

/** Default client using env vars */
export const suwappu = createClient();

export default suwappu;
