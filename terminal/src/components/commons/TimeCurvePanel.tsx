import { useMemo, useState } from 'react'
import { useReadContract, useReadContracts } from 'wagmi'
import type { Abi } from 'viem'
import {
  TerminalButton,
  TerminalInset,
  TerminalKeyValueRow,
  TerminalMetricCard,
  TerminalPanel,
  TerminalPanelHeader,
  TerminalSegmentedTabs,
  TerminalTextField,
} from '../foundation'
import {
  COMMONS,
  COMMONS_CHAIN,
  deadline,
  erc20Abi,
  fmt,
  parseAmount,
  pct,
  timeCurveAbi,
  toNum,
  withSlippage,
} from './contracts'
import { approveIfNeeded, call, useCommonsTx } from './useCommonsTx'

const curve = { address: COMMONS.timeCurve, abi: timeCurveAbi, chainId: COMMONS_CHAIN.id } as const

export function TimeCurvePanel() {
  const { run, busy, address } = useCommonsTx()
  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  const [amountInput, setAmountInput] = useState('')
  const [slippageBps, setSlippageBps] = useState(100)

  const { data } = useReadContracts({
    contracts: [
      { ...curve, functionName: 'symbol' },
      { ...curve, functionName: 'totalSupply' },
      { ...curve, functionName: 'spotPrice' },
      { ...curve, functionName: 'multiplier' },
      { ...curve, functionName: 'basePrice' },
      { ...curve, functionName: 'slope' },
      { ...curve, functionName: 'rate' },
      { ...curve, functionName: 'sinkRate' },
      { ...curve, functionName: 'totalSunk' },
      { ...curve, functionName: 'reserveBalance' },
      { ...curve, functionName: 'deployTime' },
    ],
    query: { refetchInterval: 15_000 },
  })
  const [symbol, supply, spot, mult, base, slope, rate, sink, sunk, reserveBal, deployTime] = (data ?? []).map(
    (r) => r.result,
  ) as [string?, bigint?, bigint?, bigint?, bigint?, bigint?, bigint?, bigint?, bigint?, bigint?, bigint?]

  const { data: balances } = useReadContracts({
    contracts: [
      { ...curve, functionName: 'balanceOf', args: [address!] },
      { address: COMMONS.reserveAsset, abi: erc20Abi, chainId: COMMONS_CHAIN.id, functionName: 'balanceOf', args: [address!] },
    ],
    query: { enabled: !!address, refetchInterval: 15_000 },
  })
  const myCurve = balances?.[0]?.result as bigint | undefined
  const myReserve = balances?.[1]?.result as bigint | undefined

  const amount = parseAmount(amountInput)
  const { data: quote, error: quoteError } = useReadContract({
    ...curve,
    functionName: side === 'buy' ? 'quoteBuy' : 'quoteSell',
    args: [amount ?? 0n],
    query: { enabled: !!amount, refetchInterval: 10_000 },
  })

  const ticker = symbol ?? 'CURVE'
  const insufficient =
    !!amount && quote !== undefined && (side === 'buy' ? (myReserve ?? 0n) < quote : (myCurve ?? 0n) < amount)

  const submit = async () => {
    if (!amount || quote === undefined) return
    const ok =
      side === 'buy'
        ? await run(`Buy ${fmt(amount)} ${ticker}`, [
            approveIfNeeded(COMMONS.reserveAsset, COMMONS.timeCurve, withSlippage(quote, slippageBps, true), 'Approve mUSD'),
            call('Buy', COMMONS.timeCurve, timeCurveAbi as Abi, 'buy', [
              amount,
              withSlippage(quote, slippageBps, true),
              deadline(),
            ]),
          ])
        : await run(`Sell ${fmt(amount)} ${ticker}`, [
            call('Sell', COMMONS.timeCurve, timeCurveAbi as Abi, 'sell', [
              amount,
              withSlippage(quote, slippageBps, false),
              deadline(),
            ]),
          ])
    if (ok) setAmountInput('')
  }

  const halfLifeDays =
    rate !== undefined && rate < 0n ? Math.LN2 / (-Number(rate) / 1e18) / 86_400 : undefined
  const ageDays = deployTime ? (Date.now() / 1000 - Number(deployTime)) / 86_400 : undefined

  return (
    <div className="grid min-h-0 grid-cols-1 gap-1.5 md:gap-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
      <TerminalPanel className="flex min-h-0 flex-col gap-3 p-[var(--terminal-space-card)]">
        <TerminalPanelHeader
          eyebrow="Primitive 01"
          title="TimeCurve"
          description="A continuous bonding curve whose price is a pure function of supply and time. The contract is the token: buying mints, selling burns. A decaying time multiplier means every unit was bought at a multiplier ≥ today's — so the reserve can always pay every seller."
        />
        <div className="grid grid-cols-2 gap-1.5 md:grid-cols-4">
          <TerminalMetricCard label="Spot price" value={`${fmt(spot, 6)} mUSD`} tone="accent" />
          <TerminalMetricCard label="Supply" value={`${fmt(supply, 2)} ${ticker}`} />
          <TerminalMetricCard label="Reserve" value={`${fmt(reserveBal, 2)} mUSD`} detail={`${fmt(sunk, 4)} sunk surplus`} />
          <TerminalMetricCard
            label="Time multiplier"
            value={mult !== undefined ? `${toNum(mult).toFixed(4)}×` : '—'}
            detail={halfLifeDays ? `half-life ${halfLifeDays.toFixed(1)}d` : 'flat schedule'}
            tone="sky"
          />
        </div>
        <CurveChart
          base={toNum(base)}
          slope={toNum(slope)}
          mult={toNum(mult)}
          supply={toNum(supply)}
          pending={amount ? toNum(amount) * (side === 'buy' ? 1 : -1) : 0}
          rate={rate !== undefined ? Number(rate) / 1e18 : 0}
        />
        <TerminalInset className="grid gap-1 p-3 text-xs">
          <p className="font-mono text-terminal-text">p(s, t) = m(t) · (basePrice + slope · s), &nbsp; m(t) = e^(rate · (t − t₀))</p>
          <TerminalKeyValueRow label="basePrice" value={`${fmt(base, 6)} mUSD`} />
          <TerminalKeyValueRow label="slope" value={`${fmt(slope, 6)} mUSD / token`} />
          <TerminalKeyValueRow label="rate" value={rate !== undefined ? `${(Number(rate) / 1e18).toExponential(3)} /s` : '—'} />
          <TerminalKeyValueRow label="sink rate (sell haircut → reserve)" value={pct(sink)} />
          <TerminalKeyValueRow label="age" value={ageDays !== undefined ? `${ageDays.toFixed(1)} days` : '—'} />
        </TerminalInset>
      </TerminalPanel>

      <TerminalPanel className="flex min-h-0 flex-col gap-3 p-[var(--terminal-space-card)]">
        <TerminalPanelHeader eyebrow="Trade" title={`${ticker} ⇄ mUSD`} />
        <TerminalSegmentedTabs
          activeId={side}
          options={[
            { id: 'buy', label: 'Buy (mint)' },
            { id: 'sell', label: 'Sell (burn)' },
          ]}
          onChange={(id) => setSide(id as 'buy' | 'sell')}
        />
        <TerminalTextField
          label={`Amount of ${ticker}`}
          inputMode="decimal"
          placeholder="0.0"
          mono
          value={amountInput}
          onChange={(e) => setAmountInput(e.target.value)}
          suffix={
            side === 'sell' && myCurve ? (
              <button type="button" className="text-[11px] text-terminal-accent" onClick={() => setAmountInput(String(toNum(myCurve)))}>
                MAX
              </button>
            ) : (
              ticker
            )
          }
        />
        <TerminalInset className="grid gap-1 p-3 text-xs">
          <TerminalKeyValueRow
            label={side === 'buy' ? 'You pay' : 'You receive'}
            value={amount ? (quoteError ? 'unquotable' : `${fmt(quote as bigint | undefined, 6)} mUSD`) : '—'}
          />
          <TerminalKeyValueRow
            label="Avg price"
            value={amount && quote ? `${(toNum(quote as bigint) / toNum(amount)).toFixed(6)} mUSD` : '—'}
          />
          <TerminalKeyValueRow
            label={side === 'buy' ? 'Max in (slippage)' : 'Min out (slippage)'}
            value={quote ? `${fmt(withSlippage(quote as bigint, slippageBps, side === 'buy'), 6)} mUSD` : '—'}
          />
          <div className="flex items-center justify-between pt-1">
            <span className="text-terminal-text-muted">Slippage</span>
            <div className="flex gap-1">
              {[50, 100, 300].map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => setSlippageBps(b)}
                  className={`rounded px-1.5 py-0.5 font-mono text-[11px] ${slippageBps === b ? 'bg-terminal-accent/20 text-terminal-accent' : 'text-terminal-text-muted hover:text-terminal-text'}`}
                >
                  {b / 100}%
                </button>
              ))}
            </div>
          </div>
        </TerminalInset>
        <TerminalButton
          variant="primary"
          disabled={!address || !amount || quote === undefined || insufficient || !!busy}
          onClick={submit}
        >
          {!address
            ? 'Connect wallet'
            : insufficient
              ? `Insufficient ${side === 'buy' ? 'mUSD' : ticker}`
              : busy ?? (side === 'buy' ? 'Buy' : 'Sell')}
        </TerminalButton>
        <div className="grid gap-1 text-xs">
          <TerminalKeyValueRow label={`Your ${ticker}`} value={fmt(myCurve)} />
          <TerminalKeyValueRow label="Your mUSD" value={fmt(myReserve)} />
        </div>
      </TerminalPanel>
    </div>
  )
}

/** Price-vs-supply curve at the current multiplier, plus a dashed 30-day-ahead curve. */
function CurveChart({
  base,
  slope,
  mult,
  supply,
  pending,
  rate,
}: {
  base: number
  slope: number
  mult: number
  supply: number
  pending: number
  rate: number
}) {
  const W = 640
  const H = 200
  const P = { l: 44, r: 12, t: 12, b: 26 }
  const geom = useMemo(() => {
    const sMax = Math.max(10, supply * 2, supply + Math.max(pending, 0) * 1.3)
    const pAt = (s: number, m: number) => m * (base + slope * s)
    const pMax = pAt(sMax, mult || 1) * 1.08 || 1
    const x = (s: number) => P.l + (s / sMax) * (W - P.l - P.r)
    const y = (p: number) => H - P.b - (p / pMax) * (H - P.t - P.b)
    const line = (m: number) =>
      Array.from({ length: 41 }, (_, i) => {
        const s = (sMax * i) / 40
        return `${i ? 'L' : 'M'}${x(s).toFixed(1)},${y(pAt(s, m)).toFixed(1)}`
      }).join(' ')
    const lo = Math.max(0, Math.min(supply, supply + pending))
    const hi = Math.max(supply, supply + pending)
    const area =
      pending !== 0
        ? `M${x(lo)},${y(0)} ` +
          Array.from({ length: 21 }, (_, i) => {
            const s = lo + ((hi - lo) * i) / 20
            return `L${x(s).toFixed(1)},${y(pAt(s, mult)).toFixed(1)}`
          }).join(' ') +
          ` L${x(hi)},${y(0)} Z`
        : ''
    return { sMax, pMax, x, y, now: line(mult), later: line(mult * Math.exp(rate * 30 * 86_400)), area, spotY: y(pAt(supply, mult)) }
  }, [base, slope, mult, supply, pending, rate])

  // Only draw the 30-day-ahead curve when decay is actually visible at chart scale.
  const showLater = rate < 0 && 1 - Math.exp(rate * 30 * 86_400) > 0.02

  if (!mult) return <div className="h-[200px] animate-pulse rounded-lg bg-terminal-panel" />

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Bonding curve price versus supply">
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={P.l} x2={W - P.r} y1={geom.y(geom.pMax * f)} y2={geom.y(geom.pMax * f)} stroke="currentColor" className="text-terminal-border" strokeWidth={0.5} />
          <text x={P.l - 6} y={geom.y(geom.pMax * f) + 3} textAnchor="end" className="fill-terminal-text-muted font-mono" fontSize={9}>
            {(geom.pMax * f).toFixed(3)}
          </text>
        </g>
      ))}
      <text x={W - P.r} y={H - 6} textAnchor="end" className="fill-terminal-text-muted font-mono" fontSize={9}>
        supply → {geom.sMax.toFixed(0)}
      </text>
      {geom.area && <path d={geom.area} className={pending > 0 ? 'fill-terminal-up/25' : 'fill-terminal-down/25'} />}
      {showLater && <path d={geom.later} fill="none" stroke="currentColor" strokeDasharray="4 4" strokeWidth={1} className="text-terminal-text-muted" />}
      <path d={geom.now} fill="none" stroke="currentColor" strokeWidth={2} className="text-terminal-accent" />
      <line x1={geom.x(supply)} x2={geom.x(supply)} y1={P.t} y2={H - P.b} stroke="currentColor" strokeDasharray="2 3" className="text-terminal-text/50" />
      <circle cx={geom.x(supply)} cy={geom.spotY} r={4} className="fill-terminal-accent" />
      <text x={geom.x(supply) + 6} y={P.t + 10} className="fill-terminal-text font-mono" fontSize={9}>
        now · {supply.toFixed(1)}
      </text>
      {showLater && (
        <text x={W - P.r} y={P.t + 10} textAnchor="end" className="fill-terminal-text-muted font-mono" fontSize={9}>
          ┄ same curve in 30 days
        </text>
      )}
    </svg>
  )
}
