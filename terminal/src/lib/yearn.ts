// Typed client + pure parsers for Yearn's own public yDaemon API
// (`ydaemon.yearn.fi`) — first-party, no API key, CORS-open, the same one
// yearn.fi's own UI queries. The default `/vaults` call caps at 200 results
// (silently, no pagination metadata) — `?limit=1000` returns the real full
// set (906 vaults today), confirmed by chain-count distribution changing
// between the two calls.

const VAULTS_URL = 'https://ydaemon.yearn.fi/vaults?limit=1000'

class YearnApiError extends Error {}

// Chains Yearn has active vaults on that overlap with the terminal's swap
// desk (Katana is excluded — Yearn lists vaults there but it's not one of
// the swap desk's chains).
export const YEARN_CHAINS: { id: number; label: string }[] = [
  { id: 1, label: 'Ethereum' },
  { id: 10, label: 'Optimism' },
  { id: 8453, label: 'Base' },
  { id: 137, label: 'Polygon' },
  { id: 42161, label: 'Arbitrum' },
]

export interface YearnVault {
  address: string
  name: string
  symbol: string
  chainId: number
  assetSymbol: string
  assetAddress: string
  assetDecimals: number
  tvlUsd: number
  netApyPct: number | null
}

function num(v: unknown): number {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

function parseVault(raw: unknown): YearnVault | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const address = typeof row.address === 'string' ? row.address : ''
  const chainId = Number(row.chainID)
  if (!address || !Number.isFinite(chainId)) return null
  const info = row.info as Record<string, unknown> | undefined
  if (info?.isHidden === true || info?.isRetired === true) return null
  const token = row.token as Record<string, unknown> | undefined
  const tvl = row.tvl as Record<string, unknown> | undefined
  const apr = row.apr as Record<string, unknown> | undefined
  const netApr = apr?.netAPR
  return {
    address,
    name: typeof row.name === 'string' && row.name ? row.name : address.slice(0, 10),
    symbol: typeof row.symbol === 'string' ? row.symbol : '',
    chainId,
    assetSymbol: typeof token?.symbol === 'string' && token.symbol ? token.symbol : '?',
    assetAddress: typeof token?.address === 'string' ? token.address : '',
    assetDecimals: Number.isInteger(token?.decimals) ? (token!.decimals as number) : 18,
    tvlUsd: num(tvl?.tvl),
    netApyPct: typeof netApr === 'number' && Number.isFinite(netApr) ? netApr * 100 : null,
  }
}

export function parseYearnVaults(payload: unknown): YearnVault[] {
  if (!Array.isArray(payload)) return []
  return payload.map(parseVault).filter((v): v is YearnVault => v !== null)
}

export async function fetchYearnVaults(): Promise<YearnVault[]> {
  const res = await fetch(VAULTS_URL)
  if (!res.ok) throw new YearnApiError(`Yearn API ${res.status}`)
  return parseYearnVaults(await res.json())
}

export function yearnVaultUrl(chainId: number, address: string): string {
  return `https://yearn.fi/vaults/${chainId}/${address}`
}
