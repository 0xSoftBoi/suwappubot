/**
 * RealmBanner — compact entry point to the Sakura Realm, shown on Home.
 * Surfaces the player's level + a daily-quest nudge and routes to /realm.
 */

import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '../../lib/api'
import { getLevelInfo, getCharacterClass, getQuests } from '../../lib/gamification'
import { FloatingPetals } from './FloatingPetals'

export function RealmBanner() {
  const navigate = useNavigate()
  const { data: stats } = useQuery({
    queryKey: ['points', 'stats'],
    queryFn: () => api.getPointsStats(),
  })

  const xp = stats?.totalPoints ?? 0
  const level = getLevelInfo(xp)
  const cls = getCharacterClass(xp)
  const openQuests = getQuests(stats).filter((q) => !q.complete).length

  return (
    <button
      onClick={() => navigate('/realm')}
      className={`relative w-full overflow-hidden rounded-suwappu-xl bg-gradient-to-br ${cls.tier.gradientFrom} ${cls.tier.gradientTo} p-3.5 text-left text-white shadow-suwappu-2 active:scale-[0.99] transition-transform`}
    >
      <FloatingPetals count={6} />
      <div className="relative flex items-center gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/20 text-2xl backdrop-blur-sm">
          {cls.avatar}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-heading text-sm font-bold leading-tight">
            Enter the Sakura Realm 🌸
          </p>
          <p className="text-[11px] text-white/85">
            Lv {level.level} {cls.title}
            {openQuests > 0 ? ` · ${openQuests} quest${openQuests > 1 ? 's' : ''} await` : ' · All quests cleared'}
          </p>
        </div>
        <span className="shrink-0 rounded-suwappu-pill bg-white/90 px-3 py-1.5 text-[11px] font-heading font-bold text-suwappu-purple-deep">
          Play
        </span>
      </div>
    </button>
  )
}
