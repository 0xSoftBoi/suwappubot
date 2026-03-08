import { useState } from 'react'
import { useAgents } from '../hooks/useAdminApi'
import GlassCard from '../components/layout/GlassCard'
import DataTable, { type Column } from '../components/DataTable'
import Pagination from '../components/Pagination'
import Badge, { statusBadgeVariant } from '../components/Badge'
import LoadingSpinner from '../components/LoadingSpinner'
import type { AdminAgent } from '../api/types'

export default function AgentsPage() {
  const [offset, setOffset] = useState(0)
  const [statusFilter, setStatusFilter] = useState('')
  const limit = 20

  const { data, isLoading } = useAgents({ limit, offset, status: statusFilter || undefined })

  const columns: Column<AdminAgent>[] = [
    { key: 'name', header: 'Name', render: (a) => <span className="font-medium dark:text-dark-text">{a.name}</span> },
    {
      key: 'status', header: 'Status',
      render: (a) => <Badge label={a.is_active ? 'active' : 'inactive'} variant={a.is_active ? 'success' : 'neutral'} />,
    },
    { key: 'tier', header: 'Tier', render: (a) => <span className="text-xs">{a.rate_limit_tier}</span> },
    { key: 'requests', header: 'Requests', render: (a) => <span className="font-mono text-xs">{a.total_requests ?? 0}</span> },
    { key: 'swaps', header: 'Swaps', render: (a) => <span className="font-mono text-xs">{a.total_swaps ?? 0}</span> },
    {
      key: 'last_active', header: 'Last Active',
      render: (a) => <span className="text-xs text-suwappu-text-secondary dark:text-gray-400">{a.last_active_at ? new Date(a.last_active_at).toLocaleDateString() : 'Never'}</span>,
    },
    {
      key: 'created', header: 'Created',
      render: (a) => <span className="text-xs text-suwappu-text-secondary dark:text-gray-400">{new Date(a.created_at).toLocaleDateString()}</span>,
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-heading font-bold dark:text-dark-text">Agents</h2>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setOffset(0) }}
          className="px-3 py-2 text-sm bg-white dark:bg-dark-bg border border-suwappu-sakura-light/30 dark:border-dark-border rounded-suwappu-md"
        >
          <option value="">All</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      <GlassCard>
        {isLoading ? (
          <LoadingSpinner />
        ) : (
          <>
            <DataTable columns={columns} data={data?.agents ?? []} keyExtractor={(a) => a.id} emptyMessage="No agents found" />
            {data?.pagination && (
              <Pagination total={data.pagination.total} limit={limit} offset={offset} onPageChange={setOffset} />
            )}
          </>
        )}
      </GlassCard>
    </div>
  )
}
