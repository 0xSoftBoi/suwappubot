import { describe, expect, it } from 'bun:test'
import { formatSavings, venueLabel } from './venueLabels'

describe('venueLabel', () => {
  it('labels the internal propamm id so it never renders raw', () => {
    expect(venueLabel('propamm_titan')).toBe('PropAMM · Titan')
    expect(venueLabel('propamm_titan')).not.toContain('_')
  })

  it('labels other known venues', () => {
    expect(venueLabel('kyberswap')).toBe('KyberSwap')
    expect(venueLabel('lifi')).toBe('Li.Fi')
    expect(venueLabel('0x_crosschain')).toBe('0x Cross-Chain')
  })

  it('falls back to the raw id for unknown venues rather than blanking', () => {
    expect(venueLabel('some_new_venue')).toBe('some_new_venue')
  })

  it('handles missing route', () => {
    expect(venueLabel(undefined)).toBe('—')
    expect(venueLabel(null)).toBe('—')
    expect(venueLabel('')).toBe('—')
  })
})

describe('formatSavings', () => {
  it('formats a real edge against the labelled runner-up', () => {
    expect(formatSavings(12.3456, 'kyberswap')).toEqual({
      amount: '$12.35',
      versus: 'KyberSwap',
    })
  })

  it('shows nothing when there was no runner-up to beat', () => {
    expect(formatSavings(5, null)).toBeNull()
    expect(formatSavings(5, undefined)).toBeNull()
  })

  it('suppresses sub-cent, zero, negative and non-finite figures', () => {
    expect(formatSavings(0.004, 'lifi')).toBeNull()
    expect(formatSavings(0, 'lifi')).toBeNull()
    expect(formatSavings(-3, 'lifi')).toBeNull()
    expect(formatSavings(Number.NaN, 'lifi')).toBeNull()
    expect(formatSavings(Number.POSITIVE_INFINITY, 'lifi')).toBeNull()
    expect(formatSavings(null, 'lifi')).toBeNull()
  })
})
