import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { QRCodeSVG } from '../../lib/QRCodeSVG'
import { bank, formatMinor, parseToMinor, str, type Remittance } from '../../lib/bankApi'
import { useBankAccounts } from '../../hooks/bank/useBankCore'
import { useClaimPreview, useRemittance, useRemittances } from '../../hooks/bank/useBankDomains'
import { useIdempotencyKey } from '../../hooks/bank/useIdempotencyKey'
import { BankPage, Btn, Card, Chip, Empty, ErrorBox, Field, Input, QueryState, Row, SectionTitle, Tabs } from '../../components/bank/BankUI'
import { AccountSelect } from '../../components/bank/AccountSelect'
import { CheapestChainHint } from '../../components/bank/CheapestChainHint'
import { AmountInput } from '../../components/bank/Amount'
import { ConfirmSheet } from '../../components/bank/ConfirmSheet'
import { TransferTracker } from '../../components/bank/TransferTracker'
import { a11yToast } from '@/lib/a11yToast'

type Kind = 'user' | 'address' | 'claim'

function RemitTracker({ r, onDone }: { r: Remittance; onDone: () => void }) {
  const live = useRemittance(r.id)
  const cur = live.data ?? r
  if (cur.bankTransferId) return <><Row label="Remittance" value={<Chip status={cur.status} />} /><div className="mt-2"><TransferTracker transferId={cur.bankTransferId} onDone={onDone} /></div></>
  return (
    <div className="space-y-2" aria-live="polite">
      <Row label="Status" value={<Chip status={cur.status} />} />
      <Btn className="w-full" onClick={onDone}>Done</Btn>
    </div>
  )
}

export function Send() {
  const nav = useNavigate()
  const qc = useQueryClient()
  const accounts = useBankAccounts()
  const history = useRemittances()
  const [kind, setKind] = useState<Kind>('user')
  const [from, setFrom] = useState('')
  const [amount, setAmount] = useState('')
  const [username, setUsername] = useState('')
  const [address, setAddress] = useState('')
  const [memo, setMemo] = useState('')
  const [confirm, setConfirm] = useState(false)
  const key = useIdempotencyKey()
  const acct = accounts.data?.find((a) => a.id === from)
  const amountMinor = acct?.decimals != null ? parseToMinor(amount, acct.decimals) : null
  const recipient = kind === 'user' ? { kind, username: username.replace(/^@/, '').trim() } : kind === 'address' ? { kind, address: address.trim() } : { kind }
  const recipientOk = kind === 'user' ? username.trim().length > 0 : kind === 'address' ? address.trim().length >= 20 : true
  const sig = JSON.stringify([kind, from, amountMinor, username, address, memo])
  useEffect(() => { key.reset() }, [sig]) // eslint-disable-line react-hooks/exhaustive-deps

  const quote = useMutation({ mutationFn: () => bank.remitQuote({ fromAccountId: from, amountMinor: amountMinor as string }) })
  const send = useMutation({
    mutationFn: () => bank.remitSend({ fromAccountId: from, amountMinor, memo: memo.trim() || undefined, recipient }, key.current()),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['bank'] }),
  })
  const q = quote.data as Record<string, unknown> | undefined
  const done = () => { key.reset(); setConfirm(false); send.reset(); quote.reset(); setAmount(''); nav('/bank') }
  const claimLink = send.data?.claimLink ?? (send.data?.claimPath ? `${window.location.origin}${send.data.claimPath}` : undefined)

  const rows = useMemo(() => {
    if (!acct) return []
    const dec = acct.decimals
    return [
      { label: 'Send', value: `${formatMinor(amountMinor ?? undefined, dec)} ${acct.asset}` },
      { label: 'Recipient', value: kind === 'user' ? `@${username.replace(/^@/, '')}` : kind === 'address' ? address : 'Anyone with the claim link', mono: kind === 'address' },
      { label: 'Fee', value: q && str(q.feeMinor) !== undefined ? `${formatMinor(str(q.feeMinor), dec)} ${acct.asset}` : '—' },
      { label: 'Recipient gets', value: q && str(q.receiveAmountMinor) ? `${formatMinor(str(q.receiveAmountMinor), dec)} ${acct.asset}` : '—' },
      { label: 'Arrives', value: str(q?.eta) ?? '—' },
      ...(memo.trim() ? [{ label: 'Note', value: memo.trim() }] : []),
    ]
  }, [acct, amountMinor, kind, username, address, q, memo])

  return (
    <BankPage title="Send money">
      <Card className="space-y-3">
        <Tabs<Kind> value={kind} onChange={setKind} tabs={[{ id: 'user', label: 'Username' }, { id: 'address', label: 'Address' }, { id: 'claim', label: 'Claim link' }]} />
        {kind === 'user' && <Field label="Telegram username"><Input value={username} placeholder="@name" autoCapitalize="none" onChange={(e) => setUsername(e.target.value)} /></Field>}
        {kind === 'address' && <Field label="Wallet address"><Input value={address} className="font-mono text-xs" onChange={(e) => setAddress(e.target.value)} /></Field>}
        {kind === 'claim' && <p className="text-xs text-terminal-text-secondary">You get a link to share. The money is held until someone claims it, and is returned to you if it expires.</p>}
        <Field label="From">{accounts.isLoading ? <p className="text-xs animate-pulse">Loading accounts…</p> : <AccountSelect accounts={accounts.data ?? []} value={from} onChange={setFrom} />}</Field>
        {accounts.isError && <ErrorBox error={accounts.error} onRetry={() => void accounts.refetch()} />}
        <Field label="Amount"><AmountInput value={amount} onChange={setAmount} symbol={acct?.asset} decimals={acct?.decimals ?? null} /></Field>
        <CheapestChainHint acct={acct} amountMinor={amountMinor} />
        <Field label="Note (optional)"><Input value={memo} maxLength={280} onChange={(e) => setMemo(e.target.value)} /></Field>
        {quote.isError && <ErrorBox error={quote.error} />}
        <Btn className="w-full" disabled={!acct || !amountMinor || !recipientOk || quote.isPending} onClick={() => quote.mutate(undefined, { onSuccess: () => setConfirm(true) })}>
          {quote.isPending ? 'Getting quote…' : 'Review'}
        </Btn>
      </Card>
      <SectionTitle>Sent and received</SectionTitle>
      <QueryState query={history} rows={2} isEmpty={(d) => d.sent.length + d.received.length === 0} empty={<Empty title="No remittances yet" />}>
        {(d) => (
          <Card className="divide-y divide-terminal-border !py-1">
            {[...d.sent.map((r) => ({ r, dir: 'Sent' })), ...d.received.map((r) => ({ r, dir: 'Received' }))].map(({ r, dir }) => (
              <div key={r.id} className="flex items-center justify-between py-2.5 gap-2">
                <div className="min-w-0"><p className="text-sm font-medium">{dir}</p><p className="text-[11px] text-terminal-text-secondary">{new Date(r.createdAt).toLocaleString()}</p></div>
                <div className="text-right shrink-0"><p className="text-sm font-semibold tabular-nums">{formatMinor(r.amountMinor, accounts.data?.find((a) => a.asset === r.sendAsset)?.decimals)} {r.sendAsset}</p><Chip status={r.status} /></div>
              </div>
            ))}
          </Card>
        )}
      </QueryState>
      {confirm && acct && (
        <ConfirmSheet
          title="Confirm send"
          rows={rows}
          confirmLabel={`Send ${formatMinor(amountMinor ?? undefined, acct.decimals)} ${acct.asset}`}
          pending={send.isPending}
          error={send.error}
          onConfirm={() => send.mutate()}
          onClose={() => { if (send.data) done(); else setConfirm(false) }}
          note={q?.note ? String(q.note) : undefined}
          result={send.data && (
            <div className="space-y-3">
              {claimLink && (
                <div className="text-center space-y-2">
                  <div className="mx-auto w-40 h-40 p-2 bg-terminal-panel rounded-terminal-control"><QRCodeSVG value={claimLink} size={144} /></div>
                  <p className="font-mono text-[11px] break-all">{claimLink}</p>
                  <Btn variant="ghost" className="w-full" onClick={() => void navigator.clipboard.writeText(claimLink).then(() => a11yToast.success('Link copied'), () => a11yToast.error('Could not copy the link'))}>Copy claim link</Btn>
                </div>
              )}
              {send.data.remittance ? <RemitTracker r={send.data.remittance} onDone={done} /> : <Btn className="w-full" onClick={done}>Done</Btn>}
            </div>
          )}
        />
      )}
    </BankPage>
  )
}

export function Claim() {
  const { token } = useParams()
  const nav = useNavigate()
  const accounts = useBankAccounts()
  const preview = useClaimPreview(token)
  const [choice, setChoice] = useState<'keep' | 'cashout'>('keep')
  const [to, setTo] = useState('')
  const claim = useMutation({ mutationFn: () => bank.claim(token as string, { choice, accountId: to || undefined }) })
  const p = preview.data as Record<string, unknown> | undefined
  const dec = accounts.data?.find((a) => a.asset === str(p?.asset) && a.chain === str(p?.chain))?.decimals ?? null
  const matching = (accounts.data ?? []).filter((a) => a.asset === str(p?.asset) && a.chain === str(p?.chain))
  return (
    <BankPage title="Claim money">
      <QueryState query={preview} rows={2}>
        {() => (
          <Card className="space-y-2">
            <Row label="Amount" value={`${formatMinor(str(p?.amountMinor), dec)} ${str(p?.asset) ?? ''}`} />
            <Row label="Network" value={str(p?.chain) ?? '—'} />
            <Row label="Status" value={<Chip status={str(p?.status) ?? 'unknown'} />} />
            {str(p?.memo) && <Row label="Note" value={str(p?.memo)} />}
            {str(p?.expiresAt) && <Row label="Expires" value={new Date(str(p?.expiresAt) as string).toLocaleString()} />}
            {dec === null && <p className="text-[11px] text-terminal-text-secondary">Open an account in this currency to see the amount formatted.</p>}
            {str(p?.status) === 'awaiting_claim' && !claim.data && (
              <>
                <Tabs<'keep' | 'cashout'> value={choice} onChange={setChoice} tabs={[{ id: 'keep', label: 'Keep in Bank' }, { id: 'cashout', label: 'Cash out' }]} />
                {choice === 'keep' && <Field label="Deposit into"><AccountSelect accounts={matching} value={to} onChange={setTo} /></Field>}
                {choice === 'cashout' && <p className="text-xs text-terminal-text-secondary">Cash out uses your saved bank account. Set one up under Add money, then claim.</p>}
                {claim.isError && <ErrorBox error={claim.error} />}
                <Btn className="w-full" disabled={claim.isPending || (choice === 'keep' && matching.length > 0 && !to)} onClick={() => claim.mutate()}>{claim.isPending ? 'Claiming…' : 'Claim'}</Btn>
              </>
            )}
            {claim.data && (
              <div className="space-y-2">
                <Row label="Result" value={<Chip status={claim.data.remittance.status} />} />
                {claim.data.cashout?.error && <ErrorBox error={new Error(claim.data.cashout.error)} />}
                <Btn className="w-full" onClick={() => nav('/bank')}>Go to Bank</Btn>
              </div>
            )}
          </Card>
        )}
      </QueryState>
    </BankPage>
  )
}
