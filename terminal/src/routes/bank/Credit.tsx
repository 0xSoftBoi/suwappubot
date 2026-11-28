import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Receivables, UnsecuredLine } from '../../components/bank/CreditExtra'
import { bank, transferIdOf, formatMinor, parseToMinor, str, type CreditLineView, type CreditMarket } from '../../lib/bankApi'
import { useBankAccounts, useBankAssets } from '../../hooks/bank/useBankCore'
import { useCreditEvents, useCreditLines, useCreditMarkets, useCreditScore } from '../../hooks/bank/useBankDomains'
import { useIdempotencyKey } from '../../hooks/bank/useIdempotencyKey'
import { BankPage, Btn, Card, Chip, Empty, ErrorBox, Field, Input, QueryState, Row, SectionTitle, Sheet, Tabs } from '../../components/bank/BankUI'
import { AccountSelect } from '../../components/bank/AccountSelect'
import { AmountInput } from '../../components/bank/Amount'
import { ConfirmSheet } from '../../components/bank/ConfirmSheet'
import { TransferTracker } from '../../components/bank/TransferTracker'

const bps = (n: unknown) => (typeof n === 'number' ? `${(n / 100).toFixed(2)}%` : '—')
const pctN = (n: number) => `${n.toFixed(2)}%`

/** Loan-asset decimals from the asset registry, else a matching account; null (never a guess) when neither is known. */
function useLoanDecimals(asset: string, chain: string): number | null {
  const assets = useBankAssets()
  const accounts = useBankAccounts()
  const d = assets.data?.find((a) => a.symbol === asset && a.chain === chain)?.decimals ?? accounts.data?.find((a) => a.asset === asset && a.chain === chain)?.decimals
  return typeof d === 'number' && Number.isInteger(d) && d >= 0 ? d : null
}

function LineCard({ v, onAct }: { v: CreditLineView; onAct: (a: 'draw' | 'repay' | 'withdraw') => void }) {
  const loanDec = useLoanDecimals(v.line.loanAsset, v.line.chain)
  const h = v.health
  return (
    <Card>
      <div className="flex items-center justify-between"><p className="text-sm font-semibold">{v.line.loanAsset} line · {v.line.chain}</p><Chip status={h?.level ?? v.line.status} /></div>
      <div className="mt-1">
        <Row label="Owed" value={v.owed ? `${formatMinor(v.owed.totalMinor, loanDec)} ${v.line.loanAsset}` : '—'} />
        <Row label="Interest accrued" value={v.owed ? formatMinor(v.owed.accruedInterestMinor, loanDec) : '—'} />
        <Row label="Loan-to-value" value={bps(h?.ltvBps)} />
        <Row label="Health factor" value={typeof h?.healthFactorBps === 'number' ? (h.healthFactorBps / 10000).toFixed(2) : '—'} />
        <Row label="Liquidation price" value={h?.liquidationPriceHuman ?? '—'} />
        {v.line.aprBps != null && <Row label="APR" value={bps(v.line.aprBps)} />}
      </div>
      <div className="grid grid-cols-3 gap-2 mt-2">
        <Btn onClick={() => onAct('draw')}>Borrow</Btn>
        <Btn variant="ghost" onClick={() => onAct('repay')}>Repay</Btn>
        <Btn variant="ghost" onClick={() => onAct('withdraw')}>Collateral</Btn>
      </div>
    </Card>
  )
}

function LineAction({ v, mode, onClose }: { v: CreditLineView; mode: 'draw' | 'repay' | 'withdraw'; onClose: () => void }) {
  const qc = useQueryClient()
  const loanDec = useLoanDecimals(v.line.loanAsset, v.line.chain)
  const dec = mode === 'withdraw' ? v.line.collateralDecimals ?? null : loanDec
  const [amount, setAmount] = useState('')
  const [all, setAll] = useState(false)
  const [review, setReview] = useState(false)
  const minor = dec !== null ? parseToMinor(amount, dec) : null
  const key = useIdempotencyKey(JSON.stringify(['credit', mode, v.line.id, v.line.loanAsset, v.line.chain, all ? 'all' : minor]))
  const sym = mode === 'withdraw' ? v.line.collateralToken ?? 'collateral' : v.line.loanAsset
  const m = useMutation({
    mutationFn: (): Promise<unknown> => {
      const b = { lineId: v.line.id, ...(all ? { all: true } : { amountMinor: minor as string }) }
      if (mode === 'draw') return bank.draw({ lineId: v.line.id, amountMinor: minor as string }, key.current())
      return mode === 'repay' ? bank.repay(b, key.current()) : bank.withdrawCollateral(b, key.current())
    },
    onSuccess: () => { key.reset(); void qc.invalidateQueries({ queryKey: ['bank'] }) },
    onError: (e) => key.settle(e),
  })
  const title = mode === 'draw' ? 'Borrow' : mode === 'repay' ? 'Repay' : 'Withdraw collateral'
  if (!review) {
    return (
      <Sheet title={title} onClose={onClose}>
        <div className="space-y-3">
          <Field label="Amount"><AmountInput value={amount} onChange={(x) => { setAmount(x); setAll(false) }} symbol={sym} decimals={dec} /></Field>
          {mode !== 'draw' && <Btn variant="ghost" className="w-full" onClick={() => setAll(true)}>{mode === 'repay' ? 'Repay everything owed' : 'Withdraw all collateral'}</Btn>}
          {all && <p className="text-xs text-terminal-text-secondary">Using the full amount.</p>}
          <Btn className="w-full" disabled={!(all || minor)} onClick={() => setReview(true)}>Review</Btn>
        </div>
      </Sheet>
    )
  }
  const md = m.data as { transferId?: string | null } | undefined
  const tid = md && typeof md.transferId === 'string' ? transferIdOf.credit({ transferId: md.transferId }) : null
  return (
    <ConfirmSheet
      title={`Confirm: ${title.toLowerCase()}`}
      rows={[
        { label: title, value: all ? 'Everything' : `${formatMinor(minor ?? undefined, dec)} ${sym}` },
        { label: 'Line', value: `${v.line.loanAsset} on ${v.line.chain}` },
        { label: 'Current LTV', value: bps(v.health?.ltvBps) },
        { label: 'Interest', value: v.line.aprBps != null ? `${bps(v.line.aprBps)} APR` : 'Per market rate' },
      ]}
      note={mode === 'draw' ? 'Borrowing raises your loan-to-value and moves your liquidation price closer.' : undefined}
      confirmLabel={title}
      pending={m.isPending}
      error={m.error}
      onConfirm={() => m.mutate()}
      onClose={onClose}
      result={m.data !== undefined ? (tid ? <TransferTracker transferId={tid} onDone={onClose} /> : <div className="space-y-2"><Row label="Status" value={str((m.data as unknown as Record<string, unknown>).status) ?? 'Submitted'} /><Btn className="w-full" onClick={onClose}>Done</Btn></div>) : undefined}
    />
  )
}

function OpenLine({ markets, onClose }: { markets: CreditMarket[]; onClose: () => void }) {
  const qc = useQueryClient()
  const accounts = useBankAccounts()
  const [accountId, setAccountId] = useState('')
  const [marketId, setMarketId] = useState('')
  const [amount, setAmount] = useState('')
  const [review, setReview] = useState(false)
  const mk = markets.find((x) => x.marketId === marketId)
  const minor = mk ? parseToMinor(amount, mk.collateralAsset.decimals) : null
  const key = useIdempotencyKey(JSON.stringify(['credit-open', accountId, marketId, mk?.collateralAsset.symbol, minor]))
  const m = useMutation({
    mutationFn: () => bank.openLine({ accountId, marketId, collateral: { source: 'wallet', amountMinor: minor as string } }, key.current()),
    onSuccess: () => { key.reset(); void qc.invalidateQueries({ queryKey: ['bank'] }) },
    onError: (e) => key.settle(e),
  })
  if (review && mk) {
    return (
      <ConfirmSheet
        title="Confirm credit line"
        rows={[
          { label: 'Collateral', value: `${formatMinor(minor ?? undefined, mk.collateralAsset.decimals)} ${mk.collateralAsset.symbol}` },
          { label: 'Borrow asset', value: mk.loanAsset.symbol },
          { label: 'Max loan-to-value', value: bps(mk.lltvBps) },
          { label: 'Borrow rate', value: pctN(mk.borrowApy) },
          { label: 'Network', value: mk.chain },
        ]}
        note="Collateral is moved from your wallet into the lending market. It can be liquidated if the loan-to-value gets too high."
        confirmLabel="Open line"
        pending={m.isPending}
        error={m.error}
        onConfirm={() => m.mutate()}
        onClose={onClose}
        result={m.data && <div className="space-y-2"><Row label="Line" value={<Chip status={m.data.line.line.status} />} /><Btn className="w-full" onClick={onClose}>Done</Btn></div>}
      />
    )
  }
  return (
    <Sheet title="Open a credit line" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Borrow into"><AccountSelect accounts={(accounts.data ?? []).filter((a) => !mk || (a.chain === mk.chain && a.asset === mk.loanAsset.symbol))} value={accountId} onChange={setAccountId} /></Field>
        <Field label="Market">
          <select className="w-full min-h-[44px] px-3 rounded-terminal-control border border-terminal-border bg-terminal-panel text-sm" value={marketId} onChange={(e) => setMarketId(e.target.value)}>
            <option value="">Select market</option>
            {markets.map((x) => <option key={x.marketId} value={x.marketId}>{x.collateralAsset.symbol} → {x.loanAsset.symbol} · {pctN(x.borrowApy)}</option>)}
          </select>
        </Field>
        {mk && <Field label="Collateral amount"><AmountInput value={amount} onChange={setAmount} symbol={mk.collateralAsset.symbol} decimals={mk.collateralAsset.decimals} /></Field>}
        <Btn className="w-full" disabled={!accountId || !minor} onClick={() => setReview(true)}>Review</Btn>
      </div>
    </Sheet>
  )
}

export function Credit() {
  const [tab, setTab] = useState<'lines' | 'markets' | 'score' | 'recv'>('lines')
  const [chain, setChain] = useState('base')
  const [asset, setAsset] = useState('USDC')
  const lines = useCreditLines()
  const markets = useCreditMarkets(chain, asset)
  const events = useCreditEvents()
  const score = useCreditScore(asset, chain)
  const [act, setAct] = useState<{ v: CreditLineView; mode: 'draw' | 'repay' | 'withdraw' } | null>(null)
  const [opening, setOpening] = useState(false)
  return (
    <BankPage title="Borrow">
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'lines', label: 'My lines' }, { id: 'markets', label: 'Markets' }, { id: 'score', label: 'Credit score' }, { id: 'recv', label: 'Invoices' }]} />
      {tab === 'lines' && (
        <>
          <QueryState query={lines} isEmpty={(d) => d.length === 0} empty={<Empty title="No credit lines" hint="Open a line against collateral to borrow." action={<Btn onClick={() => setOpening(true)}>Open a line</Btn>} />}>
            {(list) => <div className="space-y-2">{list.map((v) => <LineCard key={v.line.id} v={v} onAct={(mode) => setAct({ v, mode })} />)}<Btn variant="ghost" className="w-full" onClick={() => setOpening(true)}>Open another line</Btn></div>}
          </QueryState>
          <SectionTitle>Recent events</SectionTitle>
          <QueryState query={events} isEmpty={(d) => d.length === 0} empty={<Empty title="No events" />}>
            {(list) => <Card className="divide-y divide-terminal-border !py-1">{list.map((e) => <div key={e.id} className="py-2.5 flex items-center justify-between gap-2"><div><p className="text-sm capitalize">{e.type.replace(/_/g, ' ')}</p><p className="text-[11px] text-terminal-text-secondary">{new Date(e.createdAt).toLocaleString()}</p></div>{e.level && <Chip status={e.level} />}</div>)}</Card>}
          </QueryState>
        </>
      )}
      {tab === 'markets' && (
        <>
          <Card className="grid grid-cols-2 gap-2"><Field label="Network"><Input value={chain} onChange={(e) => setChain(e.target.value.toLowerCase())} /></Field><Field label="Borrow asset"><Input value={asset} onChange={(e) => setAsset(e.target.value.toUpperCase())} /></Field></Card>
          <QueryState query={markets} isEmpty={(d) => d.length === 0} empty={<Empty title="No eligible markets" hint="Try another network or asset." />}>
            {(list) => <div className="space-y-2">{list.map((x) => (
              <Card key={x.marketId}>
                <p className="text-sm font-semibold">{x.collateralAsset.symbol} → {x.loanAsset.symbol}</p>
                <Row label="Borrow rate" value={pctN(x.borrowApy)} /><Row label="Max loan-to-value" value={bps(x.lltvBps)} /><Row label="Utilization" value={pctN(x.utilizationPct)} />
                <Row label="Liquidity" value={x.liquidityUsd === null ? '—' : `$${Math.round(x.liquidityUsd).toLocaleString()}`} />
              </Card>
            ))}<Btn className="w-full" onClick={() => setOpening(true)}>Open a line</Btn></div>}
          </QueryState>
        </>
      )}
      {tab === 'score' && (
        <QueryState query={score} rows={1}>
          {(s) => (
            <Card>
              <p className="text-4xl font-display font-bold tabular-nums">{s.score}</p>
              <Row label="Tier" value={s.tier} />
              {s.aprBps != null && <Row label="Indicative APR" value={bps(s.aprBps)} />}
              {s.factors && Object.entries(s.factors).map(([k, val]) => <Row key={k} label={k.replace(/_/g, ' ')} value={typeof val === 'object' ? JSON.stringify(val) : String(val)} />)}
              {s.computedAt && <p className="text-[11px] text-terminal-text-secondary mt-2">Computed {new Date(s.computedAt).toLocaleString()}</p>}
            </Card>
          )}
        </QueryState>
      )}
      {tab === 'score' && <UnsecuredLine asset={asset} chain={chain} />}
      {tab === 'recv' && <Receivables />}
      {act && <LineAction v={act.v} mode={act.mode} onClose={() => setAct(null)} />}
      {opening && (markets.data ? <OpenLine markets={markets.data} onClose={() => setOpening(false)} /> : (
        <Sheet title="Open a credit line" onClose={() => setOpening(false)}>{markets.isLoading ? <p className="text-sm animate-pulse">Loading markets…</p> : <ErrorBox error={markets.error} onRetry={() => void markets.refetch()} />}</Sheet>
      ))}
    </BankPage>
  )
}
