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

describe('native token placeholder', () => {
  test('is a well-formed 40-hex-char EVM address on every EVM chain', async () => {
    const { EVM_NATIVE_ADDRESS, nativeTokenFor } = await import('./quoteTokens')
    expect(EVM_NATIVE_ADDRESS).toMatch(/^0x[0-9a-fA-F]{40}$/)
    expect(EVM_NATIVE_ADDRESS.toLowerCase()).toBe('0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE')
    for (const chain of ['ethereum', 'arbitrum', 'base', 'optimism', 'polygon', 'bsc', 'avalanche']) {
      expect(nativeTokenFor(chain).address).toBe(EVM_NATIVE_ADDRESS)
      expect(nativeTokenFor(chain).chain).toBe(chain)
    }
    expect(nativeTokenFor('solana').address).toBe('So11111111111111111111111111111111111111112')
  })
})
