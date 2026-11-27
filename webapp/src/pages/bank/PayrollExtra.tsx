import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { bank, formatMinor, parseToMinor, transferIdOf } from '../../lib/bankApi'
import { useBankAccounts, useBankAssets } from '../../hooks/bank/useBankCore'
import { usePayees } from '../../hooks/bank/useBankDomains'
import { Btn, Card, Chip, Empty, ErrorBox, Field, Input, QueryState, Row, SectionTitle, Select, Sheet } from '../../components/bank/BankUI'
import { AccountSelect } from '../../components/bank/AccountSelect'
import { AmountInput } from '../../components/bank/Amount'
import { MoneyAction } from '../../components/bank/MoneyAction'

const FREQ = ['weekly', 'biweekly', 'monthly'] as const
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

type Line = { payeeId: string; amount: string; ewa: string }

export function CreateSchedule({ onClose }: { onClose: () => void }) {
  const accounts = useBankAccounts()
  const payees = usePayees()
  const [funding, setFunding] = useState('')
  const [name, setName] = useState('')
  const [freq, setFreq] = useState<(typeof FREQ)[number]>('monthly')
  const [tz, setTz] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')
  const [dow, setDow] = useState(1)
  const [dom, setDom] = useState('1')
  const [time, setTime] = useState('09:00')
  const [auto, setAuto] = useState(false)
  const [lines, setLines] = useState<Line[]>([{ payeeId: '', amount: '', ewa: '' }])
  const [review, setReview] = useState(false)
  const a = accounts.data?.find((x) => x.id === funding)
  const d = a?.decimals ?? null
  const items = lines.map((l) => ({ l, m: d !== null ? parseToMinor(l.amount, d) : null, ewaN: l.ewa.trim() ? Number(l.ewa) : undefined }))
  const domN = Number(dom)
  const ok = !!a && !!name.trim() && /^([01]\d|2[0-3]):[0-5]\d$/.test(time) && items.length > 0 && items.every((i) => i.l.payeeId && i.m && (i.ewaN === undefined || (Number.isInteger(i.ewaN) && i.ewaN >= 1 && i.ewaN <= 10000))) && (freq === 'monthly' ? Number.isInteger(domN) && domN >= 1 && domN <= 31 : true)
  const total = items.reduce((t, i) => t + (i.m ? BigInt(i.m) : 0n), 0n).toString()
  const setLine = (i: number, p: Partial<Line>) => setLines(lines.map((l, k) => (k === i ? { ...l, ...p } : l)))
  if (review && a) {
    return (
      <MoneyAction
        title="Confirm payroll schedule"
        rows={[
          { label: 'Name', value: name.trim() }, { label: 'Funded from', value: a.label || `${a.asset} on ${a.chain}` },
          { label: 'Runs', value: `${freq}${freq === 'monthly' ? ` on day ${domN}` : freq === 'weekly' || freq === 'biweekly' ? ` on ${DAYS[dow]}` : ''} at ${time} (${tz})` },
          { label: 'Payees', value: String(items.length) }, { label: 'Total each run', value: `${formatMinor(total, d)} ${a.asset}` },
          { label: 'Approval', value: auto ? 'Runs automatically' : 'Each run waits for approval' }, { label: 'Fee', value: 'None shown by the API' },
        ]}
        confirmLabel="Create schedule"
        note={auto ? 'Automatic runs send real money on schedule.' : undefined}
        run={() => bank.createSchedule({ fundingAccountId: funding, name: name.trim(), frequency: freq, timezone: tz, localTime: time, ...(freq === 'monthly' ? { dayOfMonth: domN } : { dayOfWeek: dow }), autoApprove: auto, items: items.map((i) => ({ payeeId: i.l.payeeId, amountMinor: i.m, ...(i.ewaN ? { ewaBps: i.ewaN } : {}) })) })}
        onClose={onClose}
      />
    )
  }
  return (
    <Sheet title="New payroll schedule" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Name"><Input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Funded from"><AccountSelect accounts={accounts.data ?? []} value={funding} onChange={setFunding} /></Field>
        <Select aria-label="Frequency" value={freq} onChange={(e) => setFreq(e.target.value as typeof freq)}>{FREQ.map((f) => <option key={f} value={f}>{f}</option>)}</Select>
        {freq === 'monthly' ? <Field label="Day of month (1-31)"><Input inputMode="numeric" value={dom} onChange={(e) => setDom(e.target.value)} /></Field> : <Select aria-label="Weekday" value={dow} onChange={(e) => setDow(Number(e.target.value))}>{DAYS.map((x, i) => <option key={x} value={i}>{x}</option>)}</Select>}
        <div className="grid grid-cols-2 gap-2"><Field label="Time (24h)"><Input value={time} maxLength={5} onChange={(e) => setTime(e.target.value)} /></Field><Field label="Time zone"><Input value={tz} onChange={(e) => setTz(e.target.value)} /></Field></div>
        <p className="text-xs font-semibold text-suwappu-purple-deep">Who gets paid</p>
        {lines.map((l, i) => (
          <Card key={i} className="!p-3 space-y-2">
            <Select aria-label="Payee" value={l.payeeId} onChange={(e) => setLine(i, { payeeId: e.target.value })}><option value="">Choose a payee</option>{(payees.data ?? []).filter((p) => p.status !== 'archived').map((p) => <option key={p.id} value={p.id}>{p.name} · {p.currency}</option>)}</Select>
            <AmountInput value={l.amount} onChange={(v) => setLine(i, { amount: v })} symbol={a?.asset} decimals={d} />
            <Field label="Earned wage access share (basis points, optional)" hint="Up to this share of accrued pay can be taken early. 5000 = 50%."><Input inputMode="numeric" value={l.ewa} onChange={(e) => setLine(i, { ewa: e.target.value })} /></Field>
            {lines.length > 1 && <Btn variant="ghost" onClick={() => setLines(lines.filter((_, k) => k !== i))}>Remove</Btn>}
          </Card>
        ))}
        <Btn variant="ghost" className="w-full" onClick={() => setLines([...lines, { payeeId: '', amount: '', ewa: '' }])}>Add another payee</Btn>
        <label className="flex items-start gap-2 text-xs min-h-[44px]"><input type="checkbox" className="mt-1" checked={auto} onChange={(e) => setAuto(e.target.checked)} /><span>Run automatically without waiting for approval.</span></label>
        <Btn className="w-full" disabled={!ok} onClick={() => setReview(true)}>Review</Btn>
      </div>
    </Sheet>
  )
}

/** Worker side: payouts made to me, plus earned-wage access against a schedule I am a payee on. */
export function MyPayouts() {
  const qc = useQueryClient()
  const assets = useBankAssets()
  const q = useQuery({ queryKey: ['bank', 'my-payouts'], queryFn: async () => (await bank.myPayouts()).payouts, retry: 1 })
  const [pairKey, setPairKey] = useState('')
  const [asset, setAsset] = useState('')
  const [amt, setAmt] = useState('')
  const pairs = Array.from(new Map((q.data ?? []).filter((r) => r.scheduleId && r.payeeId).map((r) => [`${r.scheduleId}|${r.payeeId}`, { sid: r.scheduleId as string, pid: r.payeeId as string, name: r.payee }] as const)).values())
  const check = pairs.find((p) => `${p.sid}|${p.pid}` === pairKey) ?? pairs[0] ?? null
  const [review, setReview] = useState(false)
  const avail = useQuery({ queryKey: ['bank', 'ewa', check?.sid, check?.pid], queryFn: () => bank.scheduleAdvanceAvailable(check!.sid, check!.pid), enabled: !!check, retry: 0 })
  const [pair, chainSel] = asset.split('|')
  const ad = assets.data?.find((x) => x.symbol === pair && x.chain === chainSel)
  const m = ad ? parseToMinor(amt, ad.decimals) : null
  return (
    <div className="space-y-3">
      <SectionTitle>Paid to me</SectionTitle>
      <QueryState query={q} isEmpty={(d) => d.length === 0} empty={<Empty title="No payouts yet" />}>
        {(list) => <Card className="divide-y divide-suwappu-sakura-mid/20 !py-1">{list.map((r) => { const dd = assets.data?.find((x) => x.symbol === (r.paidAsset ?? r.asset))?.decimals ?? null; return (
          <div key={r.itemId} className="py-2.5 flex justify-between gap-2"><div className="min-w-0"><p className="text-sm break-words">{r.payee}</p><Chip status={r.status} /></div><p className="text-sm tabular-nums text-right shrink-0">{formatMinor(r.paidAmountMinor ?? r.amountMinor, dd)} {r.paidAsset ?? r.asset}</p></div>
        )})}</Card>}
      </QueryState>
      <SectionTitle>Earned wage access</SectionTitle>
      <Card className="space-y-2">
        {q.isSuccess && !check && <p className="text-xs text-suwappu-text-secondary">Earned wage access appears here once your employer pays you through a payroll schedule.</p>}
        {check && <p className="text-xs text-suwappu-text-secondary">Check how much of your accrued pay you can take early.</p>}
        {pairs.length > 1 && <Select aria-label="Payroll schedule" value={`${check?.sid}|${check?.pid}`} onChange={(e) => setPairKey(e.target.value)}>{pairs.map((p) => <option key={`${p.sid}|${p.pid}`} value={`${p.sid}|${p.pid}`}>{p.name}</option>)}</Select>}
        {avail.isError && <ErrorBox error={avail.error} />}
        {check && avail.isLoading && <p className="text-sm animate-pulse">Checking what you can take…</p>}
        {avail.data && (
          <>
            <Select aria-label="Asset" value={asset} onChange={(e) => setAsset(e.target.value)}><option value="">Pay-out asset and network</option>{(assets.data ?? []).map((x) => <option key={`${x.symbol}|${x.chain}`} value={`${x.symbol}|${x.chain}`}>{x.symbol} on {x.chain}</option>)}</Select>
            {ad && (
              <>
                <Row label="Accrued" value={`${formatMinor(avail.data.accruedMinor, ad.decimals)} ${ad.symbol}`} /><Row label="Already advanced" value={`${formatMinor(avail.data.advancedMinor, ad.decimals)} ${ad.symbol}`} /><Row label="Available" value={`${formatMinor(avail.data.availableMinor, ad.decimals)} ${ad.symbol}`} />
                <AmountInput value={amt} onChange={setAmt} symbol={ad.symbol} decimals={ad.decimals} />
                <Btn className="w-full" disabled={!m || BigInt(m) > BigInt(avail.data.availableMinor)} onClick={() => setReview(true)}>Review</Btn>
              </>
            )}
          </>
        )}
      </Card>
      {review && check && ad && m && (
        <MoneyAction
          title="Take earned wages early"
          rows={[{ label: 'Advance', value: `${formatMinor(m, ad.decimals)} ${ad.symbol}` }, { label: 'Schedule', value: check.sid, mono: true }, { label: 'Fee', value: 'None shown by the API' }]}
          confirmLabel="Take advance"
          trackId={transferIdOf.ewa}
          run={(k) => bank.scheduleAdvance(check.sid, check.pid, m, k)}
          onClose={() => { setReview(false); setAmt(''); void avail.refetch(); void qc.invalidateQueries({ queryKey: ['bank'] }) }}
        />
      )}
    </div>
  )
}
