import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { bank, formatMinor, parseToMinor, str, type Card as BankCard, type CardRules } from '../../lib/bankApi'
import { useCardAuths, useCardDetail, useCards, useCardTxs } from '../../hooks/bank/useBankDomains'
import { BankPage, Btn, Card, Chip, Empty, ErrorBox, Field, Input, QueryState, Row, SectionTitle, Tabs } from '../../components/bank/BankUI'
import { IssueCard } from '../../components/bank/IssueCard'
import { RevealCard } from '../../components/bank/RevealCard'
import { a11yToast } from '@/lib/a11yToast'

const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)
const join = (a?: string[]) => (a ?? []).join(', ')

/** Mounted only once the server's authoritative cap decimals (GET /cards/:id capDecimals) are known. */
function Rules({ card, decimals, capCurrency }: { card: BankCard; decimals: number; capCurrency?: string }) {
  const qc = useQueryClient()
  const r = card.rules ?? {}
  const win = ((r as { activeWindows?: Array<{ start: string; end: string; timezone?: string }> }).activeWindows ?? [])[0]
  const capIn = (m?: string) => (m ? formatMinor(m, decimals, { minFrac: 0, maxFrac: decimals }).replace(/,/g, '') : '')
  const perTx0 = capIn(r.perTxCapMinor)
  const daily0 = capIn(r.dailyCapMinor)
  const start0 = win?.start?.slice(0, 10) ?? ''
  const end0 = win?.end?.slice(0, 10) ?? ''
  const [perTx, setPerTx] = useState(perTx0)
  const [daily, setDaily] = useState(daily0)
  const [start, setStart] = useState(start0)
  const [end, setEnd] = useState(end0)
  const [mccAllow, setMccAllow] = useState(join(r.mccAllow))
  const [mccBlock, setMccBlock] = useState(join(r.mccBlock))
  const [merchAllow, setMerchAllow] = useState(join(r.merchantAllow))
  const [merchBlock, setMerchBlock] = useState(join(r.merchantBlock))
  const [cAllow, setCAllow] = useState(join(r.countryAllow))
  const [cBlock, setCBlock] = useState(join(r.countryBlock))
  const [simAmt, setSimAmt] = useState('')
  const [simMerch, setSimMerch] = useState('')
  const [simMcc, setSimMcc] = useState('')
  const [simCountry, setSimCountry] = useState('')

  const build = (): { rules?: CardRules; error?: string } => {
    const out: Record<string, unknown> = { ...r }
    for (const k of ['mccAllow', 'mccBlock', 'merchantAllow', 'merchantBlock', 'countryAllow', 'countryBlock']) delete out[k]
    // Caps and the active window are only rewritten when the user edited them; otherwise the stored values round-trip untouched.
    for (const [v, v0, k, f] of [[perTx, perTx0, 'Per-transaction cap', 'perTxCapMinor'], [daily, daily0, 'Daily cap', 'dailyCapMinor']] as const) {
      if (v === v0) continue
      if (!v.trim()) { delete out[f]; continue }
      const mn = parseToMinor(v, decimals)
      if (!mn || !/^\d+$/.test(mn)) return { error: `${k} is not a valid amount` }
      out[f] = mn
    }
    if (start !== start0 || end !== end0) {
      delete out.activeWindows
      if ((start && !end) || (!start && end)) return { error: 'Set both a start and an end date, or neither.' }
      if (start && end) out.activeWindows = [{ start, end, timezone: 'UTC' }]
    }
    if (list(mccAllow).length) out.mccAllow = list(mccAllow)
    if (list(mccBlock).length) out.mccBlock = list(mccBlock)
    if (list(merchAllow).length) out.merchantAllow = list(merchAllow)
    if (list(merchBlock).length) out.merchantBlock = list(merchBlock)
    if (list(cAllow).length) out.countryAllow = list(cAllow).map((c) => c.toUpperCase())
    if (list(cBlock).length) out.countryBlock = list(cBlock).map((c) => c.toUpperCase())
    return { rules: out as CardRules }
  }
  const built = build()
  const save = useMutation({
    mutationFn: () => bank.setCardRules(card.id, built.rules as CardRules),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['bank', 'cards'] }); a11yToast.success('Rules saved') },
  })
  const sim = useMutation({
    mutationFn: () => bank.simulateCard(card.id, {
      amountMinor: parseToMinor(simAmt, decimals) as string,
      merchantName: simMerch.trim() || undefined, mcc: simMcc.trim() || undefined, country: simCountry.trim().toUpperCase() || undefined, rules: built.rules,
    }),
  })
  const s = sim.data?.simulation as Record<string, unknown> | undefined
  return (
    <div className="space-y-3">
      <Card className="space-y-3">
        <p className="text-sm font-semibold">Spending rules</p>
        <div className="grid grid-cols-2 gap-2">
          <Field label={`Per-transaction cap${capCurrency ? ` (${capCurrency})` : ''}`}><Input inputMode="decimal" value={perTx} onChange={(e) => setPerTx(e.target.value)} /></Field>
          <Field label={`Daily cap${capCurrency ? ` (${capCurrency})` : ''}`}><Input inputMode="decimal" value={daily} onChange={(e) => setDaily(e.target.value)} /></Field>
          <Field label="Active from"><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="Active until"><Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        </div>
        <Field label="Allowed categories (MCC)" hint="Comma separated. Ranges like 3000-3299 work."><Input value={mccAllow} onChange={(e) => setMccAllow(e.target.value)} /></Field>
        <Field label="Blocked categories (MCC)"><Input value={mccBlock} onChange={(e) => setMccBlock(e.target.value)} /></Field>
        <Field label="Allowed merchants" hint="Exact match only: the merchant name must be identical to what the card network sends. To match reliably, use a merchant id with the id: prefix (for example id:acct_123). Leave empty to allow all."><Input value={merchAllow} onChange={(e) => setMerchAllow(e.target.value)} /></Field>
        <Field label="Blocked merchants"><Input value={merchBlock} onChange={(e) => setMerchBlock(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Allowed countries"><Input value={cAllow} placeholder="US, GB" onChange={(e) => setCAllow(e.target.value)} /></Field>
          <Field label="Blocked countries"><Input value={cBlock} onChange={(e) => setCBlock(e.target.value)} /></Field>
        </div>
        {built.error && <p className="text-xs text-bear">{built.error}</p>}
        {save.isError && <ErrorBox error={save.error} />}
        <Btn className="w-full" disabled={!built.rules || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save rules'}</Btn>
      </Card>
      <Card className="space-y-3">
        <p className="text-sm font-semibold">Test this rule</p>
        <p className="text-xs text-terminal-text-secondary">Runs a pretend purchase against the rules above without saving them.</p>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Amount"><Input inputMode="decimal" value={simAmt} onChange={(e) => setSimAmt(e.target.value)} /></Field>
          <Field label="Country"><Input value={simCountry} maxLength={2} onChange={(e) => setSimCountry(e.target.value)} /></Field>
          <Field label="Merchant"><Input value={simMerch} onChange={(e) => setSimMerch(e.target.value)} /></Field>
          <Field label="MCC"><Input value={simMcc} inputMode="numeric" maxLength={4} onChange={(e) => setSimMcc(e.target.value)} /></Field>
        </div>
        {sim.isError && <ErrorBox error={sim.error} />}
        <Btn variant="ghost" className="w-full" disabled={!built.rules || !parseToMinor(simAmt, decimals) || sim.isPending} onClick={() => sim.mutate()}>{sim.isPending ? 'Testing…' : 'Test'}</Btn>
        {s && (
          <div className="rounded-terminal-control bg-terminal-bg-tertiary p-3 text-sm space-y-1">
            <Row label="Result" value={<Chip status={str(s.decision) ?? (s.allowed === true ? 'approved' : s.allowed === false ? 'declined' : 'unknown')} tone={(s.decision === 'approve' || s.allowed === true) ? 'good' : 'bad'} />} />
            {Array.isArray(s.reasons) && s.reasons.map((x, i) => <p key={i} className="text-xs text-terminal-text-secondary break-words">{typeof x === 'string' ? x : JSON.stringify(x)}</p>)}
            {Array.isArray(s.violations) && s.violations.map((x, i) => <p key={i} className="text-xs text-terminal-text-secondary break-words">{typeof x === 'string' ? x : JSON.stringify(x)}</p>)}
          </div>
        )}
      </Card>
    </div>
  )
}

function Activity({ card, decimals }: { card: BankCard; decimals: number | null }) {
  const auths = useCardAuths(card.id)
  const txs = useCardTxs(card.id)
  return (
    <div className="space-y-3">
      <SectionTitle>Authorizations</SectionTitle>
      <QueryState query={auths} rows={1} isEmpty={(d) => d.length === 0} empty={<Empty title="No authorizations" />}>
        {(l) => <Card className="divide-y divide-terminal-border !py-1">{l.map((a) => <div key={a.id} className="py-2.5 flex justify-between gap-2"><div className="min-w-0"><p className="text-sm truncate">{a.merchantName ?? 'Merchant'}</p>{a.reason && <p className="text-[11px] text-terminal-text-secondary break-words">{a.reason}</p>}</div><div className="text-right shrink-0"><p className="text-sm tabular-nums">{formatMinor(a.amountMinor, decimals)} {a.currency}</p><Chip status={a.decision} /></div></div>)}</Card>}
      </QueryState>
      <SectionTitle>Transactions</SectionTitle>
      <QueryState query={txs} rows={1} isEmpty={(d) => d.length === 0} empty={<Empty title="No transactions" />}>
        {(l) => <Card className="divide-y divide-terminal-border !py-1">{l.map((t) => <div key={t.id} className="py-2.5 flex justify-between gap-2"><div className="min-w-0"><p className="text-sm truncate">{t.merchantName ?? t.type}</p><p className="text-[11px] text-terminal-text-secondary">{new Date(t.createdAt).toLocaleString()}</p>{t.refundState === 'AWAITING_REFUND_INFLOW' && <p className="text-[11px] text-terminal-warn break-words">Refund received by card program — awaiting settlement</p>}</div><div className="text-right shrink-0"><p className="text-sm tabular-nums">{formatMinor(t.amountMinor, decimals)} {t.currency}</p>{t.settlementStatus && <Chip status={t.settlementStatus} />}</div></div>)}</Card>}
      </QueryState>
    </div>
  )
}

export function Cards() {
  const qc = useQueryClient()
  const cards = useCards()
  const [issuing, setIssuing] = useState(false)
  const [sel, setSel] = useState<string>('')
  const [tab, setTab] = useState<'rules' | 'activity'>('rules')
  const card = cards.data?.find((c) => c.id === sel)
  useEffect(() => { if (!sel && cards.data?.[0]) setSel(cards.data[0].id) }, [cards.data, sel])
  const detail = useCardDetail(card?.id)
  const cd = detail.data && detail.data.card.id === card?.id ? detail.data : undefined
  // Authoritative cap/amount decimals come only from GET /cards/:id; never inferred from an account.
  const decimals = cd && Number.isInteger(cd.capDecimals) && cd.capDecimals >= 0 ? cd.capDecimals : null
  const capCurrency = cd?.capCurrency
  // A capture the issuer already paid but we could not settle: the server attaches `shortfall` while one is open.
  const shortfall = cd?.card.shortfall ?? card?.shortfall
  const act = useMutation({
    mutationFn: (a: 'freeze' | 'unfreeze' | 'cancel') => bank.cardAction(card?.id as string, a),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['bank', 'cards'] }),
  })
  return (
    <BankPage title="Cards">
      <QueryState query={cards} rows={1} isEmpty={(d) => d.length === 0} empty={<Empty title="No cards yet" hint="Issue a virtual card funded from one of your accounts." action={<Btn onClick={() => setIssuing(true)}>Issue a card</Btn>} />}>
        {(list) => (
          <>
            <div className="flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {list.map((c) => <button key={c.id} type="button" onClick={() => setSel(c.id)} className={`shrink-0 min-h-[44px] px-3 rounded-terminal-control text-xs font-semibold border ${sel === c.id ? 'bg-terminal-accent text-terminal-on-accent border-transparent' : 'bg-terminal-panel border-terminal-border text-terminal-text'}`}>{c.label || c.brand || 'Card'} · {c.currency}</button>)}
              <button type="button" onClick={() => setIssuing(true)} className="shrink-0 min-h-[44px] px-3 rounded-terminal-control text-xs font-semibold bg-terminal-bg-tertiary text-terminal-text">+ New</button>
            </div>
            {card && (
              <>
                <Card>
                  <div className="flex justify-between"><p className="text-sm font-semibold">{card.label || card.brand || 'Virtual card'}</p><Chip status={card.status} /></div>
                  <Row label="Type" value={card.type} />
                  {capCurrency && <Row label="Limits are in" value={capCurrency} />}
                  {card.expMonth && card.expYear && <Row label="Expires" value={`${String(card.expMonth).padStart(2, '0')}/${card.expYear}`} />}
                  {shortfall && <p className="text-xs text-terminal-warn bg-terminal-warn/10 rounded-terminal-control p-2 mt-2 break-words">This card is frozen because a purchase was paid by the card program beyond your available funds{decimals !== null ? ` (${formatMinor(shortfall.amountMinor, decimals)} ${shortfall.asset} outstanding)` : ''}. It cannot be unfrozen until that amount is repaid. Add funds to the account to cover it.</p>}
                  {act.isError && <ErrorBox error={act.error} />}
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    {card.status === 'frozen' ? <Btn disabled={act.isPending || !!shortfall} onClick={() => act.mutate('unfreeze')}>Unfreeze</Btn> : <Btn variant="ghost" disabled={card.status !== 'active' || act.isPending} onClick={() => act.mutate('freeze')}>Freeze</Btn>}
                    <Btn variant="danger" disabled={card.status === 'canceled' || act.isPending} onClick={() => { if (window.confirm('Cancel this card permanently?')) act.mutate('cancel') }}>Cancel card</Btn>
                  </div>
                </Card>
                {card.status === 'active' && <RevealCard cardId={card.id} providerCardId={cd?.card.providerCardId} provider={card.provider} />}
                <Tabs value={tab} onChange={setTab} tabs={[{ id: 'rules', label: 'Rules' }, { id: 'activity', label: 'Activity' }]} />
                {tab === 'rules'
                  ? (cd && decimals !== null
                    ? <Rules key={`${card.id}:${decimals}:${JSON.stringify(cd.card.rules)}`} card={cd.card} decimals={decimals} capCurrency={capCurrency} />
                    : detail.isError
                      ? <ErrorBox error={detail.error} onRetry={() => void detail.refetch()} />
                      : <Card><p className="text-xs text-terminal-text-secondary animate-pulse">Loading card limits…</p></Card>)
                  : <Activity card={card} decimals={decimals} />}
              </>
            )}
          </>
        )}
      </QueryState>
      {issuing && <IssueCard onClose={() => setIssuing(false)} />}
    </BankPage>
  )
}
