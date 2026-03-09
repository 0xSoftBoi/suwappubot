import { useCheckin } from '../../hooks/usePoints'
import toast from 'react-hot-toast'

interface StreakTrackerProps {
  streak: number
  longestStreak: number
  lastCheckin: string | null
}

function hasCheckedInToday(lastCheckin: string | null): boolean {
  if (!lastCheckin) return false
  const last = new Date(lastCheckin)
  const now = new Date()
  return (
    last.getUTCFullYear() === now.getUTCFullYear() &&
    last.getUTCMonth() === now.getUTCMonth() &&
    last.getUTCDate() === now.getUTCDate()
  )
}

export function StreakTracker({ streak, longestStreak, lastCheckin }: StreakTrackerProps) {
  const checkinMutation = useCheckin()
  const alreadyCheckedIn = hasCheckedInToday(lastCheckin)

  const handleCheckin = () => {
    if (alreadyCheckedIn) return
    checkinMutation.mutate(undefined, {
      onSuccess: (data) => {
        toast.success(`+${data.xpEarned} XP! Streak: ${data.newStreak} days`)
      },
      onError: () => {
        toast.error('Check-in failed')
      },
    })
  }

  return (
    <div className="flex flex-col gap-3" data-testid="streak-tracker">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex flex-col">
            <span className="text-xs text-terminal-text-secondary uppercase tracking-wider">Current Streak</span>
            <span className="font-mono text-2xl font-bold text-sakura-400">
              {streak}
              <span className="text-sm text-terminal-text-secondary ml-1">days</span>
            </span>
          </div>
          <div className="w-px h-8 bg-terminal-border" />
          <div className="flex flex-col">
            <span className="text-xs text-terminal-text-secondary uppercase tracking-wider">Longest</span>
            <span className="font-mono text-2xl font-bold text-terminal-text">
              {longestStreak}
              <span className="text-sm text-terminal-text-secondary ml-1">days</span>
            </span>
          </div>
        </div>

        <button
          onClick={handleCheckin}
          disabled={alreadyCheckedIn || checkinMutation.isPending}
          className={`terminal-button text-sm ${
            alreadyCheckedIn
              ? 'bg-terminal-bg-tertiary text-terminal-text-muted cursor-not-allowed opacity-60'
              : ''
          }`}
        >
          {checkinMutation.isPending
            ? 'Checking in...'
            : alreadyCheckedIn
              ? 'Checked In'
              : 'Daily Check-in'}
        </button>
      </div>

      {/* Streak flame visualization */}
      <div className="flex items-center gap-1">
        {Array.from({ length: 7 }).map((_, i) => (
          <div
            key={i}
            className={`h-2 flex-1 rounded-full transition-colors ${
              i < Math.min(streak, 7)
                ? 'bg-sakura-500'
                : 'bg-terminal-bg'
            }`}
          />
        ))}
      </div>
    </div>
  )
}
