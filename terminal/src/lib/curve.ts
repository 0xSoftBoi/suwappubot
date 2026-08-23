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

// ---- candles (v1 — v2 has no OHLC endpoints at all) ----

// One entry of the candle-size picker and its API aggregation, mirroring
// flet-curve's CANDLE_SIZES (a subset: the picker sizes the video UI leads
// with). `seconds * count` is how far back to ask.
export interface CurveCandleSize {
  label: string
  aggNumber: number
  aggUnits: 'minute' | 'hour' | 'day' | 'week'
  seconds: number
}

export const CURVE_CANDLE_SIZES: CurveCandleSize[] = [
  { label: '15m', aggNumber: 15, aggUnits: 'minute', seconds: 900 },
  { label: '1h', aggNumber: 1, aggUnits: 'hour', seconds: 3600 },
  { label: '4h', aggNumber: 4, aggUnits: 'hour', seconds: 14400 },
  { label: '1d', aggNumber: 1, aggUnits: 'day', seconds: 86400 },
  { label: '7d', aggNumber: 7, aggUnits: 'day', seconds: 604800 },
]

// How many candles to ask for, whatever their size (flet-curve CANDLE_COUNT).
export const CURVE_CANDLE_COUNT = 200

export interface CurveCandle {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export function parseCurveCandles(payload: unknown): CurveCandle[] {
  if (isRejection(payload)) return []
  if (!payload || typeof payload !== 'object') return []
  const data = (payload as { data?: unknown }).data
  if (!Array.isArray(data)) return []
  const out: CurveCandle[] = []
  for (const entry of data) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>
    const time = Number(row.time ?? 0)
    if (!Number.isFinite(time) || time <= 0) continue
    const open = Number(row.open ?? 0)
    const high = Number(row.high ?? 0)
    const low = Number(row.low ?? 0)
    const close = Number(row.close ?? 0)
    if (![open, high, low, close].every(Number.isFinite)) continue
    // The lp_ohlc payload carries no volume; lightweight-charts wants the
    // field present, so it is zero rather than absent.
    out.push({ time, open, high, low, close, volume: Number(row.volume ?? 0) || 0 })
  }
  out.sort((a, b) => a.time - b.time)
  return out
}

export interface FetchLpCandlesOptions {
  chain: string
  pool: string
  size: CurveCandleSize
  count?: number
  now?: number
}

// Candles for the pool's LP token price — the chart flet-curve opens every
// pool onto. `GET /v1/lp_ohlc/{chain}/{pool}?start&end&agg_number&agg_units`.
export async function fetchLpCandles(options: FetchLpCandlesOptions): Promise<CurveCandle[]> {
  const { chain, pool, size, count = CURVE_CANDLE_COUNT } = options
  const end = Math.floor(options.now ?? Date.now() / 1000)
  const payload = await getJson(
    buildUrl(PRICES_V1, `/lp_ohlc/${chain}/${pool}`, {
      start: end - size.seconds * count,
      end,
      agg_number: size.aggNumber,
      agg_units: size.aggUnits,
    }),
  )
  return parseCurveCandles(payload)
}

// ---- pool detail (v2 /pools/{chain_id}/{address}) ----

export interface CurvePoolDetail {
  name: string
  coins: CurveCoin[]
  // USD value each coin contributes, aligned with `coins` by index.
  balancesUsd: number[]
  tvlUsd: number
  volume24h: number
  tradingFee24h: number
  liquidityVolume24h: number
  lpTokenAddress: string
}

export function parseCurvePoolDetail(payload: unknown): CurvePoolDetail | null {
  if (isRejection(payload)) return null
  if (!payload || typeof payload !== 'object') return null
  const row = payload as Record<string, unknown>
  const coinsRaw = Array.isArray(row.coins) ? row.coins : []
  const coins = coinsRaw.map(parseCoin).filter((c): c is CurveCoin => c !== null)
  const balancesRaw = Array.isArray(row.balances_usd) ? row.balances_usd : []
  const balancesUsd = balancesRaw.map((v) => {
    const n = Number(v ?? 0)
    return Number.isFinite(n) ? n : 0
  })
  const num = (v: unknown) => {
    const n = Number(v ?? 0)
    return Number.isFinite(n) ? n : 0
  }
  return {
    name: typeof row.name === 'string' ? row.name : '',
    coins,
    balancesUsd,
    tvlUsd: num(row.tvl_usd),
    volume24h: num(row.trading_volume_24h),
    tradingFee24h: num(row.trading_fee_24h),
    liquidityVolume24h: num(row.liquidity_volume_24h),
    lpTokenAddress: typeof row.lp_token_address === 'string' ? row.lp_token_address : '',
  }
}

export async function fetchCurvePoolDetail(
  chainId: number,
  address: string,
): Promise<CurvePoolDetail | null> {
  const payload = await getJson(buildUrl(PRICES_V2, `/pools/${chainId}/${address}`))
  return parseCurvePoolDetail(payload)
}

// ---- trades (v1 /trades/{chain}/{pool}, one pair per request) ----

// Per-chain explorers, from flet-curve/src/curve/explorers.py (the chains our
// TRADABLE set covers, plus a multi-chain fallback for the rest).
const CURVE_EXPLORERS: Record<number, string> = {
  1: 'https://etherscan.io',
  10: 'https://optimistic.etherscan.io',
  56: 'https://bscscan.com',
  137: 'https://polygonscan.com',
  8453: 'https://basescan.org',
  42161: 'https://arbiscan.io',
}

export function explorerTxUrl(chainId: number, txHash: string): string {
  if (!txHash) return ''
  const base = CURVE_EXPLORERS[chainId]
  return base ? `${base}/tx/${txHash}` : `https://blockscan.com/tx/${txHash}`
}

export interface CurveTrade {
  time: number
  soldSymbol: string
  boughtSymbol: string
  soldAmount: number
  boughtAmount: number
  soldUsd: number
  txHash: string
  buyer: string
}

// One pair's swaps, both directions. `sold_id`/`bought_id` are pool_index
// values; the payload's main_token/reference_token blocks map them back to
// symbols. `time` is an ISO string in UTC without a zone suffix.
export function parseCurveTrades(payload: unknown): CurveTrade[] {
  if (isRejection(payload)) return []
  if (!payload || typeof payload !== 'object') return []
  const obj = payload as Record<string, unknown>
  const data = Array.isArray(obj.data) ? obj.data : []
  const symbolByIndex = new Map<number, string>()
  for (const side of [obj.main_token, obj.reference_token]) {
    if (side && typeof side === 'object') {
      const row = side as Record<string, unknown>
      const index = Number(row.pool_index)
      if (Number.isFinite(index) && typeof row.symbol === 'string') {
        symbolByIndex.set(index, row.symbol)
      }
    }
  }
  const out: CurveTrade[] = []
  for (const entry of data) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>
    const iso = typeof row.time === 'string' ? row.time : ''
    const time = iso ? Math.floor(Date.parse(iso.endsWith('Z') ? iso : `${iso}Z`) / 1000) : 0
    if (!Number.isFinite(time) || time <= 0) continue
    const num = (v: unknown) => {
      const n = Number(v ?? 0)
      return Number.isFinite(n) ? n : 0
    }
    out.push({
      time,
      soldSymbol: symbolByIndex.get(Number(row.sold_id)) ?? '?',
      boughtSymbol: symbolByIndex.get(Number(row.bought_id)) ?? '?',
      soldAmount: num(row.tokens_sold),
      boughtAmount: num(row.tokens_bought),
      soldUsd: num(row.tokens_sold_usd),
      txHash: typeof row.transaction_hash === 'string' ? row.transaction_hash : '',
      buyer: typeof row.buyer === 'string' ? row.buyer : '',
    })
  }
  return out
}

// The newest swaps through a pool across every pair it holds — flet-curve's
// `trades()` does the same merge; the API answers one pair per request, so a
// 3-coin pool is 3 requests. Pairs are capped so a many-coin pool cannot fan
// out unboundedly; failures on one pair drop that pair, not the feed.
export async function fetchPoolTrades(
  chain: string,
  pool: string,
  coins: CurveCoin[],
  perPage = 20,
): Promise<CurveTrade[]> {
  const pairs: [CurveCoin, CurveCoin][] = []
  for (let i = 0; i < coins.length && pairs.length < 6; i++) {
    for (let j = i + 1; j < coins.length && pairs.length < 6; j++) {
      if (coins[i].address && coins[j].address) pairs.push([coins[i], coins[j]])
    }
  }
  const pages = await Promise.all(
    pairs.map(async ([a, b]) => {
      try {
        const payload = await getJson(
          buildUrl(PRICES_V1, `/trades/${chain}/${pool}`, {
            main_token: a.address,
            reference_token: b.address,
            page: 1,
            per_page: perPage,
          }),
        )
        return parseCurveTrades(payload)
      } catch {
        return []
      }
    }),
  )
  return pages
    .flat()
    .sort((a, b) => b.time - a.time)
    .slice(0, perPage)
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
