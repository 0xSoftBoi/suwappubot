import { describe, expect, test } from 'bun:test'
import type { CurvePool } from '../curve'
import { ArcKind } from './quoter'
import { arcKindForPool, buildCandidates, universeCoins } from './routes'

function pool(
  address: string,
  name: string,
  registry: string,
  tvl: number,
  coins: [string, string][],
): CurvePool {
  return {
    address,
    name,
    chainId: 1,
    tvlUsd: tvl,
    volume24h: 0,
    baseApr: 0,
    registry,
    poolUrl: '',
    coins: coins.map(([symbol, addr]) => ({ symbol, address: addr, usdPrice: 1, decimals: 18 })),
  }
}

const DAI = '0xdai'
const USDC = '0xusdc'
const USDT = '0xusdt'
const WETH = '0xweth'

const THREEPOOL = pool('0xpool3', '3pool', 'main', 100, [
  ['DAI', DAI],
  ['USDC', USDC],
  ['USDT', USDT],
])
const TRICRYPTO = pool('0xtri', 'tricrypto2', 'factory_tricrypto', 50, [
  ['USDT', USDT],
  ['WBTC', '0xwbtc'],
  ['WETH', WETH],
])

describe('arcKindForPool', () => {
  test('mirrors flet-curve Pool.is_stableswap', () => {
    for (const r of ['main', 'factory', 'crvusd', 'stableswapng', 'factory-stable-ng', '']) {
      expect(arcKindForPool(r)).toBe(ArcKind.SWAP_STABLE)
    }
    for (const r of ['crypto', 'factory_crypto', 'factory_tricrypto', 'twocryptong', 'factory-twocrypto']) {
      expect(arcKindForPool(r)).toBe(ArcKind.SWAP_CRYPTO)
    }
  })
})

describe('buildCandidates', () => {
  test('finds a direct route with the pool coin indices', () => {
    const [direct] = buildCandidates([THREEPOOL], DAI, USDC)
    expect(direct.legs).toHaveLength(1)
    expect(direct.legs[0]).toMatchObject({ target: '0xpool3', kind: ArcKind.SWAP_STABLE, i: 0, j: 1, n: 3, srcSlot: 0, dstSlot: 1, bps: 0 })
    expect(direct.dstSlot).toBe(1)
    expect(direct.path).toEqual(['DAI', 'USDC'])
  })

  test('finds a two-hop through a shared coin with slot chaining', () => {
    const candidates = buildCandidates([THREEPOOL, TRICRYPTO], DAI, WETH)
    expect(candidates).toHaveLength(1)
    const [hop] = candidates
    expect(hop.legs).toHaveLength(2)
    expect(hop.legs[0]).toMatchObject({ target: '0xpool3', i: 0, j: 2, srcSlot: 0, dstSlot: 1 })
    expect(hop.legs[1]).toMatchObject({ target: '0xtri', kind: ArcKind.SWAP_CRYPTO, i: 0, j: 2, srcSlot: 1, dstSlot: 2 })
    expect(hop.dstSlot).toBe(2)
    expect(hop.path).toEqual(['DAI', 'USDT', 'WETH'])
  })

  test('ranks by weakest-pool TVL and caps candidates', () => {
    const alt = pool('0xalt', 'alt-3pool', 'main', 5, [
      ['DAI', DAI],
      ['USDC', USDC],
    ])
    const candidates = buildCandidates([alt, THREEPOOL], DAI, USDC, 1)
    expect(candidates).toHaveLength(1)
    expect(candidates[0].poolNames).toEqual(['3pool'])
  })

  test('same coin, unknown coin, and self-swap yield nothing', () => {
    expect(buildCandidates([THREEPOOL], DAI, DAI)).toEqual([])
    expect(buildCandidates([THREEPOOL], DAI, '0xnope')).toEqual([])
    expect(buildCandidates([THREEPOOL], '', USDC)).toEqual([])
  })
})

describe('universeCoins', () => {
  test('dedupes by address, heaviest pool first', () => {
    const coins = universeCoins([TRICRYPTO, THREEPOOL])
    const usdt = coins.filter((c) => c.address === USDT)
    expect(usdt).toHaveLength(1)
    // 3pool (tvl 100) outweighs tricrypto (50), so DAI leads the list.
    expect(coins[0].symbol).toBe('DAI')
  })
})
