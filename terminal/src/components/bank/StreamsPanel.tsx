import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { bank, cmpMinor, formatMinor, parseToMinor, transferIdOf, type StreamView } from '../../lib/bankApi'
import { useBankAccounts, useBankAssets } from '../../hooks/bank/useBankCore'
import { useStreams } from '../../hooks/bank/useBankDomains'
import { Btn, Card, Chip, Empty, ErrorBox, Field, Input, QueryState, Row, Select, Sheet } from './BankUI'
import { AccountSelect } from './AccountSelect'
import { AmountInput } from './Amount'
import { MoneyAction } from './MoneyAction'

const PERIODS: Array<[string, number]> = [['per minute', 60], ['per hour', 3600], ['per day', 86400], ['per week', 604800]]

function CreateStream({ onClose }: { onClose: () => void }) {
  const accounts = useBankAccounts()
  const [kind, setKind] = useState<'rate' | 'metered'>('rate')
  const [payer, setPayer] = useState('')
  const [payee, setPayee] = useState('')
  const [rate, setRate] = useState('')
  const [period, setPeriod] = useState(3600)
  const [unit, setUnit] = useState('')
  const [cap, setCap] = useState('')
  const [review, setReview] = useState(false)
  const a = accounts.data?.find((x) => x.id === payer)
  const d = a?.decimals ?? null
  const rateM = d !== null ? parseToMinor(rate, d) : null
  const unitM = d !== null ? parseToMinor(unit, d) : null
  const capM = d !== null ? parseToMinor(cap, d) : null
  const ok = !!a && !!payee.trim() && !!capM && (kind === 'rate' ? !!rateM : !!unitM)
  if (review && a && capM) {
    return (
      <MoneyAction
        title="Confirm stream"
        rows={[
          { label: 'From', value: a.label || `${a.asset} on ${a.chain}` },
          { label: 'To account', value: payee.trim(), mono: true },
          kind === 'rate' ? { label: 'Rate', value: `${formatMinor(rateM, d)} ${a.asset} ${PERIODS.find((p) => p[1] === period)?.[0]}` } : { label: 'Price per unit', value: `${formatMinor(unitM, d)} ${a.asset}` },
          { label: 'Total cap', value: `${formatMinor(capM, d)} ${a.asset}` },
          { label: 'Fee', value: 'None shown by the API' },
        ]}
        confirmLabel="Start stream"
        note="The stream pays out as it accrues, up to the cap. You can pause or cancel it any time."
        run={(k) => bank.createStream({ payerAccountId: payer, payeeAccountId: payee.trim(), kind, capMinor: capM, ...(kind === 'rate' ? { rateMinor: rateM, periodSeconds: period } : { unitPriceMinor: unitM }) }, k)}
        onClose={onClose}
      />
    )
  }
  return (
    <Sheet title="New stream" onClose={onClose}>
      <div className="space-y-3">
        <Select aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}><option value="rate">Pay over time</option><option value="metered">Pay per use</option></Select>
        <Field label="Pay from"><AccountSelect accounts={accounts.data ?? []} value={payer} onChange={setPayer} /></Field>
        <Field label="Payee account id" hint="The receiving bank account id, in the same asset and network."><Input value={payee} maxLength={64} onChange={(e) => setPayee(e.target.value)} /></Field>
        {kind === 'rate' ? (
          <>
            <Field label="Amount"><AmountInput value={rate} onChange={setRate} symbol={a?.asset} decimals={d} /></Field>
            <Select aria-label="Period" value={period} onChange={(e) => setPeriod(Number(e.target.value))}>{PERIODS.map(([l, s]) => <option key={s} value={s}>{l}</option>)}</Select>
          </>
        ) : <Field label="Price per unit"><AmountInput value={unit} onChange={setUnit} symbol={a?.asset} decimals={d} /></Field>}
        <Field label="Total cap"><AmountInput value={cap} onChange={setCap} symbol={a?.asset} decimals={d} /></Field>
        <Btn className="w-full" disabled={!ok} onClick={() => setReview(true)}>Review</Btn>
      </div>
    </Sheet>
  )
}

function Usage({ sv, onClose }: { sv: StreamView; onClose: () => void }) {
  const qc = useQueryClient()
  const [units, setUnits] = useState('')
  const [review, setReview] = useState(false)
  const ok = /^[1-9]\d{0,17}$/.test(units)
  if (review) {
    return <MoneyAction title="Report usage" rows={[{ label: 'Units used', value: units }, { label: 'Price per unit', value: sv.stream.unitPriceMinor ?? '—', mono: true }, { label: 'Stream', value: sv.stream.id, mono: true }]} confirmLabel="Report" note="Only the payee can report usage. The payer is charged for these units." run={(k) => bank.streamUsage(sv.stream.id, units, k)} onClose={() => { void qc.invalidateQueries({ queryKey: ['bank', 'streams'] }); onClose() }} />
  }
  return (
    <Sheet title="Report usage" onClose={onClose}>
      <div className="space-y-3"><Field label="Units used"><Input inputMode="numeric" value={units} onChange={(e) => setUnits(e.target.value)} /></Field><Btn className="w-full" disabled={!ok} onClick={() => setReview(true)}>Review</Btn></div>
    </Sheet>
  )
}

function Advance({ sv, decimals, onClose }: { sv: StreamView; decimals: number | null; onClose: () => void }) {
  const [amt, setAmt] = useState('')
  const [review, setReview] = useState(false)
  const m = decimals !== null ? parseToMinor(amt, decimals) : null
  const ok = !!m && cmpMinor(m, sv.advanceAvailableMinor) <= 0
  if (review && m) {
    return <MoneyAction title="Take earned wages early" rows={[{ label: 'Advance', value: `${formatMinor(m, decimals)} ${sv.stream.asset}` }, { label: 'Available now', value: `${formatMinor(sv.advanceAvailableMinor, decimals)} ${sv.stream.asset}` }, { label: 'Fee', value: 'None shown by the API' }]} confirmLabel="Take advance" trackId={transferIdOf.ewa} run={(k) => bank.streamAdvance(sv.stream.id, m, k)} onClose={onClose} />
  }
  return (
    <Sheet title="Earned wage access" onClose={onClose}>
      <div className="space-y-3"><p className="text-sm">Available now: <b className="tabular-nums">{formatMinor(sv.advanceAvailableMinor, decimals)} {sv.stream.asset}</b></p><Field label="Amount"><AmountInput value={amt} onChange={setAmt} symbol={sv.stream.asset} decimals={decimals} /></Field><Btn className="w-full" disabled={!ok} onClick={() => setReview(true)}>Review</Btn></div>
    </Sheet>
  )
}

export function StreamsPanel() {
  const qc = useQueryClient()
  const streams = useStreams()
  const assets = useBankAssets()
  const [creating, setCreating] = useState(false)
  const [usage, setUsage] = useState<StreamView | null>(null)
  const [adv, setAdv] = useState<StreamView | null>(null)
  const [settling, setSettling] = useState<StreamView | null>(null)
  const act = useMutation({ mutationFn: ({ id, a }: { id: string; a: 'pause' | 'resume' | 'cancel' }) => bank.streamAction(id, a), onSuccess: () => void qc.invalidateQueries({ queryKey: ['bank', 'streams'] }) })
  const dec = (s: { asset: string; chain: string }) => assets.data?.find((a) => a.symbol === s.asset && a.chain === s.chain)?.decimals ?? null
  return (
    <div className="space-y-3">
      <Btn className="w-full" onClick={() => setCreating(true)}>New stream</Btn>
      {act.isError && <ErrorBox error={act.error} />}
      <QueryState query={streams} isEmpty={(d) => d.length === 0} empty={<Empty title="No streams" hint="Streams pay by the second or by usage." />}>
        {(list) => <div className="space-y-2">{list.map((sv) => { const s = sv.stream; const d = dec(s); return (
          <Card key={s.id}>
            <div className="flex justify-between gap-2"><p className="text-sm font-semibold capitalize">{s.kind} stream</p><Chip status={s.status} /></div>
            {s.lastError && <p className="text-xs text-bear break-words">{s.lastError}</p>}
            <div className="divide-y divide-terminal-border">
              {s.kind === 'rate' && s.rateMinor && <Row label="Rate" value={`${formatMinor(s.rateMinor, d)} ${s.asset} / ${s.periodSeconds ?? '?'} s`} />}
              {s.kind === 'metered' && s.unitPriceMinor && <Row label="Per unit" value={`${formatMinor(s.unitPriceMinor, d)} ${s.asset}`} />}
              {s.kind === 'metered' && s.units !== undefined && <Row label="Units used" value={s.units} />}
              <Row label="Accrued" value={`${formatMinor(sv.accruedMinor, d)} ${s.asset}`} />
              <Row label="Not yet settled" value={`${formatMinor(sv.unsettledMinor, d)} ${s.asset}`} />
              <Row label="Settled" value={`${formatMinor(s.settledMinor, d)} ${s.asset}`} />
              <Row label="Cap" value={`${formatMinor(s.capMinor, d)} ${s.asset}`} />
            </div>
            <div className="grid grid-cols-3 gap-2 mt-2">
              {s.status === 'paused' ? <Btn disabled={act.isPending} onClick={() => act.mutate({ id: s.id, a: 'resume' })}>Resume</Btn> : <Btn variant="ghost" disabled={act.isPending || s.status !== 'active'} onClick={() => act.mutate({ id: s.id, a: 'pause' })}>Pause</Btn>}
              <Btn variant="ghost" disabled={act.isPending} onClick={() => setSettling(sv)}>Settle</Btn>
              <Btn variant="danger" disabled={act.isPending || s.status === 'cancelled'} onClick={() => act.mutate({ id: s.id, a: 'cancel' })}>Cancel</Btn>
            </div>
            {(s.kind === 'metered' || BigInt(sv.advanceAvailableMinor) > 0n) && (
              <div className="grid grid-cols-2 gap-2 mt-2">
                {s.kind === 'metered' && <Btn variant="ghost" onClick={() => setUsage(sv)}>Report usage</Btn>}
                {BigInt(sv.advanceAvailableMinor) > 0n && <Btn variant="ghost" onClick={() => setAdv(sv)}>Take wages early</Btn>}
              </div>
            )}
          </Card>
        )})}</div>}
      </QueryState>
      {creating && <CreateStream onClose={() => { setCreating(false); void qc.invalidateQueries({ queryKey: ['bank', 'streams'] }) }} />}
      {settling && <MoneyAction title="Settle stream now" rows={[{ label: 'Amount to settle', value: `${formatMinor(settling.unsettledMinor, dec(settling.stream))} ${settling.stream.asset}` }, { label: 'From payer account', value: settling.stream.payerAccountId, mono: true }, { label: 'To payee account', value: settling.stream.payeeAccountId, mono: true }, { label: 'Fee', value: 'None shown by the API' }]} confirmLabel="Settle" note="The amount actually settled is whatever has accrued when the request runs." trackId={transferIdOf.stream} run={() => bank.streamAction(settling.stream.id, 'settle')} onClose={() => { setSettling(null); void qc.invalidateQueries({ queryKey: ['bank', 'streams'] }) }} />}
      {usage && <Usage sv={usage} onClose={() => setUsage(null)} />}
      {adv && <Advance sv={adv} decimals={dec(adv.stream)} onClose={() => { setAdv(null); void qc.invalidateQueries({ queryKey: ['bank', 'streams'] }) }} />}
    </div>
  )
}
