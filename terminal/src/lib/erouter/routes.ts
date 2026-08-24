// Candidate route construction over the Curve pool universe, for exact
// quoting through electric-router's deployed RouteQuoter (see ./quoter.ts).
//
// This is the enumerative half of routing: direct pools plus two-hop paths
// through a shared coin, every candidate priced EXACTLY in one eth_call via
// `quote_routes` (the contract chains the pools' own get_dy). The circuit
// solver (wasm, ./index.ts) will replace enumeration with calibrated flow
// splitting in a later phase; candidates + on-chain quotes stay the
// verification layer either way.

import type { Hex } from 'viem'
import type { CurvePool } from '../curve'
import { ArcKind, type Leg } from './quoter'

// Pool-type classification, ported from flet-curve's `models.py`
// (`Pool.is_stableswap`): crypto types use uint256 indices (SWAP_CRYPTO),
// everything else — including unknown — quotes as stable (int128), the same
// default the reference takes. A wrong guess fails safe: the contract answers
// WRONG_ABI and the candidate ranks out at 0.
const CRYPTO_POOL_TYPES = new Set([
  'crypto',
  'factory_crypto',
  'factory_tricrypto',
  'twocryptong',
  'factory-crypto',
  'factory-tricrypto',
  'factory-twocrypto',
])

export function arcKindForPool(registry: string): ArcKind {
  const key = (registry || '').toLowerCase().replace(/_/g, '-')
  // Normalize the same way `registry_key` does, but the v2 spellings above
  // include underscores, so test both spellings.
  return CRYPTO_POOL_TYPES.has(registry?.toLowerCase() ?? '') || CRYPTO_POOL_TYPES.has(key)
    ? ArcKind.SWAP_CRYPTO
    : ArcKind.SWAP_STABLE
}

export interface RouteCandidate {
  legs: Leg[]
  dstSlot: number
  // For display: pool names and the coin-symbol path.
  poolNames: string[]
  path: string[]
}

function coinIndex(pool: CurvePool, address: string): number {
  const wanted = address.toLowerCase()
  return pool.coins.findIndex((c) => c.address.toLowerCase() === wanted)
}

function directLeg(pool: CurvePool, i: number, j: number): Leg {
  return {
    target: pool.address as Hex,
    kind: arcKindForPool(pool.registry),
    i,
    j,
    n: pool.coins.length,
    srcSlot: 0,
    dstSlot: 1,
    bps: 0,
  }
}

// Build candidate routes from `sell` to `buy` over the given pools: every
// direct pool, then two-hop paths through a shared intermediate coin, ordered
// by the TVL of their weakest pool and capped at `maxCandidates` (the quoter
// batches 32 routes per call, so the default keeps it to one round trip).
export function buildCandidates(
  pools: CurvePool[],
  sell: string,
  buy: string,
  maxCandidates = 24,
): RouteCandidate[] {
  const sellAddr = sell.toLowerCase()
  const buyAddr = buy.toLowerCase()
  if (!sellAddr || !buyAddr || sellAddr === buyAddr) return []

  const out: { candidate: RouteCandidate; weight: number }[] = []

  // Direct: one pool holds both coins.
  for (const pool of pools) {
    const i = coinIndex(pool, sellAddr)
    const j = coinIndex(pool, buyAddr)
    if (i < 0 || j < 0 || i === j) continue
    out.push({
      weight: pool.tvlUsd,
      candidate: {
        legs: [directLeg(pool, i, j)],
        dstSlot: 1,
        poolNames: [pool.name],
        path: [pool.coins[i].symbol, pool.coins[j].symbol],
      },
    })
  }

  // Two-hop: pool A sells into X, pool B turns X into the buy coin.
  const byCoin = new Map<string, CurvePool[]>()
  for (const pool of pools) {
    for (const coin of pool.coins) {
      const key = coin.address.toLowerCase()
      if (!key) continue
      const list = byCoin.get(key)
      if (list) list.push(pool)
      else byCoin.set(key, [pool])
    }
  }

  for (const poolA of byCoin.get(sellAddr) ?? []) {
    const i = coinIndex(poolA, sellAddr)
    if (i < 0) continue
    for (const mid of poolA.coins) {
      const midAddr = mid.address.toLowerCase()
      if (!midAddr || midAddr === sellAddr || midAddr === buyAddr) continue
      const k = coinIndex(poolA, midAddr)
      if (k < 0 || k === i) continue
      for (const poolB of byCoin.get(midAddr) ?? []) {
        if (poolB.address === poolA.address) continue
        const k2 = coinIndex(poolB, midAddr)
        const j = coinIndex(poolB, buyAddr)
        if (k2 < 0 || j < 0 || k2 === j) continue
        out.push({
          weight: Math.min(poolA.tvlUsd, poolB.tvlUsd),
          candidate: {
            legs: [
              { ...directLeg(poolA, i, k), srcSlot: 0, dstSlot: 1 },
              {
                target: poolB.address as Hex,
                kind: arcKindForPool(poolB.registry),
                i: k2,
                j,
                n: poolB.coins.length,
                srcSlot: 1,
                dstSlot: 2,
                bps: 0,
              },
            ],
            dstSlot: 2,
            poolNames: [poolA.name, poolB.name],
            path: [poolA.coins[i].symbol, mid.symbol, poolB.coins[j].symbol],
          },
        })
      }
    }
  }

  // De-dupe identical leg sequences (the same 2-hop can surface twice when a
  // metapool repeats a coin), keep the heaviest first.
  const seen = new Set<string>()
  const deduped: { candidate: RouteCandidate; weight: number }[] = []
  for (const entry of out) {
    const key = entry.candidate.legs
      .map((l) => `${l.target.toLowerCase()}:${l.i}:${l.j}`)
      .join('|')
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(entry)
  }
  deduped.sort((a, b) => b.weight - a.weight)
  return deduped.slice(0, maxCandidates).map((e) => e.candidate)
}

// Every distinct coin across the pool universe, heaviest pools first — the
// token pickers' option list. Address-deduped; symbol collisions keep the
// first (heaviest) occurrence's spelling.
export interface UniverseCoin {
  symbol: string
  address: string
  decimals: number
}

export function universeCoins(pools: CurvePool[]): UniverseCoin[] {
  const seen = new Map<string, UniverseCoin>()
  const sorted = [...pools].sort((a, b) => b.tvlUsd - a.tvlUsd)
  for (const pool of sorted) {
    for (const coin of pool.coins) {
      const key = coin.address.toLowerCase()
      if (!key || seen.has(key)) continue
      seen.set(key, { symbol: coin.symbol, address: coin.address, decimals: coin.decimals })
    }
  }
  return [...seen.values()]
}
