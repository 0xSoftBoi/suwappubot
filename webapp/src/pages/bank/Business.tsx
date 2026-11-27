import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { bank, formatMinor, type Json } from '../../lib/bankApi'
import { useOrgData, useOrgs } from '../../hooks/bank/useBankDomains'
import { BankPage, Btn, Card, Chip, Empty, ErrorBox, Field, Input, QueryState, Row, SectionTitle, Select, Tabs } from '../../components/bank/BankUI'
import { ApprovalsInbox, BillsPanel, CardBudgets, OrgTransfer, PoliciesEditor } from './BusinessExtra'
import { a11yToast } from '@/lib/a11yToast'

type Tab = 'transfer' | 'members' | 'approvals' | 'treasury' | 'bills' | 'cards'
const ROLES = ['admin', 'approver', 'accountant', 'member', 'viewer']
const arr = (v: unknown): Array<Record<string, any>> => (Array.isArray(v) ? v : [])
const rd = (v: unknown): number => (typeof v === 'number' ? v : 6)

function Members({ orgId }: { orgId: string }) {
  const qc = useQueryClient()
  const q = useOrgData('members', orgId, bank.members)
  const [role, setRole] = useState('member')
  const [email, setEmail] = useState('')
  const [tg, setTg] = useState('')
  const inv = useMutation({ mutationFn: () => bank.invite(orgId, { role, ...(email.trim() ? { email: email.trim() } : { telegramId: Number(tg) }) }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['bank', 'org', orgId] }); a11yToast.success('Invite created') } })
  const token = (inv.data as Json | undefined)?.token ?? ((inv.data as Json | undefined)?.invite as Json | undefined)?.token
  return (
    <div className="space-y-3">
      <QueryState query={q} isEmpty={(d) => arr(d.members).length === 0} empty={<Empty title="No members" />}>
        {(d) => <Card className="divide-y divide-suwappu-sakura-mid/20 !py-1">{arr(d.members).map((m) => <div key={String(m.userId)} className="py-2.5 flex justify-between"><span className="text-sm">User {String(m.userId)}{m.team ? ` · ${m.team}` : ''}</span><Chip status={String(m.role)} tone="neutral" /></div>)}</Card>}
      </QueryState>
      <Card className="space-y-3">
        <p className="text-sm font-semibold">Invite someone</p>
        <Select value={role} onChange={(e) => setRole(e.target.value)}>{ROLES.map((r) => <option key={r}>{r}</option>)}</Select>
        <Field label="Invitee email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Or Telegram id" hint="Numeric Telegram user id. Use email or Telegram id, not both."><Input inputMode="numeric" value={tg} disabled={!!email.trim()} onChange={(e) => setTg(e.target.value.replace(/\D/g, ''))} /></Field>
        {inv.isError && <ErrorBox error={inv.error} />}
        <Btn className="w-full" disabled={inv.isPending || !(email.trim() ? /^\S+@\S+\.\S+$/.test(email.trim()) : /^[1-9]\d{0,14}$/.test(tg))} onClick={() => inv.mutate()}>{inv.isPending ? 'Creating…' : 'Create invite'}</Btn>
        {typeof token === 'string' && <p className="font-mono text-[11px] break-all">{token}</p>}
      </Card>
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

export function Business() {
  const orgs = useOrgs()
  const qc = useQueryClient()
  const [orgId, setOrgId] = useState('')
  const [tab, setTab] = useState<Tab>('treasury')
  const [name, setName] = useState('')
  const list = arr((orgs.data as Json | undefined)?.orgs)
  const active = orgId || (list[0]?.id as string | undefined) || ''
  const cur = String(list.find((o) => String(o.id) === active)?.reportingCurrency ?? 'USD')
  const create = useMutation({ mutationFn: () => bank.createOrg({ name: name.trim() }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['bank', 'orgs'] }); setName('') } })
  return (
    <BankPage title="Business">
      <QueryState query={orgs} rows={1} isEmpty={() => list.length === 0} empty={
        <Card className="space-y-3"><p className="text-sm font-semibold">Create your business</p><Field label="Business name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>{create.isError && <ErrorBox error={create.error} />}<Btn className="w-full" disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>{create.isPending ? 'Creating…' : 'Create'}</Btn></Card>
      }>
        {() => (
          <>
            <Select aria-label="Organization" value={active} onChange={(e) => setOrgId(e.target.value)}>{list.map((o) => <option key={String(o.id)} value={String(o.id)}>{String(o.name)} ({String(o.role)})</option>)}</Select>
            <Tabs value={tab} onChange={setTab} tabs={[{ id: 'treasury', label: 'Treasury' }, { id: 'transfer', label: 'Send' }, { id: 'approvals', label: 'Approvals' }, { id: 'members', label: 'Members' }, { id: 'bills', label: 'Bills' }, { id: 'cards', label: 'Card budgets' }]} />
            {tab === 'treasury' && <Treasury orgId={active} />}
            {tab === 'transfer' && <OrgTransfer orgId={active} currency={cur} />}
            {tab === 'approvals' && <><ApprovalsInbox orgId={active} /><PoliciesEditor orgId={active} currency={cur} /></>}
            {tab === 'members' && <Members orgId={active} />}
            {tab === 'bills' && <BillsPanel orgId={active} />}
            {tab === 'cards' && <CardBudgets orgId={active} currency={cur} />}
          </>
        )}
      </QueryState>
    </BankPage>
  )
}
