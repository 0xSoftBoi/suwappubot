import { describe, it, expect } from 'bun:test'
import {
  truncateAddress,
  formatPct,
  formatBalance,
  flagSeverity,
  bubbleRadius,
  clusterColor,
  rugRate,
  hashString,
  seededRandom,
} from '../../lib/intelFormat'

describe('truncateAddress', () => {
  it('truncates a long address to front...back', () => {
    expect(truncateAddress('0x1234567890abcdef1234567890abcdef12345678')).toBe('0x1234...5678')
  })

  it('leaves short addresses untouched', () => {
    expect(truncateAddress('0xabc')).toBe('0xabc')
  })

  it('renders -- for null/undefined/empty', () => {
    expect(truncateAddress(null)).toBe('--')
    expect(truncateAddress(undefined)).toBe('--')
    expect(truncateAddress('')).toBe('--')
  })
})

describe('formatPct', () => {
  it('formats with the requested decimals', () => {
    expect(formatPct(12.3456)).toBe('12.35%')
    expect(formatPct(12.3456, 0)).toBe('12%')
  })

  it('renders -- for null/undefined/NaN (graceful degradation)', () => {
    expect(formatPct(null)).toBe('--')
    expect(formatPct(undefined)).toBe('--')
    expect(formatPct(NaN)).toBe('--')
  })
})

describe('formatBalance', () => {
  it('applies K/M/B/T suffixes', () => {
    expect(formatBalance(1_500)).toBe('1.50K')
    expect(formatBalance(2_500_000)).toBe('2.50M')
    expect(formatBalance(3_500_000_000)).toBe('3.50B')
    expect(formatBalance(4_500_000_000_000)).toBe('4.50T')
  })

  it('leaves small numbers as-is', () => {
    expect(formatBalance(42)).toBe('42.00')
  })

  it('renders -- for null/undefined', () => {
    expect(formatBalance(null)).toBe('--')
    expect(formatBalance(undefined)).toBe('--')
  })
})

describe('flagSeverity', () => {
  it('maps each contract flag to its severity', () => {
    expect(flagSeverity('HIGH_TOP10')).toBe('danger')
    expect(flagSeverity('SERIAL_DEPLOYER')).toBe('danger')
    expect(flagSeverity('BUNDLED')).toBe('warn')
    expect(flagSeverity('SNIPED')).toBe('warn')
    expect(flagSeverity('CLUSTERED')).toBe('warn')
  })

  it('falls back to ok for unknown flags', () => {
    expect(flagSeverity('SOME_UNKNOWN_FLAG')).toBe('ok')
  })
})

describe('bubbleRadius', () => {
  it('uses sqrt scaling so area (not radius) encodes pct', () => {
    const r100 = bubbleRadius(100)
    const r25 = bubbleRadius(25)
    // sqrt(25/100) = 0.5 -> half the radius of the 100% bubble (before clamping)
    expect(r25).toBeCloseTo(r100 * 0.5, 5)
  })

  it('clamps to the min radius for tiny/zero pct', () => {
    expect(bubbleRadius(0)).toBe(6)
    expect(bubbleRadius(0.00001)).toBeGreaterThanOrEqual(6)
  })

  it('clamps to the max radius for pct >= 100', () => {
    expect(bubbleRadius(100)).toBe(48)
    expect(bubbleRadius(500)).toBe(48)
  })

  it('respects custom min/max bounds', () => {
    expect(bubbleRadius(0, 10, 20)).toBe(10)
    expect(bubbleRadius(100, 10, 20)).toBe(20)
  })
})

describe('clusterColor', () => {
  it('is deterministic for the same index', () => {
    expect(clusterColor(2)).toBe(clusterColor(2))
  })

  it('cycles through the palette without collisions within one cycle', () => {
    const colors = Array.from({ length: 8 }, (_, i) => clusterColor(i))
    expect(new Set(colors).size).toBe(8)
  })

  it('wraps around deterministically past the palette length', () => {
    expect(clusterColor(8)).toBe(clusterColor(0))
  })

  it('returns a neutral color for unclustered (-1)', () => {
    expect(clusterColor(-1)).toBe('#8b93a7')
  })
})

describe('rugRate', () => {
  it('computes dead/prior as a percentage', () => {
    expect(rugRate(5, 10)).toBe(50)
  })

  it('handles divide-by-zero by returning null, not NaN/Infinity', () => {
    expect(rugRate(0, 0)).toBeNull()
    expect(rugRate(5, 0)).toBeNull()
    expect(rugRate(null, null)).toBeNull()
    expect(rugRate(0, null)).toBeNull()
  })

  it('treats a missing dead count as zero', () => {
    expect(rugRate(null, 10)).toBe(0)
    expect(rugRate(undefined, 10)).toBe(0)
  })

  it('clamps to 100 even if dead > prior (bad upstream data)', () => {
    expect(rugRate(20, 10)).toBe(100)
  })
})

describe('hashString + seededRandom (deterministic layout)', () => {
  it('hashString is deterministic for the same input', () => {
    expect(hashString('0xdeadbeef')).toBe(hashString('0xdeadbeef'))
  })

  it('hashString differs for different addresses (no reshuffle collisions in practice)', () => {
    expect(hashString('0xaaa')).not.toBe(hashString('0xbbb'))
  })

  it('seededRandom produces the same sequence for the same seed', () => {
    const seed = hashString('0xsomeaddress')
    const seqA = [seededRandom(seed)(), seededRandom(seed)()]
    const rngB = seededRandom(seed)
    const seqB = [rngB(), rngB()]
    expect(seqA[0]).toBe(seqB[0])
  })

  it('seededRandom values stay within [0, 1)', () => {
    const rng = seededRandom(hashString('0xabc'))
    for (let i = 0; i < 20; i++) {
      const v = rng()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})
