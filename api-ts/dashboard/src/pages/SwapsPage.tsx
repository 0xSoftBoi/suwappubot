import { useState } from 'react'
import { useSwaps } from '../hooks/useAdminApi'
import GlassCard from '../components/layout/GlassCard'
import DataTable, { type Column } from '../components/DataTable'
import Pagination from '../components/Pagination'
import Badge, { statusBadgeVariant } from '../components/Badge'
import LoadingSpinner from '../components/LoadingSpinner'
import type { AdminSwap } from '../api/types'

export default function SwapsPage() {
  const [offset, setOffset] = useState(0)
  const [statusFilter, setStatusFilter] = useState('')
  const limit = 20

  const { data, isLoading } = useSwaps({ limit, offset, status: statusFilter || undefined })

  const columns: Column<AdminSwap>[] = [
    { key: 'id', header: 'ID', render: (s) => <span className="font-mono text-xs dark:text-dark-text">#{s.id}</span> },
    {
      key: 'pair', header: 'Pair',
      render: (s) => (
        <span className="text-xs dark:text-dark-text">
          {s.from_amount} {s.from_token} → {s.to_token}
        </span>
      ),
    },
    {
      key: 'chains', header: 'Chain',
      render: (s) => (
        <span className="text-xs text-suwappu-text-secondary dark:text-gray-400">
          {s.from_chain === s.to_chain ? s.from_chain : `${s.from_chain} → ${s.to_chain}`}
        </span>
      ),
    },
    {
      key: 'status', header: 'Status',
      render: (s) => <Badge label={s.status || 'unknown'} variant={statusBadgeVariant(s.status)} />,
    },
    {
      key: 'tx', header: 'Tx',
      render: (s) => s.tx_hash
        ? <code className="text-[10px] text-suwappu-purple dark:text-suwappu-sakura-mid">{s.tx_hash.slice(0, 10)}...</code>
        : <span className="text-xs text-gray-400">-</span>,
    },
    { key: 'provider', header: 'Provider', render: (s) => <span className="text-xs">{s.route_provider || '-'}</span> },
    {
      key: 'agent', header: 'Agent',
      render: (s) => <span className="text-xs font-mono">{s.agent_id ? `#${s.agent_id}` : '-'}</span>,
    },
    {
      key: 'created', header: 'Created',
      render: (s) => <span className="text-xs text-suwappu-text-secondary dark:text-gray-400">{s.created_at ? new Date(s.created_at).toLocaleString() : '-'}</span>,
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-heading font-bold dark:text-dark-text">Swaps</h2>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setOffset(0) }}
          className="px-3 py-2 text-sm bg-white dark:bg-dark-bg border border-suwappu-sakura-light/30 dark:border-dark-border rounded-suwappu-md"
        >
          <option value="">All</option>
          <option value="pending">Pending</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      <GlassCard>
        {isLoading ? (
          <LoadingSpinner />
        ) : (
          <>
            <DataTable columns={columns} data={data?.swaps ?? []} keyExtractor={(s) => s.id} emptyMessage="No swaps found" />
            {data?.pagination && (
              <Pagination total={data.pagination.total} limit={limit} offset={offset} onPageChange={setOffset} />
            )}
          </>
        )}
      </GlassCard>
    </div>
  )
}
