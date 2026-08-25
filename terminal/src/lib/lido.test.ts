import { describe, expect, test } from 'bun:test'
import { parseLidoApr, parseLidoStats } from './lido'

describe('parseLidoStats', () => {
  test('parses a happy-path stats payload', () => {
    const payload = {
      uniqueAnytimeHolders: '637464',
      uniqueHolders: '622715',
      totalStaked: '9585928.71234584',
      marketCap: 23901554651.363125,
    }
    expect(parseLidoStats(payload)).toEqual({
      totalStakedEth: 9585928.71234584,
      marketCapUsd: 23901554651.363125,
      uniqueHolders: 622715,
    })
  })

  test('returns null for missing/null payload', () => {
    expect(parseLidoStats(null)).toBeNull()
    expect(parseLidoStats(undefined)).toBeNull()
  })

  test('defaults missing fields to zero', () => {
    expect(parseLidoStats({ totalStaked: '5' })).toEqual({
      totalStakedEth: 5,
      marketCapUsd: 0,
      uniqueHolders: 0,
    })
  })
})

describe('parseLidoApr', () => {
  test('parses the SMA APR payload', () => {
    const payload = {
      data: {
        aprs: [
          { timeUnix: 1787055671, apr: 2.18 },
          { timeUnix: 1787142071, apr: 2.185 },
        ],
        smaApr: 2.267,
      },
      meta: { symbol: 'stETH' },
    }
    expect(parseLidoApr(payload)).toEqual({
      points: [
        { timeUnix: 1787055671, apr: 2.18 },
        { timeUnix: 1787142071, apr: 2.185 },
      ],
      smaApr: 2.267,
    })
  })

  test('returns empty series for missing/null data', () => {
    expect(parseLidoApr({})).toEqual({ points: [], smaApr: 0 })
    expect(parseLidoApr(null)).toEqual({ points: [], smaApr: 0 })
  })

  test('drops malformed points', () => {
    const payload = { data: { aprs: [{ timeUnix: 1, apr: 1 }, { apr: 2 }, null], smaApr: 1 } }
    expect(parseLidoApr(payload).points).toEqual([{ timeUnix: 1, apr: 1 }])
  })
})
