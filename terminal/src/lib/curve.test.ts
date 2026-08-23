import { afterEach, describe, expect, test } from 'bun:test'
import {
  DEFAULT_MIN_TVL,
  MAX_PAGE_SIZE,
  fetchCurvePools,
  parseChainTvls,
  parseCurveChains,
  parseCurvePool,
  parseCurvePools,
} from './curve'

describe('curve chains', () => {
  test('parses a happy-path chains payload', () => {
    const payload = { data: [{ name: 'ethereum', chain_id: 1 }, { name: 'arbitrum', chain_id: 42161 }] }
    expect(parseCurveChains(payload)).toEqual([
      { name: 'ethereum', chainId: 1 },
      { name: 'arbitrum', chainId: 42161 },
    ])
  })

  test('drops entries missing name or chain_id', () => {
    const payload = { data: [{ name: 'ethereum' }, { chain_id: 1 }, null, { name: 'base', chain_id: 8453 }] }
    expect(parseCurveChains(payload)).toEqual([{ name: 'base', chainId: 8453 }])
  })

  test('returns empty array for missing/null data', () => {
    expect(parseCurveChains({})).toEqual([])
    expect(parseCurveChains(null)).toEqual([])
    expect(parseCurveChains(undefined)).toEqual([])
  })

  test('treats a rejection payload (detail, no data) as empty', () => {
    expect(parseCurveChains({ detail: 'pagination too large' })).toEqual([])
  })
})

describe('chain tvls', () => {
  test('parses v1 chain totals', () => {
    const payload = { data: [{ name: 'ethereum', pool_tvl: 1234.5, other_field: 'ignored' }] }
    expect(parseChainTvls(payload)).toEqual([{ name: 'ethereum', poolTvl: 1234.5 }])
  })

  test('defaults missing pool_tvl to 0', () => {
    const payload = { data: [{ name: 'fraxtal' }] }
    expect(parseChainTvls(payload)).toEqual([{ name: 'fraxtal', poolTvl: 0 }])
  })

  test('rejection payload yields empty array', () => {
    expect(parseChainTvls({ detail: 'nope' })).toEqual([])
  })
})

describe('parseCurvePool', () => {
  test('maps a full v2 pool row', () => {
    const raw = {
      address: '0xabc',
      name: '3pool',
      tvl_usd: 500_000,
      trading_volume_24h: 12_345,
      // v2 base_weekly_apr is already in PERCENT units — 1.27 means 1.27%.
      base_weekly_apr: 1.27,
      pool_type: 'main',
      coins: [
        { symbol: 'DAI', address: '0xdai', usd_price: 1.0 },
        { symbol: 'USDC', address: '0xusdc', usd_price: 1.001, decimals: 6 },
      ],
    }
    const pool = parseCurvePool(raw, 1, 'ethereum')
    expect(pool).toEqual({
      address: '0xabc',
      name: '3pool',
      chainId: 1,
      tvlUsd: 500_000,
      volume24h: 12_345,
      baseApr: 1.27,
      coins: [
        // decimals falls back to 18 when the payload omits it, same as flet-curve.
        { symbol: 'DAI', address: '0xdai', usdPrice: 1.0, decimals: 18 },
        { symbol: 'USDC', address: '0xusdc', usdPrice: 1.001, decimals: 6 },
      ],
      registry: 'main',
      poolUrl: 'https://curve.finance/dex/#/ethereum/pools/0xabc/deposit',
    })
  })

  test('is defensive against missing/null fields', () => {
    const pool = parseCurvePool({ address: '0xdef' }, 1, 'ethereum')
    expect(pool).toEqual({
      address: '0xdef',
      name: '0xdef', // falls back to address prefix when name is absent
      chainId: 1,
      tvlUsd: 0,
      volume24h: 0,
      baseApr: 0,
      coins: [],
      registry: '',
      poolUrl: 'https://curve.finance/dex/#/ethereum/pools/0xdef/deposit',
    })
  })

  test('returns null when address is missing', () => {
    expect(parseCurvePool({ name: 'no address' }, 1)).toBeNull()
    expect(parseCurvePool(null, 1)).toBeNull()
  })

  test('empty poolUrl when chainName is not supplied', () => {
    const pool = parseCurvePool({ address: '0xabc' }, 1)
    expect(pool?.poolUrl).toBe('')
  })
})

describe('parseCurvePools', () => {
  test('parses a page of pools with count', () => {
    const payload = {
      pools: [{ address: '0x1', name: 'a' }, { address: '0x2', name: 'b' }],
      count: 137,
    }
    const page = parseCurvePools(payload, 1, 'ethereum')
    expect(page.count).toBe(137)
    expect(page.pools).toHaveLength(2)
    expect(page.pools[0].name).toBe('a')
  })

  test('a rejection payload (detail, no pools/data) yields an empty page', () => {
    const payload = { detail: 'pagination must be <= 50' }
    expect(parseCurvePools(payload, 1)).toEqual({ pools: [], count: 0 })
  })

  test('missing pools array yields empty list', () => {
    expect(parseCurvePools({ count: 0 }, 1)).toEqual({ pools: [], count: 0 })
  })

  test('drops malformed pool rows (no address) but keeps the rest', () => {
    const payload = { pools: [{ address: '0x1' }, { name: 'missing address' }], count: 2 }
    const page = parseCurvePools(payload, 1)
    expect(page.pools).toHaveLength(1)
    expect(page.pools[0].address).toBe('0x1')
  })
})

describe('pagination and min_tvl constraints', () => {
  test('MAX_PAGE_SIZE matches the v2 hard cap (larger values 422)', () => {
    expect(MAX_PAGE_SIZE).toBe(50)
  })

  test('DEFAULT_MIN_TVL matches the dust-pool floor', () => {
    expect(DEFAULT_MIN_TVL).toBe(10_000)
  })

  afterEach(() => {
    // @ts-expect-error resetting the global test double
    delete globalThis.fetch
  })

  test('fetchCurvePools clamps a requested pageSize above 50 down to 50', async () => {
    let capturedUrl = ''
    globalThis.fetch = (async (input: string | URL) => {
      capturedUrl = String(input)
      return new Response(JSON.stringify({ pools: [], count: 0 }), { status: 200 })
    }) as typeof fetch

    await fetchCurvePools({ chainId: 1, chainName: 'ethereum', pageSize: 500 })
    const params = new URL(capturedUrl).searchParams
    expect(params.get('pagination')).toBe('50')
  })
})
