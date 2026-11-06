import type { Address } from 'viem'
import { ClearingAction, LineStatusV2 } from '@suwappu/primitives-client'
import { TerminalButton, TerminalEmptyState, TerminalPanel, TerminalPanelHeader, TerminalStatusPill } from '../../foundation'
import { fmt } from '../contracts'
import { approveIfNeeded, call } from '../useCommonsTx'
import { useLocalMeta } from './local'
import { CH, CHA, TOKEN, aprOf, type Act, type Run } from './shared'
import type { Position } from './useNetwork'

/**
 * W2 "Inbox first": everything that needs the operator, most urgent first,
 * each with one primary action. Derived purely from on-chain state.
 */

type Item = {
  rank: number // lower = more urgent
  tone: 'down' | 'warm' | 'accent' | 'neutral'
  tag: string
  text: string
  cp?: Address
  primary?: { label: string; run: () => void }
}

const pad = (v: bigint) => (v * 1001n) / 1000n // cover interest accrued until the block

export function Inbox({
  me,
  positions,
  claimable,
  act,
  run,
  busy,
  onOpen,
}: {
  me: Address
  positions: Position[]
  claimable: bigint
  act: Act
  run: Run
  busy: string | null
  onOpen: (cp: Address) => void
}) {
  const { name } = useLocalMeta()
  const now = Date.now() / 1000
  const items: Item[] = []

  for (const p of positions) {
    const l = p.line
    if (!l) continue
    const cpName = name(p.counterparty)
    const theirs = l.proposer.toLowerCase() !== me.toLowerCase()

    if (l.status === LineStatusV2.Proposed && theirs) {
      items.push({
        rank: 2,
        tone: 'accent',
        tag: 'Proposal',
        cp: p.counterparty,
        text: `${cpName} offers ${fmt(p.creditTheyExtend, 2)} mUSD credit at ${(aprOf(l.feeRate) * 100).toFixed(2)}% APR, ${(Number(l.grace) / 86_400).toFixed(1)}-day grace — review, accept or counter`,
        primary: { label: 'Review terms', run: () => onOpen(p.counterparty) },
      })
    }
    if (l.status === LineStatusV2.Proposed && !theirs) {
      items.push({ rank: 6, tone: 'neutral', tag: 'Waiting', cp: p.counterparty, text: `Your proposal to ${cpName} is awaiting their response` })
    }
    if (l.status === LineStatusV2.Active && l.demandTs > 0n) {
      const ends = Number(l.demandTs) + Number(l.grace)
      const byMe = l.demandBy.toLowerCase() === me.toLowerCase()
      if (!byMe && p.iOwe > 0n) {
        const left = ends - now
        items.push({
          rank: 0,
          tone: 'down',
          tag: left > 0 ? 'Demand' : 'Overdue',
          cp: p.counterparty,
          text:
            left > 0
              ? `${cpName} demanded ${fmt(p.iOwe, 2)} mUSD — settle within ${left > 86_400 ? `${(left / 86_400).toFixed(1)} days` : `${(left / 3600).toFixed(1)} h`} to avoid default`
              : `Grace elapsed on ${cpName}'s demand for ${fmt(p.iOwe, 2)} mUSD — they can mark you in default now`,
          primary: {
            label: `Settle ${fmt(p.iOwe, 2)}`,
            run: () => run(`Settle ${cpName}`, [approveIfNeeded(TOKEN, CH, pad(p.iOwe), 'Approve mUSD'), call('Settle', CH, CHA, 'settle', [p.counterparty, TOKEN, pad(p.iOwe)])]),
          },
        })
      }
      if (byMe && p.theyOwe > 0n && now > ends) {
        items.push({
          rank: 1,
          tone: 'warm',
          tag: 'Collect',
          cp: p.counterparty,
          text: `Grace elapsed on your demand to ${cpName} (${fmt(p.theyOwe, 2)} mUSD) — record the default, or write it off`,
          primary: {
            label: 'Mark default',
            run: () => act(`Mark default · ${cpName}`, ClearingAction.MarkDefault, [p.counterparty, TOKEN], [['debtor', p.counterparty]], [call('Mark default', CH, CHA, 'markDefault', [p.counterparty, TOKEN])]),
          },
        })
      }
      if (byMe && p.theyOwe > 0n && now <= ends) {
        items.push({ rank: 5, tone: 'neutral', tag: 'Grace', cp: p.counterparty, text: `Your demand to ${cpName} is in grace until ${new Date(ends * 1000).toLocaleString()}` })
      }
    }
    if (l.status === LineStatusV2.Defaulted && p.iOwe > 0n) {
      items.push({
        rank: 0,
        tone: 'down',
        tag: 'Defaulted',
        cp: p.counterparty,
        text: `You are in default to ${cpName} for ${fmt(p.iOwe, 2)} mUSD — settle in full to cure (recorded publicly)`,
        primary: {
          label: 'Settle & cure',
          run: () => run(`Cure ${cpName}`, [approveIfNeeded(TOKEN, CH, pad(p.iOwe), 'Approve mUSD'), call('Settle', CH, CHA, 'settle', [p.counterparty, TOKEN, pad(p.iOwe)])]),
        },
      })
    }
    if (l.status === LineStatusV2.Active && p.utilizationIn >= 0.9) {
      items.push({ rank: 3, tone: 'warm', tag: 'Exposure', cp: p.counterparty, text: `${cpName} has drawn ${(p.utilizationIn * 100).toFixed(0)}% of the credit you extend — consider a demand or holding the limit`, primary: { label: 'Open line', run: () => onOpen(p.counterparty) } })
    }
    if (l.status === LineStatusV2.Active && p.utilizationOut >= 0.9) {
      items.push({ rank: 3, tone: 'warm', tag: 'Headroom', cp: p.counterparty, text: `You've used ${(p.utilizationOut * 100).toFixed(0)}% of ${cpName}'s credit — settle or ask them to raise the limit`, primary: { label: 'Open line', run: () => onOpen(p.counterparty) } })
    }
  }

  if (claimable > 0n) {
    items.push({
      rank: 4,
      tone: 'accent',
      tag: 'Escrow',
      text: `${fmt(claimable, 2)} mUSD of repayments is waiting in escrow`,
      primary: { label: 'Withdraw', run: () => act('Withdraw', ClearingAction.Withdraw, [TOKEN, me], [['to', me]], [call('Withdraw', CH, CHA, 'withdraw', [TOKEN, me])]) },
    })
  }

  items.sort((a, b) => a.rank - b.rank)
  const owing = positions.filter((p) => p.iOwe > 0n && (p.line?.status === LineStatusV2.Active || p.line?.status === LineStatusV2.Defaulted))
  const totalOwed = owing.reduce((s, p) => s + p.iOwe, 0n)

  return (
    <TerminalPanel className="flex flex-col gap-2 p-[var(--terminal-space-card)]">
      <TerminalPanelHeader
        eyebrow="Inbox"
        title={items.filter((i) => i.primary).length ? `${items.filter((i) => i.primary).length} need your action` : 'Nothing needs your action'}
        meta={
          owing.length > 1 ? (
            <TerminalButton
              size="sm"
              variant="secondary"
              disabled={!!busy}
              onClick={() =>
                run(`Settle all (${owing.length} lines)`, [
                  approveIfNeeded(TOKEN, CH, pad(totalOwed), 'Approve mUSD'),
                  ...owing.map((p) => call(`Settle ${name(p.counterparty)}`, CH, CHA, 'settle', [p.counterparty, TOKEN, pad(p.iOwe)])),
                ])
              }
            >
              Settle all · {fmt(totalOwed, 2)}
            </TerminalButton>
          ) : undefined
        }
      />
      {items.length === 0 ? (
        <TerminalEmptyState title="All clear" description="No proposals, demands, deadlines or escrow waiting on you." />
      ) : (
        <div className="grid gap-1">
          {items.map((it, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 rounded border border-terminal-border/50 px-2 py-1.5 text-xs">
              <TerminalStatusPill tone={it.tone}>{it.tag}</TerminalStatusPill>
              <button type="button" className="min-w-0 flex-1 text-left text-terminal-text-secondary hover:text-terminal-text" onClick={() => it.cp && onOpen(it.cp)}>
                {it.text}
              </button>
              {it.primary && (
                <TerminalButton size="sm" variant={it.tone === 'down' ? 'primary' : 'secondary'} disabled={!!busy} onClick={it.primary.run}>
                  {it.primary.label}
                </TerminalButton>
              )}
            </div>
          ))}
        </div>
      )}
    </TerminalPanel>
  )
}
