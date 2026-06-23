import type { PulseToken } from '../types/api'

// Public DexScreener feed (no API key, CORS-enabled) for live token discovery.
// This is a third-party PUBLIC data source so it's called directly from the
// client rather than through our backend `api` client. It powers the Pulse
// feed's market data (mcap / volume / liquidity / age / price changes).
//
// What it does NOT provide: holder count, dev/sniper/top-holder concentration,
// or bundle detection — those need a Solana intelligence provider (Birdeye /
// Helius). Those PulseToken fields are left at 0, and applyPulseFilters() is
// written to not constrain on a signal a token doesn't carry.

const DEX_SEARCH_URL = 'https://api.dexscreener.com/latest/dex/search'

interface DexPair {
  chainId: string
  pairAddress: string
  baseToken: { address: string; name?: string; symbol: string }
  priceUsd?: string
  marketCap?: number
  fdv?: number
  pairCreatedAt?: number
  volume?: { h24?: number }
  liquidity?: { usd?: number }
  priceChange?: { m5?: number; h1?: number; h6?: number; h24?: number }
  txns?: { h24?: { buys?: number; sells?: number } }
}

function mapPair(pair: DexPair, chain: string, stage: PulseToken['stage']): PulseToken {
  const pc = pair.priceChange ?? {}
  const tx = pair.txns?.h24 ?? {}
  const buys = tx.buys ?? 0
  const sells = tx.sells ?? 0
  return {
    address: pair.baseToken.address,
    symbol: pair.baseToken.symbol,
    name: pair.baseToken.name || pair.baseToken.symbol,
    chain,
    stage,
    createdAt: pair.pairCreatedAt ? new Date(pair.pairCreatedAt).toISOString() : '',
    marketCap: pair.marketCap ?? pair.fdv ?? 0,
    volume24h: pair.volume?.h24 ?? 0,
    // On-chain intelligence not supplied by DexScreener — left at 0.
    holders: 0,
    topHolderPercent: 0,
    devPercent: 0,
    sniperPercent: 0,
    liquidityUsd: pair.liquidity?.usd ?? 0,
    priceUsd: parseFloat(pair.priceUsd ?? '0') || 0,
    txns24h: buys + sells,
    buys24h: buys,
    sells24h: sells,
    priceChange5m: pc.m5 ?? 0,
    priceChange1h: pc.h1 ?? 0,
    priceChange6h: pc.h6 ?? 0,
    priceChange24h: pc.h24 ?? 0,
  }
}

// Keep the highest-liquidity pair per token so a token isn't listed many times.
function dedupeByToken(pairs: DexPair[]): DexPair[] {
  const best = new Map<string, DexPair>()
  for (const p of pairs) {
    const key = p.baseToken?.address
    if (!key) continue
    const prev = best.get(key)
    if (!prev || (p.liquidity?.usd ?? 0) > (prev.liquidity?.usd ?? 0)) best.set(key, p)
  }
  return [...best.values()]
}

export interface PulseFeed {
  new: PulseToken[]
  migrated: PulseToken[]
}

// Fetch live pairs for a chain and shape them into the two stages we can source
// from DexScreener: `new` (most recently created) and `migrated` (highest 24h
// volume — established/graduated tokens). `final_stretch` (pump.fun bonding
// in-progress) needs a bonding-curve feed and is intentionally absent.
export async function fetchPulseFeed(chain: string, limit = 30): Promise<PulseFeed> {
  const res = await fetch(`${DEX_SEARCH_URL}?q=${encodeURIComponent(chain)}`)
  if (!res.ok) throw new Error(`DexScreener ${res.status}`)
  const data = await res.json()
  const pairs: DexPair[] = dedupeByToken(
    (data.pairs ?? []).filter((p: DexPair) => String(p.chainId).toLowerCase() === chain),
  )

  const byNewest = [...pairs].sort((a, b) => (b.pairCreatedAt ?? 0) - (a.pairCreatedAt ?? 0))
  const byVolume = [...pairs].sort((a, b) => (b.volume?.h24 ?? 0) - (a.volume?.h24 ?? 0))

  return {
    new: byNewest.slice(0, limit).map((p) => mapPair(p, chain, 'new')),
    migrated: byVolume.slice(0, limit).map((p) => mapPair(p, chain, 'migrated')),
  }
}
