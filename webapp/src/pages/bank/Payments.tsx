import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { QRCodeSVG } from 'qrcode.react'
import { bank, invoicePayLink, transferIdOf, formatMinor, parseToMinor, type Escrow, type Invoice } from '../../lib/bankApi'
import { useBankAccounts } from '../../hooks/bank/useBankCore'
import { useEscrows, useInvoices } from '../../hooks/bank/useBankDomains'
import { BankPage, Btn, Card, Chip, Empty, ErrorBox, Field, Input, QueryState, Row, SectionTitle, Sheet, Tabs } from '../../components/bank/BankUI'
import { AccountSelect } from '../../components/bank/AccountSelect'
import { AmountInput } from '../../components/bank/Amount'
import { StreamsPanel } from '../../components/bank/StreamsPanel'
import { EscrowDetail } from '../../components/bank/EscrowDetail'
import { MoneyAction } from '../../components/bank/MoneyAction'
import { a11yToast } from '@/lib/a11yToast'

const dec = (accts: ReturnType<typeof useBankAccounts>['data'], asset?: string, chain?: string) => accts?.find((a) => a.asset === asset && a.chain === chain)?.decimals ?? null
const linkFor = invoicePayLink
const copy = (t: string) => navigator.clipboard.writeText(t).then(() => a11yToast.success('Copied'), () => a11yToast.error('Could not copy'))

function CreateInvoice({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const accounts = useBankAccounts()
  const [acct, setAcct] = useState('')
  const [amount, setAmount] = useState('')
  const [memo, setMemo] = useState('')
  const a = accounts.data?.find((x) => x.id === acct)
  const minor = a?.decimals != null ? parseToMinor(amount, a.decimals) : null
  const m = useMutation({
    mutationFn: () => bank.createInvoice({ payeeAccountId: acct, amountMinor: minor, memo: memo.trim() || undefined, publish: true }, `ui_inv_${crypto.randomUUID()}`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['bank', 'invoices'] }); a11yToast.success('Payment link created'); onClose() },
  })
  return (
    <Sheet title="New payment link" onClose={onClose} dismissible={!m.isPending}>
      <div className="space-y-3">
        <Field label="Get paid into"><AccountSelect accounts={accounts.data ?? []} value={acct} onChange={setAcct} /></Field>
        <Field label="Amount"><AmountInput value={amount} onChange={setAmount} symbol={a?.asset} decimals={a?.decimals ?? null} /></Field>
        <Field label="Description"><Input value={memo} maxLength={280} onChange={(e) => setMemo(e.target.value)} /></Field>
        {m.isError && <ErrorBox error={m.error} />}
        <Btn className="w-full" disabled={!acct || !minor || m.isPending} onClick={() => m.mutate()}>{m.isPending ? 'Creating…' : 'Create link'}</Btn>
      </div>
    </Sheet>
  )
}

/** Payer-side acceptance: lets the payee finance this invoice (POST /credit/receivables/accept). */
function AcceptInvoice({ invoice }: { invoice: Invoice }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Btn variant="ghost" onClick={() => setOpen(true)}>Accept invoice</Btn>
      {open && (
        <MoneyAction
          title="Accept invoice"
          rows={[{ label: 'Invoice', value: invoice.reference || invoice.memo || invoice.id }, { label: 'Asset', value: `${invoice.asset} on ${invoice.chain}` }, { label: 'Effect', value: 'The issuer may finance this invoice. You still pay it as usual.' }]}
          confirmLabel="Accept"
          run={(k) => bank.acceptReceivable({ invoiceId: invoice.id }, k)}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

function Invoices() {
  const qc = useQueryClient()
  const accounts = useBankAccounts()
  const [role, setRole] = useState<'payee' | 'payer'>('payee')
  const inv = useInvoices(role)
  const [creating, setCreating] = useState(false)
  const [share, setShare] = useState<Invoice | null>(null)
  const [paying, setPaying] = useState<Invoice | null>(null)
  const [from, setFrom] = useState('')
  const act = useMutation({ mutationFn: ({ id, a }: { id: string; a: 'publish' | 'void' }) => (a === 'publish' ? bank.publishInvoice(id) : bank.voidInvoice(id)), onSuccess: () => void qc.invalidateQueries({ queryKey: ['bank', 'invoices'] }) })
  const fromAcct = accounts.data?.find((x) => x.id === from)
  return (
    <div className="space-y-3">
      <Tabs value={role} onChange={setRole} tabs={[{ id: 'payee', label: 'I am owed' }, { id: 'payer', label: 'I owe' }]} />
      {role === 'payee' && <Btn className="w-full" onClick={() => setCreating(true)}>New payment link</Btn>}
      {act.isError && <ErrorBox error={act.error} />}
      <QueryState query={inv} isEmpty={(d) => d.length === 0} empty={<Empty title="No invoices" />}>
        {(list) => <div className="space-y-2">{list.map((i) => {
          const d = dec(accounts.data, i.asset, i.chain)
          return (
            <Card key={i.id}>
              <div className="flex justify-between gap-2"><p className="text-sm font-semibold truncate">{i.memo || i.reference || 'Invoice'}</p><Chip status={i.status} /></div>
              <Row label="Amount" value={`${formatMinor(i.amountMinor, d)} ${i.asset}`} />
              {i.dueAt && <Row label="Due" value={new Date(i.dueAt).toLocaleDateString()} />}
              <div className="grid grid-cols-2 gap-2 mt-2">
                {role === 'payee' && i.slug && <Btn variant="ghost" onClick={() => setShare(i)}>Share</Btn>}
                {role === 'payer' && ['open', 'partial'].includes(i.status) && <AcceptInvoice invoice={i} />}
                {role === 'payee' && i.status === 'draft' && <Btn disabled={act.isPending} onClick={() => act.mutate({ id: i.id, a: 'publish' })}>Publish</Btn>}
                {role === 'payee' && ['draft', 'open'].includes(i.status) && <Btn variant="danger" disabled={act.isPending} onClick={() => act.mutate({ id: i.id, a: 'void' })}>Void</Btn>}
                {role === 'payer' && ['open', 'partially_paid', 'overdue'].includes(i.status) && <Btn onClick={() => setPaying(i)}>Pay</Btn>}
              </div>
            </Card>
          )
        })}</div>}
      </QueryState>
      {creating && <CreateInvoice onClose={() => setCreating(false)} />}
      {share?.slug && (
        <Sheet title="Share payment link" onClose={() => setShare(null)}>
          <div className="text-center space-y-3">
            <div className="mx-auto w-44 h-44 p-2 bg-white rounded-suwappu-lg shadow-suwappu-1"><QRCodeSVG value={linkFor(share.slug)} size={160} /></div>
            <p className="font-mono text-[11px] break-all">{linkFor(share.slug)}</p>
            <Btn className="w-full" onClick={() => void copy(linkFor(share.slug as string))}>Copy link</Btn>
          </div>
        </Sheet>
      )}
      {paying && !fromAcct && (
        <Sheet title="Pay invoice" onClose={() => setPaying(null)}>
          <div className="space-y-3"><Field label="Pay from"><AccountSelect accounts={(accounts.data ?? []).filter((a) => a.asset === paying.asset && a.chain === paying.chain)} value={from} onChange={setFrom} /></Field></div>
        </Sheet>
      )}
      {paying && fromAcct && (
        <MoneyAction
          title="Confirm payment"
          rows={[
            { label: 'Pay', value: `${formatMinor(paying.amountMinor, fromAcct.decimals)} ${paying.asset}` },
            { label: 'For', value: paying.memo || paying.reference || paying.id },
            { label: 'From', value: fromAcct.label || `${fromAcct.asset} on ${fromAcct.chain}` },
            { label: 'Fee', value: 'None shown by the API' },
          ]}
          confirmLabel="Pay"
          trackId={transferIdOf.invoicePay}
          run={(k) => bank.payInvoice({ invoiceId: paying.id, fromAccountId: from, amountMinor: paying.amountMinor }, k)}
          onClose={() => { setPaying(null); setFrom('') }}
        />
      )}
    </div>
  )
}

function Escrows() {
  const esc = useEscrows()
  const accounts = useBankAccounts()
  const [open, setOpen] = useState<Escrow | null>(null)
  const [creating, setCreating] = useState(false)
  const [payer, setPayer] = useState('')
  const [payeeAcct, setPayeeAcct] = useState('')
  const [payeeId, setPayeeId] = useState('')
  const [amount, setAmount] = useState('')
  const [desc, setDesc] = useState('')
  const a = accounts.data?.find((x) => x.id === payer)
  const minor = a?.decimals != null ? parseToMinor(amount, a.decimals) : null
  return (
    <div className="space-y-3">
      <Btn className="w-full" onClick={() => setCreating(true)}>New escrow</Btn>
      <QueryState query={esc} isEmpty={(d) => d.length === 0} empty={<Empty title="No escrows" />}>
        {(list) => <div className="space-y-2">{list.map((e) => <button type="button" key={e.id} onClick={() => setOpen(e)} className="w-full text-left"><Card className="flex justify-between gap-2"><p className="text-sm font-semibold truncate">{e.description || 'Escrow'}</p><Chip status={e.status} /></Card></button>)}</div>}
      </QueryState>
      {open && <EscrowDetail e={open} onClose={() => setOpen(null)} />}
      {creating && (
        <Sheet title="New escrow" onClose={() => setCreating(false)}>
          <div className="space-y-3">
            <Field label="Fund from"><AccountSelect accounts={accounts.data ?? []} value={payer} onChange={setPayer} /></Field>
            <Field label="Payee user ID"><Input value={payeeId} onChange={(e) => setPayeeId(e.target.value)} /></Field>
            <Field label="Payee account ID"><Input value={payeeAcct} onChange={(e) => setPayeeAcct(e.target.value)} /></Field>
            <Field label="Amount"><AmountInput value={amount} onChange={setAmount} symbol={a?.asset} decimals={a?.decimals ?? null} /></Field>
            <Field label="Description"><Input value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
            {a && minor && payeeAcct && payeeId && (
              <MoneyAction
                title="Confirm escrow funding"
                rows={[{ label: 'Lock', value: `${formatMinor(minor, a.decimals)} ${a.asset}` }, { label: 'Payee', value: `user ${payeeId}` }, { label: 'Fee', value: 'None shown by the API' }, { label: 'For', value: desc || '—' }]}
                confirmLabel="Fund escrow"
                trackId={transferIdOf.escrowFunding}
                run={(k) => bank.createEscrow({ payee: { ownerType: 'user', ownerId: payeeId }, payerAccountId: payer, payeeAccountId: payeeAcct, amountMinor: minor, description: desc || undefined }, k)}
                onClose={() => setCreating(false)}
              />
            )}
          </div>
        </Sheet>
      )}
    </div>
  )
}

export function Payments() {
  const [tab, setTab] = useState<'inv' | 'esc' | 'str'>('inv')
  return (
    <BankPage title="Payments">
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'inv', label: 'Invoices' }, { id: 'esc', label: 'Escrows' }, { id: 'str', label: 'Streams' }]} />
      <SectionTitle>{tab === 'inv' ? 'Invoices and payment links' : tab === 'esc' ? 'Escrows' : 'Streams'}</SectionTitle>
      {tab === 'inv' && <Invoices />}
      {tab === 'esc' && <Escrows />}
      {tab === 'str' && <StreamsPanel />}
    </BankPage>
  )
}
