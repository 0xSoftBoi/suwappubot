// Typed client + pure parsers for Morpho's own public GraphQL API
// (`blue-api.morpho.org/graphql`) — first-party, no API key, CORS-open
// (`access-control-allow-origin: *`), the same one app.morpho.org's UI
// queries. Confirmed via introspection: `vaults(where, first, orderBy,
// orderDirection)` returns MetaMorpho curated vaults, paginated under
// `items` (unlike Aave/Balancer's bare-array shape).

const GRAPHQL_URL = 'https://blue-api.morpho.org/graphql'

class MorphoApiError extends Error {}

async function graphql<T = unknown>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  if (!res.ok) throw new MorphoApiError(`Morpho API ${res.status}`)
  const payload = (await res.json()) as { data?: T; errors?: { message: string }[] }
  if (payload.errors?.length) throw new MorphoApiError(payload.errors[0].message)
  if (!payload.data) throw new MorphoApiError('Morpho API returned no data')
  return payload.data
}

// Chains Morpho lists that overlap with the terminal's swap desk.
export const MORPHO_CHAINS: { id: number; slug: string; label: string }[] = [
  { id: 1, slug: 'ethereum', label: 'Ethereum' },
  { id: 8453, slug: 'base', label: 'Base' },
  { id: 42161, slug: 'arbitrum', label: 'Arbitrum' },
  { id: 10, slug: 'optimism', label: 'Optimism' },
  { id: 137, slug: 'polygon', label: 'Polygon' },
]

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

export interface MorphoVault {
  address: string
  name: string
  symbol: string
  chainId: number
  assetSymbol: string
  assetAddress: string
  assetDecimals: number
  tvlUsd: number
  // Fee-adjusted realized yield — what a depositor actually earns net of the
  // vault's performance fee. `apy` (gross, pre-fee) is not surfaced here
  // since some low-liquidity vaults report triple-digit gross APYs that are
  // a reward-emission or pricing artifact, not a real return.
  netApyPct: number
  feePct: number
  curator: string | null
}

function num(v: unknown): number {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

function parseVault(raw: unknown): MorphoVault | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const address = typeof row.address === 'string' ? row.address : ''
  const chain = row.chain as Record<string, unknown> | undefined
  const chainId = Number(chain?.id)
  if (!address || !Number.isFinite(chainId)) return null
  const asset = row.asset as Record<string, unknown> | undefined
  const state = row.state as Record<string, unknown> | undefined
  const curator = typeof state?.curator === 'string' ? state.curator : null
  return {
    address,
    name: typeof row.name === 'string' && row.name ? row.name : address.slice(0, 10),
    symbol: typeof row.symbol === 'string' ? row.symbol : '',
    chainId,
    assetSymbol: typeof asset?.symbol === 'string' && asset.symbol ? asset.symbol : '?',
    assetAddress: typeof asset?.address === 'string' ? asset.address : '',
    assetDecimals: Number.isInteger(asset?.decimals) ? (asset!.decimals as number) : 18,
    tvlUsd: num(state?.totalAssetsUsd),
    netApyPct: num(state?.netApy) * 100,
    feePct: num(state?.fee) * 100,
    curator: curator && curator !== ZERO_ADDRESS ? curator : null,
  }
}

export function parseMorphoVaults(payload: unknown): MorphoVault[] {
  if (!payload || typeof payload !== 'object') return []
  const items = (payload as { items?: unknown }).items
  if (!Array.isArray(items)) return []
  return items.map(parseVault).filter((v): v is MorphoVault => v !== null)
}

const VAULTS_QUERY = `
query Vaults($where: VaultFilters, $first: Int, $orderBy: VaultOrderBy, $orderDirection: OrderDirection) {
  vaults(where: $where, first: $first, orderBy: $orderBy, orderDirection: $orderDirection) {
    items {
      address
      name
      symbol
      chain { id }
      asset { address symbol decimals }
      state { totalAssetsUsd netApy fee curator }
    }
  }
}`

export interface FetchMorphoVaultsOptions {
  chainId: number
  first?: number
  orderBy?: 'TotalAssetsUsd' | 'NetApy'
  search?: string
}

export async function fetchMorphoVaults(options: FetchMorphoVaultsOptions): Promise<MorphoVault[]> {
  const { chainId, first = 50, orderBy = 'TotalAssetsUsd', search } = options
  const data = await graphql<{ vaults: unknown }>(VAULTS_QUERY, {
    where: { chainId_in: [chainId], listed: true, search: search || undefined },
    first,
    orderBy,
    orderDirection: 'Desc',
  })
  return parseMorphoVaults(data.vaults)
}

export function morphoVaultUrl(chainId: number, address: string): string {
  return `https://app.morpho.org/vault?vault=${address}&network=${chainId}`
}
