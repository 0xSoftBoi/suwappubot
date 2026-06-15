/**
 * Gamification core — turns Suwappu's XP / points / streak / tier data into an
 * RPG-style "Sakura Realm" layer (DeFi-Kingdoms-inspired, sakura-themed).
 *
 * One number drives everything: the player's lifetime points (`totalPoints`),
 * treated as XP. From it we derive an adventurer Level and a Tier "class".
 */

import { TIERS, getTierByXp, getNextTier, formatXp, type Tier } from '../components/tiers/TierCard'
import type { PointsStats } from './api'

// ---------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------

/** Cumulative XP required to *reach* a given level (level 1 = 0 XP). */
export function xpForLevel(level: number): number {
  if (level <= 1) return 0
  // Gentle quadratic curve: lvl 2 = 100, lvl 5 = 1.6k, lvl 10 = 8.1k, lvl 20 = 36.1k
  return Math.round(100 * Math.pow(level - 1, 2))
}

export interface LevelInfo {
  level: number
  /** XP accumulated inside the current level. */
  xpIntoLevel: number
  /** XP span of the current level (next threshold − current threshold). */
  xpForThisLevel: number
  /** XP still needed to hit the next level. */
  xpToNext: number
  /** 0–100 progress through the current level. */
  progress: number
}

export function getLevelInfo(xp: number): LevelInfo {
  const safeXp = Math.max(0, Math.floor(xp || 0))
  // Invert the curve: level = floor(sqrt(xp / 100)) + 1
  const level = Math.floor(Math.sqrt(safeXp / 100)) + 1
  const floor = xpForLevel(level)
  const ceil = xpForLevel(level + 1)
  const xpForThisLevel = ceil - floor
  const xpIntoLevel = safeXp - floor
  return {
    level,
    xpIntoLevel,
    xpForThisLevel,
    xpToNext: Math.max(0, ceil - safeXp),
    progress: xpForThisLevel > 0 ? Math.min(100, (xpIntoLevel / xpForThisLevel) * 100) : 100,
  }
}

// ---------------------------------------------------------------------------
// Character classes (mapped from Tier)
// ---------------------------------------------------------------------------

export interface CharacterClass {
  tierId: Tier['id']
  /** RPG class name shown under the avatar. */
  title: string
  /** Big avatar emoji for the hero card. */
  avatar: string
  /** Short flavour line. */
  flavor: string
}

const CLASS_BY_TIER: Record<string, Omit<CharacterClass, 'tierId'>> = {
  bronze: { title: 'Sakura Squire', avatar: '🌱', flavor: 'A budding trader, fresh to the realm.' },
  silver: { title: 'Petal Ranger', avatar: '🍃', flavor: 'Swift of hand, quick to the trade.' },
  gold: { title: 'Blossom Knight', avatar: '🌸', flavor: 'Sworn to the swap, feared in the markets.' },
  platinum: { title: 'Frost Sage', avatar: '❄️', flavor: 'Master of fees, reader of the chains.' },
  diamond: { title: 'Realm Sovereign', avatar: '👑', flavor: 'Ruler of the Sakura Realm.' },
}

export function getCharacterClass(xp: number): CharacterClass & { tier: Tier } {
  const tier = getTierByXp(xp)
  const base = CLASS_BY_TIER[tier.id] ?? CLASS_BY_TIER.bronze
  return { tierId: tier.id, tier, ...base }
}

export { TIERS, getTierByXp, getNextTier, formatXp }
export type { Tier }

// ---------------------------------------------------------------------------
// Quests
// ---------------------------------------------------------------------------

export type QuestKind = 'daily' | 'weekly' | 'saga'

export interface QuestDef {
  id: string
  kind: QuestKind
  icon: string
  title: string
  description: string
  /** XP/points reward shown on the quest. */
  reward: number
  /** Route to send the adventurer to (CTA), if any. */
  path?: string
  /** Special action handled by the page (e.g. daily check-in). */
  action?: 'checkin'
}

export interface QuestState extends QuestDef {
  current: number
  target: number
  complete: boolean
  /** 0–100. */
  progress: number
  /** CTA label. */
  cta: string
}

const QUESTS: QuestDef[] = [
  {
    id: 'daily-checkin',
    kind: 'daily',
    icon: '⛩️',
    title: 'Visit the Shrine',
    description: 'Check in at the shrine to claim your daily blessing.',
    reward: 50,
    action: 'checkin',
  },
  {
    id: 'daily-swap',
    kind: 'daily',
    icon: '⚔️',
    title: 'Slay a Trade',
    description: 'Complete a swap in the Marketplace.',
    reward: 75,
    path: '/swap',
  },
  {
    id: 'weekly-streak',
    kind: 'weekly',
    icon: '🔥',
    title: 'Keep the Flame',
    description: 'Hold a 7-day check-in streak.',
    reward: 300,
    action: 'checkin',
  },
  {
    id: 'weekly-rank',
    kind: 'weekly',
    icon: '📈',
    title: 'Ascend the Ranks',
    description: 'Earn XP toward your next tier.',
    reward: 250,
    path: '/points',
  },
  {
    id: 'saga-refer',
    kind: 'saga',
    icon: '🤝',
    title: 'Rally the Guild',
    description: 'Invite a friend to join the realm.',
    reward: 500,
    path: '/referrals',
  },
  {
    id: 'saga-alert',
    kind: 'saga',
    icon: '🔮',
    title: 'Consult the Oracle',
    description: 'Set a price alert to watch the markets.',
    reward: 150,
    path: '/alerts',
  },
]

/**
 * Resolve live quest state from the player's points stats. Quests that we can
 * verify from available data (check-in, streak, tier progress) report real
 * progress; action quests are presented as actionable journeys.
 */
export function getQuests(stats: PointsStats | undefined): QuestState[] {
  const xp = stats?.totalPoints ?? 0
  const streak = stats?.currentStreak ?? 0
  const checkedInToday = stats ? !stats.canCheckin : false
  const tier = getTierByXp(xp)
  const next = getNextTier(tier)
  const tierProgress = next
    ? ((xp - tier.xpRequired) / (next.xpRequired - tier.xpRequired)) * 100
    : 100

  return QUESTS.map((q): QuestState => {
    switch (q.id) {
      case 'daily-checkin': {
        const complete = checkedInToday
        return {
          ...q,
          current: complete ? 1 : 0,
          target: 1,
          complete,
          progress: complete ? 100 : 0,
          cta: complete ? 'Blessed today' : 'Check in',
        }
      }
      case 'weekly-streak': {
        const current = Math.min(streak, 7)
        const complete = current >= 7
        return {
          ...q,
          current,
          target: 7,
          complete,
          progress: (current / 7) * 100,
          cta: complete ? 'Flame held' : 'Check in',
        }
      }
      case 'weekly-rank': {
        const complete = !next
        return {
          ...q,
          current: Math.round(tierProgress),
          target: 100,
          complete,
          progress: Math.min(100, tierProgress),
          cta: complete ? 'Max tier' : 'Earn XP',
        }
      }
      default:
        return {
          ...q,
          current: 0,
          target: 1,
          complete: false,
          progress: 0,
          cta: 'Begin',
        }
    }
  })
}

// ---------------------------------------------------------------------------
// Realm districts (the "world map")
// ---------------------------------------------------------------------------

export interface District {
  id: string
  name: string
  /** What it really is, in plain terms. */
  subtitle: string
  icon: string
  path: string
  /** Tailwind gradient classes for the tile. */
  gradientFrom: string
  gradientTo: string
  /** Flavour level gate (display only — never blocks navigation). */
  unlockLevel: number
}

export const DISTRICTS: District[] = [
  {
    id: 'marketplace',
    name: 'Marketplace',
    subtitle: 'Swap tokens',
    icon: '⚔️',
    path: '/swap',
    gradientFrom: 'from-rose-400',
    gradientTo: 'to-pink-600',
    unlockLevel: 1,
  },
  {
    id: 'treasury',
    name: 'Treasury',
    subtitle: 'Your wallet',
    icon: '🏰',
    path: '/wallet',
    gradientFrom: 'from-amber-400',
    gradientTo: 'to-orange-600',
    unlockLevel: 1,
  },
  {
    id: 'garden',
    name: 'Zen Garden',
    subtitle: 'Auto-invest (DCA)',
    icon: '🌿',
    path: '/dca',
    gradientFrom: 'from-emerald-400',
    gradientTo: 'to-green-600',
    unlockLevel: 2,
  },
  {
    id: 'oracle',
    name: 'Oracle Temple',
    subtitle: 'Prediction markets',
    icon: '🔮',
    path: '/predict',
    gradientFrom: 'from-violet-400',
    gradientTo: 'to-purple-600',
    unlockLevel: 3,
  },
  {
    id: 'arena',
    name: 'Battle Arena',
    subtitle: 'Perps trading',
    icon: '🥋',
    path: '/perps',
    gradientFrom: 'from-red-400',
    gradientTo: 'to-rose-700',
    unlockLevel: 4,
  },
  {
    id: 'guild',
    name: 'Guild Hall',
    subtitle: 'Referrals',
    icon: '🤝',
    path: '/referrals',
    gradientFrom: 'from-cyan-400',
    gradientTo: 'to-blue-600',
    unlockLevel: 2,
  },
  {
    id: 'watchtower',
    name: 'Watchtower',
    subtitle: 'Price alerts',
    icon: '🗼',
    path: '/alerts',
    gradientFrom: 'from-sky-400',
    gradientTo: 'to-indigo-600',
    unlockLevel: 1,
  },
  {
    id: 'hall',
    name: 'Hall of Fame',
    subtitle: 'Leaderboard & rewards',
    icon: '🏆',
    path: '/points',
    gradientFrom: 'from-yellow-400',
    gradientTo: 'to-amber-600',
    unlockLevel: 1,
  },
]

// ---------------------------------------------------------------------------
// Season
// ---------------------------------------------------------------------------

export interface Season {
  name: string
  emoji: string
}

/** A light flavour "season" that rotates with the calendar. */
export function getSeason(date = new Date()): Season {
  const m = date.getMonth()
  if (m <= 1 || m === 11) return { name: 'Winter Bloom', emoji: '❄️' }
  if (m <= 4) return { name: 'Cherry Blossom', emoji: '🌸' }
  if (m <= 7) return { name: 'Summer Festival', emoji: '🎐' }
  return { name: 'Autumn Harvest', emoji: '🍁' }
}
