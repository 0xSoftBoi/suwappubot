import { describe, expect, test } from 'bun:test'
import { fetchAaveMarkets, marketLabel, type AaveMarket } from './aave'

// Shapes below mirror a real response from api.v3.aave.com/graphql
// (captured 2026-08-25), trimmed to the fields the parser reads.
describe('fetchAaveMarkets parsing (via a stubbed fetch)', () => {
  test('parses markets and reserves', async () => {
    const payload = {
      data: {
        markets: [
          {
            name: 'AaveV3Ethereum',
            chain: { chainId: 1, name: 'Ethereum' },
            address: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
            totalMarketSize: '24498734236.83',
            totalAvailableLiquidity: '13996403341.97',
            reserves: [
              {
                underlyingToken: { symbol: 'AAVE', decimals: 18, address: '0x7Fc665...' },
                size: { usd: '105301946.27' },
                isFrozen: false,
                isPaused: false,
                supplyInfo: { apy: { formatted: '0' } },
                borrowInfo: null,
              },
              {
                underlyingToken: { symbol: 'BAL', decimals: 18, address: '0xba1000...' },
                size: { usd: '17480.99' },
                isFrozen: false,
                isPaused: false,
                supplyInfo: { apy: { formatted: '1.66' } },
                borrowInfo: {
                  apy: { formatted: '11.79' },
                  availableLiquidity: { usd: '5000' },
                  utilizationRate: { formatted: '65.5' },
                },
              },
            ],
          },
        ],
      },
    }
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), { status: 200 })) as typeof fetch
    try {
      const markets = await fetchAaveMarkets([1])
      expect(markets).toHaveLength(1)
      const m = markets[0]
      expect(m.chainId).toBe(1)
      expect(m.chainName).toBe('Ethereum')
      expect(m.totalMarketSizeUsd).toBeCloseTo(24498734236.83, 1)
      expect(m.reserves).toHaveLength(2)
      expect(m.reserves[0]).toEqual({
        symbol: 'AAVE',
        address: '0x7Fc665...',
        decimals: 18,
        tvlUsd: 105301946.27,
        supplyApy: 0,
        borrowApy: null,
        isFrozen: false,
        isPaused: false,
        availableLiquidityUsd: 0,
        utilizationRate: 0,
      })
      expect(m.reserves[1]).toEqual({
        symbol: 'BAL',
        address: '0xba1000...',
        decimals: 18,
        tvlUsd: 17480.99,
        supplyApy: 1.66,
        borrowApy: 11.79,
        isFrozen: false,
        isPaused: false,
        availableLiquidityUsd: 5000,
        utilizationRate: 65.5,
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('throws on a GraphQL errors response', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ errors: [{ message: 'bad request' }] }), {
        status: 200,
      })) as typeof fetch
    try {
      await expect(fetchAaveMarkets([1])).rejects.toThrow('bad request')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('marketLabel', () => {
  function market(name: string, chainName: string): AaveMarket {
    return {
      name,
      chainId: 1,
      chainName,
      address: '',
      totalMarketSizeUsd: 0,
      totalAvailableLiquidityUsd: 0,
      reserves: [],
    }
  }

  test('labels the main market as Main', () => {
    expect(marketLabel(market('AaveV3Ethereum', 'Ethereum'))).toBe('Main')
  })

  test('labels an isolated sub-market by its suffix', () => {
    expect(marketLabel(market('AaveV3EthereumLido', 'Ethereum'))).toBe('Lido')
    expect(marketLabel(market('AaveV3EthereumEtherFi', 'Ethereum'))).toBe('EtherFi')
  })

  test('handles the BSC/BNB naming mismatch', () => {
    expect(marketLabel(market('AaveV3BNB', 'BSC'))).toBe('Main')
  })
})
