import { describe, expect, test } from 'bun:test'
import { fetchEulerVaults, parseEulerVaultsPage } from './euler'

describe('parseEulerVaultsPage', () => {
  test('parses a happy-path page', () => {
    const payload = {
      data: [
        {
          chainId: 1,
          address: '0x056f3a2E41d2778D3a0c0714439c53af2987718E',
          name: 'EVK Vault ecbBTC-3',
          symbol: 'ecbBTC-3',
          asset: { address: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', symbol: 'cbBTC', decimals: 8 },
          totalSupplyUsd: 114210.11649753602,
          supplyApy: 0.014699601172361054,
          borrowApy: 0.10724143523173546,
          utilization: 0.152300182818506,
        },
      ],
      meta: { total: 131 },
    }
    const { vaults, total } = parseEulerVaultsPage(payload)
    expect(total).toBe(131)
    expect(vaults).toHaveLength(1)
    const v = vaults[0]
    expect(v.address).toBe('0x056f3a2E41d2778D3a0c0714439c53af2987718E')
    expect(v.assetSymbol).toBe('cbBTC')
    expect(v.tvlUsd).toBeCloseTo(114210.1165, 2)
    expect(v.supplyApyPct).toBeCloseTo(1.4699601172361054, 6)
    expect(v.borrowApyPct).toBeCloseTo(10.724143523173546, 6)
    expect(v.utilizationPct).toBeCloseTo(15.2300182818506, 6)
  })

  test('drops entries missing address or chainId', () => {
    const payload = { data: [{ name: 'x' }, { address: '0xabc', name: 'y' }, null], meta: { total: 0 } }
    expect(parseEulerVaultsPage(payload).vaults).toEqual([])
  })

  test('returns empty for missing/null payload', () => {
    expect(parseEulerVaultsPage({})).toEqual({ vaults: [], total: 0 })
    expect(parseEulerVaultsPage(null)).toEqual({ vaults: [], total: 0 })
  })
})

describe('fetchEulerVaults', () => {
  test('pages until every vault is fetched and sorts by TVL desc', async () => {
    const makeVault = (i: number, tvl: number) => ({
      chainId: 1,
      address: `0x${i.toString().padStart(40, '0')}`,
      name: `Vault ${i}`,
      symbol: `v${i}`,
      asset: { address: '0xasset', symbol: 'USDC', decimals: 6 },
      totalSupplyUsd: tvl,
      supplyApy: 0,
      borrowApy: 0,
      utilization: 0,
    })
    const page1 = { data: Array.from({ length: 100 }, (_, i) => makeVault(i, 100 - i)), meta: { total: 105 } }
    const page2 = { data: Array.from({ length: 5 }, (_, i) => makeVault(100 + i, 9999)), meta: { total: 105 } }
    let calls = 0
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (url: string) => {
      calls++
      const body = url.includes('offset=100') ? page2 : page1
      return new Response(JSON.stringify(body), { status: 200 })
    }) as typeof fetch
    try {
      const vaults = await fetchEulerVaults(1)
      expect(calls).toBe(2)
      expect(vaults).toHaveLength(105)
      expect(vaults[0].tvlUsd).toBe(9999)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
