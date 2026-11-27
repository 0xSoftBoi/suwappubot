import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { bank, formatMinor, parseToMinor, str, type Card as BankCard, type CardRules } from '../../lib/bankApi'
import { useBankAccounts } from '../../hooks/bank/useBankCore'
import { useCardAuths, useCards, useCardTxs } from '../../hooks/bank/useBankDomains'
import { BankPage, Btn, Card, Chip, Empty, ErrorBox, Field, Input, QueryState, Row, SectionTitle, Tabs } from '../../components/bank/BankUI'
import { IssueCard } from '../../components/bank/IssueCard'
import { a11yToast } from '@/lib/a11yToast'

const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)
const join = (a?: string[]) => (a ?? []).join(', ')

function Rules({ card, decimals }: { card: BankCard; decimals: number | null }) {
  const qc = useQueryClient()
  const r = card.rules ?? {}
  const win = ((r as { activeWindows?: Array<{ start: string; end: string; timezone?: string }> }).activeWindows ?? [])[0]
  const capIn = (m?: string) => (m && decimals !== null ? formatMinor(m, decimals, { minFrac: 0, maxFrac: decimals }).replace(/,/g, '') : '')
  const [perTx, setPerTx] = useState(capIn(r.perTxCapMinor))
  const [daily, setDaily] = useState(capIn(r.dailyCapMinor))
  const [start, setStart] = useState(win?.start?.slice(0, 10) ?? '')
  const [end, setEnd] = useState(win?.end?.slice(0, 10) ?? '')
  const [mccAllow, setMccAllow] = useState(join(r.mccAllow))
  const [mccBlock, setMccBlock] = useState(join(r.mccBlock))
  const [merchBlock, setMerchBlock] = useState(join(r.merchantBlock))
  const [cAllow, setCAllow] = useState(join(r.countryAllow))
  const [cBlock, setCBlock] = useState(join(r.countryBlock))
  const [simAmt, setSimAmt] = useState('')
  const [simMerch, setSimMerch] = useState('')
  const [simMcc, setSimMcc] = useState('')
  const [simCountry, setSimCountry] = useState('')

  const build = (): { rules?: CardRules; error?: string } => {
    const out: Record<string, unknown> = { ...r }
    for (const k of ['perTxCapMinor', 'dailyCapMinor', 'mccAllow', 'mccBlock', 'merchantBlock', 'countryAllow', 'countryBlock', 'activeWindows']) delete out[k]
    const cap = (v: string, k: string) => {
      if (!v.trim()) return null
      const mn = decimals !== null ? parseToMinor(v, decimals) : null
      if (!mn) return `${k} is not a valid amount`
      return mn
    }
    for (const [v, k, f] of [[perTx, 'Per-transaction cap', 'perTxCapMinor'], [daily, 'Daily cap', 'dailyCapMinor']] as const) {
      const c = cap(v, k)
      if (c && !/^\d+$/.test(c)) return { error: c }
      if (c) out[f] = c
    }
    if ((start && !end) || (!start && end)) return { error: 'Set both a start and an end date, or neither.' }
    if (start && end) out.activeWindows = [{ start, end, timezone: 'UTC' }]
    if (list(mccAllow).length) out.mccAllow = list(mccAllow)
    if (list(mccBlock).length) out.mccBlock = list(mccBlock)
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
      amountMinor: parseToMinor(simAmt, decimals ?? 0) as string,
      merchantName: simMerch.trim() || undefined, mcc: simMcc.trim() || undefined, country: simCountry.trim().toUpperCase() || undefined, rules: built.rules,
    }),
  })
  const s = sim.data?.simulation as Record<string, unknown> | undefined
  return (
    <div className="space-y-3">
      <Card className="space-y-3">
        <p className="text-sm font-semibold">Spending rules</p>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Per-transaction cap"><Input inputMode="decimal" value={perTx} onChange={(e) => setPerTx(e.target.value)} /></Field>
          <Field label="Daily cap"><Input inputMode="decimal" value={daily} onChange={(e) => setDaily(e.target.value)} /></Field>
          <Field label="Active from"><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="Active until"><Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        </div>
        <Field label="Allowed categories (MCC)" hint="Comma separated. Ranges like 3000-3299 work."><Input value={mccAllow} onChange={(e) => setMccAllow(e.target.value)} /></Field>
        <Field label="Blocked categories (MCC)"><Input value={mccBlock} onChange={(e) => setMccBlock(e.target.value)} /></Field>
        <Field label="Blocked merchants"><Input value={merchBlock} onChange={(e) => setMerchBlock(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Allowed countries"><Input value={cAllow} placeholder="US, GB" onChange={(e) => setCAllow(e.target.value)} /></Field>
          <Field label="Blocked countries"><Input value={cBlock} onChange={(e) => setCBlock(e.target.value)} /></Field>
        </div>
        {built.error && <p className="text-xs text-red-500">{built.error}</p>}
        {save.isError && <ErrorBox error={save.error} />}
        <Btn className="w-full" disabled={!built.rules || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save rules'}</Btn>
      </Card>
      <Card className="space-y-3">
        <p className="text-sm font-semibold">Test this rule</p>
        <p className="text-xs text-suwappu-text-secondary">Runs a pretend purchase against the rules above without saving them.</p>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Amount"><Input inputMode="decimal" value={simAmt} onChange={(e) => setSimAmt(e.target.value)} /></Field>
          <Field label="Country"><Input value={simCountry} maxLength={2} onChange={(e) => setSimCountry(e.target.value)} /></Field>
          <Field label="Merchant"><Input value={simMerch} onChange={(e) => setSimMerch(e.target.value)} /></Field>
          <Field label="MCC"><Input value={simMcc} inputMode="numeric" maxLength={4} onChange={(e) => setSimMcc(e.target.value)} /></Field>
        </div>
        {sim.isError && <ErrorBox error={sim.error} />}
        <Btn variant="ghost" className="w-full" disabled={!built.rules || decimals === null || !parseToMinor(simAmt, decimals ?? 0) || sim.isPending} onClick={() => sim.mutate()}>{sim.isPending ? 'Testing…' : 'Test'}</Btn>
        {s && (
          <div className="rounded-suwappu-lg bg-suwappu-sakura-light/50 p-3 text-sm space-y-1">
            <Row label="Result" value={<Chip status={str(s.decision) ?? (s.allowed === true ? 'approved' : s.allowed === false ? 'declined' : 'unknown')} tone={(s.decision === 'approve' || s.allowed === true) ? 'good' : 'bad'} />} />
            {Array.isArray(s.reasons) && s.reasons.map((x, i) => <p key={i} className="text-xs text-suwappu-text-secondary break-words">{typeof x === 'string' ? x : JSON.stringify(x)}</p>)}
            {Array.isArray(s.violations) && s.violations.map((x, i) => <p key={i} className="text-xs text-suwappu-text-secondary break-words">{typeof x === 'string' ? x : JSON.stringify(x)}</p>)}
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
        {(l) => <Card className="divide-y divide-suwappu-sakura-mid/20 !py-1">{l.map((a) => <div key={a.id} className="py-2.5 flex justify-between gap-2"><div className="min-w-0"><p className="text-sm truncate">{a.merchantName ?? 'Merchant'}</p>{a.reason && <p className="text-[11px] text-suwappu-text-secondary break-words">{a.reason}</p>}</div><div className="text-right shrink-0"><p className="text-sm tabular-nums">{formatMinor(a.amountMinor, decimals)} {a.currency}</p><Chip status={a.decision} /></div></div>)}</Card>}
      </QueryState>
      <SectionTitle>Transactions</SectionTitle>
      <QueryState query={txs} rows={1} isEmpty={(d) => d.length === 0} empty={<Empty title="No transactions" />}>
        {(l) => <Card className="divide-y divide-suwappu-sakura-mid/20 !py-1">{l.map((t) => <div key={t.id} className="py-2.5 flex justify-between gap-2"><div className="min-w-0"><p className="text-sm truncate">{t.merchantName ?? t.type}</p><p className="text-[11px] text-suwappu-text-secondary">{new Date(t.createdAt).toLocaleString()}</p></div><div className="text-right shrink-0"><p className="text-sm tabular-nums">{formatMinor(t.amountMinor, decimals)} {t.currency}</p>{t.settlementStatus && <Chip status={t.settlementStatus} />}</div></div>)}</Card>}
      </QueryState>
    </div>
  )
}

export function Cards() {
  const qc = useQueryClient()
  const cards = useCards()
  const accounts = useBankAccounts()
  const [issuing, setIssuing] = useState(false)
  const [sel, setSel] = useState<string>('')
  const [tab, setTab] = useState<'rules' | 'activity'>('rules')
  const card = cards.data?.find((c) => c.id === sel)
  useEffect(() => { if (!sel && cards.data?.[0]) setSel(cards.data[0].id) }, [cards.data, sel])
  const decimals = accounts.data?.find((a) => a.id === card?.accountId)?.decimals ?? null
  const act = useMutation({
    mutationFn: (a: 'freeze' | 'unfreeze' | 'cancel') => bank.cardAction(card?.id as string, a),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['bank', 'cards'] }),
  })
  return (
    <BankPage title="Cards">
      <QueryState query={cards} rows={1} isEmpty={(d) => d.length === 0} empty={<Empty title="No cards yet" hint="Issue a virtual card funded from one of your accounts." action={<Btn onClick={() => setIssuing(true)}>Issue a card</Btn>} />}>
        {(list) => (
          <>
            <div className="flex gap-2 overflow-x-auto no-scrollbar">
              {list.map((c) => <button key={c.id} type="button" onClick={() => setSel(c.id)} className={`shrink-0 min-h-[44px] px-3 rounded-suwappu-lg text-xs font-semibold border ${sel === c.id ? 'bg-suwappu-magenta-mid text-white border-transparent' : 'bg-white border-suwappu-sakura-mid/30 text-suwappu-purple-deep'}`}>{c.label || c.brand || 'Card'} · {c.currency}</button>)}
              <button type="button" onClick={() => setIssuing(true)} className="shrink-0 min-h-[44px] px-3 rounded-suwappu-lg text-xs font-semibold bg-suwappu-sakura-light text-suwappu-purple-deep">+ New</button>
            </div>
            {card && (
              <>
                <Card>
                  <div className="flex justify-between"><p className="text-sm font-semibold">{card.label || card.brand || 'Virtual card'}</p><Chip status={card.status} /></div>
                  <Row label="Type" value={card.type} />
                  {card.expMonth && card.expYear && <Row label="Expires" value={`${String(card.expMonth).padStart(2, '0')}/${card.expYear}`} />}
                  {act.isError && <ErrorBox error={act.error} />}
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    {card.status === 'frozen' ? <Btn disabled={act.isPending} onClick={() => act.mutate('unfreeze')}>Unfreeze</Btn> : <Btn variant="ghost" disabled={card.status !== 'active' || act.isPending} onClick={() => act.mutate('freeze')}>Freeze</Btn>}
                    <Btn variant="danger" disabled={card.status === 'canceled' || act.isPending} onClick={() => { if (window.confirm('Cancel this card permanently?')) act.mutate('cancel') }}>Cancel card</Btn>
                  </div>
                </Card>
                <Tabs value={tab} onChange={setTab} tabs={[{ id: 'rules', label: 'Rules' }, { id: 'activity', label: 'Activity' }]} />
                {tab === 'rules' ? <Rules key={card.id + JSON.stringify(card.rules)} card={card} decimals={decimals} /> : <Activity card={card} decimals={decimals} />}
              </>
            )}
          </>
        )}
      </QueryState>
      {issuing && <IssueCard onClose={() => setIssuing(false)} />}
    </BankPage>
  )
}
