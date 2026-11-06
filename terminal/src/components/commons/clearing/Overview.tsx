import type { Address } from 'viem'
import { LineStatusV2 } from '@suwappu/primitives-client'
import { TerminalMetricCard, TerminalPanel } from '../../foundation'
import { fmt, short } from '../contracts'
import type { Position } from './useNetwork'

export type Alert = { tone: 'down' | 'warm'; text: string; counterparty: Address }

/** Deadline alerts: demands against me (default risk) and defaults I can now record. */
export function alertsFor(me: Address, positions: Position[], now = Date.now() / 1000): Alert[] {
  const out: Alert[] = []
  for (const p of positions) {
    const l = p.line
    if (!l || l.status !== LineStatusV2.Active || l.demandTs === 0n) continue
    const ends = Number(l.demandTs) + Number(l.grace)
    const demandedByMe = l.demandBy.toLowerCase() === me.toLowerCase()
    if (!demandedByMe && p.iOwe > 0n) {
      const left = ends - now
      out.push({
        tone: 'down',
        counterparty: p.counterparty,
        text:
          left > 0
            ? `${short(p.counterparty)} demanded settlement of ${fmt(p.iOwe, 2)} mUSD — ${formatLeft(left)} until they can mark you in default`
            : `Grace elapsed on ${short(p.counterparty)}'s demand (${fmt(p.iOwe, 2)} mUSD) — you can be marked in default now`,
      })
    }
    if (demandedByMe && p.theyOwe > 0n && now > ends) {
      out.push({ tone: 'warm', counterparty: p.counterparty, text: `Grace elapsed on your demand to ${short(p.counterparty)} (${fmt(p.theyOwe, 2)} mUSD) — eligible to mark default` })
    }
  }
  return out
}

function formatLeft(s: number) {
  if (s > 86_400) return `${(s / 86_400).toFixed(1)} days`
  if (s > 3_600) return `${(s / 3_600).toFixed(1)} h`
  return `${Math.max(1, Math.round(s / 60))} min`
}

export function KpiStrip({ positions, claimable, alerts }: { positions: Position[]; claimable: bigint; alerts: Alert[] }) {
  const recv = positions.reduce((s, p) => s + p.theyOwe, 0n)
  const pay = positions.reduce((s, p) => s + p.iOwe, 0n)
  const extended = positions.filter((p) => p.line?.status === LineStatusV2.Active).reduce((s, p) => s + p.creditIExtend, 0n)
  const received = positions.filter((p) => p.line?.status === LineStatusV2.Active).reduce((s, p) => s + p.creditTheyExtend, 0n)
  const used = extended > 0n ? Number((recv * 10_000n) / extended) / 100 : 0
  const active = positions.filter((p) => p.line?.status === LineStatusV2.Active).length
  const defaulted = positions.filter((p) => p.line?.status === LineStatusV2.Defaulted).length
  const net = recv - pay
  return (
    <div className="grid grid-cols-2 gap-1.5 md:grid-cols-3 xl:grid-cols-6">
      <TerminalMetricCard label="Receivable" value={`${fmt(recv, 2)}`} detail="owed to you · mUSD" tone="up" />
      <TerminalMetricCard label="Payable" value={`${fmt(pay, 2)}`} detail="you owe · mUSD" tone="down" />
      <TerminalMetricCard label="Net position" value={`${net >= 0n ? '+' : '−'}${fmt(net >= 0n ? net : -net, 2)}`} detail={`${active} active · ${defaulted} defaulted`} tone={net >= 0n ? 'accent' : 'warm'} />
      <TerminalMetricCard label="Credit extended" value={`${fmt(extended, 0)}`} detail={`${used.toFixed(1)}% drawn by counterparties`} tone="sky" />
      <TerminalMetricCard label="Credit received" value={`${fmt(received, 0)}`} detail="lines others extend you" />
      <TerminalMetricCard label="Escrow · alerts" value={`${fmt(claimable, 2)}`} detail={alerts.length ? `${alerts.length} alert${alerts.length > 1 ? 's' : ''} need attention` : 'no deadlines pending'} tone={alerts.some((a) => a.tone === 'down') ? 'down' : 'neutral'} />
    </div>
  )
}

export function AlertsStrip({ alerts, onOpen }: { alerts: Alert[]; onOpen: (cp: Address) => void }) {
  if (!alerts.length) return null
  return (
    <TerminalPanel className="flex flex-col gap-1 p-[var(--terminal-space-card)]">
      {alerts.map((a, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onOpen(a.counterparty)}
          className={`flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs ${a.tone === 'down' ? 'bg-terminal-down/10 text-terminal-down' : 'bg-terminal-warn/10 text-terminal-warn'}`}
        >
          <span aria-hidden>{a.tone === 'down' ? '⚠' : '◷'}</span>
          <span className="flex-1">{a.text}</span>
          <span className="text-[10px] underline">open line</span>
        </button>
      ))}
    </TerminalPanel>
  )
}
