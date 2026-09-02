import { describe, expect, it } from 'bun:test'
import { formatBaseUnitsOrHuman, formatTokenAmount, parseServerTimestamp } from './amounts'

describe('formatTokenAmount', () => {
  it('never renders scientific notation', () => {
    expect(formatTokenAmount('4.2048360001236e-05')).toBe('0.00004205')
    expect(formatTokenAmount(1e-7)).toBe('0.0000001')
    expect(formatTokenAmount('1e21')).toBe('1000000000000000000000')
  })
  it('trims trailing zeros and keeps whole numbers plain', () => {
    expect(formatTokenAmount('2919242.2782344082')).toBe('2919242.278234')
    expect(formatTokenAmount('0.10000')).toBe('0.1')
    expect(formatTokenAmount(5)).toBe('5')
    expect(formatTokenAmount(0)).toBe('0')
  })
  it('passes through empty / non-numeric input', () => {
    expect(formatTokenAmount('')).toBe('')
    expect(formatTokenAmount(null)).toBe('')
    expect(formatTokenAmount('abc')).toBe('abc')
  })
})

describe('formatBaseUnitsOrHuman', () => {
  it('scales raw base units by decimals', () => {
    expect(formatBaseUnitsOrHuman('41838118201229', 18, '0.000042048360001236')).toBe('0.00004184')
    expect(formatBaseUnitsOrHuman('2904646066843236691869696', 18, '2919242.2782344082')).toBe('2904646.066843')
  })
  it('keeps human amounts that already have a decimal point', () => {
    expect(formatBaseUnitsOrHuman('0.5', 18)).toBe('0.5')
  })
  it('prefers the plausible interpretation for whole-number amounts', () => {
    expect(formatBaseUnitsOrHuman('5', 6, '5.02')).toBe('5')
    expect(formatBaseUnitsOrHuman('4975000', 6, '5.0')).toBe('4.975')
  })
})

describe('parseServerTimestamp', () => {
  it('treats naive ISO strings as UTC', () => {
    expect(parseServerTimestamp('2026-09-02T11:25:49.475634')).toBe(Date.parse('2026-09-02T11:25:49.475Z'))
    expect(parseServerTimestamp('2026-09-02 11:25:49')).toBe(Date.parse('2026-09-02T11:25:49Z'))
  })
  it('respects explicit offsets', () => {
    expect(parseServerTimestamp('2026-09-02T11:25:49Z')).toBe(Date.parse('2026-09-02T11:25:49Z'))
    expect(parseServerTimestamp('2026-09-02T13:25:49+02:00')).toBe(Date.parse('2026-09-02T11:25:49Z'))
  })
  it('returns NaN for empty input', () => {
    expect(Number.isNaN(parseServerTimestamp(''))).toBe(true)
  })
})
