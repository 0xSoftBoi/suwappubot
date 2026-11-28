import { useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { bank, cmpMinor, formatMinor, parseToMinor, type Escrow, type EscrowMilestone } from '../../lib/bankApi'
import { useBankAssets } from '../../hooks/bank/useBankCore'
import { useEscrow } from '../../hooks/bank/useBankDomains'
import { Btn, Card, Chip, ErrorBox, Field, Input, Row, Sheet } from './BankUI'
import { AmountInput } from './Amount'
import { MoneyAction } from './MoneyAction'
import { TransferLine } from './TransferLine'

type Role = 'payer' | 'payee' | 'arbiter'
type Act = { seq: number; a: 'deliver' | 'confirm' | 'dispute' | 'resolve' | 'refund'; amount: string }

/** Role-aware escrow milestone actions. Role rules mirror BankEscrowService (deliver: payee; confirm: payer; dispute: payer or payee; resolve: arbiter; refund: payee). The server enforces them too. */
export function EscrowDetail({ e, onClose }: { e: Escrow; onClose: () => void }) {
  const d = useEscrow(e.id)
  const assets = useBankAssets()
  const roleQs = useQueries({ queries: (['payer', 'payee', 'arbiter'] as Role[]).map((r) => ({ queryKey: ['bank', 'escrows', r], queryFn: async () => (await bank.escrows(r)).escrows, staleTime: 30_000 })) })
  const roles = (['payer', 'payee', 'arbiter'] as Role[]).filter((_, i) => roleQs[i]?.data?.some((x) => x.id === e.id))
  const decs = assets.data?.find((a) => a.symbol === e.asset && a.chain === e.chain)?.decimals ?? null
  const [act, setAct] = useState<Act | null>(null)
  const [text, setText] = useState('')
  const [release, setRelease] = useState('')
  const view = d.data
  const ms: EscrowMilestone[] = view?.milestones ?? []
  const has = (r: Role) => roles.includes(r)
  const hasArbiter = !!view?.escrow.arbiterOwnerId
  const releaseMinor = act?.a === 'resolve' ? parseToMinor(release, decs ?? 0) ?? (/^0(\.0+)?$/.test(release.trim()) ? '0' : null) : null
  const validRelease = releaseMinor !== null && act ? cmpMinor(releaseMinor, act.amount) <= 0 : false
  const close = () => { setAct(null); setText(''); setRelease(''); void d.refetch() }
  const amt = (m: string) => `${formatMinor(m, decs)} ${e.asset}`
  const ready = act && (act.a === 'confirm' || act.a === 'refund' || (act.a === 'resolve' ? validRelease : text.trim().length > 0))
  return (
    <Sheet title="Escrow" onClose={onClose}>
      <div className="space-y-2">
        <Row label="Status" value={<Chip status={view?.escrow.status ?? e.status} />} />
        {roles.length > 0 && <Row label="Your role" value={roles.join(', ')} />}
        {e.description && <Row label="For" value={e.description} />}
        <Row label="Total" value={amt(e.amountMinor)} />
        {view?.fundingTransferId && <TransferLine label="Funding transfer" transferId={view.fundingTransferId} />}
        {d.isLoading && <p className="text-sm animate-pulse">Loading milestones…</p>}
        {d.isError && <ErrorBox error={d.error} onRetry={() => void d.refetch()} />}
        {ms.map((m) => (
          <Card key={m.id} className="!p-3 space-y-1">
            <div className="flex justify-between gap-2"><p className="text-sm font-semibold">Milestone {m.seq}</p><Chip status={m.status} /></div>
            {m.description && <p className="text-xs text-suwappu-text-secondary break-words">{m.description}</p>}
            <Row label="Amount" value={amt(m.amountMinor)} />
            {(view?.transfers ?? []).filter((t) => t.milestoneSeq === m.seq).map((t) => <TransferLine key={t.transferId} label={`${t.kind === 'refund' ? 'Refund' : 'Release'} ${amt(t.amountMinor)}`} transferId={t.transferId} />)}
            {m.deliveryProof && <Row label="Proof" value={m.deliveryProof} />}
            {m.autoReleaseAt && m.status === 'delivered' && <Row label="Auto-releases" value={new Date(m.autoReleaseAt).toLocaleString()} />}
            <div className="grid grid-cols-2 gap-2 pt-1">
              {has('payee') && m.status === 'funded' && <Btn onClick={() => setAct({ seq: m.seq, a: 'deliver', amount: m.amountMinor })}>Mark delivered</Btn>}
              {has('payer') && m.status === 'delivered' && <Btn onClick={() => setAct({ seq: m.seq, a: 'confirm', amount: m.amountMinor })}>Release funds</Btn>}
              {hasArbiter && ((has('payer') && ['funded', 'delivered'].includes(m.status)) || (has('payee') && m.status === 'delivered')) && <Btn variant="danger" onClick={() => setAct({ seq: m.seq, a: 'dispute', amount: m.amountMinor })}>Dispute</Btn>}
              {has('arbiter') && m.status === 'disputed' && <Btn onClick={() => setAct({ seq: m.seq, a: 'resolve', amount: m.amountMinor })}>Resolve</Btn>}
              {has('payee') && ['funded', 'delivered'].includes(m.status) && <Btn variant="ghost" onClick={() => setAct({ seq: m.seq, a: 'refund', amount: m.amountMinor })}>Refund payer</Btn>}
            </div>
          </Card>
        ))}
        {!d.isLoading && roles.length === 0 && !roleQs.some((q) => q.isLoading) && <p className="text-xs text-suwappu-text-secondary">No actions available for your account on this escrow.</p>}
        {act?.a === 'deliver' && <Field label="Proof of delivery" hint="A link or short description the payer can check."><Input value={text} maxLength={4000} onChange={(x) => setText(x.target.value)} /></Field>}
        {act?.a === 'dispute' && <Field label="Reason for dispute"><Input value={text} maxLength={1000} onChange={(x) => setText(x.target.value)} /></Field>}
        {act?.a === 'resolve' && (
          <>
            <Field label={`Amount to release to the payee (up to ${amt(act.amount)})`}><AmountInput value={release} onChange={setRelease} symbol={e.asset} decimals={decs} /></Field>
            <Field label="Note (optional)"><Input value={text} maxLength={1000} onChange={(x) => setText(x.target.value)} /></Field>
          </>
        )}
      </div>
      {act && ready && (
        <MoneyAction
          key={`${act.seq}-${act.a}`}
          title={{ deliver: 'Mark as delivered', confirm: 'Release funds to the payee', dispute: 'Open a dispute', resolve: 'Resolve dispute', refund: 'Refund the payer' }[act.a]}
          rows={[
            { label: 'Milestone', value: String(act.seq) },
            ...(act.a === 'resolve' && releaseMinor !== null
              ? [{ label: 'Release to payee', value: amt(releaseMinor) }, { label: 'Refund to payer', value: amt((BigInt(act.amount) - BigInt(releaseMinor)).toString()) }]
              : [{ label: act.a === 'deliver' || act.a === 'dispute' ? 'Amount at stake' : 'Amount', value: amt(act.amount) }]),
            ...(act.a === 'deliver' ? [{ label: 'Proof', value: text }] : []),
            ...(act.a === 'dispute' ? [{ label: 'Reason', value: text }] : []),
            { label: 'Fee', value: 'None shown by the API' },
          ]}
          confirmLabel={{ deliver: 'Mark delivered', confirm: 'Release funds', dispute: 'Dispute', resolve: 'Resolve', refund: 'Refund' }[act.a]}
          run={() => bank.escrowAction(e.id, act.seq, act.a, act.a === 'deliver' ? { proof: text } : act.a === 'dispute' ? { reason: text } : act.a === 'resolve' ? { releaseMinor: releaseMinor as string, ...(text.trim() ? { note: text } : {}) } : undefined)}
          onClose={close}
        />
      )}
    </Sheet>
  )
}
