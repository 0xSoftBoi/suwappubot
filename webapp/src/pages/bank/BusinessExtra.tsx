import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { bank, fiatDecimals, formatMinor, parseToMinor, type ApprovalPolicy, type ApprovalRequest, type Bill, type CardBudget } from '../../lib/bankApi'
import { useBankAssets } from '../../hooks/bank/useBankCore'
import { useOrgData, usePayrollRuns } from '../../hooks/bank/useBankDomains'
import { Btn, Card, Chip, Empty, ErrorBox, Field, Input, QueryState, Row, SectionTitle, Select } from '../../components/bank/BankUI'
import { AccountSelect } from '../../components/bank/AccountSelect'
import { MoneyAction } from '../../components/bank/MoneyAction'
import { a11yToast } from '@/lib/a11yToast'

const ROLES = ['owner', 'admin', 'approver', 'accountant', 'member', 'viewer'] as const
const RULES: Array<ApprovalPolicy['ruleType']> = ['transfer_over', 'new_payee', 'payroll_run']
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
            {p.thresholdMinor && <Row label="Over" value={`${formatMinor(p.thresholdMinor, dec)} ${currency}`} />}
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
        <div className="flex flex-wrap gap-2">{ROLES.map((r) => <label key={r} className="flex items-center gap-1 text-xs min-h-[36px]"><input type="checkbox" checked={roles.includes(r)} onChange={(e) => setRoles(e.target.checked ? [...roles, r] : roles.filter((x) => x !== r))} />{r}</label>)}</div>
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
        <Card className="space-y-1"><p className="text-xs text-suwappu-text-secondary">Approval token for {label(token.data.action)}. Valid for {Math.round(token.data.expiresInSeconds / 60)} minutes. Paste it where the action asks for it.</p><p className="font-mono text-[11px] break-all">{token.data.token}</p><Btn variant="ghost" className="w-full" onClick={() => void copy(token.data.token)}>Copy token</Btn></Card>
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
            {b.lastError && <p className="text-xs text-red-500 break-words">{b.lastError}</p>}
            {['unpaid', 'failed'].includes(b.status) && <div className="grid grid-cols-2 gap-2 pt-1"><Btn onClick={() => { setSched(b); setFrom(''); setWhen('') }}>Schedule</Btn><Btn variant="danger" disabled={cancel.isPending} onClick={() => cancel.mutate(b.id)}>Cancel</Btn></div>}
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
        {(d) => <Card className="divide-y divide-suwappu-sakura-mid/20 !py-1">{d.vendors.map((v) => <div key={v.id} className="py-2 min-w-0"><p className="text-sm">{v.name}</p>{v.payAddress && <p className="font-mono text-[11px] break-all text-suwappu-text-secondary">{v.payAddress}{v.payChain ? ` · ${v.payChain}` : ''}</p>}</div>)}</Card>}
      </QueryState>
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
  const [monthly, setMonthly] = useState('')
  const [perTx, setPerTx] = useState('')
  const mM = dec !== null && monthly.trim() ? parseToMinor(monthly, dec) : null
  const pM = dec !== null && perTx.trim() ? parseToMinor(perTx, dec) : null
  const ok = !!scopeId.trim() && (mM || pM) && (!monthly.trim() || !!mM) && (!perTx.trim() || !!pM)
  const save = useMutation({ mutationFn: () => bank.setCardBudget(orgId, { scope, scopeId: scopeId.trim(), monthlyCapMinor: mM, perTxCapMinor: pM }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['bank', 'org', orgId] }); a11yToast.success('Budget saved') } })
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
        <Select aria-label="Scope" value={scope} onChange={(e) => setScope(e.target.value as 'member' | 'team')}><option value="member">Member (user id)</option><option value="team">Team</option></Select>
        <Field label={scope === 'member' ? 'Member user id' : 'Team name'}><Input value={scopeId} maxLength={64} onChange={(e) => setScopeId(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-2"><Field label={`Monthly (${currency})`}><Input inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} /></Field><Field label={`Per purchase (${currency})`}><Input inputMode="decimal" value={perTx} onChange={(e) => setPerTx(e.target.value)} /></Field></div>
        {save.isError && <ErrorBox error={save.error} />}
        <Btn className="w-full" disabled={!ok || save.isPending} onClick={() => save.mutate()}>Save budget</Btn>
      </Card>
    </div>
  )
}
