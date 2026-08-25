import { describe, expect, test } from 'bun:test'
import { balancerPoolUrl, fetchBalancerPools } from './balancer'

describe('fetchBalancerPools parsing (via a stubbed fetch)', () => {
  test('parses pools and sums fractional apr items into a percent', async () => {
    const payload = {
      data: {
        poolGetPools: [
          {
            id: '0xpool1',
            address: '0xpool1',
            name: '20wstETH-80AAVE',
            symbol: '20wstETH-80AAVE',
            chain: 'MAINNET',
            type: 'WEIGHTED',
            protocolVersion: 2,
            poolTokens: [
              { symbol: 'wstETH', address: '0xwsteth', decimals: 18 },
              { symbol: 'AAVE', address: '0xaave', decimals: 18 },
            ],
            dynamicData: {
              totalLiquidity: '15978031.39',
              volume24h: '1001537.02',
              fees24h: '2924.49',
              aprItems: [
                { apr: 0.03336332959478896, type: 'SWAP_FEE_24H' },
                { apr: 0.00451906865713351, type: 'IB_YIELD' },
              ],
            },
          },
        ],
      },
    }
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), { status: 200 })) as typeof fetch
    try {
      const pools = await fetchBalancerPools({ chainId: 'MAINNET' })
      expect(pools).toHaveLength(1)
      const p = pools[0]
      expect(p.tvlUsd).toBeCloseTo(15978031.39, 1)
      expect(p.volume24hUsd).toBeCloseTo(1001537.02, 1)
      expect(p.protocolVersion).toBe(2)
      expect(p.aprPct).toBeCloseTo(3.788239825192247, 5)
      expect(p.tokens).toEqual([
        { symbol: 'wstETH', address: '0xwsteth', decimals: 18 },
        { symbol: 'AAVE', address: '0xaave', decimals: 18 },
      ])
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('drops pools missing address or chain', async () => {
    const payload = {
      data: {
        poolGetPools: [
          { id: 'a', name: 'x', symbol: 'x', type: 'WEIGHTED', poolTokens: [], dynamicData: {} },
          { id: 'b', address: '0xb', chain: 'MAINNET', name: 'y', symbol: 'y', type: 'WEIGHTED', poolTokens: [], dynamicData: {} },
        ],
      },
    }
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), { status: 200 })) as typeof fetch
    try {
      const pools = await fetchBalancerPools({ chainId: 'MAINNET' })
      expect(pools.map((p) => p.id)).toEqual(['b'])
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('balancerPoolUrl', () => {
  test('builds a version-aware pool URL', () => {
    expect(balancerPoolUrl('ethereum', { id: '0xabc', protocolVersion: 2 })).toBe(
      'https://balancer.fi/pools/ethereum/v2/0xabc',
    )
    expect(balancerPoolUrl('base', { id: '0xdef', protocolVersion: 3 })).toBe(
      'https://balancer.fi/pools/base/v3/0xdef',
    )
  })
})
