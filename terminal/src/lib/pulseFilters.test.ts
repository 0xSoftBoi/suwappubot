import { describe, it, expect } from 'bun:test'
import { applyPulseFilters } from '../hooks/usePulse'
import type { PulseFilters, PulseToken } from '../types/api'

const NOW = Date.now()

function baseFilters(overrides: Partial<PulseFilters> = {}): PulseFilters {
  return {
    minMarketCap: null,
    maxMarketCap: null,
    minLiquidity: null,
    minVolume: null,
    minTxns: null,
    maxAgeMinutes: null,
    maxTopHolderPercent: null,
    maxDevPercent: null,
    maxSniperPercent: null,
    maxBundleCount: null,
    minHolders: null,
    maxInsidersPercent: null,
    maxBundlePercent: null,
    ...overrides,
  }
}

function finalStretchToken(overrides: Partial<PulseToken> = {}): PulseToken {
  return {
    address: 'mint1',
    symbol: 'STRETCH',
    name: 'Stretch Token',
    chain: 'solana',
    stage: 'final_stretch',
    createdAt: new Date(NOW - 5 * 60_000).toISOString(),
    marketCap: 20_000,
    volume24h: 100_000,
    holders: 0,
    topHolderPercent: 0,
    devPercent: 0,
    sniperPercent: 0,
    liquidityUsd: 8_000,
    priceUsd: 0.0001,
    txns24h: 500,
    priceChange5m: 0,
    insidersPercent: 40,
    bundlePercent: 20,
    ...overrides,
  }
}

describe('applyPulseFilters — Final Stretch stage', () => {
  it('only returns tokens in the requested stage', () => {
    const tokens = [
      finalStretchToken({ address: 'a', stage: 'final_stretch' }),
      finalStretchToken({ address: 'b', stage: 'new' }),
      finalStretchToken({ address: 'c', stage: 'migrated' }),
    ]
    const result = applyPulseFilters(tokens, baseFilters(), 'final_stretch', NOW)
    expect(result.map((t) => t.address)).toEqual(['a'])
  })

  it('narrows by Insiders% (maxInsidersPercent)', () => {
    const tokens = [
      finalStretchToken({ address: 'low', insidersPercent: 10 }),
      finalStretchToken({ address: 'high', insidersPercent: 90 }),
    ]
    const result = applyPulseFilters(
      tokens,
      baseFilters({ maxInsidersPercent: 50 }),
      'final_stretch',
      NOW,
    )
    expect(result.map((t) => t.address)).toEqual(['low'])
  })

  it('narrows by Bundle% (maxBundlePercent)', () => {
    const tokens = [
      finalStretchToken({ address: 'low', bundlePercent: 5 }),
      finalStretchToken({ address: 'high', bundlePercent: 60 }),
    ]
    const result = applyPulseFilters(
      tokens,
      baseFilters({ maxBundlePercent: 25 }),
      'final_stretch',
      NOW,
    )
    expect(result.map((t) => t.address)).toEqual(['low'])
  })

  it('narrows by Age (maxAgeMinutes)', () => {
    const tokens = [
      finalStretchToken({ address: 'new', createdAt: new Date(NOW - 2 * 60_000).toISOString() }),
      finalStretchToken({ address: 'old', createdAt: new Date(NOW - 200 * 60_000).toISOString() }),
    ]
    const result = applyPulseFilters(tokens, baseFilters({ maxAgeMinutes: 30 }), 'final_stretch', NOW)
    expect(result.map((t) => t.address)).toEqual(['new'])
  })

  it('narrows by Volume (minVolume)', () => {
    const tokens = [
      finalStretchToken({ address: 'lowvol', volume24h: 1_000 }),
      finalStretchToken({ address: 'hivol', volume24h: 500_000 }),
    ]
    const result = applyPulseFilters(tokens, baseFilters({ minVolume: 100_000 }), 'final_stretch', NOW)
    expect(result.map((t) => t.address)).toEqual(['hivol'])
  })

  it('narrows by Txns (minTxns)', () => {
    const tokens = [
      finalStretchToken({ address: 'lowtx', txns24h: 20 }),
      finalStretchToken({ address: 'hitx', txns24h: 900 }),
    ]
    const result = applyPulseFilters(tokens, baseFilters({ minTxns: 100 }), 'final_stretch', NOW)
    expect(result.map((t) => t.address)).toEqual(['hitx'])
  })

  it('does not exclude tokens missing the insiders/bundle signal', () => {
    const tokens = [
      finalStretchToken({ address: 'unknown', insidersPercent: null, bundlePercent: null }),
    ]
    const result = applyPulseFilters(
      tokens,
      baseFilters({ maxInsidersPercent: 10, maxBundlePercent: 10 }),
      'final_stretch',
      NOW,
    )
    expect(result.map((t) => t.address)).toEqual(['unknown'])
  })
})
