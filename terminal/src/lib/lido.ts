// Typed client + pure parsers for Lido's own public API (`eth-api.lido.fi`) —
// the same first-party, no-key, CORS-enabled API that powers stake.lido.fi
// itself. See https://docs.lido.fi/integrations/api/. Lido is a single
// product (stETH liquid staking on Ethereum mainnet), so this venue is a
// stats overview rather than a pools table.

const ETH_API = 'https://eth-api.lido.fi/v1'

export const STETH_ADDRESS = '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84'
export const STETH_DECIMALS = 18
export const STETH_CHAIN_ID = 1

class LidoApiError extends Error {}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url)
  if (!res.ok) throw new LidoApiError(`Lido API ${res.status}`)
  return res.json()
}

export interface LidoStats {
  totalStakedEth: number
  marketCapUsd: number
  uniqueHolders: number
}

export function parseLidoStats(payload: unknown): LidoStats | null {
  if (!payload || typeof payload !== 'object') return null
  const row = payload as Record<string, unknown>
  const totalStaked = Number(row.totalStaked ?? 0)
  const marketCap = Number(row.marketCap ?? 0)
  const holders = Number(row.uniqueHolders ?? 0)
  if (!Number.isFinite(totalStaked) && !Number.isFinite(marketCap)) return null
  return {
    totalStakedEth: Number.isFinite(totalStaked) ? totalStaked : 0,
    marketCapUsd: Number.isFinite(marketCap) ? marketCap : 0,
    uniqueHolders: Number.isFinite(holders) ? holders : 0,
  }
}

export async function fetchLidoStats(): Promise<LidoStats | null> {
  const payload = await getJson(`${ETH_API}/protocol/steth/stats`)
  return parseLidoStats(payload)
}

export interface LidoAprPoint {
  timeUnix: number
  apr: number
}

export interface LidoApr {
  points: LidoAprPoint[]
  smaApr: number
}

function parseAprPoint(raw: unknown): LidoAprPoint | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const time = Number(row.timeUnix ?? 0)
  const apr = Number(row.apr ?? 0)
  if (!Number.isFinite(time) || time <= 0 || !Number.isFinite(apr)) return null
  return { timeUnix: time, apr }
}

// 7-day SMA APR series — the same figure stake.lido.fi's own APR banner
// shows, straight from Lido's API rather than a derived estimate.
export function parseLidoApr(payload: unknown): LidoApr {
  if (!payload || typeof payload !== 'object') return { points: [], smaApr: 0 }
  const data = (payload as { data?: unknown }).data
  if (!data || typeof data !== 'object') return { points: [], smaApr: 0 }
  const row = data as Record<string, unknown>
  const aprsRaw = Array.isArray(row.aprs) ? row.aprs : []
  const points = aprsRaw.map(parseAprPoint).filter((p): p is LidoAprPoint => p !== null)
  const smaApr = Number(row.smaApr ?? 0)
  return { points, smaApr: Number.isFinite(smaApr) ? smaApr : 0 }
}

export async function fetchLidoApr(): Promise<LidoApr> {
  const payload = await getJson(`${ETH_API}/protocol/steth/apr/sma`)
  return parseLidoApr(payload)
}

export function lidoStakeUrl(): string {
  return 'https://stake.lido.fi/'
}
