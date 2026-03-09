import { useMilestones } from '../../hooks/usePoints'
import type { Milestone } from '../../types/api'

const MOCK_MILESTONES: Milestone[] = [
  { id: 'm1', title: 'First Swap', description: 'Complete your first token swap', icon: '\u21C4', category: 'trading', progress: 1, target: 1, completed: true, xpReward: 50, completedAt: '2025-12-01' },
  { id: 'm2', title: 'Swap Master', description: 'Complete 10 swaps', icon: '\u26A1', category: 'trading', progress: 7, target: 10, completed: false, xpReward: 200 },
  { id: 'm3', title: 'Chain Hopper', description: 'Swap on 3 different chains', icon: '\u26D3', category: 'trading', progress: 2, target: 3, completed: false, xpReward: 150 },
  { id: 'm4', title: 'Whale Alert', description: 'Execute a single swap over $1,000', icon: '\u{1F433}', category: 'trading', progress: 1, target: 1, completed: true, xpReward: 300, completedAt: '2025-12-15' },
  { id: 'm5', title: 'Streak Starter', description: 'Maintain a 3-day check-in streak', icon: '\u{1F525}', category: 'engagement', progress: 3, target: 3, completed: true, xpReward: 100, completedAt: '2025-12-05' },
  { id: 'm6', title: 'Streak Legend', description: 'Maintain a 30-day check-in streak', icon: '\u{1F31F}', category: 'engagement', progress: 12, target: 30, completed: false, xpReward: 1000 },
  { id: 'm7', title: 'Portfolio Builder', description: 'Hold 5 different tokens', icon: '\u{1F4BC}', category: 'portfolio', progress: 3, target: 5, completed: false, xpReward: 200 },
  { id: 'm8', title: 'Referral Rookie', description: 'Invite 1 friend', icon: '\u{1F91D}', category: 'social', progress: 0, target: 1, completed: false, xpReward: 100 },
  { id: 'm9', title: 'Social Butterfly', description: 'Invite 10 friends', icon: '\u{1F98B}', category: 'social', progress: 0, target: 10, completed: false, xpReward: 500 },
  { id: 'm10', title: 'Limit Lord', description: 'Set 5 limit orders', icon: '\u{1F4CA}', category: 'trading', progress: 2, target: 5, completed: false, xpReward: 200 },
  { id: 'm11', title: 'DCA Disciple', description: 'Create 3 DCA strategies', icon: '\u{1F504}', category: 'trading', progress: 1, target: 3, completed: false, xpReward: 250 },
  { id: 'm12', title: 'Diamond Hands', description: 'Hold a position for 30 days', icon: '\u{1F48E}', category: 'portfolio', progress: 18, target: 30, completed: false, xpReward: 500 },
]

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
  const items = milestones ?? MOCK_MILESTONES

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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {items.map(m => (
          <MilestoneCard key={m.id} milestone={m} />
        ))}
      </div>
    </div>
  )
}
