/**
 * ChampionsBoard — leaderboard reframed as the realm's champions, each ranked
 * by their adventurer level (derived from points). Top 3 wear crowns.
 */

import { getLevelInfo, getCharacterClass, formatXp } from '../../lib/gamification'
import type { LeaderboardEntry } from '../../lib/api'

interface ChampionsBoardProps {
  entries: LeaderboardEntry[]
  loading?: boolean
}

const RANK_BADGE = ['👑', '🥈', '🥉']

function displayName(e: LeaderboardEntry): string {
  return e.firstName || e.username || `Wanderer #${e.userId}`
}

export function ChampionsBoard({ entries, loading }: ChampionsBoardProps) {
  return (
    <div className="overflow-hidden rounded-suwappu-xl bg-white shadow-suwappu-1">
      <div className="border-b border-suwappu-sakura-mid/10 px-3 py-2.5">
        <span className="font-heading text-sm font-semibold text-suwappu-purple-deep">
          🏆 Champions of the Realm
        </span>
      </div>

      {loading ? (
        <div className="space-y-2 p-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded-suwappu-lg bg-suwappu-sakura-light/40" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <p className="p-6 text-center text-xs text-suwappu-text-secondary">
          No champions yet — be the first to rise. 🌸
        </p>
      ) : (
        <div className="divide-y divide-suwappu-sakura-mid/10">
          {entries.map((e) => {
            const level = getLevelInfo(e.totalPoints)
            const cls = getCharacterClass(e.totalPoints)
            return (
              <div key={e.userId} className="flex items-center gap-3 p-2.5">
                <span className="w-6 shrink-0 text-center text-sm font-bold text-suwappu-text-secondary">
                  {RANK_BADGE[e.rank - 1] ?? e.rank}
                </span>
                <span className="text-xl">{cls.avatar}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-heading text-sm font-semibold text-suwappu-purple-deep">
                    {displayName(e)}
                  </p>
                  <p className="text-[10px] text-suwappu-text-secondary">
                    Lv {level.level} · {cls.title}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-heading text-sm font-bold text-suwappu-magenta-mid">
                    💰 {formatXp(e.totalPoints)}
                  </p>
                  <p className="text-[10px] text-suwappu-text-secondary">🔥 {e.currentStreak}</p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
