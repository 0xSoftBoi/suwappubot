import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { bank, formatMinor, isMinor, parseToMinor, type PayrollPreview } from '../../lib/bankApi'
import { useBankAccounts, useBankAssets } from '../../hooks/bank/useBankCore'
import { usePayees, usePayrollRun, usePayrollRuns, usePayrollSchedules } from '../../hooks/bank/useBankDomains'
import { BankPage, Btn, Card, Chip, Empty, ErrorBox, Field, Input, QueryState, Row, Select, Sheet, Tabs } from '../../components/bank/BankUI'
import { AccountSelect } from '../../components/bank/AccountSelect'
import { AmountInput } from '../../components/bank/Amount'
import { MoneyAction } from '../../components/bank/MoneyAction'
import { CreateSchedule, MyPayouts } from './PayrollExtra'
import { a11yToast } from '@/lib/a11yToast'

function Payees() {
  const qc = useQueryClient()
  const payees = usePayees()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<'worker' | 'contractor'>('contractor')
  const [address, setAddress] = useState('')
  const [chain, setChain] = useState('base')
  const [currency, setCurrency] = useState('USD')
  const add = useMutation({
    mutationFn: () => bank.createPayee({ kind, name: name.trim(), method: 'wallet', address: address.trim(), chain, currency }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['bank', 'payees'] }); a11yToast.success('Payee added'); setAdding(false) },
  })
  const archive = useMutation({ mutationFn: (id: string) => bank.archivePayee(id), onSuccess: () => void qc.invalidateQueries({ queryKey: ['bank', 'payees'] }) })
  return (
    <div className="space-y-3">
      <Btn className="w-full" onClick={() => setAdding(true)}>Add payee</Btn>
      {archive.isError && <ErrorBox error={archive.error} />}
      <QueryState query={payees} isEmpty={(d) => d.length === 0} empty={<Empty title="No payees" />}>
        {(l) => <Card className="divide-y divide-terminal-border !py-1">{l.map((p) => <div key={p.id} className="py-2.5 flex items-center justify-between gap-2"><div className="min-w-0"><p className="text-sm font-medium truncate">{p.name}</p><p className="text-[11px] text-terminal-text-secondary">{p.kind} · {p.method} · {p.currency}</p></div>{p.status === 'active' ? <Btn variant="ghost" className="!min-h-[36px] !px-3 text-xs" disabled={archive.isPending} onClick={() => archive.mutate(p.id)}>Archive</Btn> : <Chip status={p.status} />}</div>)}</Card>}
      </QueryState>
      {adding && (
        <Sheet title="Add payee" onClose={() => setAdding(false)} dismissible={!add.isPending}>
          <div className="space-y-3">
            <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Tabs value={kind} onChange={setKind} tabs={[{ id: 'contractor', label: 'Contractor' }, { id: 'worker', label: 'Worker' }]} />
            <Field label="Wallet address"><Input className="font-mono text-xs" value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-2"><Field label="Network"><Input value={chain} onChange={(e) => setChain(e.target.value.toLowerCase())} /></Field><Field label="Currency"><Input value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value.toUpperCase())} /></Field></div>
            {add.isError && <ErrorBox error={add.error} />}
            <Btn className="w-full" disabled={!name.trim() || address.trim().length < 20 || currency.length !== 3 || add.isPending} onClick={() => add.mutate()}>{add.isPending ? 'Adding…' : 'Add payee'}</Btn>
          </div>
        </Sheet>
      )}
    </div>
  )
}

function RunDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const q = usePayrollRun(id)
  const assets = useBankAssets()
  const [step, setStep] = useState<'approve' | 'execute' | 'retry' | null>(null)
  const [tok, setTok] = useState('')
  const pv = q.data as PayrollPreview | undefined
  const run = pv?.run
  const items = Array.isArray(pv?.items) ? pv.items : []
  const dRaw = run ? assets.data?.find((a) => a.symbol === run.asset && a.chain === run.chain)?.decimals : undefined
  const d = typeof dRaw === 'number' && Number.isInteger(dRaw) ? dRaw : null
  const sum = (xs: typeof items) => xs.reduce((s, x) => (isMinor(x.item.amountMinor) ? s + BigInt(x.item.amountMinor) : s), 0n).toString()
  const failed = items.filter((x) => x.item.status === 'failed')
  const total = isMinor(pv?.totalMinor) ? pv.totalMinor : sum(items)
  const stepItems = step === 'retry' ? failed : items
  const stepTotal = step === 'retry' ? sum(failed) : total
  const rows = [
    { label: step === 'retry' ? 'Retry total' : 'Total', value: `${formatMinor(stepTotal, d)} ${run?.asset ?? ''}` },
    { label: 'Payees', value: String(stepItems.length) },
    ...stepItems.map((x) => ({ label: x.payee.name, value: `${formatMinor(x.item.amountMinor, d)} ${run?.asset ?? ''}` })),
    { label: 'Fee', value: 'None shown by the API' },
  ]
  return (
    <Sheet title={run?.label || 'Payroll run'} onClose={onClose}>
      {q.isLoading && <p className="text-sm animate-pulse">Loading…</p>}
      {q.isError && <ErrorBox error={q.error} onRetry={() => void q.refetch()} />}
      {run && (
        <div className="space-y-2">
          <Row label="Status" value={<Chip status={run.status} />} />
          <Row label="Total" value={`${formatMinor(total, d)} ${run.asset}`} />
          {pv && !pv.sufficientFunds && <p className="text-xs text-terminal-warn">The funding account may not cover the outstanding payouts.</p>}
          {assets.isSuccess && d === null && <p className="text-xs text-terminal-warn">Amounts cannot be shown because this asset's precision is unknown, so actions are disabled.</p>}
          <div className="divide-y divide-terminal-border">
            {items.map((x) => (
              <div key={x.item.id} className="py-2 flex items-center justify-between gap-2">
                <div className="min-w-0"><p className="text-sm truncate">{x.payee.name}</p>{x.item.error && <p className="text-[11px] text-bear break-words">{String(x.item.error)}</p>}{x.issue && <p className="text-[11px] text-terminal-warn break-words">{x.issue}</p>}</div>
                <div className="text-right shrink-0"><p className="text-sm tabular-nums">{formatMinor(x.item.amountMinor, d)}</p><Chip status={String(x.item.status)} /></div>
              </div>
            ))}
          </div>
          {run.status === 'draft' && pv?.approvalRequired === true && <Field label="Approval token" hint="This run needs sign-off. Request approval under Business > Approvals, then paste the token you receive."><Input value={tok} onChange={(e) => setTok(e.target.value.trim())} autoComplete="off" /></Field>}
          <div className="grid grid-cols-2 gap-2 pt-1">
            {run.status === 'draft' && <Btn disabled={d === null || (pv?.approvalRequired === true && !tok)} onClick={() => setStep('approve')}>Approve</Btn>}
            {run.status === 'approved' && <Btn disabled={d === null} onClick={() => setStep('execute')}>Execute payroll</Btn>}
            {['partial', 'failed'].includes(run.status) && <Btn disabled={d === null || failed.length === 0} onClick={() => setStep('retry')}>Retry failed</Btn>}
          </div>
        </div>
      )}
      {step && run && d !== null && (
        <MoneyAction
          title={step === 'approve' ? 'Approve payroll' : step === 'execute' ? 'Execute payroll' : 'Retry failed payouts'}
          rows={rows} confirmLabel={step === 'approve' ? 'Approve' : step === 'execute' ? 'Pay everyone' : 'Retry'}
          note={step === 'execute' ? 'This sends real money to every payee in the run.' : undefined}
          run={() => (step === 'approve' ? bank.approveRun(id, tok || undefined) : step === 'execute' ? bank.executeRun(id) : bank.retryRun(id))}
          trackId={undefined}
          renderResult={(r) => (r && Array.isArray(r.items) ? <p className="text-xs text-terminal-text-secondary">{r.items.filter((i: { status: string }) => i.status === 'paid').length} paid, {r.items.filter((i: { status: string }) => i.status === 'failed').length} failed of {r.items.length}</p> : null)}
          onClose={() => { setStep(null); void q.refetch() }}
        />
      )}
    </Sheet>
  )
}

function Runs() {
  const runs = usePayrollRuns()
  const accounts = useBankAccounts()
  const payees = usePayees()
  const qc = useQueryClient()
  const [open, setOpen] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [fund, setFund] = useState('')
  const [label, setLabel] = useState('')
  const [lines, setLines] = useState<Array<{ payeeId: string; amount: string }>>([{ payeeId: '', amount: '' }])
  const fa = accounts.data?.find((a) => a.id === fund)
  const items = lines.map((l) => ({ payeeId: l.payeeId, amountMinor: fa?.decimals != null ? parseToMinor(l.amount, fa.decimals) : null }))
  const valid = !!fa && items.every((i) => i.payeeId && i.amountMinor)
  const create = useMutation({
    mutationFn: () => bank.createRun({ fundingAccountId: fund, label: label.trim() || undefined, items }),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['bank', 'payroll-runs'] }); setCreating(false); const id = (r as Record<string, any>).run?.id; if (id) setOpen(id) },
  })
  return (
    <div className="space-y-3">
      <Btn className="w-full" onClick={() => setCreating(true)}>New payroll run</Btn>
      <QueryState query={runs} isEmpty={(d) => d.length === 0} empty={<Empty title="No payroll runs" />}>
        {(l) => <div className="space-y-2">{l.map((r) => <button key={r.id} type="button" className="w-full text-left" onClick={() => setOpen(r.id)}><Card className="flex justify-between gap-2"><div className="min-w-0"><p className="text-sm font-semibold truncate">{r.label || 'Payroll run'}</p><p className="text-[11px] text-terminal-text-secondary">{r.createdAt ? new Date(r.createdAt).toLocaleDateString() : ''} · {r.asset}</p></div><Chip status={r.status} /></Card></button>)}</div>}
      </QueryState>
      {open && <RunDetail id={open} onClose={() => setOpen(null)} />}
      {creating && (
        <Sheet title="New payroll run" onClose={() => setCreating(false)} dismissible={!create.isPending}>
          <div className="space-y-3">
            <Field label="Fund from"><AccountSelect accounts={accounts.data ?? []} value={fund} onChange={setFund} /></Field>
            <Field label="Label"><Input value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_110px] gap-2">
                <Select value={l.payeeId} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, payeeId: e.target.value } : x)))}><option value="">Payee</option>{(payees.data ?? []).filter((p) => p.status === 'active').map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
                <AmountInput value={l.amount} onChange={(v) => setLines(lines.map((x, j) => (j === i ? { ...x, amount: v } : x)))} decimals={fa?.decimals ?? null} />
              </div>
            ))}
            <Btn variant="ghost" className="w-full" onClick={() => setLines([...lines, { payeeId: '', amount: '' }])}>Add line</Btn>
            {create.isError && <ErrorBox error={create.error} />}
            <Btn className="w-full" disabled={!valid || create.isPending} onClick={() => create.mutate()}>{create.isPending ? 'Preparing…' : 'Create and preview'}</Btn>
            <p className="text-[11px] text-terminal-text-secondary">Creating a run does not move money. You review, approve and execute it next.</p>
          </div>
        </Sheet>
      )}
    </div>
  )
}

function Schedules() {
  const [creating, setCreating] = useState(false)
  const q = usePayrollSchedules()
  const qc = useQueryClient()
  const set = useMutation({ mutationFn: ({ id, s }: { id: string; s: string }) => bank.setScheduleStatus(id, s), onSuccess: () => void qc.invalidateQueries({ queryKey: ['bank', 'payroll-schedules'] }) })
  return (
    <div className="space-y-3">
      <Btn className="w-full" onClick={() => setCreating(true)}>New schedule</Btn>
      {creating && <CreateSchedule onClose={() => setCreating(false)} />}
      {set.isError && <ErrorBox error={set.error} />}
      <QueryState query={q} isEmpty={(d) => d.length === 0} empty={<Empty title="No schedules" />}>
        {(l) => <div className="space-y-2">{l.map((s) => (
          <Card key={s.id}>
            <div className="flex justify-between"><p className="text-sm font-semibold">{s.name}</p><Chip status={s.status} /></div>
            <Row label="Frequency" value={`${s.frequency}${s.localTime ? ` at ${s.localTime}` : ''} (${s.timezone})`} />
            <Row label="Auto-approve" value={s.autoApprove ? 'Yes' : 'No'} />
            <Btn variant="ghost" className="w-full mt-1" disabled={set.isPending} onClick={() => set.mutate({ id: s.id, s: s.status === 'active' ? 'paused' : 'active' })}>{s.status === 'active' ? 'Pause' : 'Resume'}</Btn>
          </Card>
        ))}</div>}
      </QueryState>
    </div>
  )
}

export function Payroll() {
  const [tab, setTab] = useState<'runs' | 'payees' | 'sched' | 'mine'>('runs')
  return (
    <BankPage title="Payroll">
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'runs', label: 'Runs' }, { id: 'payees', label: 'Payees' }, { id: 'sched', label: 'Schedules' }, { id: 'mine', label: 'My pay' }]} />
      {tab === 'runs' && <Runs />}{tab === 'payees' && <Payees />}{tab === 'sched' && <Schedules />}{tab === 'mine' && <MyPayouts />}
    </BankPage>
  )
}
