import { useStats, useSwaps } from '../hooks/useAdminApi'
import StatCard from '../components/StatCard'
import GlassCard from '../components/layout/GlassCard'
import LoadingSpinner from '../components/LoadingSpinner'
import Badge, { statusBadgeVariant } from '../components/Badge'

export default function OverviewPage() {
  const { data: stats, isLoading: statsLoading } = useStats()
  const { data: recentSwaps, isLoading: swapsLoading } = useSwaps({ limit: 5 })

  if (statsLoading) return <LoadingSpinner />

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-heading font-bold dark:text-dark-text">Overview</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Agents" value={stats?.agents.total ?? 0} color="purple" />
        <StatCard label="Active Agents" value={stats?.agents.active ?? 0} color="success" />
        <StatCard label="Total Swaps" value={stats?.swaps.total ?? 0} color="magenta" />
        <StatCard label="Swaps (24h)" value={stats?.swaps.last_24h ?? 0} color="info" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <GlassCard className="p-5">
          <h3 className="text-sm font-semibold text-suwappu-text-secondary dark:text-gray-400 uppercase tracking-wider mb-3">
            Webhook Status
          </h3>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-2xl font-heading font-bold text-green-500">{stats?.webhooks.delivered ?? 0}</p>
              <p className="text-xs text-suwappu-text-secondary dark:text-gray-400">Delivered</p>
            </div>
            <div>
              <p className="text-2xl font-heading font-bold text-amber-500">{stats?.webhooks.pending ?? 0}</p>
              <p className="text-xs text-suwappu-text-secondary dark:text-gray-400">Pending</p>
            </div>
            <div>
              <p className="text-2xl font-heading font-bold text-red-500">{stats?.webhooks.failed ?? 0}</p>
              <p className="text-xs text-suwappu-text-secondary dark:text-gray-400">Failed</p>
            </div>
          </div>
        </GlassCard>

        <GlassCard className="p-5">
          <h3 className="text-sm font-semibold text-suwappu-text-secondary dark:text-gray-400 uppercase tracking-wider mb-3">
            Recent Swaps
          </h3>
          {swapsLoading ? (
            <p className="text-sm text-suwappu-text-secondary">Loading...</p>
          ) : recentSwaps?.swaps.length === 0 ? (
            <p className="text-sm text-suwappu-text-secondary dark:text-gray-400">No swaps yet</p>
          ) : (
            <div className="space-y-2">
              {recentSwaps?.swaps.map((s) => (
                <div key={s.id} className="flex items-center justify-between text-sm">
                  <span className="font-mono text-xs dark:text-dark-text">
                    {s.from_amount} {s.from_token} → {s.to_token}
                  </span>
                  <Badge label={s.status || 'unknown'} variant={statusBadgeVariant(s.status)} />
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      </div>
    </div>
  )
}
