import { describe, expect, test } from 'bun:test'
import { rankChainsByTvl } from './chainRanking'

describe('rankChainsByTvl', () => {
  test('orders chains by summed TVL desc', () => {
    const items = [
      { chainId: 1, tvl: 10 },
      { chainId: 42161, tvl: 100 },
      { chainId: 1, tvl: 50 },
    ]
    expect(rankChainsByTvl(items, (i) => i.chainId, (i) => i.tvl)).toEqual([42161, 1])
  })

  test('returns empty array for no items', () => {
    expect(rankChainsByTvl([], () => 0, () => 0)).toEqual([])
  })
})
