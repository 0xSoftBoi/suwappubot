export interface Tier {
  id: string
  name: string
  emoji: string
  xpRequired: number
  feeRate: number
  color: string
  gradientFrom: string
  gradientTo: string
}

export const TIERS: Tier[] = [
  {
    id: 'bronze',
    name: 'Bronze',
    emoji: '🥉',
    xpRequired: 0,
    feeRate: 0.8,
    color: 'text-amber-700',
    gradientFrom: 'from-amber-600',
    gradientTo: 'to-amber-800',
  },
  {
    id: 'silver',
    name: 'Silver',
    emoji: '🥈',
    xpRequired: 1000,
    feeRate: 0.7,
    color: 'text-gray-500',
    gradientFrom: 'from-gray-400',
    gradientTo: 'to-gray-600',
  },
  {
    id: 'gold',
    name: 'Gold',
    emoji: '🥇',
    xpRequired: 5000,
    feeRate: 0.6,
    color: 'text-yellow-500',
    gradientFrom: 'from-yellow-400',
    gradientTo: 'to-yellow-600',
  },
  {
    id: 'platinum',
    name: 'Platinum',
    emoji: '💎',
    xpRequired: 25000,
    feeRate: 0.5,
    color: 'text-cyan-400',
    gradientFrom: 'from-cyan-300',
    gradientTo: 'to-cyan-500',
  },
  {
    id: 'diamond',
    name: 'Diamond',
    emoji: '👑',
    xpRequired: 100000,
    feeRate: 0.4,
    color: 'text-purple-400',
    gradientFrom: 'from-purple-400',
    gradientTo: 'to-pink-500',
  },
]

export function getTierByXp(xp: number): Tier {
  for (let i = TIERS.length - 1; i >= 0; i--) {
    if (xp >= TIERS[i].xpRequired) {
      return TIERS[i]
    }
  }
  return TIERS[0]
}

export function getNextTier(currentTier: Tier): Tier | null {
  const index = TIERS.findIndex(t => t.id === currentTier.id)
  return index < TIERS.length - 1 ? TIERS[index + 1] : null
}

export function formatXp(xp: number): string {
  if (xp >= 1000) {
    return `${(xp / 1000).toFixed(xp >= 10000 ? 0 : 1)}k`
  }
  return xp.toString()
}
