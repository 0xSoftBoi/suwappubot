import { describe, expect, test } from 'bun:test'
import { fetchMorphoVaults, morphoVaultUrl, parseMorphoVaults } from './morpho'

describe('parseMorphoVaults', () => {
  test('parses a happy-path vaults payload', () => {
    const payload = {
      items: [
        {
          address: '0xbEef047a543E45807105E51A8BBEFCc5950fcfBa',
          name: 'Steakhouse USDT',
          symbol: 'steakUSDT',
          chain: { id: 1 },
          asset: { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', symbol: 'USDT', decimals: 6 },
          state: { totalAssetsUsd: 91289714.0035, netApy: 0.0331898794, fee: 0.05, curator: '0x827e86072B06674a077f592A531dcE4590aDeCdB' },
        },
      ],
    }
    const [vault] = parseMorphoVaults(payload)
    expect(vault.netApyPct).toBeCloseTo(3.31898794, 6)
    expect(vault).toEqual({
      address: '0xbEef047a543E45807105E51A8BBEFCc5950fcfBa',
      name: 'Steakhouse USDT',
      symbol: 'steakUSDT',
      chainId: 1,
      assetSymbol: 'USDT',
      assetAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      assetDecimals: 6,
      tvlUsd: 91289714.0035,
      netApyPct: vault.netApyPct,
      feePct: 5,
      curator: '0x827e86072B06674a077f592A531dcE4590aDeCdB',
    })
  })

  test('treats the zero address curator as uncurated (null)', () => {
    const payload = {
      items: [
        {
          address: '0xabc',
          name: 'x',
          symbol: 'x',
          chain: { id: 1 },
          asset: { address: '0xdef', symbol: 'USDC', decimals: 6 },
          state: { totalAssetsUsd: 1, netApy: 0, fee: 0, curator: '0x0000000000000000000000000000000000000000' },
        },
      ],
    }
    expect(parseMorphoVaults(payload)[0].curator).toBeNull()
  })

  test('drops entries missing address or chain', () => {
    const payload = {
      items: [
        { name: 'x', chain: { id: 1 } },
        { address: '0xabc', name: 'y' },
        null,
        { address: '0xdef', name: 'z', chain: { id: 1 } },
      ],
    }
    expect(parseMorphoVaults(payload).map((v) => v.address)).toEqual(['0xdef'])
  })

  test('returns empty array for missing/null items', () => {
    expect(parseMorphoVaults({})).toEqual([])
    expect(parseMorphoVaults(null)).toEqual([])
  })
})

describe('fetchMorphoVaults (via a stubbed fetch)', () => {
  test('throws on a GraphQL errors response', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ errors: [{ message: 'bad request' }] }), { status: 200 })) as typeof fetch
    try {
      await expect(fetchMorphoVaults({ chainId: 1 })).rejects.toThrow('bad request')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('morphoVaultUrl', () => {
  test('builds the vault detail URL', () => {
    expect(morphoVaultUrl(1, '0xabc')).toBe('https://app.morpho.org/vault?vault=0xabc&network=1')
  })
})
