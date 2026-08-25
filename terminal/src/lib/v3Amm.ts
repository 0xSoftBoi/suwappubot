// Shared engine for Uniswap-V3-shaped AMMs (Uniswap itself, and forks like
// PancakeSwap V3) where the protocol has no open public API to enumerate
// pools by TVL (Uniswap Labs' interface API is access-gated — confirmed
// 403/`MissingAuthenticationTokenException`; PancakeSwap's old public API is
// dead and no documented replacement exists). Pool identity is first-party:
// resolved by calling the protocol's own deployed Factory contract's
// `getPool(tokenA, tokenB, fee)` on-chain for a curated set of major pairs
// per chain (there is no way to *discover* every pool without an indexer).
// USD TVL/volume for each confirmed pool then comes from DexScreener — the
// same already-integrated, first-party-trusted, no-key public feed this app
// already uses for market data (see `dexscreener.ts`) — keyed by the real
// on-chain pool address, not used for pool discovery itself.

import type { PublicClient } from 'viem'

export const FACTORY_ABI = [
  {
    type: 'function',
    name: 'getPool',
    stateMutability: 'view',
    inputs: [{ type: 'address' }, { type: 'address' }, { type: 'uint24' }],
    outputs: [{ type: 'address' }],
  },
] as const

export const ERC20_ABI = [
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
] as const

export interface V3ChainConfig {
  slug: string
  label: string
  chainId: number
  dexScreenerChainId: string
  factory: string
  // Curated tokens for this chain, keyed by a short symbol hint (not trusted
  // as the real symbol — that's always read on-chain from the token itself).
  tokens: Record<string, string>
}

export interface V3AmmConfig {
  key: string
  label: string
  dexScreenerDexId: string
  feeTiers: number[]
  pairKeys: [string, string][]
  chains: V3ChainConfig[]
  poolUrl: (chainSlug: string, poolAddress: string) => string
}

export interface V3PoolCandidate {
  tokenA: string
  tokenB: string
  fee: number
}

// Every (curated pair × fee tier) combination worth checking against the
// factory for this chain — only pairs whose tokens both exist on the chain.
export function candidatePools(config: V3AmmConfig, chain: V3ChainConfig): V3PoolCandidate[] {
  const out: V3PoolCandidate[] = []
  for (const [a, b] of config.pairKeys) {
    const tokenA = chain.tokens[a]
    const tokenB = chain.tokens[b]
    if (!tokenA || !tokenB) continue
    for (const fee of config.feeTiers) out.push({ tokenA, tokenB, fee })
  }
  return out
}

export interface DiscoveredPool {
  address: string
  fee: number
  token0: string
  token1: string
}

// Resolves candidates to real pool addresses via the factory's own
// `getPool` — one multicall round trip. Candidates the factory has no pool
// for come back as the zero address and are dropped.
export async function discoverPools(
  client: PublicClient,
  factory: string,
  candidates: V3PoolCandidate[],
): Promise<DiscoveredPool[]> {
  if (candidates.length === 0) return []
  const results = await client.multicall({
    contracts: candidates.map((c) => ({
      address: factory as `0x${string}`,
      abi: FACTORY_ABI,
      functionName: 'getPool' as const,
      args: [c.tokenA as `0x${string}`, c.tokenB as `0x${string}`, c.fee],
    })),
  })
  const seen = new Set<string>()
  const out: DiscoveredPool[] = []
  results.forEach((r, i) => {
    if (r.status !== 'success' || typeof r.result !== 'string') return
    const address = r.result
    if (address === '0x0000000000000000000000000000000000000000') return
    const key = address.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push({ address, fee: candidates[i].fee, token0: candidates[i].tokenA, token1: candidates[i].tokenB })
  })
  return out
}

export interface TokenInfo {
  address: string
  symbol: string
  decimals: number
}

// Reads real symbol/decimals for every unique token address involved —
// never trusted from the curated config, which only carries addresses.
export async function resolveTokens(client: PublicClient, addresses: string[]): Promise<Map<string, TokenInfo>> {
  const unique = [...new Set(addresses.map((a) => a.toLowerCase()))]
  if (unique.length === 0) return new Map()
  const calls = unique.flatMap((addr) => [
    { address: addr as `0x${string}`, abi: ERC20_ABI, functionName: 'symbol' as const },
    { address: addr as `0x${string}`, abi: ERC20_ABI, functionName: 'decimals' as const },
  ])
  const results = await client.multicall({ contracts: calls })
  const out = new Map<string, TokenInfo>()
  unique.forEach((addr, i) => {
    const symbolRes = results[i * 2]
    const decimalsRes = results[i * 2 + 1]
    out.set(addr, {
      address: addr,
      symbol: symbolRes.status === 'success' ? String(symbolRes.result) : '?',
      decimals: decimalsRes.status === 'success' ? Number(decimalsRes.result) : 18,
    })
  })
  return out
}

export interface DexScreenerPoolStats {
  tvlUsd: number
  volume24hUsd: number
  priceUsd: number
}

class DexScreenerError extends Error {}

function num(v: unknown): number {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

export function parseDexScreenerPairStats(payload: unknown): DexScreenerPoolStats | null {
  if (!payload || typeof payload !== 'object') return null
  const pairs = (payload as { pairs?: unknown }).pairs
  if (!Array.isArray(pairs) || pairs.length === 0) return null
  const pair = pairs[0] as Record<string, unknown>
  const liquidity = pair.liquidity as Record<string, unknown> | undefined
  const volume = pair.volume as Record<string, unknown> | undefined
  return {
    tvlUsd: num(liquidity?.usd),
    volume24hUsd: num(volume?.h24),
    priceUsd: num(pair.priceUsd),
  }
}

// One pool address per call — DexScreener's pairs endpoint doesn't support
// batching multiple addresses in one request.
export async function fetchDexScreenerPairStats(
  dexScreenerChainId: string,
  poolAddress: string,
): Promise<DexScreenerPoolStats | null> {
  const res = await fetch(`https://api.dexscreener.com/latest/dex/pairs/${dexScreenerChainId}/${poolAddress}`)
  if (!res.ok) throw new DexScreenerError(`DexScreener API ${res.status}`)
  return parseDexScreenerPairStats(await res.json())
}
