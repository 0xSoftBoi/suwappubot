import { describe, expect, it } from 'bun:test'
import { clampLeverage, isLeverageValid, normalizeMaxLeverage } from './perpsRisk'

describe('perps leverage bounds', () => {
  it('clamps persisted leverage when switching to a lower-cap market', () => {
    expect(clampLeverage(50, 20)).toBe(20)
    expect(clampLeverage(10, 5)).toBe(5)
  })

  it('never permits leverage below 1x or non-finite values', () => {
    expect(clampLeverage(0, 20)).toBe(1)
    expect(clampLeverage(Number.NaN, 20)).toBe(1)
  })

  it('uses the conservative fallback only when market metadata is invalid', () => {
    expect(normalizeMaxLeverage(undefined)).toBe(20)
    expect(normalizeMaxLeverage(0)).toBe(20)
    expect(normalizeMaxLeverage(7.9)).toBe(7)
  })

  it('blocks submission outside the selected market leverage range', () => {
    expect(isLeverageValid(1, 5)).toBe(true)
    expect(isLeverageValid(5, 5)).toBe(true)
    expect(isLeverageValid(6, 5)).toBe(false)
    expect(isLeverageValid(1.5, 5)).toBe(false)
  })
})
