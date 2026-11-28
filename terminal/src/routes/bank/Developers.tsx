import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { bank } from '../../lib/bankApi'
import { useBankAccounts } from '../../hooks/bank/useBankCore'
import { useOrgs } from '../../hooks/bank/useBankDomains'
import { BankPage, Btn, Card, Empty, ErrorBox, Field, Input, QueryState, Row, SectionTitle, Select } from '../../components/bank/BankUI'
import { a11yToast } from '@/lib/a11yToast'

const obj = (v: unknown): Array<[string, string]> => Object.entries((v ?? {}) as Record<string, unknown>).filter(([, x]) => ['string', 'number', 'boolean'].includes(typeof x)).map(([k, x]) => [k, String(x)])

/** Payment address (handle): publishing requires choosing which accounts to advertise. */
function PaymentAddress() {
  const accounts = useBankAccounts()
  const [handle, setHandle] = useState(''); const [inst, setInst] = useState(''); const [domain, setDomain] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [kyc, setKyc] = useState<'none' | 'basic' | 'full'>('basic')
  const [tr, setTr] = useState(false); const [sanc, setSanc] = useState(false); const [jur, setJur] = useState('')
  const jurList = jur.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean)
  const ok = handle.trim().length >= 2 && !!inst.trim() && picked.length > 0 && jurList.every((j) => /^[A-Z]{2}$/.test(j))
  const m = useMutation({ mutationFn: () => bank.setNetworkAddress({ handle: handle.trim(), institutionName: inst.trim(), ...(domain.trim() ? { domain: domain.trim() } : {}), accountIds: picked, compliance: { kycLevel: kyc, travelRuleSupported: tr, sanctionsScreened: sanc, jurisdictions: jurList } }), onSuccess: () => a11yToast.success('Payment address published') })
  return (
    <Card className="space-y-2">
      <Field label="Handle"><Input value={handle} maxLength={63} onChange={(e) => setHandle(e.target.value)} /></Field>
      <Field label="Institution name"><Input value={inst} maxLength={120} onChange={(e) => setInst(e.target.value)} /></Field>
      <Field label="Domain (optional)"><Input value={domain} onChange={(e) => setDomain(e.target.value)} /></Field>
      <p className="text-xs font-semibold text-terminal-text">Accounts to advertise</p>
      {accounts.isLoading && <p className="text-xs animate-pulse">Loading accounts…</p>}
      {accounts.isError && <ErrorBox error={accounts.error} onRetry={() => void accounts.refetch()} />}
      {(accounts.data ?? []).map((a) => <label key={a.id} className="flex items-center gap-2 text-sm min-h-[40px] min-w-0"><input type="checkbox" checked={picked.includes(a.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, a.id] : picked.filter((x) => x !== a.id))} /><span className="min-w-0 break-words">{a.label || a.kind} · {a.asset} on {a.chain}</span></label>)}
      <Select aria-label="KYC level" value={kyc} onChange={(e) => setKyc(e.target.value as typeof kyc)}><option value="none">No KYC</option><option value="basic">Basic KYC</option><option value="full">Full KYC</option></Select>
      <label className="flex items-center gap-2 text-sm min-h-[40px]"><input type="checkbox" checked={tr} onChange={(e) => setTr(e.target.checked)} />Travel rule supported</label>
      <label className="flex items-center gap-2 text-sm min-h-[40px]"><input type="checkbox" checked={sanc} onChange={(e) => setSanc(e.target.checked)} />Sanctions screened</label>
      <Field label="Jurisdictions (2-letter codes, comma separated)"><Input value={jur} onChange={(e) => setJur(e.target.value)} /></Field>
      {m.isError && <ErrorBox error={m.error} />}
      <Btn className="w-full" disabled={!ok || m.isPending} onClick={() => m.mutate()}>{m.isPending ? 'Publishing…' : 'Publish address'}</Btn>
    </Card>
  )
}

/** Partner config / customers / usage for an org the viewer owns or administers (?orgId=). */
function Partner({ orgId }: { orgId: string }) {
  const cfg = useQuery({ queryKey: ['bank', 'platform-config', orgId], queryFn: async () => (await bank.platformConfig(orgId)).partner, retry: 0 })
  const cust = useQuery({ queryKey: ['bank', 'platform-customers', orgId], queryFn: async () => (await bank.platformCustomers(orgId)).customers, retry: 0 })
  const usage = useQuery({ queryKey: ['bank', 'platform-usage', orgId], queryFn: async () => (await bank.platformUsage(orgId)).usage, retry: 0 })
  return (
    <div className="space-y-3">
      <QueryState query={cfg} rows={1}>{(p) => <Card>{obj(p).map(([k, v]) => <Row key={k} label={k.replace(/([A-Z])/g, ' $1').toLowerCase()} value={v} mono={v.length > 24} />)}</Card>}</QueryState>
      <SectionTitle>Customers</SectionTitle>
      <QueryState query={cust} rows={1} isEmpty={(d) => d.length === 0} empty={<Empty title="No customers" />}>{(l) => <Card className="divide-y divide-terminal-border !py-1">{l.map((c, i) => <p key={i} className="py-2 text-sm break-all">{String((c as Record<string, unknown>).displayName ?? (c as Record<string, unknown>).externalRef ?? (c as Record<string, unknown>).id)}</p>)}</Card>}</QueryState>
      <Card><p className="text-sm text-terminal-text-secondary">Fee settings, webhooks and adding customers need your organization API key, so they cannot be changed from the Telegram app. Use the API key with the agent API; see the documentation.</p></Card>
      <SectionTitle>Usage (last 30 days)</SectionTitle>
      <QueryState query={usage} rows={1}>{(u) => <Card>{obj(u).map(([k, v]) => <Row key={k} label={k.replace(/([A-Z])/g, ' $1').toLowerCase()} value={v} />)}</Card>}</QueryState>
    </div>
  )
}

export function Developers() {
  const orgs = useOrgs()
  const admin = (orgs.data?.orgs ?? []).filter((o) => o.role === 'owner' || o.role === 'admin')
  const [sel, setSel] = useState('')
  const orgId = sel || admin[0]?.id || ''
  return (
    <BankPage title="Developers">
      <SectionTitle>Payment address</SectionTitle>
      <PaymentAddress />
      {orgs.isError && <ErrorBox error={orgs.error} onRetry={() => void orgs.refetch()} />}
      {orgs.isSuccess && admin.length === 0 && <Card><p className="text-sm text-terminal-text-secondary">API keys and platform settings are available to owners and admins of a business. Create or join one under Business.</p></Card>}
      {orgId && (
        <>
          {admin.length > 1 && <Select aria-label="Organization" value={orgId} onChange={(e) => setSel(e.target.value)}>{admin.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select>}
          <SectionTitle>API keys</SectionTitle>
          <Card>
            <p className="text-sm text-terminal-text-secondary">API keys are not managed in the terminal app. They are managed via the agent API; see the documentation for how to create and revoke them.</p>
            <a href="https://api.suwappu.bot/docs" target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex min-h-[44px] items-center text-sm font-semibold text-terminal-accent underline">Open API docs</a>
          </Card>
          <SectionTitle>Platform</SectionTitle>
          <Partner orgId={orgId} />
        </>
      )}
    </BankPage>
  )
}
