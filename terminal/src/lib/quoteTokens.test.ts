import { describe, expect, test } from 'bun:test'
import { nativeTokenFor, pairFromToken, usdcFor } from './quoteTokens'

describe('quoteTokens', () => {
  test('pairs a selected token with same-chain USDC', () => {
    const sol = nativeTokenFor('solana')
    expect(pairFromToken(sol).quote).toEqual(usdcFor('solana'))
  })

  test('switches Solana to a coherent SOL/USDC market', () => {
    expect(nativeTokenFor('solana')).toMatchObject({
      symbol: 'SOL',
      chain: 'solana',
      decimals: 9,
    })
    expect(usdcFor('solana').chain).toBe('solana')
  })

  test('uses the correct gas token for EVM chains', () => {
    expect(nativeTokenFor('bsc').symbol).toBe('BNB')
    expect(nativeTokenFor('polygon').symbol).toBe('POL')
    expect(nativeTokenFor('base').symbol).toBe('ETH')
  })
})
