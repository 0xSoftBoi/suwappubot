import { describe, expect, test } from 'bun:test'
import { swapDeskSlugForChainId, swapDeskSlugForChainName } from './swapDeskChains'

describe('swapDeskSlugForChainId', () => {
  test('resolves a known chain id', () => {
    expect(swapDeskSlugForChainId(1)).toBe('ethereum')
    expect(swapDeskSlugForChainId(56)).toBe('bsc')
  })

  test('returns undefined for an unknown chain id', () => {
    expect(swapDeskSlugForChainId(999999)).toBeUndefined()
  })
})

describe('swapDeskSlugForChainName', () => {
  test('resolves a known chain name', () => {
    expect(swapDeskSlugForChainName('Ethereum')).toBe('ethereum')
    expect(swapDeskSlugForChainName('BSC')).toBe('bsc')
  })

  test('returns undefined for an unknown chain name', () => {
    expect(swapDeskSlugForChainName('Nonexistent')).toBeUndefined()
  })
})
