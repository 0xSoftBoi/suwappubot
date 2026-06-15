/**
 * QuestBoard — daily / weekly / saga quests derived from live points data.
 * Completed quests show a stamped seal; actionable ones route the player to
 * the relevant feature (or trigger the shrine check-in).
 */

import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import type { QuestState, QuestKind } from '../../lib/gamification'

const KIND_LABEL: Record<QuestKind, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  saga: 'Saga',
}

const KIND_STYLE: Record<QuestKind, string> = {
  daily: 'bg-rose-100 text-rose-600',
  weekly: 'bg-violet-100 text-violet-600',
  saga: 'bg-amber-100 text-amber-700',
}

interface QuestRowProps {
  quest: QuestState
  onCheckin: () => void
  checkinLoading: boolean
}

function QuestRow({ quest, onCheckin, checkinLoading }: QuestRowProps) {
  const navigate = useNavigate()

  const handle = () => {
    if (quest.complete) return
    if (quest.action === 'checkin') {
      onCheckin()
    } else if (quest.path) {
      navigate(quest.path)
    }
  }

  const showBar = quest.target > 1 && !quest.complete

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex items-center gap-3 p-3 ${quest.complete ? 'opacity-70' : ''}`}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-suwappu-lg bg-suwappu-sakura-light/40 text-xl">
        {quest.icon}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-heading text-sm font-semibold text-suwappu-purple-deep">
            {quest.title}
          </span>
          <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase ${KIND_STYLE[quest.kind]}`}>
            {KIND_LABEL[quest.kind]}
          </span>
        </div>
        <p className="truncate text-[11px] text-suwappu-text-secondary">{quest.description}</p>
        {showBar && (
          <div className="mt-1.5 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-suwappu-sakura-light/50">
              <div
                className="h-full rounded-full bg-suwappu-gradient transition-all duration-500"
                style={{ width: `${quest.progress}%` }}
              />
            </div>
            <span className="text-[10px] font-medium text-suwappu-text-secondary">
              {quest.current}/{quest.target}
            </span>
          </div>
        )}
        <p className="mt-1 text-[10px] font-bold text-suwappu-magenta-mid">+{quest.reward} XP</p>
      </div>

      {quest.complete ? (
        <span className="shrink-0 rounded-suwappu-pill bg-suwappu-success/15 px-2.5 py-1 text-[11px] font-bold text-suwappu-success">
          ✓ Done
        </span>
      ) : (
        <button
          onClick={handle}
          disabled={quest.action === 'checkin' && checkinLoading}
          className="shrink-0 rounded-suwappu-pill bg-suwappu-gradient px-3 py-1.5 text-[11px] font-heading font-bold text-white shadow-suwappu-button active:scale-95 disabled:opacity-50"
        >
          {quest.action === 'checkin' && checkinLoading ? '...' : quest.cta}
        </button>
      )}
    </motion.div>
  )
}

interface QuestBoardProps {
  quests: QuestState[]
  onCheckin: () => void
  checkinLoading: boolean
}

export function QuestBoard({ quests, onCheckin, checkinLoading }: QuestBoardProps) {
  const completed = quests.filter((q) => q.complete).length

  return (
    <div className="overflow-hidden rounded-suwappu-xl bg-white shadow-suwappu-1">
      <div className="flex items-center justify-between border-b border-suwappu-sakura-mid/10 px-3 py-2.5">
        <span className="font-heading text-sm font-semibold text-suwappu-purple-deep">
          📜 Quest Board
        </span>
        <span className="text-[11px] font-medium text-suwappu-text-secondary">
          {completed}/{quests.length} cleared
        </span>
      </div>
      <div className="divide-y divide-suwappu-sakura-mid/10">
        {quests.map((q) => (
          <QuestRow key={q.id} quest={q} onCheckin={onCheckin} checkinLoading={checkinLoading} />
        ))}
      </div>
    </div>
  )
}
