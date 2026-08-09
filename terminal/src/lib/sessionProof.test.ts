import { describe, expect, test } from 'bun:test'
import { hasTradingProof } from './sessionProof'

describe('hasTradingProof', () => {
  test('accepts only proof-bearing session sources', () => {
    expect(hasTradingProof('siwe')).toBe(true)
    expect(hasTradingProof('telegram')).toBe(true)
    expect(hasTradingProof('passkey')).toBe(true)
  })

  test('keeps OAuth and legacy sessions out of money-changing UI', () => {
    expect(hasTradingProof('weak')).toBe(false)
    expect(hasTradingProof(null)).toBe(false)
    expect(hasTradingProof(undefined)).toBe(false)
    expect(hasTradingProof('unknown')).toBe(false)
  })
})
