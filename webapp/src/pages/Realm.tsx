/**
 * Realm — the gamified home of Suwappu (DeFi-Kingdoms-inspired, sakura-themed).
 *
 * Composes the adventurer hero, quest board, world map and champions board on
 * top of the real points / streak / tier / leaderboard APIs. The daily check-in
 * is a live mutation that fires a celebration.
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AppLayout, AppHeader } from '../components/layout'
import { SuccessCelebration } from '../components/ui'
import { AdventurerCard, QuestBoard, RealmMap, ChampionsBoard } from '../components/realm'
import { useAuth } from '../contexts/AuthContext'
import { useTelegram } from '../hooks/useTelegram'
import { api } from '../lib/api'
import { getLevelInfo, getQuests, getSeason } from '../lib/gamification'
import type { CheckinResult } from '../lib/api'

export function Realm() {
  const queryClient = useQueryClient()
  const { telegramUser } = useAuth()
  const { hapticFeedback } = useTelegram()
  const [celebration, setCelebration] = useState<CheckinResult | null>(null)

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['points', 'stats'],
    queryFn: () => api.getPointsStats(),
  })

  const { data: leaderboard, isLoading: leaderboardLoading } = useQuery({
    queryKey: ['points', 'leaderboard'],
    queryFn: () => api.getLeaderboard(10),
  })

  const checkinMutation = useMutation({
    mutationFn: () => api.dailyCheckin(),
    onSuccess: (result) => {
      hapticFeedback('success')
      setCelebration(result)
      queryClient.invalidateQueries({ queryKey: ['points'] })
    },
    onError: () => hapticFeedback('error'),
  })

  const season = getSeason()
  const quests = getQuests(stats)
  const level = getLevelInfo(stats?.totalPoints ?? 0)
  const playerName =
    telegramUser?.first_name || telegramUser?.username || 'Adventurer'

  const header = <AppHeader title="Sakura Realm" />

  if (statsLoading) {
    return (
      <AppLayout header={header} activeNav="home">
        <div className="space-y-4 p-3 pb-20">
          <div className="h-52 animate-pulse rounded-suwappu-xl bg-suwappu-sakura-light" />
          <div className="h-40 animate-pulse rounded-suwappu-xl bg-suwappu-sakura-light" />
          <div className="h-40 animate-pulse rounded-suwappu-xl bg-suwappu-sakura-light" />
        </div>
      </AppLayout>
    )
  }

  return (
    <AppLayout header={header} activeNav="home">
      <div className="space-y-4 p-3 pb-20">
        <AdventurerCard stats={stats} name={playerName} season={season} />

        <QuestBoard
          quests={quests}
          onCheckin={() => checkinMutation.mutate()}
          checkinLoading={checkinMutation.isPending}
        />

        <RealmMap level={level.level} />

        <ChampionsBoard entries={leaderboard ?? []} loading={leaderboardLoading} />
      </div>

      <SuccessCelebration
        isOpen={!!celebration}
        title={`+${celebration?.pointsAwarded ?? 0} XP claimed!`}
        message={
          celebration
            ? `Day ${celebration.streak} streak${
                celebration.bonusPoints ? ` · +${celebration.bonusPoints} bonus` : ''
              }. The shrine smiles upon you. 🌸`
            : ''
        }
        onClose={() => setCelebration(null)}
        autoCloseDuration={4000}
      />
    </AppLayout>
  )
}
