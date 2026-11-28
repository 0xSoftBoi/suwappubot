import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { bank, transferIdOf, formatMinor, parseToMinor } from '../../lib/bankApi'
import { useBankAccounts } from '../../hooks/bank/useBankCore'
import { useIdempotencyKey } from '../../hooks/bank/useIdempotencyKey'
import { BankPage, Btn, Card, ErrorBox, Field, Row } from '../../components/bank/BankUI'
import { AccountSelect } from '../../components/bank/AccountSelect'
import { AmountInput } from '../../components/bank/Amount'
import { ConfirmSheet } from '../../components/bank/ConfirmSheet'
import { TransferTracker } from '../../components/bank/TransferTracker'

export function Convert() {
  const nav = useNavigate()
  const qc = useQueryClient()
  const accounts = useBankAccounts()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [open, setOpen] = useState(false)
  const key = useIdempotencyKey()
  const a = accounts.data?.find((x) => x.id === from)
  const b = accounts.data?.find((x) => x.id === to)
  const amountMinor = a?.decimals != null ? parseToMinor(amount, a.decimals) : null
  useEffect(() => { key.reset() }, [from, to, amountMinor]) // eslint-disable-line react-hooks/exhaustive-deps

  const quote = useMutation({ mutationFn: () => bank.fxQuote({ fromAccountId: from, toAccountId: to, amountMinor: amountMinor as string }) })
  const exec = useMutation({
    mutationFn: () => bank.fxExecute({ fromAccountId: from, toAccountId: to, amountMinor: amountMinor as string, minToMinor: quote.data?.quote.minToMinor }, key.current()),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['bank'] }),
  })
  const qd = quote.data?.quote
  const done = () => { key.reset(); setOpen(false); exec.reset(); quote.reset(); setAmount(''); nav('/bank') }
  const tid = exec.data ? transferIdOf.fx(exec.data) : null

  return (
    <BankPage title="Convert">
      <Card className="space-y-3">
        {accounts.isError && <ErrorBox error={accounts.error} onRetry={() => void accounts.refetch()} />}
        <Field label="From">{accounts.isLoading ? <p className="text-xs animate-pulse">Loading accounts…</p> : <AccountSelect accounts={accounts.data ?? []} value={from} onChange={(v) => { setFrom(v); if (v === to) setTo(''); quote.reset() }} />}</Field>
        <Field label="To"><AccountSelect accounts={accounts.data ?? []} value={to} onChange={(v) => { setTo(v); quote.reset() }} exclude={from} /></Field>
        <Field label="Amount"><AmountInput value={amount} onChange={(v) => { setAmount(v); quote.reset() }} symbol={a?.asset} decimals={a?.decimals ?? null} /></Field>
        {quote.isError && <ErrorBox error={quote.error} />}
        <Btn className="w-full" disabled={!a || !b || !amountMinor || quote.isPending} onClick={() => quote.mutate()}>{quote.isPending ? 'Getting quote…' : 'Get quote'}</Btn>
      </Card>
      {qd && a && b && (
        <Card>
          <Row label="You pay" value={`${formatMinor(qd.fromAmountMinor, a.decimals)} ${qd.fromAsset}`} />
          <Row label="You get (expected)" value={`${formatMinor(qd.expectedToMinor, b.decimals)} ${qd.toAsset}`} />
          <Row label="Minimum you get" value={`${formatMinor(qd.minToMinor, b.decimals)} ${qd.toAsset}`} />
          <Row label="Rate" value={`1 ${qd.fromAsset} = ${qd.rate} ${qd.toAsset}`} />
          <Row label="Route" value={qd.route} />
          <Row label="Network fee (est.)" value={`$${qd.estimatedGasUsd}`} />
          <Btn className="w-full mt-3" onClick={() => setOpen(true)}>Review conversion</Btn>
        </Card>
      )}
      {open && qd && a && b && (
        <ConfirmSheet
          title="Confirm conversion"
          rows={[
            { label: 'Pay', value: `${formatMinor(qd.fromAmountMinor, a.decimals)} ${qd.fromAsset}` },
            { label: 'Receive (expected)', value: `${formatMinor(qd.expectedToMinor, b.decimals)} ${qd.toAsset}` },
            { label: 'Receive at least', value: `${formatMinor(qd.minToMinor, b.decimals)} ${qd.toAsset}` },
            { label: 'Fee', value: `~$${qd.estimatedGasUsd} network fee` },
            { label: 'Into', value: b.label || `${b.asset} on ${b.chain}` },
          ]}
          confirmLabel="Convert"
          pending={exec.isPending}
          error={exec.error}
          onConfirm={() => exec.mutate()}
          onClose={() => (exec.data ? done() : setOpen(false))}
          result={exec.data && (tid ? <TransferTracker transferId={tid} onDone={done} /> : (
            <div className="space-y-2"><Row label="Status" value={exec.data.transfer.status} /><Btn className="w-full" onClick={done}>Done</Btn></div>
          ))}
        />
      )}
    </BankPage>
  )
}
