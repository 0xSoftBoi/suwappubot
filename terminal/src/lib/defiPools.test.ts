import { describe, expect, test } from 'bun:test'
import { chainsByTvl, defiLlamaPoolUrl, parseDefiPools, poolsForProtocol } from './defiPools'

describe('parseDefiPools', () => {
  test('parses a happy-path pools payload', () => {
    const payload = {
      data: [
        {
          pool: 'abc-123',
          project: 'uniswap-v3',
          chain: 'Ethereum',
          symbol: 'USDC-WETH',
          tvlUsd: 1_000_000,
          apy: 12.5,
          apyBase: 10,
          apyReward: 2.5,
          poolMeta: '0.05%',
          underlyingTokens: ['0xUSDC', '0xWETH'],
        },
      ],
    }
    expect(parseDefiPools(payload)).toEqual([
      {
        id: 'abc-123',
        project: 'uniswap-v3',
        chain: 'Ethereum',
        symbol: 'USDC-WETH',
        tvlUsd: 1_000_000,
        apy: 12.5,
        apyBase: 10,
        apyReward: 2.5,
        poolMeta: '0.05%',
        underlyingTokens: ['0xUSDC', '0xWETH'],
      },
    ])
  })

  test('drops entries missing pool id or project', () => {
    const payload = {
      data: [
        { pool: 'x', chain: 'Ethereum', symbol: 'A' },
        { project: 'aave-v3', chain: 'Ethereum', symbol: 'B' },
        null,
        { pool: 'y', project: 'aave-v3', chain: 'Base', symbol: 'USDC' },
      ],
    }
    const parsed = parseDefiPools(payload)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].id).toBe('y')
  })

  test('defaults missing numeric/array fields', () => {
    const payload = { data: [{ pool: 'z', project: 'lido', chain: 'Ethereum', symbol: 'stETH' }] }
    expect(parseDefiPools(payload)).toEqual([
      {
        id: 'z',
        project: 'lido',
        chain: 'Ethereum',
        symbol: 'stETH',
        tvlUsd: 0,
        apy: 0,
        apyBase: 0,
        apyReward: 0,
        poolMeta: '',
        underlyingTokens: [],
      },
    ])
  })

  test('returns empty array for missing/null data', () => {
    expect(parseDefiPools({})).toEqual([])
    expect(parseDefiPools(null)).toEqual([])
    expect(parseDefiPools(undefined)).toEqual([])
  })
})

describe('poolsForProtocol', () => {
  test('filters by project slug', () => {
    const payload = {
      data: [
        { pool: 'a', project: 'uniswap-v3', chain: 'Ethereum', symbol: 'A' },
        { pool: 'b', project: 'aave-v3', chain: 'Ethereum', symbol: 'B' },
      ],
    }
    const pools = parseDefiPools(payload)
    expect(poolsForProtocol(pools, 'aave-v3').map((p) => p.id)).toEqual(['b'])
  })
})

describe('chainsByTvl', () => {
  test('orders chains by summed TVL desc', () => {
    const payload = {
      data: [
        { pool: 'a', project: 'uniswap-v3', chain: 'Base', symbol: 'A', tvlUsd: 10 },
        { pool: 'b', project: 'uniswap-v3', chain: 'Ethereum', symbol: 'B', tvlUsd: 100 },
        { pool: 'c', project: 'uniswap-v3', chain: 'Ethereum', symbol: 'C', tvlUsd: 50 },
      ],
    }
    expect(chainsByTvl(parseDefiPools(payload))).toEqual(['Ethereum', 'Base'])
  })
})

describe('defiLlamaPoolUrl', () => {
  test('builds the pool detail URL', () => {
    expect(defiLlamaPoolUrl('abc-123')).toBe('https://defillama.com/yields/pool/abc-123')
  })
})
