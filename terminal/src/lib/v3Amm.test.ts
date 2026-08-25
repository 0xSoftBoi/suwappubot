import { describe, expect, test } from 'bun:test'
import { candidatePools, parseDexScreenerPairStats, type V3AmmConfig, type V3ChainConfig } from './v3Amm'

const CONFIG: V3AmmConfig = {
  key: 'test',
  label: 'Test',
  dexScreenerDexId: 'test',
  feeTiers: [500, 3000],
  pairKeys: [
    ['WETH', 'USDC'],
    ['WBTC', 'WETH'],
    ['DAI', 'USDC'],
  ],
  chains: [],
  poolUrl: () => '',
}

describe('candidatePools', () => {
  test('builds one candidate per (pair, fee) combo the chain has tokens for', () => {
    const chain: V3ChainConfig = {
      slug: 'ethereum',
      label: 'Ethereum',
      chainId: 1,
      dexScreenerChainId: 'ethereum',
      factory: '0xfactory',
      tokens: { WETH: '0xweth', USDC: '0xusdc', WBTC: '0xwbtc' },
    }
    const candidates = candidatePools(CONFIG, chain)
    // WETH/USDC and WBTC/WETH both resolvable (2 pairs x 2 fees); DAI/USDC
    // skipped since the chain has no DAI entry.
    expect(candidates).toHaveLength(4)
    expect(candidates).toContainEqual({ tokenA: '0xweth', tokenB: '0xusdc', fee: 500 })
    expect(candidates).toContainEqual({ tokenA: '0xweth', tokenB: '0xusdc', fee: 3000 })
    expect(candidates).toContainEqual({ tokenA: '0xwbtc', tokenB: '0xweth', fee: 500 })
  })

  test('returns empty when the chain has none of the curated tokens', () => {
    const chain: V3ChainConfig = {
      slug: 'x',
      label: 'X',
      chainId: 2,
      dexScreenerChainId: 'x',
      factory: '0xfactory',
      tokens: {},
    }
    expect(candidatePools(CONFIG, chain)).toEqual([])
  })
})

describe('parseDexScreenerPairStats', () => {
  test('parses the first pair from a happy-path payload', () => {
    const payload = {
      pairs: [{ liquidity: { usd: 104724992.36 }, volume: { h24: 120053391.92 }, priceUsd: '2507.086' }],
    }
    expect(parseDexScreenerPairStats(payload)).toEqual({
      tvlUsd: 104724992.36,
      volume24hUsd: 120053391.92,
      priceUsd: 2507.086,
    })
  })

  test('returns null when pairs is missing or empty', () => {
    expect(parseDexScreenerPairStats({ pairs: [] })).toBeNull()
    expect(parseDexScreenerPairStats({})).toBeNull()
    expect(parseDexScreenerPairStats(null)).toBeNull()
  })

  test('defaults missing numeric fields to zero', () => {
    expect(parseDexScreenerPairStats({ pairs: [{}] })).toEqual({ tvlUsd: 0, volume24hUsd: 0, priceUsd: 0 })
  })
})
