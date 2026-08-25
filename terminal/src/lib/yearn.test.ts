import { describe, expect, test } from 'bun:test'
import { parseYearnVaults, yearnVaultUrl } from './yearn'

describe('parseYearnVaults', () => {
  test('parses a happy-path vault', () => {
    const payload = [
      {
        address: '0x028eC7330ff87667b6dfb0D94b954c820195336c',
        name: 'yvWETH',
        symbol: 'yvWETH',
        chainID: 1,
        token: { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', symbol: 'WETH', decimals: 18 },
        tvl: { tvl: 12345.67 },
        apr: { netAPR: 0.0325 },
        info: { isHidden: false, isRetired: false },
      },
    ]
    expect(parseYearnVaults(payload)).toEqual([
      {
        address: '0x028eC7330ff87667b6dfb0D94b954c820195336c',
        name: 'yvWETH',
        symbol: 'yvWETH',
        chainId: 1,
        assetSymbol: 'WETH',
        assetAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        assetDecimals: 18,
        tvlUsd: 12345.67,
        netApyPct: 3.25,
      },
    ])
  })

  test('filters out hidden and retired vaults', () => {
    const base = {
      address: '0xabc',
      name: 'x',
      symbol: 'x',
      chainID: 1,
      token: { address: '0xdef', symbol: 'USDC', decimals: 6 },
      tvl: { tvl: 1 },
      apr: { netAPR: 0 },
    }
    const payload = [
      { ...base, info: { isHidden: true, isRetired: false } },
      { ...base, info: { isHidden: false, isRetired: true } },
      { ...base, address: '0xlive', info: { isHidden: false, isRetired: false } },
    ]
    expect(parseYearnVaults(payload).map((v) => v.address)).toEqual(['0xlive'])
  })

  test('nulls out a non-numeric or missing netAPR rather than defaulting to zero', () => {
    const payload = [
      {
        address: '0xabc',
        name: 'x',
        symbol: 'x',
        chainID: 1,
        token: { address: '0xdef', symbol: 'USDC', decimals: 6 },
        tvl: { tvl: 1 },
        apr: { netAPR: null },
        info: { isHidden: false, isRetired: false },
      },
    ]
    expect(parseYearnVaults(payload)[0].netApyPct).toBeNull()
  })

  test('drops entries missing address or chainID', () => {
    const payload = [{ name: 'x' }, { address: '0xabc' }, null]
    expect(parseYearnVaults(payload)).toEqual([])
  })

  test('returns empty array for non-array payload', () => {
    expect(parseYearnVaults({})).toEqual([])
    expect(parseYearnVaults(null)).toEqual([])
  })
})

describe('yearnVaultUrl', () => {
  test('builds the vault detail URL', () => {
    expect(yearnVaultUrl(1, '0xabc')).toBe('https://yearn.fi/vaults/1/0xabc')
  })
})
