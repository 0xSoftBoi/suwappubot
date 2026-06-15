/**
 * AdventurerCard — the player's RPG hero panel.
 * Shows class/avatar (from tier), Level + XP ring, streak flame, gold (points),
 * realm rank, and progress to the next level. Driven by real PointsStats.
 */

import { motion } from 'framer-motion'
import { getLevelInfo, getCharacterClass, getNextTier, formatXp } from '../../lib/gamification'
import { FloatingPetals } from './FloatingPetals'
import type { PointsStats } from '../../lib/api'

interface AdventurerCardProps {
  stats?: PointsStats
  name?: string
  season?: { name: string; emoji: string }
}

function Stat({ icon, value, label }: { icon: string; value: string; label: string }) {
  return (
    <div className="flex-1 rounded-suwappu-lg bg-white/15 px-2 py-2 text-center backdrop-blur-sm">
      <p className="text-base font-heading font-bold leading-none">
        {icon} {value}
      </p>
      <p className="mt-1 text-[10px] uppercase tracking-wide text-white/70">{label}</p>
    </div>
  )
}

export function AdventurerCard({ stats, name = 'Adventurer', season }: AdventurerCardProps) {
  const xp = stats?.totalPoints ?? 0
  const level = getLevelInfo(xp)
  const cls = getCharacterClass(xp)
  const next = getNextTier(cls.tier)

  return (
    <div
      className={`relative overflow-hidden rounded-suwappu-xl bg-gradient-to-br ${cls.tier.gradientFrom} ${cls.tier.gradientTo} p-4 text-white shadow-suwappu-3`}
    >
      <FloatingPetals count={8} />
      {/* decorative glows */}
      <div className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-white/10" />
      <div className="pointer-events-none absolute -bottom-10 -left-10 h-28 w-28 rounded-full bg-white/10" />

      {season && (
        <div className="relative mb-3 inline-flex items-center gap-1 rounded-suwappu-pill bg-black/20 px-2.5 py-1 text-[11px] font-semibold backdrop-blur-sm">
          <span>{season.emoji}</span>
          <span>Season · {season.name}</span>
        </div>
      )}

      <div className="relative flex items-center gap-4">
        {/* Avatar with level ring */}
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 220, damping: 16 }}
          className="relative flex h-20 w-20 shrink-0 items-center justify-center"
        >
          <svg className="absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="44" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="7" />
            <motion.circle
              cx="50"
              cy="50"
              r="44"
              fill="none"
              stroke="white"
              strokeWidth="7"
              strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 44}
              initial={{ strokeDashoffset: 2 * Math.PI * 44 }}
              animate={{ strokeDashoffset: 2 * Math.PI * 44 * (1 - level.progress / 100) }}
              transition={{ duration: 0.9, ease: 'easeOut' }}
            />
          </svg>
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/20 text-3xl backdrop-blur-sm">
            {cls.avatar}
          </div>
          <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-suwappu-pill bg-white px-2 py-0.5 text-[10px] font-heading font-bold text-suwappu-purple-deep shadow">
            Lv {level.level}
          </span>
        </motion.div>

        <div className="min-w-0 flex-1">
          <p className="truncate font-heading text-lg font-bold leading-tight">{name}</p>
          <p className="text-sm text-white/80">
            {cls.tier.emoji} {cls.title}
          </p>
          {/* XP bar */}
          <div className="mt-2">
            <div className="mb-1 flex items-center justify-between text-[11px] text-white/80">
              <span>{formatXp(level.xpIntoLevel)} / {formatXp(level.xpForThisLevel)} XP</span>
              <span>{level.xpToNext > 0 ? `${formatXp(level.xpToNext)} to Lv ${level.level + 1}` : 'MAX'}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/25">
              <motion.div
                className="h-full rounded-full bg-white"
                initial={{ width: 0 }}
                animate={{ width: `${level.progress}%` }}
                transition={{ duration: 0.9, ease: 'easeOut' }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="relative mt-4 flex gap-2">
        <Stat icon="🔥" value={String(stats?.currentStreak ?? 0)} label="Streak" />
        <Stat icon="💰" value={formatXp(xp)} label="Gold" />
        <Stat icon="🏅" value={stats?.rank ? `#${stats.rank}` : '—'} label="Realm Rank" />
      </div>

      {next && (
        <p className="relative mt-3 text-center text-[11px] text-white/75">
          {formatXp(next.xpRequired - xp)} XP until {next.emoji} {next.name} class · {next.feeRate}% fees
        </p>
      )}
    </div>
  )
}
