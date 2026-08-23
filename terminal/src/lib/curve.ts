// Typed client + pure parsers for Curve Finance's public "Prices" API.
// Public, CORS-enabled, no API key — called directly from the browser, same
// as `dexscreener.ts`. Modeled on the vendored Python fork at
// `flet-curve/src/curve/api.py` (see `MAX_PAGE_SIZE`, `DEFAULT_MIN_TVL`,
// `BASE_APR_SCALE` notes there for where these constants come from).

const PRICES_V2 = 'https://prices.curve.finance/v2'
const PRICES_V1 = 'https://prices.curve.finance/v1'

// The v2 hard cap on `pagination`; anything larger is a 422.
export const MAX_PAGE_SIZE = 50

// Below this the list is mostly dust: thousands of abandoned factory pools
// with no liquidity. Matches flet-curve's `DEFAULT_MIN_TVL`.
export const DEFAULT_MIN_TVL = 10_000

// The v2 `sort_by` values the API accepts, confirmed from
// `flet-curve/src/curve/sort.py` (`SortOption.field`): "volume", "tvl",
// "aggregate_apr" (incentives), "base_daily_apr" (base APR).
export type CurveSortBy = 'tvl' | 'volume' | 'base_daily_apr'
export type CurveSortDirection = 'asc' | 'desc'

export interface CurveChain {
  name: string
  chainId: number
}

export interface CurveChainTvl {
  name: string
  poolTvl: number
}

export interface CurveCoin {
  symbol: string
  address: string
  usdPrice: number
  decimals: number
}

export interface CurvePool {
  address: string
  name: string
  chainId: number
  tvlUsd: number
  volume24h: number
  // Already in PERCENT units on the v2 payload — do not divide/multiply.
  baseApr: number
  coins: CurveCoin[]
  registry: string
  poolUrl: string
}

export interface CurvePoolsPage {
  pools: CurvePool[]
  count: number
}

class CurveApiError extends Error {}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url)
  if (!res.ok) throw new CurveApiError(`Curve API ${res.status}`)
  return res.json()
}

function buildUrl(base: string, path: string, params?: Record<string, string | number | undefined>): string {
  const url = new URL(base + path)
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === '') continue
      url.searchParams.set(key, String(value))
    }
  }
  return url.toString()
}

// A payload with `detail` but no `data`/`pools` key is the API rejecting the
// request (bad params, e.g. pagination > 50) rather than returning an empty
// result — flet-curve's `CurveApi._v2` treats this the same way.
function isRejection(payload: unknown): payload is { detail: unknown } {
  if (!payload || typeof payload !== 'object') return false
  const obj = payload as Record<string, unknown>
  return 'detail' in obj && !('data' in obj) && !('pools' in obj)
}

// ---- pure parsers (unit-testable, defensive against missing/null fields) ----

export function parseCurveChains(payload: unknown): CurveChain[] {
  if (isRejection(payload)) return []
  if (!payload || typeof payload !== 'object') return []
  const data = (payload as { data?: unknown }).data
  if (!Array.isArray(data)) return []
  const out: CurveChain[] = []
  for (const entry of data) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>
    const name = row.name
    const chainId = row.chain_id
    if (typeof name !== 'string' || !name) continue
    if (chainId === null || chainId === undefined) continue
    const id = Number(chainId)
    if (!Number.isFinite(id)) continue
    out.push({ name, chainId: id })
  }
  return out
}

export function parseChainTvls(payload: unknown): CurveChainTvl[] {
  if (isRejection(payload)) return []
  if (!payload || typeof payload !== 'object') return []
  const data = (payload as { data?: unknown }).data
  if (!Array.isArray(data)) return []
  const out: CurveChainTvl[] = []
  for (const entry of data) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>
    const name = row.name
    if (typeof name !== 'string' || !name) continue
    const tvl = Number(row.pool_tvl ?? 0)
    out.push({ name, poolTvl: Number.isFinite(tvl) ? tvl : 0 })
  }
  return out
}

function poolUrlFor(chainName: string, address: string): string {
  if (!chainName || !address) return ''
  return `https://curve.finance/dex/#/${chainName}/pools/${address}/deposit`
}

function parseCoin(raw: unknown): CurveCoin | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const symbol = typeof row.symbol === 'string' && row.symbol ? row.symbol : '?'
  const address = typeof row.address === 'string' ? row.address : ''
  const price = Number(row.usd_price ?? 0)
  // Same default as flet-curve's `Coin.from_v2` when the payload omits it.
  const decimals = Number(row.decimals ?? 18)
  return {
    symbol,
    address,
    usdPrice: Number.isFinite(price) ? price : 0,
    decimals: Number.isInteger(decimals) && decimals >= 0 ? decimals : 18,
  }
}

export function parseCurvePool(raw: unknown, chainId: number, chainName = ''): CurvePool | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const address = typeof row.address === 'string' ? row.address : ''
  if (!address) return null
  const name = typeof row.name === 'string' && row.name ? row.name : address.slice(0, 10)
  const tvl = Number(row.tvl_usd ?? 0)
  const volume = Number(row.trading_volume_24h ?? 0)
  // v2 `base_weekly_apr` is already in PERCENT units — no scaling here.
  const baseApr = Number(row.base_weekly_apr ?? 0)
  const coinsRaw = Array.isArray(row.coins) ? row.coins : []
  const coins = coinsRaw.map(parseCoin).filter((c): c is CurveCoin => c !== null)
  const registry = typeof row.pool_type === 'string' && row.pool_type
    ? row.pool_type
    : typeof row.registry_type === 'string' && row.registry_type
      ? row.registry_type
      : ''

  return {
    address,
    name,
    chainId,
    tvlUsd: Number.isFinite(tvl) ? tvl : 0,
    volume24h: Number.isFinite(volume) ? volume : 0,
    baseApr: Number.isFinite(baseApr) ? baseApr : 0,
    coins,
    registry,
    poolUrl: poolUrlFor(chainName, address),
  }
}

export function parseCurvePools(payload: unknown, chainId: number, chainName = ''): CurvePoolsPage {
  if (isRejection(payload)) return { pools: [], count: 0 }
  if (!payload || typeof payload !== 'object') return { pools: [], count: 0 }
  const obj = payload as Record<string, unknown>
  const poolsRaw = Array.isArray(obj.pools) ? obj.pools : []
  const pools = poolsRaw
    .map((p) => parseCurvePool(p, chainId, chainName))
    .filter((p): p is CurvePool => p !== null)
  const count = Number(obj.count ?? pools.length)
  return { pools, count: Number.isFinite(count) ? count : pools.length }
}

// ---- fetchers ----

export async function fetchCurveChains(): Promise<CurveChain[]> {
  const payload = await getJson(buildUrl(PRICES_V2, '/pools/chains/'))
  return parseCurveChains(payload)
}

export async function fetchChainTvls(): Promise<CurveChainTvl[]> {
  const payload = await getJson(buildUrl(PRICES_V1, '/chains/'))
  return parseChainTvls(payload)
}

export interface FetchCurvePoolsOptions {
  chainId: number
  chainName?: string
  page?: number
  pageSize?: number
  sortBy?: CurveSortBy
  sortDirection?: CurveSortDirection
  minTvl?: number
  searchString?: string
}

export async function fetchCurvePools(options: FetchCurvePoolsOptions): Promise<CurvePoolsPage> {
  const {
    chainId,
    chainName = '',
    page = 1,
    pageSize = MAX_PAGE_SIZE,
    sortBy = 'volume',
    sortDirection = 'desc',
    minTvl = DEFAULT_MIN_TVL,
    searchString = '',
  } = options

  // `pagination` max is 50 — a larger value gets a 422, so clamp rather than
  // pass it through.
  const pagination = Math.min(pageSize, MAX_PAGE_SIZE)

  const payload = await getJson(
    buildUrl(PRICES_V2, '/pools/', {
      chain_id: chainId,
      page: Math.max(1, page),
      pagination,
      sort_by: sortBy,
      sort_direction: sortDirection,
      min_tvl: minTvl || undefined,
      search_string: searchString || undefined,
    }),
  )
  return parseCurvePools(payload, chainId, chainName)
}
