// Generic pools/TVL venue for major DeFi protocols, built on DefiLlama's
// public Yields API (`yields.llama.fi/pools`) instead of a bespoke
// first-party API per protocol — most protocols don't expose one the way
// Curve's Prices API does. Public, CORS-enabled, no API key, same trust
// tier as `curve.ts` and `dexscreener.ts`.
//
// The full payload is one ~11MB (~2MB gzipped) JSON array covering every
// pool DefiLlama tracks; we fetch it once (module-level cache) and filter
// client-side per protocol, rather than one heavy fetch per tab.

const POOLS_URL = 'https://yields.llama.fi/pools'

export type ProtocolKind = 'dex' | 'lending' | 'staking'

export interface ProtocolConfig {
  // DefiLlama `project` slug this tab filters to.
  slug: string
  label: string
  icon: string
  kind: ProtocolKind
  externalName: string
}

export const PROTOCOLS: Record<string, ProtocolConfig> = {
  uniswap: { slug: 'uniswap-v3', label: 'Uniswap', icon: '🦄', kind: 'dex', externalName: 'Uniswap' },
  pancakeswap: {
    slug: 'pancakeswap-amm-v3',
    label: 'PancakeSwap',
    icon: '🥞',
    kind: 'dex',
    externalName: 'PancakeSwap',
  },
  balancer: { slug: 'balancer-v2', label: 'Balancer', icon: '⚖️', kind: 'dex', externalName: 'Balancer' },
  aave: { slug: 'aave-v3', label: 'Aave', icon: '👻', kind: 'lending', externalName: 'Aave' },
  compound: { slug: 'compound-v3', label: 'Compound', icon: '🏛️', kind: 'lending', externalName: 'Compound' },
  lido: { slug: 'lido', label: 'Lido', icon: '🌊', kind: 'staking', externalName: 'Lido' },
}

export type DefiSortBy = 'tvl' | 'apy'

export interface DefiPool {
  id: string
  project: string
  chain: string
  symbol: string
  tvlUsd: number
  apy: number
  apyBase: number
  apyReward: number
  poolMeta: string
  underlyingTokens: string[]
}

class DefiPoolsApiError extends Error {}

function parsePool(raw: unknown): DefiPool | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const id = typeof row.pool === 'string' ? row.pool : ''
  const project = typeof row.project === 'string' ? row.project : ''
  if (!id || !project) return null
  const chain = typeof row.chain === 'string' && row.chain ? row.chain : 'unknown'
  const symbol = typeof row.symbol === 'string' && row.symbol ? row.symbol : '?'
  const num = (v: unknown) => {
    const n = Number(v ?? 0)
    return Number.isFinite(n) ? n : 0
  }
  const underlyingTokens = Array.isArray(row.underlyingTokens)
    ? row.underlyingTokens.filter((t): t is string => typeof t === 'string')
    : []
  return {
    id,
    project,
    chain,
    symbol,
    tvlUsd: num(row.tvlUsd),
    apy: num(row.apy),
    apyBase: num(row.apyBase),
    apyReward: num(row.apyReward),
    poolMeta: typeof row.poolMeta === 'string' ? row.poolMeta : '',
    underlyingTokens,
  }
}

export function parseDefiPools(payload: unknown): DefiPool[] {
  if (!payload || typeof payload !== 'object') return []
  const data = (payload as { data?: unknown }).data
  if (!Array.isArray(data)) return []
  const out: DefiPool[] = []
  for (const entry of data) {
    const parsed = parsePool(entry)
    if (parsed) out.push(parsed)
  }
  return out
}

let cache: Promise<DefiPool[]> | null = null

// All pools across every protocol DefiLlama tracks, fetched once per page
// load and shared across every protocol tab (react-query's own cache keys
// this the same way, but the module-level promise also protects against
// two tabs mounting before the first fetch resolves).
export async function fetchAllDefiPools(): Promise<DefiPool[]> {
  if (!cache) {
    cache = (async () => {
      const res = await fetch(POOLS_URL)
      if (!res.ok) throw new DefiPoolsApiError(`DefiLlama pools API ${res.status}`)
      return parseDefiPools(await res.json())
    })()
    cache.catch(() => {
      cache = null
    })
  }
  return cache
}

export function poolsForProtocol(pools: DefiPool[], slug: string): DefiPool[] {
  return pools.filter((p) => p.project === slug)
}

// Chains ordered by that protocol's total TVL desc, so the busiest chain
// leads the picker — same convention as Curve's chain ordering.
export function chainsByTvl(pools: DefiPool[]): string[] {
  const tvlByChain = new Map<string, number>()
  for (const p of pools) {
    tvlByChain.set(p.chain, (tvlByChain.get(p.chain) ?? 0) + p.tvlUsd)
  }
  return [...tvlByChain.entries()].sort((a, b) => b[1] - a[1]).map(([chain]) => chain)
}

export function defiLlamaPoolUrl(id: string): string {
  return `https://defillama.com/yields/pool/${id}`
}
