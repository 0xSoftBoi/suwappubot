import { useMemo, useState } from 'react'
import type { Address } from 'viem'
import { FLAG_CLEARABLE, LineStatusV2 } from '@suwappu/primitives-client'
import { TerminalButton, TerminalEmptyState, TerminalPanel, TerminalPanelHeader, TerminalStatusPill } from '../../foundation'
import { fmt, short, toNum } from '../contracts'
import { downloadCsv } from './csv'
import { STATUS_LABEL, aprOf, statusTone } from './shared'
import type { Position } from './useNetwork'

type SortKey = 'counterparty' | 'status' | 'iOwe' | 'theyOwe' | 'net' | 'util' | 'apr'

const COLS: { key: SortKey; label: string; align?: 'right' }[] = [
  { key: 'counterparty', label: 'Counterparty' },
  { key: 'status', label: 'Status' },
  { key: 'theyOwe', label: 'Receivable', align: 'right' },
  { key: 'iOwe', label: 'Payable', align: 'right' },
  { key: 'net', label: 'Net', align: 'right' },
  { key: 'util', label: 'Utilization', align: 'right' },
  { key: 'apr', label: 'Fee APR', align: 'right' },
]

function sortVal(p: Position, k: SortKey): number | string {
  switch (k) {
    case 'counterparty':
      return p.counterparty.toLowerCase()
    case 'status':
      return p.line?.status ?? 0
    case 'iOwe':
      return toNum(p.iOwe)
    case 'theyOwe':
      return toNum(p.theyOwe)
    case 'net':
      return toNum(p.net)
    case 'util':
      return Math.max(p.utilizationIn, p.utilizationOut)
    case 'apr':
      return p.line ? aprOf(p.line.feeRate) : 0
  }
}

export function PositionsTable({
  positions,
  loading,
  selected,
  onSelect,
  me,
}: {
  positions: Position[]
  loading: boolean
  selected?: Address
  onSelect: (cp: Address) => void
  me: Address
}) {
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: 'net', dir: -1 })
  const [hideClosed, setHideClosed] = useState(true)
  const rows = useMemo(() => {
    const r = positions.filter((p) => !hideClosed || (p.line?.status !== LineStatusV2.Closed && p.line?.status !== LineStatusV2.None))
    return [...r].sort((a, b) => {
      const x = sortVal(a, sort.k)
      const y = sortVal(b, sort.k)
      return (x > y ? 1 : x < y ? -1 : 0) * sort.dir
    })
  }, [positions, sort, hideClosed])

  const exportCsv = () =>
    downloadCsv(
      `commons-positions-${me.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.csv`,
      ['counterparty', 'status', 'receivable_musd', 'payable_musd', 'net_musd', 'credit_you_extend', 'credit_they_extend', 'utilization_in', 'utilization_out', 'fee_apr', 'grace_days', 'clearable', 'terms_hash', 'terms_version'],
      positions.map((p) => [
        p.counterparty,
        STATUS_LABEL[p.line?.status ?? 0],
        toNum(p.theyOwe),
        toNum(p.iOwe),
        toNum(p.net),
        toNum(p.creditIExtend),
        toNum(p.creditTheyExtend),
        p.utilizationIn.toFixed(4),
        p.utilizationOut.toFixed(4),
        p.line ? aprOf(p.line.feeRate).toFixed(4) : '',
        p.line ? (Number(p.line.grace) / 86_400).toFixed(2) : '',
        p.line ? String((p.line.flags & FLAG_CLEARABLE) !== 0) : '',
        p.line?.termsHash ?? '',
        p.line?.nonce ?? '',
      ]),
    )

  return (
    <TerminalPanel className="flex min-h-0 flex-col gap-2 p-[var(--terminal-space-card)]">
      <TerminalPanelHeader
        eyebrow="Positions"
        title={`${rows.length} line${rows.length === 1 ? '' : 's'}`}
        meta={
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-[11px] text-terminal-text-muted">
              <input type="checkbox" checked={hideClosed} onChange={(e) => setHideClosed(e.target.checked)} />
              hide closed
            </label>
            <TerminalButton size="sm" variant="ghost" disabled={!positions.length} onClick={exportCsv}>
              Export CSV
            </TerminalButton>
          </div>
        }
      />
      {loading ? (
        <div className="h-24 animate-pulse rounded bg-terminal-panel" />
      ) : rows.length === 0 ? (
        <TerminalEmptyState title="No lines yet" description="Enter a counterparty above to propose your first credit line." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-xs">
            <thead>
              <tr className="border-b border-terminal-border text-[10px] uppercase tracking-wide text-terminal-text-muted">
                {COLS.map((c) => (
                  <th key={c.key} className={`px-2 py-1.5 font-medium ${c.align === 'right' ? 'text-right' : 'text-left'}`}>
                    <button
                      type="button"
                      className="hover:text-terminal-text"
                      onClick={() => setSort((s) => ({ k: c.key, dir: s.k === c.key ? (s.dir === 1 ? -1 : 1) : -1 }))}
                    >
                      {c.label}
                      {sort.k === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                    </button>
                  </th>
                ))}
                <th className="px-2 py-1.5 text-left font-medium">Flags</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {rows.map((p) => {
                const isSel = selected?.toLowerCase() === p.counterparty.toLowerCase()
                const util = Math.max(p.utilizationIn, p.utilizationOut)
                const demand = p.line && p.line.demandTs > 0n
                return (
                  <tr
                    key={p.counterparty}
                    onClick={() => onSelect(p.counterparty)}
                    className={`cursor-pointer border-b border-terminal-border/40 hover:bg-terminal-panel ${isSel ? 'bg-terminal-accent/10' : ''}`}
                  >
                    <td className="px-2 py-1.5 text-terminal-text">{short(p.counterparty)}</td>
                    <td className="px-2 py-1.5">
                      <TerminalStatusPill tone={statusTone(p.line?.status)}>{STATUS_LABEL[p.line?.status ?? 0]}</TerminalStatusPill>
                    </td>
                    <td className="px-2 py-1.5 text-right text-terminal-up">{p.theyOwe > 0n ? fmt(p.theyOwe, 2) : '—'}</td>
                    <td className="px-2 py-1.5 text-right text-terminal-down">{p.iOwe > 0n ? fmt(p.iOwe, 2) : '—'}</td>
                    <td className={`px-2 py-1.5 text-right ${p.net > 0n ? 'text-terminal-up' : p.net < 0n ? 'text-terminal-down' : 'text-terminal-text-muted'}`}>
                      {p.net === 0n ? '0' : `${p.net > 0n ? '+' : '−'}${fmt(p.net > 0n ? p.net : -p.net, 2)}`}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <div className="ml-auto flex w-24 items-center gap-1">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-terminal-panel">
                          <div className={`h-full ${util > 0.9 ? 'bg-terminal-down' : util > 0.6 ? 'bg-terminal-warn' : 'bg-terminal-accent'}`} style={{ width: `${Math.min(100, util * 100)}%` }} />
                        </div>
                        <span className="w-9 text-right text-[10px] text-terminal-text-muted">{(util * 100).toFixed(0)}%</span>
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-right text-terminal-text-secondary">{p.line ? `${(aprOf(p.line.feeRate) * 100).toFixed(2)}%` : '—'}</td>
                    <td className="px-2 py-1.5 text-[10px] text-terminal-text-muted">
                      {p.line && (p.line.flags & FLAG_CLEARABLE) !== 0 ? 'CLR ' : ''}
                      {demand ? <span className="text-terminal-warn">DEMAND</span> : ''}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </TerminalPanel>
  )
}
