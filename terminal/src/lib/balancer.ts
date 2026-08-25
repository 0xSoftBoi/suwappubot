// Typed client + pure parsers for Balancer's own public API v3 GraphQL API
// (`api-v3.balancer.fi/graphql`) — first-party, no API key, the same one
// app.balancer.fi's own UI queries. Confirmed via introspection:
// `poolGetPools(where, first, skip, orderBy, orderDirection)`.

const GRAPHQL_URL = 'https://api-v3.balancer.fi/graphql'

class BalancerApiError extends Error {}

async function graphql<T = unknown>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  if (!res.ok) throw new BalancerApiError(`Balancer API ${res.status}`)
  const payload = (await res.json()) as { data?: T; errors?: { message: string }[] }
  if (payload.errors?.length) throw new BalancerApiError(payload.errors[0].message)
  if (!payload.data) throw new BalancerApiError('Balancer API returned no data')
  return payload.data
}

// The chains Balancer v3 API tracks that overlap with the terminal's swap
// desk (`GqlChain` enum value -> Curve/wagmi-style chain slug).
export const BALANCER_CHAINS: { id: string; slug: string; label: string }[] = [
  { id: 'MAINNET', slug: 'ethereum', label: 'Ethereum' },
  { id: 'ARBITRUM', slug: 'arbitrum', label: 'Arbitrum' },
  { id: 'OPTIMISM', slug: 'optimism', label: 'Optimism' },
  { id: 'POLYGON', slug: 'polygon', label: 'Polygon' },
  { id: 'BASE', slug: 'base', label: 'Base' },
  { id: 'AVALANCHE', slug: 'avalanche', label: 'Avalanche' },
  { id: 'GNOSIS', slug: 'gnosis', label: 'Gnosis' },
  { id: 'SONIC', slug: 'sonic', label: 'Sonic' },
]

export type BalancerSortBy = 'totalLiquidity' | 'volume24h' | 'apr'

export interface BalancerPoolToken {
  symbol: string
  address: string
  decimals: number
}

export interface BalancerPool {
  id: string
  address: string
  name: string
  symbol: string
  chainId: string
  poolType: string
  protocolVersion: number
  tvlUsd: number
  volume24hUsd: number
  fees24hUsd: number
  aprPct: number
  tokens: BalancerPoolToken[]
}

function num(v: unknown): number {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

function parseToken(raw: unknown): BalancerPoolToken | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const address = typeof row.address === 'string' ? row.address : ''
  if (!address) return null
  return {
    symbol: typeof row.symbol === 'string' && row.symbol ? row.symbol : '?',
    address,
    decimals: Number.isInteger(row.decimals) ? (row.decimals as number) : 18,
  }
}

function parsePool(raw: unknown): BalancerPool | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const address = typeof row.address === 'string' ? row.address : ''
  const chainId = typeof row.chain === 'string' ? row.chain : ''
  if (!address || !chainId) return null
  const dynamicData = row.dynamicData as Record<string, unknown> | undefined
  const aprItemsRaw = Array.isArray(dynamicData?.aprItems) ? dynamicData!.aprItems : []
  // apr items are fractions (0.05 = 5%); sum them and scale to percent, the
  // same combined figure app.balancer.fi's pool APR badge shows.
  const aprFraction = aprItemsRaw.reduce((sum: number, item) => {
    if (!item || typeof item !== 'object') return sum
    return sum + num((item as Record<string, unknown>).apr)
  }, 0)
  const tokensRaw = Array.isArray(row.poolTokens) ? row.poolTokens : []
  return {
    id: typeof row.id === 'string' ? row.id : address,
    address,
    name: typeof row.name === 'string' && row.name ? row.name : address.slice(0, 10),
    symbol: typeof row.symbol === 'string' ? row.symbol : '',
    chainId,
    poolType: typeof row.type === 'string' ? row.type : '',
    protocolVersion: Number.isInteger(row.protocolVersion) ? (row.protocolVersion as number) : 3,
    tvlUsd: num(dynamicData?.totalLiquidity),
    volume24hUsd: num(dynamicData?.volume24h),
    fees24hUsd: num(dynamicData?.fees24h),
    aprPct: aprFraction * 100,
    tokens: tokensRaw.map(parseToken).filter((t): t is BalancerPoolToken => t !== null),
  }
}

const POOLS_QUERY = `
query Pools($where: GqlPoolFilter, $first: Int, $skip: Int, $orderBy: GqlPoolOrderBy, $orderDirection: GqlPoolOrderDirection) {
  poolGetPools(where: $where, first: $first, skip: $skip, orderBy: $orderBy, orderDirection: $orderDirection) {
    id
    address
    name
    symbol
    chain
    type
    protocolVersion
    poolTokens { symbol address decimals }
    dynamicData { totalLiquidity volume24h fees24h aprItems { apr type } }
  }
}`

export interface FetchBalancerPoolsOptions {
  chainId: string
  first?: number
  skip?: number
  orderBy?: BalancerSortBy
  orderDirection?: 'asc' | 'desc'
  minTvl?: number
  textSearch?: string
}

export async function fetchBalancerPools(options: FetchBalancerPoolsOptions): Promise<BalancerPool[]> {
  const { chainId, first = 50, skip = 0, orderBy = 'totalLiquidity', orderDirection = 'desc', minTvl, textSearch } = options
  const data = await graphql<{ poolGetPools: unknown[] }>(POOLS_QUERY, {
    where: {
      chainIn: [chainId],
      minTvl: minTvl || undefined,
      textSearch: textSearch || undefined,
    },
    first,
    skip,
    orderBy,
    orderDirection,
  })
  const pools = Array.isArray(data.poolGetPools) ? data.poolGetPools : []
  return pools.map(parsePool).filter((p): p is BalancerPool => p !== null)
}

export function balancerPoolUrl(chainSlug: string, pool: Pick<BalancerPool, 'id' | 'protocolVersion'>): string {
  return `https://balancer.fi/pools/${chainSlug}/v${pool.protocolVersion}/${pool.id}`
}
