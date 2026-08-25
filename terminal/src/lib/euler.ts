// Typed client + pure parsers for Euler's own public Data API V3
// (`v3.euler.finance/v3`) — first-party, no API key, CORS-open, documented
// at docs.euler.finance ("Euler Data API V3"). Confirmed live:
// `GET /v3/evk/vaults?chainId=&limit=&offset=` returns EVK lending vaults
// with a `{data, meta}` envelope; `meta.total` drives pagination since the
// API caps `limit` at 100 per page. The documented `sort=-totalSupplyUsd`
// param doesn't actually order results (verified against a live response),
// so vaults are paged in full per chain and sorted client-side instead.

const API_BASE = 'https://v3.euler.finance/v3'
const PAGE_SIZE = 100

class EulerApiError extends Error {}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url)
  if (!res.ok) throw new EulerApiError(`Euler API ${res.status}`)
  return res.json()
}

// Chains Euler lists that overlap with the terminal's swap desk (Polygon
// currently has zero Euler vaults, so it's excluded here even though the
// swap desk supports it).
export const EULER_CHAINS: { id: number; label: string }[] = [
  { id: 1, label: 'Ethereum' },
  { id: 8453, label: 'Base' },
  { id: 42161, label: 'Arbitrum' },
  { id: 56, label: 'BSC' },
  { id: 43114, label: 'Avalanche' },
]

export interface EulerVault {
  address: string
  name: string
  symbol: string
  chainId: number
  assetSymbol: string
  assetAddress: string
  assetDecimals: number
  tvlUsd: number
  supplyApyPct: number
  borrowApyPct: number
  utilizationPct: number
}

function num(v: unknown): number {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

function parseVault(raw: unknown): EulerVault | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const address = typeof row.address === 'string' ? row.address : ''
  const chainId = Number(row.chainId)
  if (!address || !Number.isFinite(chainId)) return null
  const asset = row.asset as Record<string, unknown> | undefined
  return {
    address,
    name: typeof row.name === 'string' && row.name ? row.name : address.slice(0, 10),
    symbol: typeof row.symbol === 'string' ? row.symbol : '',
    chainId,
    assetSymbol: typeof asset?.symbol === 'string' && asset.symbol ? asset.symbol : '?',
    assetAddress: typeof asset?.address === 'string' ? asset.address : '',
    assetDecimals: Number.isInteger(asset?.decimals) ? (asset!.decimals as number) : 18,
    tvlUsd: num(row.totalSupplyUsd),
    supplyApyPct: num(row.supplyApy) * 100,
    borrowApyPct: num(row.borrowApy) * 100,
    utilizationPct: num(row.utilization) * 100,
  }
}

export function parseEulerVaultsPage(payload: unknown): { vaults: EulerVault[]; total: number } {
  if (!payload || typeof payload !== 'object') return { vaults: [], total: 0 }
  const obj = payload as Record<string, unknown>
  const dataRaw = Array.isArray(obj.data) ? obj.data : []
  const vaults = dataRaw.map(parseVault).filter((v): v is EulerVault => v !== null)
  const meta = obj.meta as Record<string, unknown> | undefined
  const total = num(meta?.total)
  return { vaults, total }
}

// Fetches every vault for the chain (Euler caps `limit` at 100/page; a chain
// tops out around 130 vaults today, so this is at most two round trips) and
// ranks by TVL client-side, since the API's documented sort param doesn't
// actually order the response.
export async function fetchEulerVaults(chainId: number): Promise<EulerVault[]> {
  const first = parseEulerVaultsPage(
    await getJson(`${API_BASE}/evk/vaults?chainId=${chainId}&limit=${PAGE_SIZE}&offset=0`),
  )
  let vaults = first.vaults
  for (let offset = PAGE_SIZE; offset < first.total; offset += PAGE_SIZE) {
    const page = parseEulerVaultsPage(
      await getJson(`${API_BASE}/evk/vaults?chainId=${chainId}&limit=${PAGE_SIZE}&offset=${offset}`),
    )
    vaults = vaults.concat(page.vaults)
  }
  return vaults.sort((a, b) => b.tvlUsd - a.tvlUsd)
}

export function eulerVaultUrl(chainId: number, address: string): string {
  return `https://app.euler.finance/vault/${address}?chainId=${chainId}`
}
