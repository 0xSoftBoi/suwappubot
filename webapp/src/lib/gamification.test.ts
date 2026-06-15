import { describe, it, expect } from 'bun:test'
import {
  xpForLevel,
  getLevelInfo,
  getCharacterClass,
  getQuests,
  getSeason,
  DISTRICTS,
} from './gamification'
import type { PointsStats } from './api'

describe('levels', () => {
  it('starts everyone at level 1 with 0 XP', () => {
    const info = getLevelInfo(0)
    expect(info.level).toBe(1)
    expect(info.xpIntoLevel).toBe(0)
    expect(info.progress).toBe(0)
  })

  it('xpForLevel matches the inverse used by getLevelInfo', () => {
    for (const lvl of [2, 3, 5, 10, 20]) {
      const threshold = xpForLevel(lvl)
      // Exactly at the threshold => that level, with no progress yet.
      expect(getLevelInfo(threshold).level).toBe(lvl)
      // One XP below the threshold => previous level.
      expect(getLevelInfo(threshold - 1).level).toBe(lvl - 1)
    }
  })

  it('clamps negative / NaN XP to level 1', () => {
    expect(getLevelInfo(-500).level).toBe(1)
    expect(getLevelInfo(NaN).level).toBe(1)
  })

  it('reports sane progress inside a level', () => {
    const info = getLevelInfo(150) // between lvl2 (100) and lvl3 (400)
    expect(info.level).toBe(2)
    expect(info.progress).toBeGreaterThan(0)
    expect(info.progress).toBeLessThan(100)
    expect(info.xpToNext).toBe(xpForLevel(3) - 150)
  })
})

describe('character class', () => {
  it('maps low XP to the starter class and high XP to sovereign', () => {
    expect(getCharacterClass(0).tier.id).toBe('bronze')
    expect(getCharacterClass(0).title).toBe('Sakura Squire')
    expect(getCharacterClass(1_000_000).tier.id).toBe('diamond')
    expect(getCharacterClass(1_000_000).title).toBe('Realm Sovereign')
  })
})

describe('quests', () => {
  const baseStats: PointsStats = {
    totalPoints: 0,
    currentStreak: 0,
    longestStreak: 0,
    lastCheckin: null,
    canCheckin: true,
    rank: undefined,
  }

  it('returns a quest for every definition', () => {
    expect(getQuests(undefined).length).toBeGreaterThan(0)
    expect(getQuests(baseStats).length).toBe(getQuests(undefined).length)
  })

  it('marks the shrine check-in complete once the user has checked in', () => {
    const open = getQuests({ ...baseStats, canCheckin: true })
    const done = getQuests({ ...baseStats, canCheckin: false })
    expect(open.find((q) => q.id === 'daily-checkin')?.complete).toBe(false)
    expect(done.find((q) => q.id === 'daily-checkin')?.complete).toBe(true)
  })

  it('tracks the 7-day streak quest progress', () => {
    const q = getQuests({ ...baseStats, currentStreak: 3 }).find((x) => x.id === 'weekly-streak')!
    expect(q.current).toBe(3)
    expect(q.target).toBe(7)
    expect(q.complete).toBe(false)
    const maxed = getQuests({ ...baseStats, currentStreak: 9 }).find((x) => x.id === 'weekly-streak')!
    expect(maxed.current).toBe(7)
    expect(maxed.complete).toBe(true)
  })
})

describe('realm map', () => {
  it('every district has a route and unlock level', () => {
    for (const d of DISTRICTS) {
      expect(d.path.startsWith('/')).toBe(true)
      expect(d.unlockLevel).toBeGreaterThanOrEqual(1)
    }
  })
})

describe('season', () => {
  it('rotates with the calendar', () => {
    expect(getSeason(new Date('2026-04-01')).name).toBe('Cherry Blossom')
    expect(getSeason(new Date('2026-07-01')).name).toBe('Summer Festival')
    expect(getSeason(new Date('2026-10-01')).name).toBe('Autumn Harvest')
    expect(getSeason(new Date('2026-01-01')).name).toBe('Winter Bloom')
  })
})
