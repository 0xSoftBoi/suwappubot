import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { QRCodeSVG } from '../../lib/QRCodeSVG'
import { bank, transferIdOf, currencyDecimals, formatMinor, parseToMinor, type PayoutRequest, type RoutedQuotes } from '../../lib/bankApi'
import { useBankAccounts, useBankAssets } from '../../hooks/bank/useBankCore'
import { useExternalAccounts, useKyc, useProviders, useRails, useRampTransfers, useVirtualAccounts } from '../../hooks/bank/useBankDomains'
import { useIdempotencyKey } from '../../hooks/bank/useIdempotencyKey'
import { BankPage, Btn, Card, Chip, Empty, ErrorBox, Field, Input, QueryState, Row, SectionTitle, Select, Tabs } from '../../components/bank/BankUI'
import { AccountSelect } from '../../components/bank/AccountSelect'
import { AmountInput } from '../../components/bank/Amount'
import { ConfirmSheet } from '../../components/bank/ConfirmSheet'
import { TransferTracker } from '../../components/bank/TransferTracker'
import { a11yToast } from '@/lib/a11yToast'

type Tab = 'add' | 'out' | 'kyc' | 'banks' | 'rails' | 'qr'
const PROVIDERS = ['bridge', 'due'] as const

function Kyc() {
  const [provider, setProvider] = useState<'bridge' | 'due'>('bridge')
  const kyc = useKyc(provider)
  const qc = useQueryClient()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [type, setType] = useState<'individual' | 'business'>('individual')
  const start = useMutation({ mutationFn: () => bank.startKyc({ provider, email: email.trim(), fullName: name.trim(), type }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['bank', 'kyc'] }) })
  const link = (kyc.data ?? start.data?.customer)?.kycLink
  const tos = (kyc.data ?? start.data?.customer)?.tosLink
  return (
    <div className="space-y-3">
      <Tabs value={provider} onChange={setProvider} tabs={PROVIDERS.map((p) => ({ id: p, label: p }))} />
      <Card className="space-y-2">
        {kyc.isLoading && <p className="text-sm animate-pulse">Checking status…</p>}
        {kyc.isError && <ErrorBox error={kyc.error} />}
        {kyc.data && <><Row label="Verification" value={<Chip status={kyc.data.kycStatus} />} />
          {tos && <a className="block text-sm font-semibold text-terminal-accent min-h-[44px] leading-[44px]" href={tos} target="_blank" rel="noreferrer">Accept terms of service</a>}
          {link && <a className="block text-sm font-semibold text-terminal-accent min-h-[44px] leading-[44px]" href={link} target="_blank" rel="noreferrer">Continue identity verification</a>}
          <Btn variant="ghost" className="w-full" onClick={() => void kyc.refetch()}>Refresh status</Btn></>}
      </Card>
      {(kyc.isError || !kyc.data) && !kyc.isLoading && (
        <Card className="space-y-3">
          <p className="text-sm font-semibold">Start verification</p>
          <Field label="Full legal name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Tabs value={type} onChange={setType} tabs={[{ id: 'individual', label: 'Individual' }, { id: 'business', label: 'Business' }]} />
          {start.isError && <ErrorBox error={start.error} />}
          <Btn className="w-full" disabled={!name.trim() || !/.+@.+\..+/.test(email) || start.isPending} onClick={() => start.mutate()}>{start.isPending ? 'Starting…' : 'Start verification'}</Btn>
        </Card>
      )}
    </div>
  )
}

const validAba = (v: string) => /^\d{9}$/.test(v) && (3 * (+v[0]! + +v[3]! + +v[6]!) + 7 * (+v[1]! + +v[4]! + +v[7]!) + (+v[2]! + +v[5]! + +v[8]!)) % 10 === 0
const validIban = (v: string) => {
  const s = v.toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false
  const r = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55))
  return BigInt(r) % 97n === 1n
}
const validClabe = (v: string) => /^\d{18}$/.test(v) && (10 - (Array.from(v.slice(0, 17)).reduce((a, d, i) => a + ((+d * [3, 7, 1][i % 3]!) % 10), 0) % 10)) % 10 === +v[17]!

function Banks() {
  const ext = useExternalAccounts()
  const qc = useQueryClient()
  const [type, setType] = useState<'us' | 'iban' | 'clabe'>('us')
  const [owner, setOwner] = useState('')
  const [f1, setF1] = useState('')
  const [f2, setF2] = useState('')
  const [country, setCountry] = useState('')
  const [bic, setBic] = useState('')
  const [label, setLabel] = useState('')
  const n1 = f1.replace(/[\s-]/g, '')
  const err: string | null = type === 'us'
    ? (!/^\d{4,17}$/.test(n1) ? 'Account number is 4 to 17 digits.' : !validAba(f2) ? 'Routing number must be a valid 9-digit ABA number.' : null)
    : type === 'iban'
      ? (!validIban(n1) ? 'That IBAN does not look valid.' : !/^[A-Za-z]{3}$/.test(country) ? 'Country is the 3-letter code, e.g. DEU.' : !/^[A-Za-z]{4}[A-Za-z]{2}[A-Za-z0-9]{2}([A-Za-z0-9]{3})?$/.test(bic.trim()) ? 'BIC is 8 or 11 characters.' : null)
      : (!validClabe(n1) ? 'CLABE is 18 digits with a valid check digit.' : null)
  const account: Record<string, string> = type === 'us' ? { account_number: n1, routing_number: f2.trim() } : type === 'iban' ? { account_number: n1.toUpperCase(), country: country.toUpperCase(), bic: bic.trim().toUpperCase() } : { account_number: n1 }
  const add = useMutation({ mutationFn: () => bank.addExternalAccount({ provider: 'bridge', accountType: type, ownerName: owner.trim(), label: label.trim() || undefined, account }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['bank', 'external-accounts'] }); a11yToast.success('Bank account added'); setF1(''); setF2(''); setBic(''); setCountry('') } })
  return (
    <div className="space-y-3">
      <QueryState query={ext} rows={1} isEmpty={(d) => d.length === 0} empty={<Empty title="No bank accounts saved" />}>
        {(list) => <Card className="divide-y divide-terminal-border !py-1">{list.map((e) => <div key={e.id} className="py-2.5 flex justify-between gap-2"><div className="min-w-0"><p className="text-sm font-medium truncate">{e.label || e.rail}</p><p className="text-[11px] text-terminal-text-secondary">{e.rail.toUpperCase()} · {e.currency}</p></div><span className="text-[11px] text-terminal-text-secondary">{e.provider}</span></div>)}</Card>}
      </QueryState>
      <Card className="space-y-3">
        <p className="text-sm font-semibold">Add a bank account</p>
        <Tabs value={type} onChange={setType} tabs={[{ id: 'us', label: 'US' }, { id: 'iban', label: 'IBAN' }, { id: 'clabe', label: 'CLABE (MX)' }]} />
        <Field label="Account holder name"><Input value={owner} onChange={(e) => setOwner(e.target.value)} /></Field>
        <Field label={type === 'us' ? 'Account number' : type === 'iban' ? 'IBAN (SEPA)' : 'CLABE (SPEI)'}><Input value={f1} inputMode={type === 'iban' ? 'text' : 'numeric'} autoComplete="off" onChange={(e) => setF1(e.target.value)} /></Field>
        {type === 'us' && <Field label="Routing number (ACH)"><Input value={f2} inputMode="numeric" maxLength={9} onChange={(e) => setF2(e.target.value.replace(/\D/g, ''))} /></Field>}
        {type === 'iban' && <div className="grid grid-cols-2 gap-2"><Field label="BIC / SWIFT"><Input value={bic} maxLength={11} onChange={(e) => setBic(e.target.value)} /></Field><Field label="Country (3 letters)"><Input value={country} maxLength={3} onChange={(e) => setCountry(e.target.value)} /></Field></div>}
        {f1 && err && <p className="text-xs text-bear" role="alert">{err}</p>}
        <Field label="Label (optional)"><Input value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
        {add.isError && <ErrorBox error={add.error} />}
        <Btn className="w-full" disabled={!owner.trim() || !!err || add.isPending} onClick={() => add.mutate()}>{add.isPending ? 'Saving…' : 'Save bank account'}</Btn>
      </Card>
    </div>
  )
}

function AddMoney() {
  const accounts = useBankAccounts()
  const va = useVirtualAccounts()
  const qc = useQueryClient()
  const [accountId, setAccountId] = useState('')
  const [cur, setCur] = useState<'usd' | 'eur' | 'mxn' | 'brl' | 'cop' | 'gbp'>('usd')
  const create = useMutation({ mutationFn: () => bank.createVirtualAccount({ provider: 'bridge', accountId, sourceCurrency: cur }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['bank', 'virtual-accounts'] }) })
  return (
    <div className="space-y-3">
      <QueryState query={va} rows={1} isEmpty={(d) => d.length === 0} empty={<Empty title="No deposit instructions yet" hint="Create one below to receive bank transfers into your account." />}>
        {(list) => <div className="space-y-2">{list.map((v) => (
          <Card key={v.id}>
            <div className="flex justify-between"><p className="text-sm font-semibold">{v.sourceCurrency.toUpperCase()} deposits</p><Chip status={v.status} /></div>
            {v.instructions && Object.entries(v.instructions).filter(([, x]) => typeof x === 'string' || typeof x === 'number').map(([k, x]) => <Row key={k} label={k.replace(/_/g, ' ')} value={String(x)} mono />)}
          </Card>
        ))}</div>}
      </QueryState>
      <Card className="space-y-3">
        <p className="text-sm font-semibold">Get bank deposit details</p>
        <Field label="Deposit into"><AccountSelect accounts={accounts.data ?? []} value={accountId} onChange={setAccountId} /></Field>
        <Field label="Bank currency"><Select value={cur} onChange={(e) => setCur(e.target.value as typeof cur)}>{['usd', 'eur', 'mxn', 'brl', 'cop', 'gbp'].map((c) => <option key={c} value={c}>{c.toUpperCase()}</option>)}</Select></Field>
        {create.isError && <ErrorBox error={create.error} />}
        <Btn className="w-full" disabled={!accountId || create.isPending} onClick={() => create.mutate()}>{create.isPending ? 'Creating…' : 'Create deposit details'}</Btn>
      </Card>
    </div>
  )
}

const STAGE: Record<string, string> = { funded: 'Funds sent to the bank partner', awaiting_funding: 'Waiting for your funds to reach the bank partner', failed: 'Failed' }

function CashOut() {
  const accounts = useBankAccounts()
  const assets = useBankAssets()
  const ext = useExternalAccounts()
  const transfers = useRampTransfers()
  const qc = useQueryClient()
  const [from, setFrom] = useState('')
  const [dest, setDest] = useState('')
  const [amount, setAmount] = useState('')
  const [open, setOpen] = useState(false)
  const key = useIdempotencyKey()
  const a = accounts.data?.find((x) => x.id === from)
  const e = ext.data?.find((x) => x.id === dest)
  const minor = a?.decimals != null ? parseToMinor(amount, a.decimals) : null
  useEffect(() => { key.reset() }, [from, dest, minor]) // eslint-disable-line react-hooks/exhaustive-deps
  const quote = useMutation({ mutationFn: () => bank.rampQuote({ direction: 'offramp', rail: (e as NonNullable<typeof e>).rail, asset: (a as NonNullable<typeof a>).asset, amountMinor: minor as string }) })
  const go = useMutation({
    mutationFn: () => bank.offramp({ provider: e?.provider, fromAccountId: from, externalAccountId: dest, amountMinor: minor as string }, key.current()),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['bank'] }),
  })
  const routed: RoutedQuotes | undefined = quote.data?.routed
  const best = routed?.best
  const done = () => { key.reset(); setOpen(false); go.reset(); quote.reset(); setAmount('') }
  const tid = go.data ? transferIdOf.offramp(go.data) : null
  return (
    <div className="space-y-3">
      <Card className="space-y-3">
        <Field label="From"><AccountSelect accounts={accounts.data ?? []} value={from} onChange={(v) => { setFrom(v); quote.reset() }} /></Field>
        <Field label="To bank account">
          <Select value={dest} onChange={(x) => { setDest(x.target.value); quote.reset() }}><option value="">{ext.isLoading ? 'Loading…' : 'Select'}</option>{(ext.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.label || x.rail} · {x.currency}</option>)}</Select>
        </Field>
        {ext.isError && <ErrorBox error={ext.error} />}
        {ext.data?.length === 0 && <p className="text-xs text-terminal-text-secondary">Add a bank account in the Banks tab first.</p>}
        <Field label="Amount"><AmountInput value={amount} onChange={(v) => { setAmount(v); quote.reset() }} symbol={a?.asset} decimals={a?.decimals ?? null} /></Field>
        {quote.isError && <ErrorBox error={quote.error} />}
        <Btn className="w-full" disabled={!a || !e || !minor || quote.isPending} onClick={() => quote.mutate()}>{quote.isPending ? 'Getting quote…' : 'Get quote'}</Btn>
      </Card>
      {best && a && (
        <Card>
          <Row label="You send" value={`${formatMinor(best.sendAmountMinor, a.decimals)} ${a.asset}`} />
          <Row label="They receive" value={`${formatMinor(best.receiveAmountMinor, (best.decimals ?? currencyDecimals(best.destCurrency, assets.data)))} ${best.destCurrency}`} />
          <Row label="Fee" value={best.feeMinor ? `${formatMinor(best.feeMinor, a.decimals)} ${a.asset}` : 'Included in rate'} />
          <Row label="Rate" value={best.rate} />
          <Row label="Provider" value={best.provider} />
          <Row label="Arrives" value={best.etaSeconds ? `~${Math.max(1, Math.round(best.etaSeconds / 60))} min` : 'Provider has not given an estimate'} />
          {best.indicative && <p className="text-[11px] text-terminal-text-secondary">Indicative: the final rate is set when the provider processes it.</p>}
          {routed?.failures.map((f) => <p key={f.provider} className="text-[11px] text-terminal-text-secondary">Not available yet: {f.provider}: {f.error}</p>)}
          <Btn className="w-full mt-2" onClick={() => setOpen(true)}>Review cash out</Btn>
        </Card>
      )}
      {open && best && a && e && (
        <ConfirmSheet
          title="Confirm cash out"
          rows={[
            { label: 'Send', value: `${formatMinor(best.sendAmountMinor, a.decimals)} ${a.asset}` },
            { label: 'Receive', value: `${formatMinor(best.receiveAmountMinor, (best.decimals ?? currencyDecimals(best.destCurrency, assets.data)))} ${best.destCurrency}` },
            { label: 'Fee', value: best.feeMinor ? `${formatMinor(best.feeMinor, a.decimals)} ${a.asset}` : 'Included in rate' },
            { label: 'To', value: `${e.label || e.rail} (${e.rail.toUpperCase()})` },
            { label: 'Provider', value: best.provider },
          ]}
          confirmLabel="Cash out"
          pending={go.isPending}
          error={go.error}
          onConfirm={() => go.mutate()}
          onClose={() => (go.data ? done() : setOpen(false))}
          result={go.data && (tid ? <div className="space-y-2"><Row label="Stage" value={STAGE[go.data.stage ?? ''] ?? go.data.stage ?? '—'} /><TransferTracker transferId={tid} onDone={done} /></div> : <div className="space-y-2"><Row label="Stage" value={STAGE[go.data.stage ?? ''] ?? go.data.stage ?? '—'} /><Row label="Status" value={go.data.rampTransfer.status} /><Btn className="w-full" onClick={done}>Done</Btn></div>)}
        />
      )}
      <SectionTitle>Recent bank transfers</SectionTitle>
      <QueryState query={transfers} rows={1} isEmpty={(d) => d.length === 0} empty={<Empty title="No bank transfers yet" />}>
        {(list) => <Card className="divide-y divide-terminal-border !py-1">{list.map((t) => <div key={t.id} className="py-2.5 flex justify-between gap-2"><div><p className="text-sm capitalize">{t.direction}</p><p className="text-[11px] text-terminal-text-secondary">{new Date(t.createdAt).toLocaleString()}</p></div><Chip status={t.status} /></div>)}</Card>}
      </QueryState>
    </div>
  )
}

function RailsView() {
  const rails = useRails()
  const providers = useProviders()
  return (
    <div className="space-y-3">
      <QueryState query={rails} isEmpty={(d) => d.length === 0} empty={<Empty title="No rails" />}>
        {(list) => <Card className="divide-y divide-terminal-border !py-1">{list.map((r) => {
          const live = r.sourceProviders.length + r.destinationProviders.length > 0
          return <div key={r.rail} className="py-2.5 flex items-start justify-between gap-2"><div className="min-w-0"><p className="text-sm font-semibold uppercase">{r.rail}</p>{!live && <p className="text-[11px] text-terminal-text-secondary break-words">Not available yet: {r.unconfigured.length ? r.unconfigured.map((u) => `${u.provider} needs ${u.missing}`).join('; ') : 'no provider supports this rail'}</p>}</div><Chip status={live ? 'available' : 'unavailable'} tone={live ? 'good' : 'neutral'} /></div>
        })}</Card>}
      </QueryState>
      <SectionTitle>Providers</SectionTitle>
      <QueryState query={providers} rows={1}>
        {(list) => <Card className="divide-y divide-terminal-border !py-1">{list.map((p) => <div key={p.id} className="py-2.5 flex justify-between gap-2"><span className="text-sm capitalize">{p.id}</span><span className="text-[11px] text-terminal-text-secondary text-right break-words">{p.configured ? 'configured' : `Not available yet: needs ${p.missing}`}</span></div>)}</Card>}
      </QueryState>
    </div>
  )
}

function Qr() {
  const assets = useBankAssets()
  const [text, setText] = useState('')
  const [out, setOut] = useState<PayoutRequest | null>(null)
  const m = useMutation({ mutationFn: () => bank.parseQr(text.trim()), onSuccess: (r) => setOut(r.payout) })
  const scan = () => {
    const tg = (window as unknown as { Telegram?: { WebApp?: { showScanQrPopup?: (p: { text?: string }, cb: (t: string) => boolean | void) => void } } }).Telegram?.WebApp
    if (!tg?.showScanQrPopup) { a11yToast.info('QR scanning is only available inside Telegram. Paste the code instead.'); return }
    tg.showScanQrPopup({ text: 'Scan a PIX, VietQR or UPI code' }, (t) => { setText(t); return true })
  }
  return (
    <div className="space-y-3">
      <Card className="space-y-3">
        <Field label="PIX, VietQR or UPI payload"><textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} className="w-full px-3 py-2 rounded-terminal-control border border-terminal-border bg-terminal-panel text-xs font-mono outline-none" /></Field>
        <div className="grid grid-cols-2 gap-2"><Btn variant="ghost" onClick={scan}>Scan QR</Btn><Btn disabled={text.trim().length < 8 || m.isPending} onClick={() => m.mutate()}>{m.isPending ? 'Reading…' : 'Read code'}</Btn></div>
        {m.isError && <ErrorBox error={m.error} />}
      </Card>
      {out && (
        <Card>
          <Row label="Rail" value={out.rail.toUpperCase()} /><Row label="Currency" value={out.currency} /><Row label="Destination" value={out.destination} mono />
          <Row label="Amount" value={out.amountMinor ? `${formatMinor(out.amountMinor, currencyDecimals(out.currency, assets.data))} ${out.currency}` : 'Not fixed by the code'} />
          {out.payeeName && <Row label="Payee" value={out.payeeName} />}{out.reference && <Row label="Reference" value={out.reference} />}
          <div className="mx-auto w-32 h-32 mt-2"><QRCodeSVG value={text.trim()} size={128} /></div>
          <p className="text-[11px] text-terminal-text-secondary mt-2">Paying a code from your balance goes through Send, using a bank payout recipient on this rail.</p>
        </Card>
      )}
    </div>
  )
}

export function Ramps() {
  const loc = useLocation()
  const [tab, setTab] = useState<Tab>(loc.pathname.endsWith('cashout') ? 'out' : 'add')
  return (
    <BankPage title={tab === 'out' ? 'Cash out' : 'Add money'}>
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ id: 'add', label: 'Add money' }, { id: 'out', label: 'Cash out' }, { id: 'kyc', label: 'Verification' }, { id: 'banks', label: 'Banks' }, { id: 'rails', label: 'Rails' }, { id: 'qr', label: 'QR' }]} />
      {tab === 'add' && <AddMoney />}
      {tab === 'out' && <CashOut />}
      {tab === 'kyc' && <Kyc />}
      {tab === 'banks' && <Banks />}
      {tab === 'rails' && <RailsView />}
      {tab === 'qr' && <Qr />}
    </BankPage>
  )
}
