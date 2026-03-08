/**
 * Referral system types
 */

export interface ReferralCode {
  code: string
  timesUsed: number
  totalRewards: number
  createdAt: string
}

export interface ReferralStats {
  code: string
  totalReferrals: number
  activeReferrals: number
  totalVolume: number
  totalRewards: number
  unpaidRewards: number
}

export interface Referral {
  id: number
  refereeId: number
  refereeUsername?: string
  refereeJoinedAt: string
  totalVolume: number
  totalRewards: number
}

export interface ReferralReward {
  id: number
  amount: number
  chain: string
  token: string
  isPaid: boolean
  paidAt?: string
  createdAt: string
}
