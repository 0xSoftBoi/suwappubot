import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { QRCodeSVG } from 'qrcode.react'
import { bank, fetchPublicInvoice, formatMinor, isMinor, transferIdOf, type PublicInvoice } from '../../lib/bankApi'
import { useAuth } from '../../contexts/AuthContext'
import { bankKeys, useBankAccounts } from '../../hooks/bank/useBankCore'
import { Btn, Card, Chip, ErrorBox, Loading, Row } from '../../components/bank/BankUI'
import { AccountSelect } from '../../components/bank/AccountSelect'
import { MoneyAction } from '../../components/bank/MoneyAction'
import { a11yToast } from '@/lib/a11yToast'

const copy = (t: string) => navigator.clipboard.writeText(t).then(() => a11yToast.success('Copied'), () => a11yToast.error('Could not copy'))

/** Solana Pay carries the amount in decimal user units on the wire (`amount=`). */
const solanaDecimalAmount = (uri: string): string | null => {
  const m = /[?&]amount=([0-9]+(?:\.[0-9]+)?)/.exec(uri)
  return m ? m[1]! : null
}

function PayFromAccount({ inv, due, decimals }: { inv: PublicInvoice; due: string; decimals: number | null }) {
  const accounts = useBankAccounts()
  const [from, setFrom] = useState('')
  const [open, setOpen] = useState(false)
  const eligible = (accounts.data ?? []).filter((a) => a.asset === inv.asset && a.chain === inv.chain && a.status === 'active')
  const acct = eligible.find((a) => a.id === from)
  if (accounts.isLoading) return <Loading rows={1} />
  if (accounts.isError) return <ErrorBox error={accounts.error} onRetry={() => void accounts.refetch()} />
  if (eligible.length === 0) return <p className="text-sm text-suwappu-text-secondary">You have no active {inv.asset} account on {inv.chain}. Pay with the address below instead.</p>
  return (
    <div className="space-y-2">
      <AccountSelect accounts={eligible} value={from} onChange={setFrom} />
      <Btn className="w-full" disabled={!acct} onClick={() => setOpen(true)}>Pay from my bank account</Btn>
      {open && acct && (
        <MoneyAction
          title="Confirm payment"
          rows={[
            { label: 'Pay', value: `${formatMinor(due, decimals)} ${inv.asset}` },
            { label: 'To invoice', value: inv.slug, mono: true },
            { label: 'From', value: acct.label || `${acct.asset} on ${acct.chain}` },
            { label: 'Fee', value: 'None shown by the API' },
          ]}
          confirmLabel="Pay"
          trackId={transferIdOf.invoicePay}
          run={(k) => bank.payInvoice({ slug: inv.slug, fromAccountId: acct.id, amountMinor: due }, k)}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}

/** Shown only when the signed-in viewer is the invoice's named payer (it appears in their payer-side invoice list). */
function AcceptBanner({ slug, amount }: { slug: string; amount: string }) {
  const [open, setOpen] = useState(false)
  const mine = useQuery({ queryKey: ['bank', 'invoices', 'payer'], queryFn: async () => (await bank.invoices({ role: 'payer' })).invoices, retry: 1 })
  const target = mine.data?.find((i) => i.slug === slug)
  if (!target) return null
  return (
    <Card className="space-y-2">
      <p className="text-sm font-semibold">This invoice needs your acceptance</p>
      <p className="text-xs text-suwappu-text-secondary">The issuer may finance it once you accept. You still pay it as usual.</p>
      <Btn className="w-full" onClick={() => setOpen(true)}>Accept invoice</Btn>
      {open && (
        <MoneyAction
          title="Accept invoice"
          rows={[{ label: 'Invoice', value: target.reference || target.memo || slug }, { label: 'Amount', value: amount }, { label: 'Asset', value: `${target.asset} on ${target.chain}` }, { label: 'Fee', value: 'None' }]}
          confirmLabel="Accept"
          run={() => bank.acceptInvoice(target.id)}
          onClose={() => { setOpen(false); void mine.refetch() }}
        />
      )}
    </Card>
  )
}

/** Public, unauthenticated invoice page: /pay/:slug. */
export function PayInvoice() {
  const { slug = '' } = useParams()
  const { isAuthenticated } = useAuth()
  const q = useQuery({ queryKey: ['public-invoice', slug], queryFn: () => fetchPublicInvoice(slug), retry: 1, refetchInterval: (s) => (s.state.data && ['paid', 'void'].includes(s.state.data.status) ? false : 15_000) })
  // /assets needs a session; unauthenticated visitors get the amount in the units the API carries on the wire.
  const assets = useQuery({ queryKey: bankKeys.assets, queryFn: async () => (await bank.assets()).assets, enabled: isAuthenticated, staleTime: 10 * 60_000, retry: 1 })
  const inv = q.data
  const decimals = inv ? inv.decimals ?? assets.data?.find((a) => a.symbol === inv.asset && a.chain === inv.chain)?.decimals ?? null : null
  const sym = inv?.symbol ?? inv?.asset ?? ''
  const due = inv && isMinor(inv.amountMinor) && isMinor(inv.paidMinor) && BigInt(inv.amountMinor) > BigInt(inv.paidMinor) ? (BigInt(inv.amountMinor) - BigInt(inv.paidMinor)).toString() : '0'
  const req = inv?.paymentRequest
  const sol = req?.family === 'solana' ? solanaDecimalAmount(req.uri) : null
  const amountText = (minor: string) => (decimals !== null ? `${formatMinor(minor, decimals)} ${sym}` : `${minor} ${sym} (smallest units)`)
  const payable = !!inv && !['paid', 'void', 'draft', 'cancelled'].includes(inv.status) && due !== '0'
  return (
    <div className="min-h-screen bg-suwappu-bg">
      <div className="p-3 pb-16 space-y-3 max-w-xl mx-auto w-full">
        <h1 className="font-heading font-bold text-lg text-suwappu-purple-deep px-1 pt-2">Invoice</h1>
        {q.isLoading && <Loading rows={3} />}
        {q.isError && <ErrorBox error={q.error} onRetry={() => void q.refetch()} />}
        {inv && req && (
          <>
            <Card>
              <div className="flex items-start justify-between gap-2">
                <p className={`${decimals === null ? 'text-base' : 'text-2xl'} font-heading font-bold tabular-nums break-all min-w-0`}>{amountText(inv.amountMinor)}</p>
                <Chip status={inv.status} />
              </div>
              {inv.memo && <p className="text-sm mt-1 break-words">{inv.memo}</p>}
              <div className="mt-2 divide-y divide-suwappu-sakura-mid/20">
                {BigInt(inv.paidMinor) > 0n && <Row label="Already paid" value={amountText(inv.paidMinor)} />}
                <Row label="Still due" value={amountText(due)} />
                <Row label="Network" value={inv.chainName ?? inv.chain} />
                {inv.acceptance?.required && <Row label="Acceptance" value={inv.acceptance.acceptedAt ? `Accepted ${new Date(inv.acceptance.acceptedAt).toLocaleDateString()}` : 'Waiting for the payer to accept'} />}
                {inv.dueAt && <Row label="Due" value={new Date(inv.dueAt).toLocaleDateString()} />}
              </div>
              {inv.lineItems.length > 0 && (
                <ul className="mt-2 text-sm space-y-1">
                  {inv.lineItems.map((l, i) => (
                    <li key={i} className="flex justify-between gap-2"><span className="min-w-0 break-words">{l.quantity} × {l.description}</span><span className="tabular-nums shrink-0">{amountText((BigInt(l.unitAmountMinor) * BigInt(l.quantity)).toString())}</span></li>
                  ))}
                </ul>
              )}
            </Card>
            {isAuthenticated && inv.acceptance?.required && !inv.acceptance.acceptedAt && <AcceptBanner slug={inv.slug} amount={amountText(inv.amountMinor)} />}
            {payable ? (
              <>
                <Card className="space-y-2">
                  <h2 className="font-heading font-bold text-sm text-suwappu-purple-deep">Pay from your bank account</h2>
                  {isAuthenticated ? <PayFromAccount inv={inv} due={due} decimals={decimals} /> : <p className="text-sm text-suwappu-text-secondary">Open this page inside Suwappu on Telegram to pay from your bank account, or pay from any wallet below.</p>}
                </Card>
                <Card className="space-y-2 text-center">
                  <h2 className="font-heading font-bold text-sm text-suwappu-purple-deep text-left">Pay from any wallet</h2>
                  <div className="mx-auto w-48 h-48 p-2 bg-white rounded-suwappu-lg shadow-suwappu-1"><QRCodeSVG value={req.qrPayload} size={176} /></div>
                  <div className="text-left">
                    <Row label="Send exactly" value={sol ? `${sol} ${sym}` : amountText(req.payAmountMinor)} />
                    <Row label="Pay to" value={req.payTo} mono />
                    <Row label="Network" value={inv.chainName ?? req.chain} />
                    {req.reference && <Row label="Reference" value={req.reference} mono />}
                  </div>
                  <p className="text-xs text-suwappu-text-secondary text-left">{req.family === 'evm' ? 'The amount includes a unique tag so we can match your payment. Send exactly this amount on the network shown.' : 'Send exactly this amount on the network shown.'}</p>
                  <p className="font-mono text-[11px] break-all text-left">{req.uri}</p>
                  <Btn variant="ghost" className="w-full" onClick={() => void copy(req.uri)}>Copy payment link</Btn>
                  <Btn variant="ghost" className="w-full" onClick={() => void copy(req.payTo)}>Copy address</Btn>
                </Card>
              </>
            ) : (
              <Card><p className="text-sm">{inv.status === 'paid' ? 'This invoice has been paid.' : `This invoice is ${inv.status} and cannot be paid.`}</p></Card>
            )}
          </>
        )}
      </div>
    </div>
  )
}
