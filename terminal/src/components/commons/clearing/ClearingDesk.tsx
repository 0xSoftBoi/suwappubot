import { useMemo, useState } from 'react'
import type { Address } from 'viem'
import {
  TerminalButton,
  TerminalEmptyState,
  TerminalInset,
  TerminalKeyValueRow,
  TerminalMetricCard,
  TerminalPanel,
  TerminalPanelHeader,
  TerminalSegmentedTabs,
} from '../../foundation'
import { fmt, short } from '../contracts'
import { call } from '../useCommonsTx'
import { planClearing } from './cycles'
import { CH, CHA, TOKEN, type Run } from './shared'
import type { Edge } from './useNetwork'

/**
 * Clearing desk: the solver runs client-side over the live credit graph and
 * proposes a multi-cycle clear as ONE transaction. Anyone may submit it —
 * clearing never moves a net position — and the contract re-verifies every
 * edge and every node's conservation, so a stale plan can only revert.
 */
export function ClearingDesk({ me, edges, loading, run, busy }: { me?: Address; edges: Edge[]; loading: boolean; run: Run; busy: string | null }) {
  const [scope, setScope] = useState<'mine' | 'network'>('mine')
  const plan = useMemo(() => planClearing(edges, { through: scope === 'mine' ? me : undefined, me }), [edges, scope, me])
  const totalDebt = edges.reduce((s, e) => s + e.amount, 0n)
  const pct = totalDebt > 0n ? Number((plan.grossRemoved * 10_000n) / totalDebt) / 100 : 0

  return (
    <TerminalPanel className="flex flex-col gap-3 p-[var(--terminal-space-card)]">
      <TerminalPanelHeader
        eyebrow="Clearing desk"
        title="Debt-cycle solver"
        description="Scans every clearable line on-chain for cycles (A owes B owes C owes A), cancels them greedily — largest gross reduction first — and batches the result into one clear() call. Net positions never change; gross obligations and the interest on them do."
        meta={
          <TerminalSegmentedTabs
            activeId={scope}
            options={[
              { id: 'mine', label: 'Through me' },
              { id: 'network', label: 'Whole network' },
            ]}
            onChange={(id) => setScope(id as 'mine' | 'network')}
          />
        }
      />
      <div className="grid grid-cols-2 gap-1.5 md:grid-cols-4">
        <TerminalMetricCard label="Cycles found" value={String(plan.cycles.length)} detail={`${edges.length} clearable debts scanned`} />
        <TerminalMetricCard label="Gross debt removed" value={fmt(plan.grossRemoved, 2)} detail={`${pct.toFixed(1)}% of clearable debt · mUSD`} tone="accent" />
        <TerminalMetricCard label="Interest avoided / yr" value={plan.networkInterestSavedPerYear.toFixed(4)} detail="network-wide · mUSD" tone="sky" />
        <TerminalMetricCard
          label="Your interest effect / yr"
          value={`${plan.myInterestEffectPerYear >= 0 ? '+' : ''}${plan.myInterestEffectPerYear.toFixed(4)}`}
          detail="paying less (+) vs earning less (−)"
          tone={plan.myInterestEffectPerYear >= 0 ? 'up' : 'warm'}
        />
      </div>

      {loading ? (
        <div className="h-20 animate-pulse rounded bg-terminal-panel" />
      ) : plan.cycles.length === 0 ? (
        <TerminalEmptyState
          title={scope === 'mine' ? 'No cycles through you right now' : 'No cycles in the network right now'}
          description="A cycle needs debts that loop back: you owe someone who (eventually) owes you, on lines both parties marked clearable."
        />
      ) : (
        <TerminalInset className="grid gap-1.5 p-3 text-xs">
          {plan.cycles.map((c, i) => (
            <div key={i} className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-terminal-text-secondary">
                {[...c.nodes, c.nodes[0]].map((n) => (me && n.toLowerCase() === me.toLowerCase() ? 'you' : short(n))).join(' → ')}
              </span>
              <span className="font-mono text-terminal-text">
                −{fmt(c.amount, 4)} × {c.nodes.length} legs
              </span>
            </div>
          ))}
          <div className="mt-1 border-t border-terminal-border pt-1.5">
            <TerminalKeyValueRow label="Edges in batch" value={String(plan.edges.length)} />
          </div>
        </TerminalInset>
      )}

      <TerminalButton
        variant="primary"
        disabled={!me || plan.edges.length < 3 || !!busy}
        onClick={() =>
          run(`Clear ${plan.cycles.length} cycle${plan.cycles.length === 1 ? '' : 's'}`, [
            call('Clear', CH, CHA, 'clear', [TOKEN, plan.edges]),
          ])
        }
      >
        {plan.cycles.length ? `Submit clearing batch (${plan.edges.length} edges)` : 'Nothing to clear'}
      </TerminalButton>
      <p className="text-[11px] text-terminal-text-muted">
        Permissionless: you can clear cycles you're not part of. Amounts are a snapshot — interest accrues between now and the block, which only increases what's owed, so the plan stays valid unless someone settles first (then it reverts harmlessly).
      </p>
    </TerminalPanel>
  )
}
