import { useState } from 'react'
import { useWebhooks } from '../hooks/useAdminApi'
import GlassCard from '../components/layout/GlassCard'
import DataTable, { type Column } from '../components/DataTable'
import Pagination from '../components/Pagination'
import Badge, { statusBadgeVariant } from '../components/Badge'
import LoadingSpinner from '../components/LoadingSpinner'
import type { AdminWebhook } from '../api/types'

export default function WebhooksPage() {
  const [offset, setOffset] = useState(0)
  const [statusFilter, setStatusFilter] = useState('')
  const limit = 20

  const { data, isLoading } = useWebhooks({ limit, offset, status: statusFilter || undefined })

  const columns: Column<AdminWebhook>[] = [
    { key: 'id', header: 'ID', render: (ev) => <span className="font-mono text-xs dark:text-dark-text">#{ev.id}</span> },
    { key: 'event', header: 'Event', render: (ev) => <code className="text-xs dark:text-dark-text">{ev.event_type}</code> },
    {
      key: 'status', header: 'Status',
      render: (ev) => <Badge label={ev.status || 'unknown'} variant={statusBadgeVariant(ev.status)} />,
    },
    { key: 'attempts', header: 'Attempts', render: (ev) => <span className="font-mono text-xs">{ev.attempts ?? 0}</span> },
    { key: 'agent', header: 'Agent', render: (ev) => <span className="font-mono text-xs">#{ev.agent_id}</span> },
    {
      key: 'response', header: 'Response',
      render: (ev) => ev.response_status
        ? <span className={`font-mono text-xs ${ev.response_status < 400 ? 'text-green-600' : 'text-red-500'}`}>{ev.response_status}</span>
        : <span className="text-xs text-gray-400">-</span>,
    },
    {
      key: 'error', header: 'Error',
      render: (ev) => ev.last_error
        ? <span className="text-xs text-red-500 truncate max-w-[200px] block" title={ev.last_error}>{ev.last_error}</span>
        : <span className="text-xs text-gray-400">-</span>,
    },
    {
      key: 'created', header: 'Created',
      render: (ev) => <span className="text-xs text-suwappu-text-secondary dark:text-gray-400">{ev.created_at ? new Date(ev.created_at).toLocaleString() : '-'}</span>,
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-heading font-bold dark:text-dark-text">Webhooks</h2>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setOffset(0) }}
          className="px-3 py-2 text-sm bg-white dark:bg-dark-bg border border-suwappu-sakura-light/30 dark:border-dark-border rounded-suwappu-md"
        >
          <option value="">All</option>
          <option value="pending">Pending</option>
          <option value="delivered">Delivered</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      <GlassCard>
        {isLoading ? (
          <LoadingSpinner />
        ) : (
          <>
            <DataTable columns={columns} data={data?.events ?? []} keyExtractor={(ev) => ev.id} emptyMessage="No webhook events" />
            {data?.pagination && (
              <Pagination total={data.pagination.total} limit={limit} offset={offset} onPageChange={setOffset} />
            )}
          </>
        )}
      </GlassCard>
    </div>
  )
}
