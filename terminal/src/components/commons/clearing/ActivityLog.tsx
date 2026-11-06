import { useMemo, useState } from 'react'
import type { Address } from 'viem'
import { TerminalButton, TerminalEmptyState, TerminalPanel, TerminalPanelHeader } from '../../foundation'
import { fmt, toNum, txUrl } from '../contracts'
import { downloadCsv } from './csv'
import { useLocalMeta } from './local'
import type { useActivity } from './useActivity'

const KIND_TONE: Record<string, string> = {
  Payment: 'text-terminal-text',
  Settled: 'text-terminal-up',
  Cleared: 'text-terminal-accent',
  Default: 'text-terminal-down',
  Demand: 'text-terminal-warn',
  'Write-off': 'text-terminal-warn',
  Cured: 'text-terminal-up',
  Withdraw: 'text-terminal-up',
}

/** On-chain audit trail for the connected address, with CSV export. */
export function ActivityLog({ me, activity }: { me: Address; activity: ReturnType<typeof useActivity> }) {
  const { data, isLoading, error } = activity
  const { name, refOf } = useLocalMeta()
  const [filter, setFilter] = useState('')
  const rows = useMemo(
    () => (data ?? []).filter((r) => !filter || r.kind === filter),
    [data, filter],
  )
  const kinds = useMemo(() => [...new Set((data ?? []).map((r) => r.kind))].sort(), [data])

  const exportCsv = () =>
    downloadCsv(
      `commons-activity-${me.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.csv`,
      ['time_utc', 'block', 'event', 'counterparty', 'counterparty_label', 'amount_musd', 'net_effect_musd', 'detail', 'reference', 'tx_hash', 'explorer'],
      (data ?? []).map((r) => [
        r.time ? new Date(r.time * 1000).toISOString() : '',
        r.block.toString(),
        r.kind,
        r.counterparty ?? '',
        r.counterparty ? name(r.counterparty) : '',
        r.amount !== undefined ? toNum(r.amount) : '',
        r.delta !== undefined ? toNum(r.delta) : '',
        r.detail,
        refOf(r.tx) ?? '',
        r.tx,
        txUrl(r.tx),
      ]),
    )

  return (
    <TerminalPanel className="flex min-h-0 flex-col gap-2 p-[var(--terminal-space-card)]">
      <TerminalPanelHeader
        eyebrow="Audit trail"
        title="Activity"
        description="Every on-chain event on your lines, your escrow and routing settings, and clears that touched you (decoded from the transaction). Sourced from chain — nothing here is stored by Suwappu."
        meta={
          <div className="flex items-center gap-2">
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="terminal-theme-control h-7 rounded px-1.5 text-[11px] text-terminal-text"
            >
              <option value="">All events</option>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <TerminalButton size="sm" variant="ghost" disabled={!data?.length} onClick={exportCsv}>
              Export CSV
            </TerminalButton>
          </div>
        }
      />
      {isLoading ? (
        <div className="h-32 animate-pulse rounded bg-terminal-panel" />
      ) : error ? (
        <p className="text-xs text-terminal-warn">Couldn't load activity: {String((error as Error).message).slice(0, 120)}</p>
      ) : rows.length === 0 ? (
        <TerminalEmptyState title="No activity yet" description="Events appear here as soon as your first line is proposed." />
      ) : (
        <div className="max-h-[520px] overflow-auto">
          <table className="w-full min-w-[640px] border-collapse text-xs">
            <thead className="sticky top-0 bg-terminal-bg">
              <tr className="border-b border-terminal-border text-left text-[10px] uppercase tracking-wide text-terminal-text-muted">
                <th className="px-2 py-1.5 font-medium">Time</th>
                <th className="px-2 py-1.5 font-medium">Event</th>
                <th className="px-2 py-1.5 font-medium">Counterparty</th>
                <th className="px-2 py-1.5 text-right font-medium">Amount</th>
                <th className="px-2 py-1.5 font-medium">Detail</th>
                <th className="px-2 py-1.5 font-medium">Reference</th>
                <th className="px-2 py-1.5 font-medium">Tx</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.tx}-${i}`} className="border-b border-terminal-border/40">
                  <td className="whitespace-nowrap px-2 py-1.5 font-mono text-terminal-text-muted">
                    {r.time ? new Date(r.time * 1000).toLocaleString() : `#${r.block}`}
                  </td>
                  <td className={`px-2 py-1.5 font-semibold ${KIND_TONE[r.kind] ?? 'text-terminal-text-secondary'}`}>{r.kind}</td>
                  <td className="px-2 py-1.5 text-terminal-text-secondary">{r.counterparty ? name(r.counterparty) : '—'}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-terminal-text">{r.amount !== undefined ? fmt(r.amount, 4) : '—'}</td>
                  <td className="px-2 py-1.5 text-terminal-text-secondary">{r.detail}</td>
                  <td className="px-2 py-1.5 font-mono text-terminal-accent">{refOf(r.tx) ?? ''}</td>
                  <td className="px-2 py-1.5">
                    <a href={txUrl(r.tx)} target="_blank" rel="noreferrer" className="font-mono text-terminal-text-muted hover:text-terminal-accent">
                      {r.tx.slice(0, 8)}… ↗
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </TerminalPanel>
  )
}
