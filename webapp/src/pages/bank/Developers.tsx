import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { bank } from '../../lib/bankApi'
import { useBankAccounts } from '../../hooks/bank/useBankCore'
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
      <p className="text-xs font-semibold text-suwappu-purple-deep">Accounts to advertise</p>
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

/** Partner config / customers / usage. These endpoints need an organization API key; a Telegram session is refused by the API and that message is shown as-is. */
function Partner() {
  const qc = useQueryClient()
  const cfg = useQuery({ queryKey: ['bank', 'platform-config'], queryFn: async () => (await bank.platformConfig()).partner, retry: 0 })
  const cust = useQuery({ queryKey: ['bank', 'platform-customers'], queryFn: async () => (await bank.platformCustomers()).customers, retry: 0 })
  const usage = useQuery({ queryKey: ['bank', 'platform-usage'], queryFn: async () => (await bank.platformUsage()).usage, retry: 0 })
  const [fT, setFT] = useState(''); const [fF, setFF] = useState(''); const [hook, setHook] = useState('')
  const save = useMutation({ mutationFn: () => bank.setPlatformConfig({ ...(fT.trim() ? { feeBpsTransfer: Number(fT) } : {}), ...(fF.trim() ? { feeBpsFx: Number(fF) } : {}), ...(hook.trim() ? { webhookUrl: hook.trim() } : {}) }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['bank', 'platform-config'] }) })
  const [ref, setRef] = useState(''); const [nm, setNm] = useState('')
  const add = useMutation({ mutationFn: () => bank.createPlatformCustomer({ externalRef: ref.trim(), ...(nm.trim() ? { displayName: nm.trim() } : {}) }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['bank', 'platform-customers'] }); setRef(''); setNm('') } })
  const bps = (s: string) => s.trim() === '' || (/^\d+$/.test(s) && Number(s) <= 1000)
  return (
    <div className="space-y-3">
      <QueryState query={cfg} rows={1}>{(p) => <Card>{obj(p).map(([k, v]) => <Row key={k} label={k.replace(/([A-Z])/g, ' $1').toLowerCase()} value={v} mono={v.length > 24} />)}</Card>}</QueryState>
      <Card className="space-y-2">
        <div className="grid grid-cols-2 gap-2"><Field label="Transfer fee (bps, max 1000)"><Input inputMode="numeric" value={fT} onChange={(e) => setFT(e.target.value)} /></Field><Field label="FX fee (bps, max 1000)"><Input inputMode="numeric" value={fF} onChange={(e) => setFF(e.target.value)} /></Field></div>
        <Field label="Webhook URL"><Input value={hook} onChange={(e) => setHook(e.target.value)} /></Field>
        {save.isError && <ErrorBox error={save.error} />}
        <Btn className="w-full" disabled={!bps(fT) || !bps(fF) || (!fT && !fF && !hook.trim()) || save.isPending} onClick={() => save.mutate()}>Save config</Btn>
      </Card>
      <SectionTitle>Customers</SectionTitle>
      <QueryState query={cust} rows={1} isEmpty={(d) => d.length === 0} empty={<Empty title="No customers" />}>{(l) => <Card className="divide-y divide-suwappu-sakura-mid/20 !py-1">{l.map((c, i) => <p key={i} className="py-2 text-sm break-all">{String((c as Record<string, unknown>).displayName ?? (c as Record<string, unknown>).externalRef ?? (c as Record<string, unknown>).id)}</p>)}</Card>}</QueryState>
      <Card className="space-y-2">
        <Field label="External reference"><Input value={ref} maxLength={128} onChange={(e) => setRef(e.target.value)} /></Field>
        <Field label="Display name (optional)"><Input value={nm} maxLength={200} onChange={(e) => setNm(e.target.value)} /></Field>
        {add.isError && <ErrorBox error={add.error} />}
        <Btn className="w-full" disabled={!ref.trim() || add.isPending} onClick={() => add.mutate()}>Add customer</Btn>
      </Card>
      <SectionTitle>Usage (last 30 days)</SectionTitle>
      <QueryState query={usage} rows={1}>{(u) => <Card>{obj(u).map(([k, v]) => <Row key={k} label={k.replace(/([A-Z])/g, ' $1').toLowerCase()} value={v} />)}</Card>}</QueryState>
    </div>
  )
}

export function Developers() {
  return (
    <BankPage title="Developers">
      <SectionTitle>Payment address</SectionTitle>
      <PaymentAddress />
      <SectionTitle>Platform</SectionTitle>
      <Partner />
    </BankPage>
  )
}
