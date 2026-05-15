import { useMilestones } from '../../hooks/usePoints'
import type { Milestone } from '../../types/api'

function MilestoneCard({ milestone }: { milestone: Milestone }) {
  const progressPct = Math.min((milestone.progress / milestone.target) * 100, 100)

  return (
    <div
      className={`terminal-panel p-4 flex flex-col gap-3 transition-colors ${
        milestone.completed ? 'border-sakura-600/30' : ''
      }`}
      data-testid="milestone-card"
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">{milestone.icon}</span>
          <div className="flex flex-col">
            <span className="text-sm font-medium text-terminal-text">{milestone.title}</span>
            <span className="text-xs text-terminal-text-muted">{milestone.description}</span>
          </div>
        </div>
        {milestone.completed && (
          <span className="text-sakura-400 text-lg" title="Completed">{'\u2713'}</span>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex justify-between text-xs font-mono">
          <span className="text-terminal-text-secondary">
            {milestone.progress}/{milestone.target}
          </span>
          <span className="text-sakura-400">+{milestone.xpReward} XP</span>
        </div>
        <div className="h-1.5 rounded-full bg-terminal-bg overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${progressPct}%`,
              background: milestone.completed
                ? 'linear-gradient(90deg, #FF839B, #E66D85)'
                : 'linear-gradient(90deg, #55556a, #8888a0)',
            }}
          />
        </div>
      </div>
    </div>
  )
}

export function MilestoneWall() {
  const { data: milestones } = useMilestones()
  const items = milestones ?? []

  const completed = items.filter(m => m.completed).length

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-terminal-text-secondary">
          {completed}/{items.length} completed
        </span>
        <span className="font-mono text-xs text-sakura-400">
          +{items.filter(m => m.completed).reduce((sum, m) => sum + m.xpReward, 0).toLocaleString()} XP earned
        </span>
      </div>
      {items.length === 0 ? (
        <div className="terminal-panel p-6 text-center text-sm text-terminal-text-muted">
          Milestones are not connected yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map(m => (
            <MilestoneCard key={m.id} milestone={m} />
          ))}
        </div>
      )}
    </div>
  )
}
