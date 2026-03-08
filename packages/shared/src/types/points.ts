/**
 * Points, XP, and gamification types
 */

export interface UserPointsInfo {
  points: number
  spendablePoints: number
  xp: number
  level: string
  levelEmoji: string
  feeDiscount: number
  nextLevel?: string
  xpToNextLevel?: number
  dailyStreak: number
  longestStreak: number
  lastCheckinAt?: string
  canCheckin: boolean
}

export interface Milestone {
  id: string
  name: string
  description: string
  emoji: string
  requirement: number
  currentProgress: number
  isAchieved: boolean
  achievedAt?: string
  pointsReward: number
}

export interface Reward {
  id: number
  name: string
  description: string
  cost: number
  rewardType: 'fee_discount' | 'gas_rebate' | 'raffle_entry' | 'custom'
  rewardValue: string
  isAvailable: boolean
}

export interface PointTransaction {
  id: number
  amount: number
  type: 'earned' | 'spent' | 'bonus'
  reason: string
  createdAt: string
}

export interface LeaderboardEntry {
  rank: number
  userId: number
  username?: string
  displayName?: string
  xp: number
  level: string
  levelEmoji: string
}

export const LEVELS: Record<string, { minXp: number; feePercent: number; emoji: string }> = {
  Bronze: { minXp: 0, feePercent: 0.8, emoji: '🥉' },
  Silver: { minXp: 1000, feePercent: 0.7, emoji: '🥈' },
  Gold: { minXp: 5000, feePercent: 0.6, emoji: '🥇' },
  Platinum: { minXp: 25000, feePercent: 0.5, emoji: '💎' },
  Diamond: { minXp: 100000, feePercent: 0.4, emoji: '👑' },
}
