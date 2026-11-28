import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { bank } from '../../lib/bankApi'
import { useBankAccounts } from '../../hooks/bank/useBankCore'
import { useIdempotencyKey } from '../../hooks/bank/useIdempotencyKey'
import { Btn, ErrorBox, Field, Input, Select, Sheet, Tabs } from './BankUI'
import { AccountSelect } from './AccountSelect'
import { a11yToast } from '@/lib/a11yToast'

type Addr = { line1: string; line2: string; city: string; state: string; postalCode: string; country: string }
const blank: Addr = { line1: '', line2: '', city: '', state: '', postalCode: '', country: '' }
const addrOk = (a: Addr) => !!a.line1.trim() && !!a.city.trim() && !!a.postalCode.trim() && /^[A-Za-z]{2}$/.test(a.country.trim())
const addrBody = (a: Addr) => ({ line1: a.line1.trim(), ...(a.line2.trim() ? { line2: a.line2.trim() } : {}), city: a.city.trim(), ...(a.state.trim() ? { state: a.state.trim() } : {}), postalCode: a.postalCode.trim(), country: a.country.trim().toUpperCase() })

function AddrFields({ v, set }: { v: Addr; set: (a: Addr) => void }) {
  const f = (k: keyof Addr, label: string, extra?: { max?: number }) => (
    <Field label={label}><Input value={v[k]} maxLength={extra?.max} onChange={(e) => set({ ...v, [k]: e.target.value })} /></Field>
  )
  return (
    <div className="space-y-2">
      {f('line1', 'Address line 1', { max: 200 })}{f('line2', 'Address line 2 (optional)', { max: 200 })}
      <div className="grid grid-cols-2 gap-2">{f('city', 'City', { max: 100 })}{f('state', 'State / region', { max: 100 })}</div>
      <div className="grid grid-cols-2 gap-2">{f('postalCode', 'Postal code', { max: 20 })}{f('country', 'Country (2 letters)', { max: 2 })}</div>
    </div>
  )
}

/** Card issuing: cardholder details (required by the issuer) and, for physical cards, a shipping address. */
export function IssueCard({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const accounts = useBankAccounts()
  const [type, setType] = useState<'virtual' | 'physical'>('virtual')
  const [accountId, setAccountId] = useState('')
  const [label, setLabel] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [dob, setDob] = useState('')
  const [billing, setBilling] = useState<Addr>(blank)
  const [ship, setShip] = useState<Addr>(blank)
  const [shipName, setShipName] = useState('')
  const [speed, setSpeed] = useState<'standard' | 'express' | 'priority'>('standard')
  const [terms, setTerms] = useState(false)
  // Key follows the exact payload: any edit is a new intent, reopening the sheet with the same inputs re-sends the same key.
  const key = useIdempotencyKey(JSON.stringify([type, accountId, label, name, email, phone, first, last, dob, billing, ship, shipName, speed, terms]))
  const dobParts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob)
  const dobObj = dobParts ? { year: Number(dobParts[1]), month: Number(dobParts[2]), day: Number(dobParts[3]) } : null
  const individualGiven = !!(first.trim() || last.trim() || dob)
  const individualOk = !individualGiven || (!!first.trim() && !!last.trim() && !!dobObj)
  const valid = !!accountId && terms && !!name.trim() && addrOk(billing) && individualOk && (type === 'virtual' || (!!shipName.trim() && addrOk(ship)))
  const m = useMutation({
    mutationFn: () => bank.issueCard({
      accountId, type, label: label.trim() || undefined, termsAccepted: terms,
      cardholder: {
        name: name.trim(), ...(email.trim() ? { email: email.trim() } : {}), ...(phone.trim() ? { phoneNumber: phone.trim() } : {}), billing: addrBody(billing),
        ...(individualGiven && dobObj ? { individual: { firstName: first.trim(), lastName: last.trim(), dob: dobObj } } : {}),
      },
      ...(type === 'physical' ? { shipping: { ...addrBody(ship), name: shipName.trim(), speed } } : {}),
    }, key.current()),
    onSuccess: () => { key.reset(); void qc.invalidateQueries({ queryKey: ['bank', 'cards'] }); a11yToast.success('Card requested'); onClose() },
    onError: (e) => key.settle(e),
  })
  return (
    <Sheet title="Issue a card" onClose={onClose} dismissible={!m.isPending}>
      <div className="space-y-3">
        <Tabs<'virtual' | 'physical'> value={type} onChange={setType} tabs={[{ id: 'virtual', label: 'Virtual' }, { id: 'physical', label: 'Physical' }]} />
        <Field label="Funded from"><AccountSelect accounts={accounts.data ?? []} value={accountId} onChange={setAccountId} /></Field>
        <Field label="Label (optional)"><Input value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} /></Field>
        <p className="text-xs font-semibold text-terminal-text">Cardholder</p>
        <Field label="Full name"><Input value={name} maxLength={100} autoComplete="name" onChange={(e) => setName(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Email (optional)"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Phone (optional)"><Input type="tel" value={phone} maxLength={32} onChange={(e) => setPhone(e.target.value)} /></Field>
        </div>
        <p className="text-xs font-semibold text-terminal-text">Billing address</p>
        <AddrFields v={billing} set={setBilling} />
        <p className="text-xs font-semibold text-terminal-text">Identity (some issuers require it)</p>
        <div className="grid grid-cols-2 gap-2">
          <Field label="First name"><Input value={first} maxLength={60} onChange={(e) => setFirst(e.target.value)} /></Field>
          <Field label="Last name"><Input value={last} maxLength={60} onChange={(e) => setLast(e.target.value)} /></Field>
        </div>
        <Field label="Date of birth"><Input type="date" value={dob} onChange={(e) => setDob(e.target.value)} /></Field>
        {!individualOk && <p className="text-xs text-bear">Give first name, last name and date of birth together, or leave all three empty.</p>}
        {type === 'physical' && (
          <>
            <p className="text-xs font-semibold text-terminal-text">Ship to</p>
            <Field label="Recipient name"><Input value={shipName} maxLength={100} onChange={(e) => setShipName(e.target.value)} /></Field>
            <AddrFields v={ship} set={setShip} />
            <Field label="Delivery speed"><Select value={speed} onChange={(e) => setSpeed(e.target.value as typeof speed)}><option value="standard">Standard</option><option value="express">Express</option><option value="priority">Priority</option></Select></Field>
          </>
        )}
        <label className="flex items-start gap-2 text-xs min-h-[44px]"><input type="checkbox" className="mt-1" checked={terms} onChange={(e) => setTerms(e.target.checked)} /><span>I accept the card issuer terms.</span></label>
        {m.isError && <ErrorBox error={m.error} />}
        <Btn className="w-full" disabled={!valid || m.isPending} onClick={() => m.mutate()}>{m.isPending ? 'Requesting…' : type === 'physical' ? 'Order physical card' : 'Issue virtual card'}</Btn>
      </div>
    </Sheet>
  )
}
