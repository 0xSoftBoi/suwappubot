import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { bank, transferIdOf, fiatDecimals, formatMinor, parseToMinor, type ApprovalPolicy, type ApprovalRequest, type Bill, type CardBudget } from '../../lib/bankApi'
import { useBankAssets } from '../../hooks/bank/useBankCore'
import { useOrgData, usePayrollRuns } from '../../hooks/bank/useBankDomains'
import { Btn, Card, Chip, Empty, ErrorBox, Field, Input, QueryState, Row, SectionTitle, Select } from '../../components/bank/BankUI'
import { AmountInput } from '../../components/bank/Amount'
import { AccountSelect } from '../../components/bank/AccountSelect'
import { MoneyAction } from '../../components/bank/MoneyAction'
import { a11yToast } from '@/lib/a11yToast'

const RULES: Array<ApprovalPolicy['ruleType']> = ['transfer_over', 'new_payee', 'payroll_run']
const APPROVER_ROLES = ['owner', 'admin', 'approver'] as const
const label = (s: string) => s.replace(/_/g, ' ')
const copy = (t: string) => navigator.clipboard.writeText(t).then(() => a11yToast.success('Copied'), () => a11yToast.error('Could not copy'))

/** Policies editor: thresholds are in reporting-currency minor units (BankApprovalService.createPolicy). */
export function PoliciesEditor({ orgId, currency }: { orgId: string; currency: string }) {
  const qc = useQueryClient()
  const q = useOrgData('policies', orgId, bank.policies)
  const dec = fiatDecimals(currency)
  const [rule, setRule] = useState<ApprovalPolicy['ruleType']>('transfer_over')
  const [threshold, setThreshold] = useState('')
  const [needed, setNeeded] = useState('1')
  const [roles, setRoles] = useState<string[]>(['approver'])
  const [hours, setHours] = useState('72')
  const thr = rule === 'transfer_over' && dec !== null ? parseToMinor(threshold, dec) : undefined
  const n = Number(needed), h = Number(hours)
  const valid = roles.length > 0 && Number.isInteger(n) && n >= 1 && n <= 10 && Number.isInteger(h) && h >= 1 && h <= 720 && (rule !== 'transfer_over' || !!thr)
  const inv = () => void qc.invalidateQueries({ queryKey: ['bank', 'org', orgId] })
  const add = useMutation({ mutationFn: () => bank.createPolicy(orgId, { ruleType: rule, ...(thr ? { thresholdMinor: thr } : {}), requiredApprovals: n, approverRoles: roles, expiryHours: h }), onSuccess: () => { inv(); setThreshold(''); a11yToast.success('Policy added') } })
  const del = useMutation({ mutationFn: (id: string) => bank.deletePolicy(orgId, id), onSuccess: inv })
  return (
    <div className="space-y-2">
      <SectionTitle>Approval policies</SectionTitle>
      <QueryState query={q} rows={1} isEmpty={(d) => d.policies.length === 0} empty={<Empty title="No policies" hint="Without a policy nothing needs approval." />}>
        {(d) => <>{d.policies.map((p) => (
          <Card key={p.id} className="!p-3">
            <div className="flex justify-between gap-2"><p className="text-sm font-semibold capitalize">{label(p.ruleType)}</p><Btn variant="danger" disabled={del.isPending} onClick={() => del.mutate(p.id)}>Remove</Btn></div>
            {p.thresholdMinor && <Row label="Over" value={`${formatMinor(p.thresholdMinor, p.thresholdDecimals ?? dec)} ${p.thresholdCurrency ?? currency}`} />}
            <Row label="Approvals needed" value={p.requiredApprovals} /><Row label="Approver roles" value={p.approverRoles.join(', ')} /><Row label="Expires after" value={`${p.expiryHours} h`} />
          </Card>
        ))}</>}
      </QueryState>
      {del.isError && <ErrorBox error={del.error} />}
      <Card className="space-y-2">
        <p className="text-sm font-semibold">Add a policy</p>
        <Select aria-label="Rule" value={rule} onChange={(e) => setRule(e.target.value as typeof rule)}>{RULES.map((r) => <option key={r} value={r}>{label(r)}</option>)}</Select>
        {rule === 'transfer_over' && <Field label={`Threshold (${currency})`}><Input inputMode="decimal" value={threshold} onChange={(e) => setThreshold(e.target.value)} /></Field>}
        <div className="grid grid-cols-2 gap-2">
          <Field label="Approvals needed"><Input inputMode="numeric" value={needed} onChange={(e) => setNeeded(e.target.value)} /></Field>
          <Field label="Expires after (hours)"><Input inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value)} /></Field>
        </div>
        <div className="flex flex-wrap gap-2">{APPROVER_ROLES.map((r) => <label key={r} className="flex items-center gap-1 text-xs min-h-[36px]"><input type="checkbox" checked={roles.includes(r)} onChange={(e) => setRoles(e.target.checked ? [...roles, r] : roles.filter((x) => x !== r))} />{r}</label>)}</div>
        {add.isError && <ErrorBox error={add.error} />}
        <Btn className="w-full" disabled={!valid || add.isPending} onClick={() => add.mutate()}>Add policy</Btn>
      </Card>
    </div>
  )
}

/** Inbox actions + token request + payroll approval request (payload exactly { runId, totalMinor }, action payroll_run). */
export function ApprovalsInbox({ orgId }: { orgId: string }) {
  const qc = useQueryClient()
  const q = useOrgData('approvals-all', orgId, (id) => bank.approvals(id))
  const runs = usePayrollRuns()
  const [comment, setComment] = useState('')
  const [runId, setRunId] = useState('')
  const inv = () => void qc.invalidateQueries({ queryKey: ['bank', 'org', orgId] })
  const decide = useMutation({ mutationFn: ({ id, ok }: { id: string; ok: boolean }) => (ok ? bank.approve(id, comment.trim() || undefined) : bank.reject(id, comment.trim() || undefined)), onSuccess: () => { inv(); setComment('') } })
  const cancel = useMutation({ mutationFn: (id: string) => bank.cancelApproval(id), onSuccess: inv })
  const token = useMutation({ mutationFn: (id: string) => bank.approvalToken(id) })
  const request = useMutation({
    mutationFn: async () => {
      const p = await bank.previewRun(runId)
      return bank.requestApproval(orgId, { action: 'payroll_run', payload: { runId, totalMinor: p.totalMinor } })
    },
    onSuccess: inv,
  })
  const reqs = (q.data?.requests ?? []) as unknown as Array<ApprovalRequest & { decisions?: unknown[] }>
  return (
    <div className="space-y-2">
      {(decide.isError || cancel.isError || token.isError) && <ErrorBox error={decide.error ?? cancel.error ?? token.error} />}
      <QueryState query={q} isEmpty={() => reqs.length === 0} empty={<Empty title="No approval requests" />}>
        {() => <>{reqs.map((r) => (
          <Card key={r.id} className="!p-3 space-y-1">
            <div className="flex justify-between gap-2"><p className="text-sm font-semibold capitalize">{label(r.action)}</p><Chip status={r.status} /></div>
            <Row label="Approvals needed" value={r.requiredApprovals} />
            {r.payload && 'totalMinor' in r.payload && <Row label="Run total (minor units)" value={String(r.payload.totalMinor)} mono />}
            {r.expiresAt && <Row label="Expires" value={new Date(r.expiresAt).toLocaleString()} />}
            {r.status === 'pending' && (
              <div className="grid grid-cols-3 gap-2 pt-1">
                <Btn disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, ok: true })}>Approve</Btn>
                <Btn variant="danger" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, ok: false })}>Reject</Btn>
                <Btn variant="ghost" disabled={cancel.isPending} onClick={() => cancel.mutate(r.id)}>Cancel</Btn>
              </div>
            )}
            {r.status === 'approved' && <Btn variant="ghost" className="w-full" disabled={token.isPending} onClick={() => token.mutate(r.id)}>Get approval token (requester only)</Btn>}
          </Card>
        ))}</>}
      </QueryState>
      <Field label="Comment for approve / reject (optional)"><Input value={comment} maxLength={280} onChange={(e) => setComment(e.target.value)} /></Field>
      {token.data && (
        <Card className="space-y-1"><p className="text-xs text-terminal-text-secondary">Approval token for {label(token.data.action)}. Valid for {Math.round(token.data.expiresInSeconds / 60)} minutes. Paste it where the action asks for it.</p><p className="font-mono text-[11px] break-all">{token.data.token}</p><Btn variant="ghost" className="w-full" onClick={() => void copy(token.data.token)}>Copy token</Btn></Card>
      )}
      <Card className="space-y-2">
        <p className="text-sm font-semibold">Request approval for a payroll run</p>
        <Select aria-label="Payroll run" value={runId} onChange={(e) => setRunId(e.target.value)}><option value="">Choose a run</option>{(runs.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.label || r.id} · {r.status}</option>)}</Select>
        {request.isError && <ErrorBox error={request.error} />}
        {request.data && <p className="text-xs">{request.data.required ? 'Approval requested.' : 'No policy matches this run, so no approval is needed.'}</p>}
        <Btn className="w-full" disabled={!runId || request.isPending} onClick={() => request.mutate()}>{request.isPending ? 'Requesting…' : 'Request approval'}</Btn>
      </Card>
    </div>
  )
}

/** Vendors + bills (bill decimals come from /assets by asset+chain), schedule with confirm sheet. */
export function BillsPanel({ orgId }: { orgId: string }) {
  const qc = useQueryClient()
  const assets = useBankAssets()
  const vendors = useOrgData('vendors', orgId, bank.vendors)
  const bills = useOrgData('bills', orgId, (id) => bank.bills(id))
  const accts = useQuery({ queryKey: ['bank', 'org', orgId, 'accounts'], queryFn: async () => (await bank.orgAccounts(orgId)).accounts ?? [] })
  const inv = () => void qc.invalidateQueries({ queryKey: ['bank', 'org', orgId] })
  const dec = (b: { asset: string; chain: string }) => assets.data?.find((a) => a.symbol === b.asset && a.chain === b.chain)?.decimals ?? null
  const [vn, setVn] = useState(''); const [ve, setVe] = useState(''); const [va, setVa] = useState(''); const [vc, setVc] = useState('')
  const addV = useMutation({ mutationFn: () => bank.createVendor(orgId, { name: vn.trim(), ...(ve.trim() ? { email: ve.trim() } : {}), ...(va.trim() ? { payAddress: va.trim(), payChain: vc.trim() || undefined } : {}) }), onSuccess: () => { inv(); setVn(''); setVe(''); setVa(''); setVc('') } })
  const [vendorId, setVendorId] = useState(''); const [ref, setRef] = useState(''); const [amount, setAmount] = useState(''); const [pair, setPair] = useState(''); const [due, setDue] = useState('')
  const a = assets.data?.find((x) => `${x.symbol}|${x.chain}` === pair)
  const minor = a ? parseToMinor(amount, a.decimals) : null
  const addB = useMutation({ mutationFn: () => bank.createBill(orgId, { vendorId, ...(ref.trim() ? { reference: ref.trim() } : {}), amountMinor: minor as string, asset: (a as NonNullable<typeof a>).symbol, chain: (a as NonNullable<typeof a>).chain, dueDate: new Date(`${due}T00:00:00`).toISOString() }), onSuccess: () => { inv(); setAmount(''); setRef('') } })
  const cancel = useMutation({ mutationFn: (id: string) => bank.cancelBill(orgId, id), onSuccess: inv })
  const [sched, setSched] = useState<Bill | null>(null); const [from, setFrom] = useState(''); const [when, setWhen] = useState('')
  const fromAcct = accts.data?.find((x) => x.id === from)
  const csv = useMutation({
    mutationFn: () => bank.booksCsv(orgId),
    onSuccess: (text) => { const el = document.createElement('a'); el.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); el.download = 'books.csv'; el.click(); URL.revokeObjectURL(el.href) },
  })
  return (
    <div className="space-y-3">
      <SectionTitle>Bills</SectionTitle>
      <QueryState query={bills} rows={1} isEmpty={(d) => d.bills.length === 0} empty={<Empty title="No bills" />}>
        {(d) => <>{d.bills.map((b) => (
          <Card key={b.id} className="!p-3 space-y-1">
            <div className="flex justify-between gap-2"><p className="text-sm font-semibold tabular-nums">{formatMinor(b.amountMinor, dec(b))} {b.asset}</p><Chip status={b.status} /></div>
            <Row label="Vendor" value={vendors.data?.vendors.find((v) => v.id === b.vendorId)?.name ?? b.vendorId} />
            {b.reference && <Row label="Reference" value={b.reference} />}
            <Row label="Due" value={new Date(b.dueDate).toLocaleDateString()} />
            {b.scheduledFor && <Row label="Scheduled" value={new Date(b.scheduledFor).toLocaleDateString()} />}
            {b.lastError && <p className="text-xs text-bear break-words">{b.lastError}</p>}
            {['unpaid', 'failed', 'scheduled', 'pending_approval'].includes(b.status) && <div className="grid grid-cols-2 gap-2 pt-1">{['unpaid', 'failed'].includes(b.status) ? <Btn onClick={() => { setSched(b); setFrom(''); setWhen('') }}>Schedule</Btn> : <span />}<Btn variant="danger" disabled={cancel.isPending} onClick={() => cancel.mutate(b.id)}>Cancel</Btn></div>}
          </Card>
        ))}</>}
      </QueryState>
      {cancel.isError && <ErrorBox error={cancel.error} />}
      {sched && (
        <Card className="space-y-2">
          <p className="text-sm font-semibold">Schedule payment of {formatMinor(sched.amountMinor, dec(sched))} {sched.asset}</p>
          <Field label="Pay from"><AccountSelect accounts={(accts.data ?? []).filter((x) => x.asset === sched.asset && x.chain === sched.chain)} value={from} onChange={setFrom} /></Field>
          <Field label="Pay on"><Input type="date" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-2"><Btn variant="ghost" onClick={() => setSched(null)}>Close</Btn></div>
          {fromAcct && when && (
            <MoneyAction
              title="Confirm scheduled bill payment"
              rows={[
                { label: 'Pay', value: `${formatMinor(sched.amountMinor, dec(sched))} ${sched.asset}` },
                { label: 'To vendor', value: vendors.data?.vendors.find((v) => v.id === sched.vendorId)?.name ?? sched.vendorId },
                { label: 'From', value: fromAcct.label || `${fromAcct.asset} on ${fromAcct.chain}` },
                { label: 'On', value: new Date(`${when}T00:00:00`).toLocaleDateString() },
                { label: 'Fee', value: 'None shown by the API' },
              ]}
              confirmLabel="Schedule payment"
              note="The payment is sent automatically on that date, or sent for approval first if a policy requires it."
              run={() => bank.scheduleBill(orgId, sched.id, { payFromAccountId: from, scheduledFor: new Date(`${when}T00:00:00`).toISOString() })}
              renderResult={(r) => (r?.approvalRequired ? <p className="text-xs">This bill needs approval before it is paid.</p> : null)}
              onClose={() => { setSched(null); inv() }}
            />
          )}
        </Card>
      )}
      <Card className="space-y-2">
        <p className="text-sm font-semibold">New bill</p>
        <Select aria-label="Vendor" value={vendorId} onChange={(e) => setVendorId(e.target.value)}><option value="">Choose a vendor</option>{(vendors.data?.vendors ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</Select>
        <Select aria-label="Asset" value={pair} onChange={(e) => setPair(e.target.value)}><option value="">Asset and network</option>{(assets.data ?? []).map((x) => <option key={`${x.symbol}|${x.chain}`} value={`${x.symbol}|${x.chain}`}>{x.symbol} on {x.chain}</option>)}</Select>
        <Field label="Amount"><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Reference (optional)"><Input value={ref} maxLength={120} onChange={(e) => setRef(e.target.value)} /></Field>
        <Field label="Due date"><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        {addB.isError && <ErrorBox error={addB.error} />}
        <Btn className="w-full" disabled={!vendorId || !minor || !due || addB.isPending} onClick={() => addB.mutate()}>Create bill</Btn>
      </Card>
      <SectionTitle>Vendors</SectionTitle>
      <QueryState query={vendors} rows={1} isEmpty={(d) => d.vendors.length === 0} empty={<Empty title="No vendors" />}>
        {(d) => <Card className="divide-y divide-terminal-border !py-1">{d.vendors.map((v) => <div key={v.id} className="py-2 min-w-0"><p className="text-sm">{v.name}</p>{v.payAddress && <p className="font-mono text-[11px] break-all text-terminal-text-secondary">{v.payAddress}{v.payChain ? ` · ${v.payChain}` : ''}</p>}</div>)}</Card>}
      </QueryState>
      <SectionTitle>Books</SectionTitle>
      <Card className="space-y-2"><p className="text-xs text-terminal-text-secondary">Download every booked entry as CSV.</p>{csv.isError && <ErrorBox error={csv.error} />}<Btn className="w-full" disabled={csv.isPending} onClick={() => csv.mutate()}>{csv.isPending ? 'Preparing…' : 'Download CSV'}</Btn></Card>
      <Card className="space-y-2">
        <Field label="Vendor name"><Input value={vn} maxLength={200} onChange={(e) => setVn(e.target.value)} /></Field>
        <Field label="Email (optional)"><Input type="email" value={ve} onChange={(e) => setVe(e.target.value)} /></Field>
        <Field label="Pay address (optional)"><Input value={va} maxLength={128} onChange={(e) => setVa(e.target.value)} /></Field>
        {va.trim() && <Field label="Network of that address"><Input value={vc} maxLength={32} onChange={(e) => setVc(e.target.value)} /></Field>}
        {addV.isError && <ErrorBox error={addV.error} />}
        <Btn className="w-full" disabled={!vn.trim() || addV.isPending} onClick={() => addV.mutate()}>Add vendor</Btn>
      </Card>
    </div>
  )
}

/** Card budgets per member/team. Caps are entered in the org reporting currency. */
export function CardBudgets({ orgId, currency }: { orgId: string; currency: string }) {
  const qc = useQueryClient()
  const q = useOrgData('card-budgets', orgId, bank.cardBudgets)
  const dec = fiatDecimals(currency)
  const [scope, setScope] = useState<'member' | 'team'>('member')
  const [scopeId, setScopeId] = useState('')
  // null = untouched (keep the saved value); a string = what the user typed (empty clears that cap).
  const [monthly, setMonthly] = useState<string | null>(null)
  const [perTx, setPerTx] = useState<string | null>(null)
  const existing = (q.data?.budgets ?? []).find((b) => b.scope === scope && b.scopeId === scopeId.trim())
  const keep = (v: string | null | undefined) => (typeof v === 'string' && /^\d+$/.test(v) && v !== '0' ? v : null)
  const resolve = (typed: string | null, saved: string | null | undefined) => (typed === null ? { ok: true, v: keep(saved) } : typed.trim() === '' ? { ok: true, v: null } : dec !== null && parseToMinor(typed, dec) ? { ok: true, v: parseToMinor(typed, dec) } : { ok: false, v: null })
  const mR = resolve(monthly, existing?.monthlyCapMinor), pR = resolve(perTx, existing?.perTxCapMinor)
  const mM = mR.v, pM = pR.v
  const ok = !!scopeId.trim() && !!q.data && dec !== null && mR.ok && pR.ok && !!(mM || pM)
  const save = useMutation({ mutationFn: () => bank.setCardBudget(orgId, { scope, scopeId: scopeId.trim(), monthlyCapMinor: mM, perTxCapMinor: pM, ...(existing?.categoryBudgets && Object.keys(existing.categoryBudgets).length ? { categoryBudgets: existing.categoryBudgets } : {}) }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['bank', 'org', orgId] }); setMonthly(null); setPerTx(null); a11yToast.success('Budget saved') } })
  return (
    <div className="space-y-2">
      <SectionTitle>Card budgets</SectionTitle>
      <QueryState query={q} rows={1} isEmpty={(d) => d.budgets.length === 0} empty={<Empty title="No card budgets" />}>
        {(d) => <>{d.budgets.map((b: CardBudget, i) => (
          <Card key={b.id ?? i} className="!p-3">
            <p className="text-sm font-semibold capitalize">{b.scope} {b.scopeId}</p>
            <Row label="Monthly cap" value={b.monthlyCapMinor ? `${formatMinor(b.monthlyCapMinor, dec)} ${currency}` : 'None'} />
            <Row label="Per purchase" value={b.perTxCapMinor ? `${formatMinor(b.perTxCapMinor, dec)} ${currency}` : 'None'} />
          </Card>
        ))}</>}
      </QueryState>
      <Card className="space-y-2">
        <Select aria-label="Scope" value={scope} onChange={(e) => { setScope(e.target.value as 'member' | 'team'); setMonthly(null); setPerTx(null) }}><option value="member">Member (user id)</option><option value="team">Team</option></Select>
        <Field label={scope === 'member' ? 'Member user id' : 'Team name'}><Input value={scopeId} maxLength={64} onChange={(e) => { setScopeId(e.target.value); setMonthly(null); setPerTx(null) }} /></Field>
        <div className="grid grid-cols-2 gap-2"><Field label={`Monthly (${currency})`}><Input inputMode="decimal" value={monthly ?? ''} placeholder={existing?.monthlyCapMinor ? `Current ${formatMinor(existing.monthlyCapMinor, dec)}` : ''} onChange={(e) => setMonthly(e.target.value)} /></Field><Field label={`Per purchase (${currency})`}><Input inputMode="decimal" value={perTx ?? ''} placeholder={existing?.perTxCapMinor ? `Current ${formatMinor(existing.perTxCapMinor, dec)}` : ''} onChange={(e) => setPerTx(e.target.value)} /></Field></div>
        {existing && <p className="text-[11px] text-terminal-text-secondary">This member or team already has a budget. Leave a box untouched to keep its current cap; clear a box to remove that cap. Category budgets are kept.</p>}
        {save.isError && <ErrorBox error={save.error} />}
        <Btn className="w-full" disabled={!ok || save.isPending} onClick={() => save.mutate()}>Save budget</Btn>
      </Card>
    </div>
  )
}

/** Org transfer. When a policy requires approval the API returns a request instead of moving money; once approved the requester gets a token (Approvals tab) and resubmits with it. */
export function OrgTransfer({ orgId, currency }: { orgId: string; currency: string }) {
  const accts = useQuery({ queryKey: ['bank', 'org', orgId, 'accounts'], queryFn: async () => (await bank.orgAccounts(orgId)).accounts ?? [], retry: 1 })
  const [from, setFrom] = useState('')
  const [mode, setMode] = useState<'account' | 'external'>('account')
  const [toAcct, setToAcct] = useState('')
  const [addr, setAddr] = useState('')
  const [amt, setAmt] = useState('')
  const [memo, setMemo] = useState('')
  const [tok, setTok] = useState('')
  const [review, setReview] = useState(false)
  const list = accts.data ?? []
  const a = list.find((x) => x.id === from)
  const aDec = typeof a?.decimals === 'number' && Number.isInteger(a.decimals) ? a.decimals : null
  const minor = aDec !== null ? parseToMinor(amt, aDec) : null
  const destOk = mode === 'account' ? !!toAcct && toAcct !== from : addr.trim().length >= 20
  const toAccount = list.find((x) => x.id === toAcct)
  return (
    <div className="space-y-3">
      <Card className="space-y-3">
        <p className="text-sm font-semibold">Send from a business account</p>
        <p className="text-xs text-terminal-text-secondary">Transfers over your approval policy threshold (set in {currency}) are held for approval. Request it, get it approved, then paste the approval token below and send again.</p>
        {accts.isError && <ErrorBox error={accts.error} onRetry={() => void accts.refetch()} />}
        <Field label="From"><AccountSelect accounts={list} value={from} onChange={(v) => { setFrom(v); setToAcct('') }} /></Field>
        {a && aDec === null && <p className="text-xs text-terminal-warn">This account's precision is not available, so amounts cannot be entered safely. Nothing was sent.</p>}
        <Select aria-label="Destination type" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}><option value="account">Another business account</option><option value="external">External address</option></Select>
        {mode === 'account' ? <AccountSelect accounts={list.filter((x) => !a || (x.asset === a.asset && x.chain === a.chain))} value={toAcct} onChange={setToAcct} exclude={from} /> : <Field label="Address"><Input value={addr} maxLength={128} onChange={(e) => setAddr(e.target.value.trim())} /></Field>}
        <Field label="Amount">{a ? <AmountInput value={amt} onChange={setAmt} symbol={a.asset} decimals={aDec} /> : <p className="text-xs text-terminal-text-secondary">Pick an account first.</p>}</Field>
        <Field label="Memo (optional)"><Input value={memo} maxLength={140} onChange={(e) => setMemo(e.target.value)} /></Field>
        <Field label="Approval token (only if this transfer was approved)"><Input value={tok} autoComplete="off" onChange={(e) => setTok(e.target.value.trim())} /></Field>
        <Btn className="w-full" disabled={!a || !minor || minor === '0' || !destOk} onClick={() => setReview(true)}>Review</Btn>
      </Card>
      {review && a && aDec !== null && minor && (
        <MoneyAction
          key={tok}
          title="Confirm business transfer"
          rows={[
            { label: 'Send', value: `${formatMinor(minor, aDec)} ${a.asset}` },
            { label: 'Network', value: a.chain },
            { label: 'From', value: a.label || a.kind },
            { label: 'To', value: mode === 'account' ? (toAccount ? `${toAccount.label || toAccount.kind} (${toAcct})` : toAcct) : addr, mono: mode === 'external' },
            ...(memo.trim() ? [{ label: 'Memo', value: memo.trim() }] : []),
            { label: 'Approval', value: tok ? 'Token attached' : 'Held for approval if your policy requires it' },
            { label: 'Fee', value: 'None shown by the API' },
          ]}
          confirmLabel="Send"
          trackId={transferIdOf.orgTransfer}
          run={(k) => bank.orgTransfer(orgId, { fromAccountId: a.id, ...(mode === 'account' ? { toAccountId: toAcct } : { toExternal: { address: addr } }), amountMinor: minor, ...(memo.trim() ? { memo: memo.trim() } : {}), ...(tok ? { approvalToken: tok } : {}) }, k)}
          renderResult={(r) => (r?.approvalRequired ? <div className="space-y-1"><p className="text-sm font-semibold">Approval needed, nothing was sent</p><p className="text-xs break-words">{String(r.reason)}</p><p className="text-xs text-terminal-text-secondary">Request {r.request?.id}. After an approver signs off, open Approvals, tap Get token, then paste it here and send again.</p></div> : null)}
          onClose={() => { setReview(false); void accts.refetch() }}
        />
      )}
    </div>
  )
}
