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

/**
 * One leg of a routed swap. Most cross-chain routes are more than one
 * transaction — a swap on the source chain, a bridge relay, a swap on the
 * destination — and the preview reports each leg rather than a flattened
 * route string.
 */
export interface PreviewHop {
  index: number;
  /** 'swap' (same-chain DEX), 'cross' (bridge/relay), 'protocol', … */
  type: string;
  tool: string;
  toolName: string;
  fromChain: string | null;
  toChain: string | null;
  fromToken: string | null;
  toToken: string | null;
  fromAmount: string | null;
  toAmount: string | null;
  estimatedGasUsd: string | null;
  feeUsd: string | null;
  estimatedDurationSeconds: number | null;
}

export interface SwapPreview {
  indicative: true;
  executable: false;
  previewId: string;
  order: RouteOrder;
  fromChain: string;
  toChain: string;
  fromToken: { address: string; symbol: string; decimals: number };
  toToken: { address: string; symbol: string; decimals: number };
  /** Human-readable, as requested — the API echoes it back rather than wei. */
  fromAmount: string;
  fromAmountUsd: string;
  /** Human-readable, like fromAmount. */
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
  /**
   * Absent from an older API build, and from proposals a pre-hops session
   * persisted in localStorage. Never read it directly: `previewHops()` is the
   * one place the fallback lives.
   */
  hops?: PreviewHop[];
  notice: string;
}

/**
 * The route's legs, never empty. When the preview carries none, the whole
 * quote is one honest hop, so every consumer (tool results, the dossier, the
 * receipt) counts and draws the same thing.
 */
export function previewHops(p: SwapPreview): PreviewHop[] {
  if (Array.isArray(p.hops) && p.hops.length > 0) return p.hops;
  return [
    {
      index: 0,
      type: p.fromChain === p.toChain ? 'swap' : 'cross',
      tool: p.route,
      toolName: p.route,
      fromChain: p.fromChain,
      toChain: p.toChain,
      fromToken: p.fromToken.symbol,
      toToken: p.toToken.symbol,
      fromAmount: p.fromAmount,
      toAmount: p.toAmount,
      estimatedGasUsd: p.estimatedGasUsd,
      feeUsd: p.bridgeFeeUsd,
      estimatedDurationSeconds: p.estimatedDurationSeconds,
    },
  ];
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
    throw new Error(detail);
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

// ── Server-side enforcement: agent spend policies ───────────────────
//
// POST/GET/DELETE /v1/agent/policies. These rows are what the API's policy
// gate evaluates on every swap execute by the agent, before a transaction is
// built. The desk calls them with the agent's bearer token, which the human
// pastes into the page and which lives only in this tab's session storage.

export interface SpendPolicyBody {
  name: string;
  max_tx_usd?: number;
  daily_cap_usd?: number;
  max_slippage_bps?: number;
  allowed_chains?: string[];
  allowed_tokens?: string[];
  approval_mode?: 'always_ask' | 'above_limit' | 'autonomous';
  require_approval_above_usd?: number;
  replaces?: string[];
}

export interface SpendPolicy {
  id: string;
  name: string;
  scope: 'agent' | 'organization';
  enabled: boolean;
  max_tx_usd: number | null;
  daily_cap_usd: number | null;
  max_slippage_bps: number | null;
  allowed_chains: string[] | null;
  allowed_tokens: string[] | null;
  approval_mode: string;
  created_at: string;
}

async function authedJson<T>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  apiKey: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });
  const parsed = (await res.json().catch(() => null)) as
    | (T & { error?: string; message?: string; hint?: string })
    | null;
  if (!res.ok || parsed === null) {
    const detail =
      (parsed && [parsed.message || parsed.error, parsed.hint].filter(Boolean).join(' — ')) ||
      `${res.status} ${res.statusText}`;
    throw new Error(detail);
  }
  return parsed as T;
}

export function installSpendPolicy(
  apiKey: string,
  body: SpendPolicyBody,
  signal?: AbortSignal,
): Promise<{ policy: SpendPolicy; enforcement: string }> {
  return authedJson('POST', '/v1/agent/policies', apiKey, body, signal);
}

export function listSpendPolicies(
  apiKey: string,
  signal?: AbortSignal,
): Promise<{ policies: SpendPolicy[]; enforcement: string }> {
  return authedJson('GET', '/v1/agent/policies', apiKey, undefined, signal);
}

export function deleteSpendPolicy(
  apiKey: string,
  id: string,
  signal?: AbortSignal,
): Promise<{ deleted: boolean }> {
  return authedJson('DELETE', `/v1/agent/policies/${encodeURIComponent(id)}`, apiKey, undefined, signal);
}
