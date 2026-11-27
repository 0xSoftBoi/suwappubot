import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { bank, formatMinor, type ApprovalRequest, type Json } from '../../lib/bankApi'
import { useOrgData, useOrgs } from '../../hooks/bank/useBankDomains'
import { BankPage, Btn, Card, Chip, Empty, ErrorBox, Field, Input, QueryState, Row, SectionTitle, Select, Tabs } from '../../components/bank/BankUI'
import { a11yToast } from '@/lib/a11yToast'

type Tab = 'members' | 'approvals' | 'treasury' | 'bills'
const ROLES = ['admin', 'approver', 'accountant', 'member', 'viewer']
const arr = (v: unknown): Array<Record<string, any>> => (Array.isArray(v) ? v : [])
const rd = (v: unknown): number => (typeof v === 'number' ? v : 6)

function Members({ orgId }: { orgId: string }) {
  const qc = useQueryClient()
  const q = useOrgData('members', orgId, bank.members)
  const [role, setRole] = useState('member')
  const [email, setEmail] = useState('')
  const inv = useMutation({ mutationFn: () => bank.invite(orgId, { role, email: email.trim() || undefined }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['bank', 'org', orgId] }); a11yToast.success('Invite created') } })
  const token = (inv.data as Json | undefined)?.token ?? ((inv.data as Json | undefined)?.invite as Json | undefined)?.token
  return (
    <div className="space-y-3">
      <QueryState query={q} isEmpty={(d) => arr(d.members).length === 0} empty={<Empty title="No members" />}>
        {(d) => <Card className="divide-y divide-suwappu-sakura-mid/20 !py-1">{arr(d.members).map((m) => <div key={String(m.userId)} className="py-2.5 flex justify-between"><span className="text-sm">User {String(m.userId)}{m.team ? ` · ${m.team}` : ''}</span><Chip status={String(m.role)} tone="neutral" /></div>)}</Card>}
      </QueryState>
      <Card className="space-y-3">
        <p className="text-sm font-semibold">Invite someone</p>
        <Select value={role} onChange={(e) => setRole(e.target.value)}>{ROLES.map((r) => <option key={r}>{r}</option>)}</Select>
        <Field label="Email (optional)"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        {inv.isError && <ErrorBox error={inv.error} />}
        <Btn className="w-full" disabled={inv.isPending} onClick={() => inv.mutate()}>{inv.isPending ? 'Creating…' : 'Create invite'}</Btn>
        {typeof token === 'string' && <p className="font-mono text-[11px] break-all">{token}</p>}
      </Card>
    </div>
  )
}

function Approvals({ orgId }: { orgId: string }) {
  const qc = useQueryClient()
  const q = useOrgData('approvals', orgId, (id) => bank.approvals(id, 'pending'))
  const decide = useMutation({ mutationFn: ({ id, ok }: { id: string; ok: boolean }) => (ok ? bank.approve(id) : bank.reject(id)), onSuccess: () => void qc.invalidateQueries({ queryKey: ['bank', 'org', orgId] }) })
  return (
    <div className="space-y-2">
      {decide.isError && <ErrorBox error={decide.error} />}
      <QueryState query={q} isEmpty={(d) => arr(d.requests).length === 0} empty={<Empty title="Nothing waiting for approval" />}>
        {(d) => <>{(arr(d.requests) as unknown as ApprovalRequest[]).map((r) => (
          <Card key={r.id}>
            <div className="flex justify-between"><p className="text-sm font-semibold capitalize">{r.action.replace(/_/g, ' ')}</p><Chip status={r.status} /></div>
            <Row label="Approvals needed" value={r.requiredApprovals} />
            {r.expiresAt && <Row label="Expires" value={new Date(r.expiresAt).toLocaleString()} />}
            <div className="grid grid-cols-2 gap-2 mt-2"><Btn disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, ok: true })}>Approve</Btn><Btn variant="danger" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, ok: false })}>Reject</Btn></div>
          </Card>
        ))}</>}
      </QueryState>
    </div>
  )
}

function Treasury({ orgId }: { orgId: string }) {
  const t = useOrgData('treasury', orgId, bank.treasury)
  const r = useOrgData('runway', orgId, bank.runway)
  const x = useOrgData('fx', orgId, bank.fxExposure)
  const td = t.data as Json | undefined
  const rdec = rd(td?.reportingDecimals)
  const cur = String(td?.reportingCurrency ?? '')
  const kv = (o: Json | undefined) => Object.entries(o ?? {}).filter(([k, v]) => k !== 'success' && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'))
  return (
    <div className="space-y-3">
      <QueryState query={t} rows={2}>
        {(d) => (
          <>
            <Card><p className="text-xs text-suwappu-text-secondary">Total ({cur})</p><p className="text-2xl font-heading font-bold tabular-nums">{formatMinor(String(d.totalReportingMinor), rdec)}</p></Card>
            <Card className="divide-y divide-suwappu-sakura-mid/20 !py-1">
              {arr(d.holdings).length === 0 && <p className="py-2 text-sm">No holdings.</p>}
              {arr(d.holdings).map((h, i) => <div key={i} className="py-2.5 flex justify-between gap-2"><span className="text-sm">{String(h.asset)} · {String(h.chain)}</span><span className="text-sm tabular-nums">{String(h.balance ?? '—')}</span></div>)}
            </Card>
          </>
        )}
      </QueryState>
      <SectionTitle>Runway</SectionTitle>
      <QueryState query={r} rows={1}>
        {(d) => <Card>{kv(d).map(([k, v]) => <Row key={k} label={k.replace(/([A-Z])/g, ' $1').toLowerCase()} value={k.endsWith('Minor') && typeof v === 'string' ? formatMinor(v, rdec) : String(v)} />)}</Card>}
      </QueryState>
      <SectionTitle>Currency exposure</SectionTitle>
      <QueryState query={x} rows={1}>
        {(d) => <Card>{kv(d).map(([k, v]) => <Row key={k} label={k.replace(/([A-Z])/g, ' $1').toLowerCase()} value={k.endsWith('Minor') && typeof v === 'string' ? formatMinor(v, rdec) : String(v)} />)}{Object.values(d).filter(Array.isArray).flatMap((a) => (a as Array<Record<string, any>>).map((e, i) => <Row key={`${e.currency}${i}`} label={String(e.currency ?? e.key ?? '')} value={e.reportingMinor ? formatMinor(String(e.reportingMinor), rdec) : e.share !== undefined ? String(e.share) : ''} />))}</Card>}
      </QueryState>
    </div>
  )
}

function Bills({ orgId }: { orgId: string }) {
  const bills = useOrgData('bills', orgId, (id) => bank.bills(id))
  const vendors = useOrgData('vendors', orgId, bank.vendors)
  const qc = useQueryClient()
  const [vn, setVn] = useState('')
  const addV = useMutation({ mutationFn: () => bank.createVendor(orgId, { name: vn.trim() }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['bank', 'org', orgId] }); setVn('') } })
  const cancel = useMutation({ mutationFn: (id: string) => bank.cancelBill(orgId, id), onSuccess: () => void qc.invalidateQueries({ queryKey: ['bank', 'org', orgId] }) })
  const csv = useMutation({
    mutationFn: () => bank.booksCsv(orgId),
    onSuccess: (text) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = 'books.csv'; a.click(); URL.revokeObjectURL(a.href) },
  })
  return (
    <div className="space-y-3">
      <QueryState query={bills} isEmpty={(d) => arr(d.bills).length === 0} empty={<Empty title="No bills" />}>
        {(d) => <Card className="divide-y divide-suwappu-sakura-mid/20 !py-1">{arr(d.bills).map((b) => <div key={String(b.id)} className="py-2.5 flex justify-between gap-2"><div className="min-w-0"><p className="text-sm truncate">{String(b.reference ?? 'Bill')}</p><p className="text-[11px] text-suwappu-text-secondary">{vendors.data && arr((vendors.data as Json).vendors).find((v) => v.id === b.vendorId)?.name} · due {b.dueDate ? new Date(String(b.dueDate)).toLocaleDateString() : '—'}</p></div><div className="text-right shrink-0"><p className="text-sm tabular-nums">{formatMinor(String(b.amountMinor), 6)} {String(b.asset)}</p><Chip status={String(b.status)} />{['unpaid', 'scheduled'].includes(String(b.status)) && <button type="button" className="block ml-auto min-h-[36px] text-[11px] underline" disabled={cancel.isPending} onClick={() => cancel.mutate(String(b.id))}>Cancel</button>}</div></div>)}</Card>}
      </QueryState>
      {cancel.isError && <ErrorBox error={cancel.error} />}
      <SectionTitle>Vendors</SectionTitle>
      <QueryState query={vendors} isEmpty={(d) => arr(d.vendors).length === 0} empty={<Empty title="No vendors" />}>
        {(d) => <Card className="divide-y divide-suwappu-sakura-mid/20 !py-1">{arr(d.vendors).map((v) => <p key={String(v.id)} className="py-2.5 text-sm">{String(v.name)}</p>)}</Card>}
      </QueryState>
      <Card className="space-y-2"><Field label="New vendor"><Input value={vn} onChange={(e) => setVn(e.target.value)} /></Field>{addV.isError && <ErrorBox error={addV.error} />}<Btn className="w-full" disabled={!vn.trim() || addV.isPending} onClick={() => addV.mutate()}>Add vendor</Btn></Card>
      <SectionTitle>Books</SectionTitle>
      <Card className="space-y-2"><p className="text-xs text-suwappu-text-secondary">Download every booked entry as CSV.</p>{csv.isError && <ErrorBox error={csv.error} />}<Btn className="w-full" disabled={csv.isPending} onClick={() => csv.mutate()}>{csv.isPending ? 'Preparing…' : 'Download CSV'}</Btn></Card>
    </div>
  )
}

export function Business() {
  const orgs = useOrgs()
  const qc = useQueryClient()
  const [orgId, setOrgId] = useState('')
  const [tab, setTab] = useState<Tab>('treasury')
  const [name, setName] = useState('')
  const list = arr((orgs.data as Json | undefined)?.orgs)
  const active = orgId || (list[0]?.id as string | undefined) || ''
  const create = useMutation({ mutationFn: () => bank.createOrg({ name: name.trim() }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['bank', 'orgs'] }); setName('') } })
  return (
    <BankPage title="Business">
      <QueryState query={orgs} rows={1} isEmpty={() => list.length === 0} empty={
        <Card className="space-y-3"><p className="text-sm font-semibold">Create your business</p><Field label="Business name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>{create.isError && <ErrorBox error={create.error} />}<Btn className="w-full" disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>{create.isPending ? 'Creating…' : 'Create'}</Btn></Card>
      }>
        {() => (
          <>
            <Select aria-label="Organization" value={active} onChange={(e) => setOrgId(e.target.value)}>{list.map((o) => <option key={String(o.id)} value={String(o.id)}>{String(o.name)} ({String(o.role)})</option>)}</Select>
            <Tabs value={tab} onChange={setTab} tabs={[{ id: 'treasury', label: 'Treasury' }, { id: 'approvals', label: 'Approvals' }, { id: 'members', label: 'Members' }, { id: 'bills', label: 'Bills & books' }]} />
            {tab === 'treasury' && <Treasury orgId={active} />}
            {tab === 'approvals' && <Approvals orgId={active} />}
            {tab === 'members' && <Members orgId={active} />}
            {tab === 'bills' && <Bills orgId={active} />}
          </>
        )}
      </QueryState>
    </BankPage>
  )
}
