import type { Address } from 'viem'
import { useReadContract } from 'wagmi'
import { TerminalInset, TerminalKeyValueRow } from '../../foundation'
import { fmt } from '../contracts'
import { TOKEN, ch } from './shared'

/**
 * Counterparty standing straight from the contract (per address, per token).
 * Deliberately shown as raw counters, not a score: volume among sybils costs
 * only gas, so weight it by counterparties you independently trust.
 */
export function CounterpartyStanding({ who }: { who: Address }) {
  const { data } = useReadContract({ ...ch, functionName: 'standing', args: [who, TOKEN], query: { refetchInterval: 30_000 } })
  const s = data as readonly [bigint, bigint, number, number, number, number] | undefined
  if (!s) return null
  const [settled, cleared, defaults, cures, opened, writeOffs] = s
  return (
    <TerminalInset className="grid gap-1 p-3 text-xs">
      <div className="mb-0.5 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wide text-terminal-text-muted">Counterparty standing (on-chain)</span>
        <span className={`text-[10px] font-semibold ${defaults > cures ? 'text-terminal-down' : defaults > 0 ? 'text-terminal-warn' : 'text-terminal-up'}`}>
          {defaults === 0 ? 'no defaults' : `${defaults} default${defaults > 1 ? 's' : ''}, ${cures} cured`}
        </span>
      </div>
      <TerminalKeyValueRow label="Repaid in tokens" value={`${fmt(settled, 2)} mUSD`} />
      <TerminalKeyValueRow label="Debt cleared on its lines" value={`${fmt(cleared, 2)} mUSD`} />
      <TerminalKeyValueRow label="Lines opened · write-offs" value={`${opened} · ${writeOffs}`} />
      <p className="pt-0.5 text-[10px] text-terminal-text-muted">Self-dealable between sybils — weigh it by who it was earned with.</p>
    </TerminalInset>
  )
}
