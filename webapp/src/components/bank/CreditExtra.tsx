import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { bank, formatMinor, type Invoice } from '../../lib/bankApi'
import { useBankAccounts, useBankAssets } from '../../hooks/bank/useBankCore'
import { useCreditScore, useInvoices } from '../../hooks/bank/useBankDomains'
import { Btn, Card, Chip, Empty, ErrorBox, Field, QueryState, Row, Sheet } from './BankUI'
import { AccountSelect } from './AccountSelect'
import { MoneyAction } from './MoneyAction'

/** Unsecured line: score first, then request. Only one unsecured line per asset/chain; the server says so if one exists. */
export function UnsecuredLine({ asset, chain }: { asset: string; chain: string }) {
  const accounts = useBankAccounts()
  const score = useCreditScore(asset, chain)
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [acct, setAcct] = useState('')
  const eligible = (accounts.data ?? []).filter((a) => a.asset === asset && a.chain === chain)
  const a = eligible.find((x) => x.id === acct)
  return (
    <Card className="space-y-2">
      <p className="text-sm font-semibold">Unsecured credit line ({asset} on {chain})</p>
      <QueryState query={score} rows={1}>{(s) => <><Row label="Your score" value={s.score} /><Row label="Tier" value={s.tier} />{s.aprBps != null && <Row label="Indicative APR" value={`${(s.aprBps / 100).toFixed(2)}%`} />}</>}</QueryState>
      <Btn className="w-full" onClick={() => setOpen(true)}>Request a line</Btn>
      {open && (
        <Sheet title="Request unsecured line" onClose={() => setOpen(false)}>
          <div className="space-y-3">
            {eligible.length === 0 ? <p className="text-sm text-suwappu-text-secondary">Open a {asset} account on {chain} first.</p> : <Field label="Draws are paid into"><AccountSelect accounts={eligible} value={acct} onChange={setAcct} /></Field>}
            {a && (
              <MoneyAction
                title="Confirm credit line request"
                rows={[{ label: 'Asset', value: `${asset} on ${chain}` }, { label: 'Paid into', value: a.label || a.kind }, { label: 'Limit', value: 'Set by your score; shown on the line after approval' }, { label: 'Fee', value: 'None shown by the API' }]}
                confirmLabel="Request line"
                run={(k) => bank.unsecuredLine({ accountId: a.id }, k)}
                onClose={() => { setOpen(false); void qc.invalidateQueries({ queryKey: ['bank'] }) }}
              />
            )}
          </div>
        </Sheet>
      )}
    </Card>
  )
}

/** Receivables financing: advance against an invoice you issued. The payer must have accepted it. */
export function Receivables() {
  const invoices = useInvoices('payee')
  const accounts = useBankAccounts()
  const assets = useBankAssets()
  const qc = useQueryClient()
  const [inv, setInv] = useState<Invoice | null>(null)
  const [acct, setAcct] = useState('')
  const dec = (i: Invoice) => assets.data?.find((a) => a.symbol === i.asset && a.chain === i.chain)?.decimals ?? null
  const eligible = inv ? (accounts.data ?? []).filter((a) => a.asset === inv.asset && a.chain === inv.chain) : []
  const a = eligible.find((x) => x.id === acct)
  return (
    <div className="space-y-2">
      <p className="text-xs text-suwappu-text-secondary">Get an advance on an invoice you sent. Financing is only offered once the payer has accepted the invoice.</p>
      <QueryState query={invoices} isEmpty={(d) => d.filter((i) => i.status !== 'draft').length === 0} empty={<Empty title="No invoices to finance" />}>
        {(list) => <>{list.filter((i) => i.status !== 'draft').map((i) => (
          <Card key={i.id} className="!p-3 space-y-1">
            <div className="flex justify-between gap-2"><p className="text-sm font-semibold tabular-nums">{formatMinor(i.amountMinor, dec(i))} {i.asset}</p><Chip status={i.status} /></div>
            {i.memo && <p className="text-xs text-suwappu-text-secondary break-words">{i.memo}</p>}
            {i.acceptance?.required && <p className="text-[11px] text-suwappu-text-secondary">{i.acceptance.acceptedAt ? `Accepted by payer ${new Date(i.acceptance.acceptedAt).toLocaleDateString()}` : 'Waiting for the payer to accept. Financing is refused until they do.'}</p>}
            {!i.acceptance?.required && <p className="text-[11px] text-suwappu-text-secondary">No named payer, so this invoice cannot be accepted or financed.</p>}
            {['open', 'accepted', 'partial'].includes(i.status) && !!i.acceptance?.acceptedAt && <Btn variant="ghost" className="w-full" onClick={() => { setInv(i); setAcct('') }}>Finance this invoice</Btn>}
          </Card>
        ))}</>}
      </QueryState>
      {inv && (
        <Sheet title="Finance invoice" onClose={() => setInv(null)}>
          <div className="space-y-3">
            <Row label="Invoice" value={`${formatMinor(inv.amountMinor, dec(inv))} ${inv.asset}`} />
            <Field label="Advance is paid into"><AccountSelect accounts={eligible} value={acct} onChange={setAcct} /></Field>
            {a && (
              <MoneyAction
                title="Confirm invoice financing"
                rows={[{ label: 'Invoice', value: `${formatMinor(inv.amountMinor, dec(inv))} ${inv.asset}` }, { label: 'Advance paid into', value: a.label || a.kind }, { label: 'Advance amount', value: 'Set by the lender; shown after approval' }, { label: 'Fee', value: 'None shown by the API' }]}
                confirmLabel="Request advance"
                run={(k) => bank.financeReceivable({ accountId: a.id, invoiceId: inv.id }, k)}
                renderResult={(r) => (r?.advanceMinor ? <Row label="Advance" value={`${formatMinor(r.advanceMinor, dec(inv))} ${inv.asset}`} /> : null)}
                onClose={() => { setInv(null); void qc.invalidateQueries({ queryKey: ['bank'] }) }}
              />
            )}
          </div>
        </Sheet>
      )}
      {invoices.isError && <ErrorBox error={invoices.error} />}
    </div>
  )
}
