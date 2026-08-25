// Typed client + pure parsers for Compound's own public v3 markets API
// (`v3-api.compound.finance`) — first-party, no API key, the same one
// app.compound.finance's own UI queries. (Compound's older v2 API at
// api.compound.finance was shut down in 2023; v3/Comet moved to this host.)
//
// The summary payload doesn't carry the market's base-asset symbol/decimals
// (only USD price and collateral symbols) — the panel resolves that by
// reading the Comet contract's own `baseToken()` on-chain via viem, the same
// "ask the contract" pattern `erouter/quoter.ts` already uses for Curve.

const SUMMARY_URL = 'https://v3-api.compound.finance/market/all-networks/all-contracts/summary'

class CompoundApiError extends Error {}

export const COMPOUND_CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum',
  10: 'Optimism',
  137: 'Polygon',
  8453: 'Base',
  42161: 'Arbitrum',
  59144: 'Linea',
  534352: 'Scroll',
  5000: 'Mantle',
  130: 'Unichain',
  2020: 'Ronin',
}

export interface CompoundMarket {
  chainId: number
  chainName: string
  cometAddress: string
  supplyAprPct: number
  borrowAprPct: number
  totalSupplyUsd: number
  totalBorrowUsd: number
  totalCollateralUsd: number
  utilizationPct: number
  baseUsdPrice: number
  collateralSymbols: string[]
}

function num(v: unknown): number {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

function parseMarket(raw: unknown): CompoundMarket | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const chainId = Number(row.chain_id)
  const comet = row.comet as Record<string, unknown> | undefined
  const cometAddress = typeof comet?.address === 'string' ? comet.address : ''
  if (!Number.isFinite(chainId) || !cometAddress) return null
  const collateralRaw = Array.isArray(row.collateral_asset_symbols) ? row.collateral_asset_symbols : []
  return {
    chainId,
    chainName: COMPOUND_CHAIN_NAMES[chainId] ?? `Chain ${chainId}`,
    cometAddress,
    // APRs arrive as plain decimal fractions (e.g. "0.0713" = 7.13%), but
    // `utilization` is passed through as Comet's raw on-chain fixed-point
    // value (`getUtilization()`, scaled 1e18) — confirmed against a live
    // payload: "908621046555114617" / 1e18 = 0.9086 (90.86%), not 9.09e19%.
    supplyAprPct: num(row.supply_apr) * 100,
    borrowAprPct: num(row.borrow_apr) * 100,
    totalSupplyUsd: num(row.total_supply_value),
    totalBorrowUsd: num(row.total_borrow_value),
    totalCollateralUsd: num(row.total_collateral_value),
    utilizationPct: (num(row.utilization) / 1e18) * 100,
    baseUsdPrice: num(row.base_usd_price),
    collateralSymbols: collateralRaw.filter((s): s is string => typeof s === 'string'),
  }
}

export function parseCompoundMarkets(payload: unknown): CompoundMarket[] {
  if (!Array.isArray(payload)) return []
  return payload.map(parseMarket).filter((m): m is CompoundMarket => m !== null)
}

export async function fetchCompoundMarkets(): Promise<CompoundMarket[]> {
  const res = await fetch(SUMMARY_URL)
  if (!res.ok) throw new CompoundApiError(`Compound API ${res.status}`)
  return parseCompoundMarkets(await res.json())
}

export function compoundAppUrl(): string {
  return 'https://app.compound.finance/markets'
}
