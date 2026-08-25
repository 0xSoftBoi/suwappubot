// Typed client + pure parsers for Aave's own public GraphQL API
// (`api.v3.aave.com/graphql`) — first-party, no API key, CORS-enabled
// (`access-control-allow-origin: *`), the same API app.aave.com's own UI
// queries. Confirmed via introspection: `markets(request: MarketsRequest!)`
// returns one entry per market deployment (a chain can host more than one —
// e.g. Ethereum has a main market plus EtherFi/Lido/Horizon isolated
// markets), each carrying its `reserves` (one per listed asset).

const GRAPHQL_URL = 'https://api.v3.aave.com/graphql'

class AaveApiError extends Error {}

async function graphql<T = unknown>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  if (!res.ok) throw new AaveApiError(`Aave API ${res.status}`)
  const payload = (await res.json()) as { data?: T; errors?: { message: string }[] }
  if (payload.errors?.length) throw new AaveApiError(payload.errors[0].message)
  if (!payload.data) throw new AaveApiError('Aave API returned no data')
  return payload.data
}

export interface AaveChain {
  chainId: number
  name: string
  explorerUrl: string
}

function parseChain(raw: unknown): AaveChain | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const chainId = Number(row.chainId)
  const name = typeof row.name === 'string' ? row.name : ''
  if (!Number.isFinite(chainId) || !name) return null
  return { chainId, name, explorerUrl: typeof row.explorerUrl === 'string' ? row.explorerUrl : '' }
}

export async function fetchAaveChains(): Promise<AaveChain[]> {
  const data = await graphql<{ chains: unknown[] }>(
    'query { chains { chainId name explorerUrl isTestnet } }',
  )
  const chains = Array.isArray(data.chains) ? data.chains : []
  return chains
    .filter((c) => !(c && typeof c === 'object' && (c as Record<string, unknown>).isTestnet))
    .map(parseChain)
    .filter((c): c is AaveChain => c !== null)
}

export interface AaveReserve {
  symbol: string
  address: string
  decimals: number
  tvlUsd: number
  supplyApy: number
  borrowApy: number | null
  isFrozen: boolean
  isPaused: boolean
  availableLiquidityUsd: number
  utilizationRate: number
}

function num(v: unknown): number {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

function parseReserve(raw: unknown): AaveReserve | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const token = row.underlyingToken as Record<string, unknown> | undefined
  const address = typeof token?.address === 'string' ? token.address : ''
  if (!address) return null
  const symbol = typeof token?.symbol === 'string' && token.symbol ? token.symbol : '?'
  const decimals = Number.isInteger(token?.decimals) ? (token!.decimals as number) : 18
  const size = row.size as Record<string, unknown> | undefined
  const supplyInfo = row.supplyInfo as Record<string, unknown> | undefined
  const borrowInfo = row.borrowInfo as Record<string, unknown> | undefined | null
  const supplyApy = num((supplyInfo?.apy as Record<string, unknown> | undefined)?.formatted)
  const borrowApyRaw = borrowInfo ? (borrowInfo.apy as Record<string, unknown> | undefined)?.formatted : undefined
  const availableLiquidity = borrowInfo?.availableLiquidity as Record<string, unknown> | undefined
  const utilization = borrowInfo?.utilizationRate as Record<string, unknown> | undefined
  return {
    symbol,
    address,
    decimals,
    tvlUsd: num(size?.usd),
    supplyApy,
    borrowApy: borrowInfo ? num(borrowApyRaw) : null,
    isFrozen: row.isFrozen === true,
    isPaused: row.isPaused === true,
    availableLiquidityUsd: num(availableLiquidity?.usd),
    utilizationRate: num(utilization?.formatted),
  }
}

export interface AaveMarket {
  name: string
  chainId: number
  chainName: string
  address: string
  totalMarketSizeUsd: number
  totalAvailableLiquidityUsd: number
  reserves: AaveReserve[]
}

function parseMarket(raw: unknown): AaveMarket | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const name = typeof row.name === 'string' ? row.name : ''
  const chain = row.chain as Record<string, unknown> | undefined
  const chainId = Number(chain?.chainId)
  if (!name || !Number.isFinite(chainId)) return null
  const reservesRaw = Array.isArray(row.reserves) ? row.reserves : []
  return {
    name,
    chainId,
    chainName: typeof chain?.name === 'string' ? chain.name : '',
    address: typeof row.address === 'string' ? row.address : '',
    totalMarketSizeUsd: num(row.totalMarketSize),
    totalAvailableLiquidityUsd: num(row.totalAvailableLiquidity),
    reserves: reservesRaw.map(parseReserve).filter((r): r is AaveReserve => r !== null),
  }
}

const MARKETS_QUERY = `
query Markets($req: MarketsRequest!) {
  markets(request: $req) {
    name
    chain { chainId name }
    address
    totalMarketSize
    totalAvailableLiquidity
    reserves {
      underlyingToken { symbol decimals address }
      size { usd }
      isFrozen
      isPaused
      supplyInfo { apy { formatted } }
      borrowInfo {
        apy { formatted }
        availableLiquidity { usd }
        utilizationRate { formatted }
      }
    }
  }
}`

export async function fetchAaveMarkets(chainIds: number[]): Promise<AaveMarket[]> {
  const data = await graphql<{ markets: unknown[] }>(MARKETS_QUERY, { req: { chainIds } })
  const markets = Array.isArray(data.markets) ? data.markets : []
  return markets.map(parseMarket).filter((m): m is AaveMarket => m !== null)
}

// The GraphQL market `name` embeds the chain under a different token than
// `chain.name` for a couple of chains (BSC's chain name is "BSC" but its
// market is "AaveV3BNB") — a small alias table beats guessing.
const CHAIN_NAME_TOKEN: Record<string, string> = { BSC: 'BNB' }

// "AaveV3Ethereum" -> "Main", "AaveV3EthereumLido" -> "Lido" — the isolated
// sub-market's own name, since app.aave.com's picker uses the same suffix.
export function marketLabel(market: AaveMarket): string {
  const chainToken = CHAIN_NAME_TOKEN[market.chainName] ?? market.chainName.replace(/\s+/g, '')
  const prefix = `AaveV3${chainToken}`
  const suffix = market.name.startsWith(prefix) ? market.name.slice(prefix.length) : market.name
  return suffix || 'Main'
}

export function aaveAppUrl(): string {
  return 'https://app.aave.com/markets/'
}
