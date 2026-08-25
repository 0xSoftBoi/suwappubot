import { describe, expect, test } from 'bun:test'
import { compactUsd, percent } from './format'

describe('compactUsd', () => {
  test('formats magnitudes with t/b/m/k suffixes', () => {
    expect(compactUsd(1_500_000_000_000)).toBe('$1.50t')
    expect(compactUsd(2_340_000_000)).toBe('$2.34b')
    expect(compactUsd(5_600_000)).toBe('$5.60m')
    expect(compactUsd(7_800)).toBe('$7.80k')
    expect(compactUsd(42.5)).toBe('$42.50')
  })

  test('handles zero and negative values', () => {
    expect(compactUsd(0)).toBe('$0')
    expect(compactUsd(-1_000_000)).toBe('-$1.00m')
  })
})

describe('percent', () => {
  test('formats to two decimals with a percent sign', () => {
    expect(percent(12.3456)).toBe('12.35%')
    expect(percent(0)).toBe('0.00%')
  })
})
