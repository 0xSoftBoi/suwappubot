import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { QRCodeSVG } from '../../lib/QRCodeSVG'
import { BankApiError, bank, formatMinor, parseToMinor, str, type Remittance } from '../../lib/bankApi'
import { useBankAccounts, useBankAssets } from '../../hooks/bank/useBankCore'
import { useClaimPreview, useExternalAccounts, useRemittance, useRemittances } from '../../hooks/bank/useBankDomains'
import { clearIntentKey, intentKey } from '../../hooks/bank/intentKey'
import { isDefinitiveFailure } from '../../hooks/bank/useIdempotencyKey'
import { isTelegramId, isTelegramUsername } from '../../lib/bankValidate'
import { BankPage, Btn, Card, Chip, Empty, ErrorBox, Field, Input, QueryState, Row, SectionTitle, Select, Tabs } from '../../components/bank/BankUI'
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
  const [claimTo, setClaimTo] = useState('')
  const [openLink, setOpenLink] = useState(false)
  const [memo, setMemo] = useState('')
  const [confirm, setConfirm] = useState(false)
  const acct = accounts.data?.find((a) => a.id === from)
  const amountMinor = acct?.decimals != null ? parseToMinor(amount, acct.decimals) : null
  // Claim links: default to a named claimant (server binds the link to that Telegram identity); an open bearer link is an explicit opt-in.
  const claimRaw = claimTo.trim().replace(/^@/, '')
  const claimIsId = isTelegramId(claimRaw)
  const claimValid = claimIsId || isTelegramUsername(claimRaw)
  const claimBound = kind === 'claim' && !openLink
  const claimRecipient = claimIsId ? { kind: 'claim' as const, telegramId: Number(claimRaw) } : { kind: 'claim' as const, username: claimRaw }
  const recipient = kind === 'user' ? { kind, username: username.replace(/^@/, '').trim() } : kind === 'address' ? { kind, address: address.trim() } : claimBound ? claimRecipient : { kind }
  const recipientOk = kind === 'user' ? username.trim().length > 0 : kind === 'address' ? address.trim().length >= 20 : openLink || claimValid
  const sig = JSON.stringify([kind, from, acct?.asset, amountMinor, username, address, memo, claimBound ? claimRaw.toLowerCase() : 'open'])
  // Same intent (even after closing/reopening the confirm sheet) => same key; any input change => new key.
  const fp = `send:${sig}`

  const quote = useMutation({ mutationFn: () => bank.remitQuote({ fromAccountId: from, amountMinor: amountMinor as string }) })
  const send = useMutation({
    mutationFn: () => bank.remitSend({ fromAccountId: from, amountMinor, memo: memo.trim() || undefined, recipient }, intentKey(fp)),
    onSuccess: () => { clearIntentKey(fp); void qc.invalidateQueries({ queryKey: ['bank'] }) },
    onError: (e) => { if (isDefinitiveFailure(e)) clearIntentKey(fp) },
  })
  const q = quote.data as Record<string, unknown> | undefined
  const done = () => { setConfirm(false); send.reset(); quote.reset(); setAmount(''); nav('/bank') }
  const claimLink = send.data?.claimLink ?? (send.data?.claimToken ? `${window.location.origin}/bank/claim/${encodeURIComponent(send.data.claimToken)}` : undefined)

  const rows = useMemo(() => {
    if (!acct) return []
    const dec = acct.decimals
    return [
      { label: 'Send', value: `${formatMinor(amountMinor ?? undefined, dec)} ${acct.asset}` },
      { label: 'Recipient', value: kind === 'user' ? `@${username.replace(/^@/, '')}` : kind === 'address' ? address : claimBound ? `Claim link, only ${claimIsId ? `Telegram id ${claimRaw}` : `@${claimRaw}`} can claim` : 'Claim link, OPEN: anyone with the link can claim', mono: kind === 'address' },
      { label: 'Fee', value: q && str(q.feeMinor) !== undefined ? `${formatMinor(str(q.feeMinor), dec)} ${acct.asset}` : '—' },
      { label: 'Recipient gets', value: q && str(q.receiveAmountMinor) ? `${formatMinor(str(q.receiveAmountMinor), dec)} ${acct.asset}` : '—' },
      { label: 'Arrives', value: str(q?.eta) ?? '—' },
      ...(memo.trim() ? [{ label: 'Note', value: memo.trim() }] : []),
    ]
  }, [acct, amountMinor, kind, username, address, q, memo, claimBound, claimRaw, claimIsId])

  return (
    <BankPage title="Send money">
      <Card className="space-y-3">
        <Tabs<Kind> value={kind} onChange={setKind} tabs={[{ id: 'user', label: 'Username' }, { id: 'address', label: 'Address' }, { id: 'claim', label: 'Claim link' }]} />
        {kind === 'user' && <Field label="Telegram username"><Input value={username} placeholder="@name" autoCapitalize="none" onChange={(e) => setUsername(e.target.value)} /></Field>}
        {kind === 'address' && <Field label="Wallet address"><Input value={address} className="font-mono text-xs" onChange={(e) => setAddress(e.target.value)} /></Field>}
        {kind === 'claim' && (
          <div className="space-y-2">
            <p className="text-xs text-terminal-text-secondary">You get a link to share. The money is held until it is claimed, and is returned to you if it expires.</p>
            {!openLink && (
              <Field label="Only this person can claim">
                <Input value={claimTo} placeholder="@username or Telegram id" autoCapitalize="none" onChange={(e) => setClaimTo(e.target.value)} />
                {claimTo.trim() !== '' && !claimValid && <p className="text-[11px] text-bear mt-1">Enter a Telegram username (5 to 32 letters, digits or underscores) or a numeric Telegram id.</p>}
              </Field>
            )}
            <label className="flex items-start gap-2 text-xs min-h-[36px]">
              <input type="checkbox" className="mt-0.5" checked={openLink} onChange={(e) => setOpenLink(e.target.checked)} />
              <span><span className="font-semibold">Anyone with the link can claim</span><br /><span className="text-terminal-text-secondary">Whoever opens the link first gets the money, so a forwarded or leaked link can be claimed by someone else.</span></span>
            </label>
          </div>
        )}
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
                  <p className="text-xs font-semibold">{claimBound ? `Bound link: only ${claimIsId ? `Telegram id ${claimRaw}` : `@${claimRaw}`} can claim it.` : 'Open link: anyone who has it can claim the money.'}</p>
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
  const [ext, setExt] = useState('')
  const assets = useBankAssets()
  const externals = useExternalAccounts()
  const claim = useMutation({ mutationFn: () => bank.claim(token as string, choice === 'cashout' ? { choice, externalAccountId: ext } : { choice, accountId: to || undefined }) })
  const p = preview.data as Record<string, unknown> | undefined
  const dec = assets.data?.find((a) => a.symbol === str(p?.asset) && a.chain === str(p?.chain))?.decimals ?? null
  const extList = externals.data ?? []
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
            {dec === null && !assets.isLoading && <p className="text-[11px] text-terminal-text-secondary">Amount shown in raw units because this currency could not be looked up.</p>}
            {str(p?.status) === 'awaiting_claim' && !claim.data && (
              <>
                <Tabs<'keep' | 'cashout'> value={choice} onChange={setChoice} tabs={extList.length > 0 ? [{ id: 'keep', label: 'Keep in Bank' }, { id: 'cashout', label: 'Cash out' }] : [{ id: 'keep', label: 'Keep in Bank' }]} />
                {extList.length === 0 && !externals.isLoading && <p className="text-[11px] text-terminal-text-secondary">To cash out to a bank, first save a bank account under Add money, then open this link again.</p>}
                {choice === 'keep' && <Field label="Deposit into"><AccountSelect accounts={matching} value={to} onChange={setTo} /></Field>}
                {choice === 'cashout' && (
                  <Field label="Send to bank account">
                    <Select value={ext} onChange={(e) => setExt(e.target.value)}>
                      <option value="">Choose an account</option>
                      {extList.map((x) => <option key={x.id} value={x.id}>{x.label || x.provider} · {x.rail} · {x.currency}</option>)}
                    </Select>
                  </Field>
                )}
                {claim.isError && (claim.error instanceof BankApiError && claim.error.code === 'FORBIDDEN'
                  ? <ErrorBox error={new Error('This claim link was issued to a different person. Sign in with the Telegram account it was sent to. Nothing was claimed.')} />
                  : <ErrorBox error={claim.error} />)}
                <Btn className="w-full" disabled={claim.isPending || (choice === 'keep' && matching.length > 0 && !to) || (choice === 'cashout' && !ext)} onClick={() => claim.mutate()}>{claim.isPending ? 'Claiming…' : 'Claim'}</Btn>
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
