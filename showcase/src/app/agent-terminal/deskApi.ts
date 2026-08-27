/**
 * Thin, browser-safe client for the public Suwappu endpoints the Agent Desk
 * exposes as WebMCP site tools.
 *
 * Every endpoint here is unauthenticated and read-only. Nothing in this file
 * can move funds: the only "write" in the Desk is a proposal that a human has
 * to approve in the page UI, and the signing itself happens in the user's own
 * wallet surface (Telegram / Terminal), never here.
 */
import { API_BASE_URL } from '@/lib/links';

export interface ChainInfo {
  id: number;
  key: string;
  name: string;
  logoURI?: string;
}

export interface TokenInfo {
  symbol: string;
  name: string;
  address: string;
  chain: string;
  decimals: number;
  logoUrl?: string | null;
}

export type RouteOrder = 'RECOMMENDED' | 'FASTEST' | 'CHEAPEST' | 'SAFEST';

export interface SwapPreview {
  indicative: true;
  executable: false;
  previewId: string;
  order: RouteOrder;
  fromChain: string;
  toChain: string;
  fromToken: { address: string; symbol: string; decimals: number };
  toToken: { address: string; symbol: string; decimals: number };
  fromAmount: string;
  fromAmountUsd: string;
  toAmount: string;
  toAmountMin: string;
  toAmountUsd: string;
  exchangeRate: string;
  priceImpact: string;
  estimatedGasUsd: string;
  bridgeFeeUsd: string;
  estimatedDurationSeconds: number;
  slippage: number;
  route: string;
  notice: string;
}

export interface PreviewParams {
  fromChain: string;
  toChain: string;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  slippage?: number;
  order?: RouteOrder;
}

class DeskApiError extends Error {}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: { Accept: 'application/json' },
    signal,
  });
  const body = (await res.json().catch(() => null)) as
    | (T & { error?: string; message?: string })
    | null;
  if (!res.ok || body === null) {
    const detail =
      (body && (body.message || body.error)) || `${res.status} ${res.statusText}`;
    throw new DeskApiError(detail);
  }
  return body as T;
}

export function listChains(signal?: AbortSignal): Promise<{ chains: ChainInfo[] }> {
  return getJson<{ chains: ChainInfo[] }>('/public/swap/chains', signal);
}

export async function findTokens(
  query: string,
  chain: string,
  signal?: AbortSignal,
): Promise<TokenInfo[]> {
  const qs = new URLSearchParams({ q: query, chain });
  const rows = await getJson<TokenInfo[]>(`/webapp/tokens/search?${qs}`, signal);
  return Array.isArray(rows) ? rows : [];
}

export async function getPrices(
  symbols: string[],
  signal?: AbortSignal,
): Promise<Record<string, number>> {
  if (symbols.length === 0) return {};
  const qs = new URLSearchParams({ tokens: symbols.join(',') });
  const body = await getJson<{ prices?: Record<string, number> }>(
    `/webapp/tokens/prices?${qs}`,
    signal,
  );
  return body.prices ?? {};
}

export function previewSwap(
  params: PreviewParams,
  signal?: AbortSignal,
): Promise<SwapPreview> {
  const qs = new URLSearchParams({
    fromChain: params.fromChain,
    toChain: params.toChain,
    fromToken: params.fromToken,
    toToken: params.toToken,
    fromAmount: params.fromAmount,
    order: params.order ?? 'RECOMMENDED',
  });
  if (params.slippage !== undefined) qs.set('slippage', String(params.slippage));
  return getJson<SwapPreview>(`/public/swap/preview?${qs}`, signal);
}
