/**
 * TierDisplay: Current Tier Hero + Compact List
 * Large current tier display with expandable tier list below
 */

import { useState } from 'react'
import { TIERS, formatXp, getTierByXp, getNextTier } from './TierCard'

export interface TierDisplayProps {
  currentXp?: number
}

export function TierDisplay({ currentXp = 0 }: TierDisplayProps) {
  const [expanded, setExpanded] = useState(false)
  const currentTier = getTierByXp(currentXp)
  const nextTier = getNextTier(currentTier)

  const progressToNext = nextTier
    ? ((currentXp - currentTier.xpRequired) / (nextTier.xpRequired - currentTier.xpRequired)) * 100
    : 100

  return (
    <div className="space-y-3">
      {/* Hero card - current tier */}
      <div className={`relative overflow-hidden rounded-suwappu-xl p-5 bg-gradient-to-br ${currentTier.gradientFrom} ${currentTier.gradientTo} text-white shadow-suwappu-3`}>
        {/* Decorative circles */}
        <div className="absolute -top-10 -right-10 w-32 h-32 bg-white/10 rounded-full" />
        <div className="absolute -bottom-8 -left-8 w-24 h-24 bg-white/10 rounded-full" />

        <div className="relative">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <span className="text-4xl">{currentTier.emoji}</span>
              <div>
                <p className="text-white/70 text-xs">Current Tier</p>
                <h3 className="font-heading font-bold text-xl">{currentTier.name}</h3>
              </div>
            </div>
            <div className="text-right">
              <p className="text-white/70 text-xs">Your Fee Rate</p>
              <p className="font-heading font-bold text-2xl">{currentTier.feeRate}%</p>
            </div>
          </div>

          {nextTier && (
            <div className="bg-white/20 rounded-suwappu-lg p-3">
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="text-white/80">Progress to {nextTier.emoji} {nextTier.name}</span>
                <span className="font-semibold">{Math.round(progressToNext)}%</span>
              </div>
              <div className="h-2 bg-white/30 rounded-full overflow-hidden">
                <div
                  className="h-full bg-white transition-all duration-500"
                  style={{ width: `${progressToNext}%` }}
                />
              </div>
              <div className="flex items-center justify-between mt-2 text-xs text-white/70">
                <span>{formatXp(currentXp)} XP</span>
                <span>{formatXp(nextTier.xpRequired)} XP needed</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Expandable tier list */}
      <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 overflow-hidden">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between p-3 hover:bg-suwappu-sakura-light/20 transition-colors"
        >
          <span className="font-heading font-semibold text-sm text-suwappu-purple-deep">
            All Tiers & Benefits
          </span>
          <svg
            className={`w-5 h-5 text-suwappu-text-secondary transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {expanded && (
          <div className="border-t border-suwappu-sakura-mid/20">
            {TIERS.map((tier) => {
              const isUnlocked = currentXp >= tier.xpRequired
              const isCurrent = tier.id === currentTier.id

              return (
                <div
                  key={tier.id}
                  className={`flex items-center gap-3 p-3 border-b border-suwappu-sakura-mid/10 last:border-b-0 ${
                    isCurrent ? 'bg-suwappu-sakura-light/30' : ''
                  } ${!isUnlocked ? 'opacity-50' : ''}`}
                >
                  <span className="text-xl">{tier.emoji}</span>
                  <div className="flex-1">
                    <span className={`font-heading font-semibold text-sm ${tier.color}`}>
                      {tier.name}
                    </span>
                    <span className="text-xs text-suwappu-text-secondary ml-2">
                      {tier.xpRequired > 0 ? `${formatXp(tier.xpRequired)} XP` : 'Default'}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="font-heading font-bold text-sm text-suwappu-success">
                      {tier.feeRate}%
                    </span>
                    {isCurrent && (
                      <span className="block text-[9px] text-suwappu-magenta-mid">Current</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
