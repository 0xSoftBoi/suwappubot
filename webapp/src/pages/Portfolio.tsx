import { useMemo, useRef, useEffect, useState } from 'react'
import { createChart, AreaSeries, ColorType } from 'lightweight-charts'
import { AppLayout, AppHeader } from '../components/layout'
import { BalanceCard, TokenItem } from '../components/cards'
import { usePortfolio } from '../hooks/usePortfolio'
import { usePortfolioPnl } from '../hooks/usePortfolioPnl'
import type { PnlPeriod } from '../hooks/usePortfolioPnl'
import type { Token, PnlDataPoint } from '../types/api'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const chainIcons: Record<string, string> = {
  ethereum: 'Ξ', eth: 'Ξ',
  solana: '◎', sol: '◎',
  polygon: '⬡', matic: '⬡',
  arbitrum: 'A', optimism: 'O',
  base: 'B', bsc: 'B',
  tempo: 'T',
}

function getTokenIcon(token: Token): string {
  const s = token.symbol.toLowerCase()
  const c = token.chain.toLowerCase()
  if (s === 'eth') return 'Ξ'
  if (s === 'sol') return '◎'
  if (s === 'usdc' || s === 'usdt') return '$'
  if (s === 'matic') return '⬡'
  return chainIcons[c] || token.symbol.charAt(0).toUpperCase()
}

function formatUsd(value: number, compact = false): string {
  if (compact && Math.abs(value) >= 1000) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(value)
  }
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
}

const PERIOD_LABELS: Record<PnlPeriod, string> = { '7d': '7D', '30d': '30D', '90d': '90D', 'all': 'All' }
const PERIODS: PnlPeriod[] = ['7d', '30d', '90d', 'all']

// ---------------------------------------------------------------------------
// Equity Curve Chart (lightweight-charts v5)
// ---------------------------------------------------------------------------

interface EquityCurveProps {
  dataPoints: PnlDataPoint[]
  isPositive: boolean
}

function EquityCurveChart({ dataPoints, isPositive }: EquityCurveProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current || dataPoints.length === 0) return

    const upColor = 'rgb(34, 197, 94)'
    const downColor = 'rgb(239, 68, 68)'
    const lineColor = isPositive ? upColor : downColor
    const topColor = isPositive ? 'rgba(34, 197, 94, 0.25)' : 'rgba(239, 68, 68, 0.25)'
    const bottomColor = 'rgba(0,0,0,0)'

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#9ca3af',
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: 'rgba(156,163,175,0.1)' },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, fixLeftEdge: true, fixRightEdge: true },
      crosshair: { horzLine: { visible: false } },
      handleScroll: false,
      handleScale: false,
      width: containerRef.current.clientWidth,
      height: 180,
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const series = (chart as any).addSeries(AreaSeries, {
      lineColor,
      topColor,
      bottomColor,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: true,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    })

    series.setData(
      dataPoints.map(p => ({ time: p.date as string, value: p.cumulativePnl }))
    )

    chart.timeScale().fitContent()

    const resizeObserver = new ResizeObserver(entries => {
      if (entries[0]) {
        chart.applyOptions({ width: entries[0].contentRect.width })
      }
    })
    resizeObserver.observe(containerRef.current)

    return () => {
      resizeObserver.disconnect()
      chart.remove()
    }
  }, [dataPoints, isPositive])

  if (dataPoints.length === 0) {
    return (
      <div className="h-[180px] flex items-center justify-center text-xs text-suwappu-text-secondary">
        No trade data for this period
      </div>
    )
  }

  return <div ref={containerRef} className="w-full" />
}

// ---------------------------------------------------------------------------
// PnL Calendar Heatmap
// ---------------------------------------------------------------------------

interface HeatmapProps {
  dataPoints: PnlDataPoint[]
}

interface DayTrades {
  date: string
  pnl: number
  tradeCount: number
}

function pnlColor(pnl: number, max: number): string {
  if (pnl === 0) return 'bg-gray-100'
  const intensity = Math.min(Math.abs(pnl) / (max || 1), 1)
  if (pnl > 0) {
    if (intensity > 0.66) return 'bg-green-500'
    if (intensity > 0.33) return 'bg-green-300'
    return 'bg-green-100'
  } else {
    if (intensity > 0.66) return 'bg-red-500'
    if (intensity > 0.33) return 'bg-red-300'
    return 'bg-red-100'
  }
}

function PnlHeatmap({ dataPoints }: HeatmapProps) {
  const [monthOffset, setMonthOffset] = useState(0) // 0 = current month
  const [selectedDay, setSelectedDay] = useState<DayTrades | null>(null)

  const pnlByDate = useMemo(() => {
    const map: Record<string, DayTrades> = {}
    for (const p of dataPoints) {
      map[p.date] = { date: p.date, pnl: p.pnl, tradeCount: p.tradeCount }
    }
    return map
  }, [dataPoints])

  const { label, cells, maxAbs } = useMemo(() => {
    const now = new Date()
    const target = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1)
    const y = target.getFullYear()
    const m = target.getMonth()
    const label = target.toLocaleString('default', { month: 'long', year: 'numeric' })

    const firstDay = new Date(y, m, 1).getDay() // 0=Sun
    const daysInMonth = new Date(y, m + 1, 0).getDate()

    const cells: (DayTrades | null)[] = []
    for (let i = 0; i < firstDay; i++) cells.push(null) // padding
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      cells.push(pnlByDate[dateStr] || { date: dateStr, pnl: 0, tradeCount: 0 })
    }

    const vals = Object.values(pnlByDate).map(v => Math.abs(v.pnl))
    const maxAbs = vals.length ? Math.max(...vals) : 1

    return { label, cells, maxAbs }
  }, [monthOffset, pnlByDate])

  const canGoNext = monthOffset < 0

  return (
    <div className="bg-white rounded-suwappu-xl p-3 shadow-suwappu-1">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-heading font-semibold text-sm text-suwappu-purple-deep">PnL Heatmap</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMonthOffset(o => o - 1)}
            className="text-xs text-suwappu-text-secondary px-1.5 py-0.5 rounded hover:bg-suwappu-sakura-light"
          >
            &lt;
          </button>
          <span className="text-xs text-suwappu-text-secondary font-medium">{label}</span>
          <button
            onClick={() => setMonthOffset(o => o + 1)}
            disabled={!canGoNext}
            className={`text-xs px-1.5 py-0.5 rounded ${canGoNext ? 'text-suwappu-text-secondary hover:bg-suwappu-sakura-light' : 'text-gray-300 cursor-not-allowed'}`}
          >
            &gt;
          </button>
        </div>
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 gap-0.5 mb-0.5">
        {['S','M','T','W','T','F','S'].map((d, i) => (
          <div key={i} className="text-center text-[9px] text-suwappu-text-secondary font-medium">{d}</div>
        ))}
      </div>

      {/* Calendar cells */}
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((cell, i) => {
          if (!cell) return <div key={i} />
          const dayNum = parseInt(cell.date.split('-')[2])
          const today = new Date()
          const isToday = cell.date === `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`
          const isFuture = new Date(cell.date) > today
          return (
            <button
              key={i}
              onClick={() => !isFuture && cell.tradeCount > 0 && setSelectedDay(cell)}
              className={`
                aspect-square rounded-xs flex items-center justify-center
                text-[8px] font-medium transition-opacity
                ${isFuture ? 'bg-gray-50 text-gray-300 cursor-default' : pnlColor(cell.pnl, maxAbs)}
                ${cell.pnl !== 0 && !isFuture ? 'cursor-pointer hover:opacity-80' : ''}
                ${isToday ? 'ring-1 ring-suwappu-magenta-mid' : ''}
              `}
            >
              {dayNum}
            </button>
          )
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-2 mt-2 justify-end">
        <div className="flex items-center gap-1">
          <div className="w-2.5 h-2.5 rounded-xs bg-red-500" />
          <span className="text-[9px] text-suwappu-text-secondary">Loss</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2.5 h-2.5 rounded-xs bg-gray-100" />
          <span className="text-[9px] text-suwappu-text-secondary">No trades</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2.5 h-2.5 rounded-xs bg-green-500" />
          <span className="text-[9px] text-suwappu-text-secondary">Profit</span>
        </div>
      </div>

      {/* Day detail slide-up */}
      {selectedDay && (
        <div className="mt-2 border-t border-suwappu-sakura-mid/10 pt-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold text-suwappu-purple-deep">{selectedDay.date}</span>
            <button onClick={() => setSelectedDay(null)} className="text-[10px] text-suwappu-text-secondary hover:underline">Close</button>
          </div>
          <div className="flex gap-3">
            <div>
              <div className={`text-sm font-bold font-heading ${selectedDay.pnl >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                {formatUsd(selectedDay.pnl)}
              </div>
              <div className="text-[10px] text-suwappu-text-secondary">Daily PnL</div>
            </div>
            <div>
              <div className="text-sm font-bold font-heading text-suwappu-purple-deep">{selectedDay.tradeCount}</div>
              <div className="text-[10px] text-suwappu-text-secondary">Trades</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Chain Breakdown
// ---------------------------------------------------------------------------

const CHAIN_COLORS: Record<string, string> = {
  ethereum: '#3b82f6', eth: '#3b82f6',
  solana: '#a855f7', sol: '#a855f7',
  polygon: '#6366f1', matic: '#6366f1',
  arbitrum: '#0ea5e9', optimism: '#ef4444',
  base: '#60a5fa', bsc: '#eab308',
  tempo: '#f59e0b',
}

function ChainBreakdown({ chains }: { chains: { chain: string; pnl: number; tradeCount: number }[] }) {
  if (!chains.length) return null
  const maxAbs = Math.max(...chains.map(c => Math.abs(c.pnl)), 1)

  return (
    <div className="bg-white rounded-suwappu-xl p-3 shadow-suwappu-1">
      <h3 className="font-heading font-semibold text-sm text-suwappu-purple-deep mb-3">By Chain</h3>
      <div className="space-y-2">
        {chains.map(c => {
          const color = CHAIN_COLORS[c.chain.toLowerCase()] || '#6b7280'
          const pct = (Math.abs(c.pnl) / maxAbs) * 100
          return (
            <div key={c.chain}>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-xs font-medium text-suwappu-purple-deep capitalize">{c.chain}</span>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-suwappu-text-secondary">{c.tradeCount} trades</span>
                  <span className={`text-xs font-semibold ${c.pnl >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {formatUsd(c.pnl)}
                  </span>
                </div>
              </div>
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${pct}%`, backgroundColor: color, opacity: c.pnl < 0 ? 0.5 : 1 }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// KPI Card
// ---------------------------------------------------------------------------

interface KpiCardProps {
  label: string
  value: string
  subtitle?: string
  positive?: boolean | null
}

function KpiCard({ label, value, subtitle, positive }: KpiCardProps) {
  const valueColor =
    positive === true ? 'text-green-600' :
    positive === false ? 'text-red-500' :
    'text-suwappu-purple-deep'

  return (
    <div className="shrink-0 bg-white rounded-suwappu-xl p-3 shadow-suwappu-1 min-w-[110px]">
      <div className="text-[10px] text-suwappu-text-secondary mb-0.5">{label}</div>
      <div className={`text-sm font-bold font-heading truncate ${valueColor}`}>{value}</div>
      {subtitle && <div className="text-[9px] text-suwappu-text-secondary mt-0.5 leading-tight">{subtitle}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Portfolio page
// ---------------------------------------------------------------------------

export function Portfolio() {
  const [period, setPeriod] = useState<PnlPeriod>('30d')
  const { data: portfolio, isLoading: portfolioLoading, error: portfolioError } = usePortfolio()
  const { data: pnl, isLoading: pnlLoading } = usePortfolioPnl(period)

  const tokens = portfolio?.tokens || []
  const totalBalance = portfolio ? formatUsd(portfolio.totalUsdValue) : '$0.00'

  const chainAllocations = useMemo(() => {
    if (!portfolio || portfolio.totalUsdValue === 0) return []
    const totals: Record<string, number> = {}
    for (const t of portfolio.tokens) {
      const c = t.chain.toLowerCase()
      totals[c] = (totals[c] || 0) + t.usdValue
    }
    return Object.entries(totals)
      .map(([chain, value]) => ({ chain, pct: Math.round((value / portfolio.totalUsdValue) * 100) }))
      .sort((a, b) => b.pct - a.pct)
  }, [portfolio])

  const isPositive = (pnl?.totalPnl ?? 0) >= 0

  if (portfolioLoading) {
    return (
      <AppLayout header={<AppHeader title="Portfolio" />} activeNav="portfolio">
        <div className="p-3 pb-20 space-y-3 animate-pulse">
          <div className="bg-suwappu-sakura-light rounded-suwappu-xl h-32" />
          <div className="flex gap-2 overflow-hidden">
            {[1,2,3,4].map(i => <div key={i} className="bg-suwappu-sakura-light rounded-suwappu-xl h-16 flex-1" />)}
          </div>
          <div className="bg-suwappu-sakura-light rounded-suwappu-xl h-48" />
          <div className="bg-suwappu-sakura-light rounded-suwappu-xl h-56" />
        </div>
      </AppLayout>
    )
  }

  if (portfolioError) {
    return (
      <AppLayout header={<AppHeader title="Portfolio" />} activeNav="portfolio">
        <div className="p-3 pb-20">
          <div className="bg-white rounded-suwappu-xl p-6 text-center shadow-suwappu-1">
            <p className="text-sm text-suwappu-error mb-1">Failed to load portfolio</p>
            <p className="text-xs text-suwappu-text-secondary">Please try again later</p>
          </div>
        </div>
      </AppLayout>
    )
  }

  return (
    <AppLayout header={<AppHeader title="Portfolio" />} activeNav="portfolio">
      <div className="pb-20 space-y-3">

        {/* Balance */}
        <div className="px-3 pt-3">
          <BalanceCard balance={totalBalance} />
        </div>

        {/* Period tabs */}
        <div className="px-3 flex gap-1.5">
          {PERIODS.map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`flex-1 py-1.5 rounded-suwappu-lg text-xs font-semibold transition-colors ${
                period === p
                  ? 'bg-suwappu-magenta-mid text-white'
                  : 'bg-white text-suwappu-text-secondary hover:bg-suwappu-sakura-light shadow-suwappu-1'
              }`}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>

        {/* KPI row — horizontal scroll */}
        {pnlLoading ? (
          <div className="px-3 flex gap-2 overflow-x-auto pb-1 animate-pulse">
            {[1,2,3,4,5,6].map(i => <div key={i} className="bg-suwappu-sakura-light rounded-suwappu-xl h-16 min-w-[110px]" />)}
          </div>
        ) : pnl ? (
          <div className="px-3 flex gap-2 overflow-x-auto pb-1 hide-scrollbar">
            <KpiCard
              label="Total PnL"
              value={formatUsd(pnl.totalPnl, true)}
              positive={pnl.totalPnl > 0 ? true : pnl.totalPnl < 0 ? false : null}
            />
            <KpiCard
              label="Win Rate"
              value={`${pnl.winRate.toFixed(0)}%`}
              subtitle={`${pnl.wins}W / ${pnl.losses}L`}
              positive={pnl.winRate >= 50 ? true : false}
            />
            <KpiCard
              label="Total Trades"
              value={String(pnl.totalTrades)}
            />
            <KpiCard
              label="Avg Trade"
              value={formatUsd(pnl.avgTradeSize, true)}
            />
            <KpiCard
              label="Gas Paid"
              value={formatUsd(pnl.gasPaidUsd, true)}
              subtitle="across all chains"
            />
            <KpiCard
              label="Fees Saved"
              value={formatUsd(pnl.feesSavedUsd, true)}
              subtitle="from points redemptions"
              positive={pnl.feesSavedUsd > 0 ? true : null}
            />
          </div>
        ) : null}

        {/* Equity Curve */}
        <div className="px-3">
          <div className="bg-white rounded-suwappu-xl p-3 shadow-suwappu-1">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-heading font-semibold text-sm text-suwappu-purple-deep">Equity Curve</h3>
              {pnl && (
                <span className={`text-xs font-semibold ${isPositive ? 'text-green-600' : 'text-red-500'}`}>
                  {formatUsd(pnl.totalPnl)}
                </span>
              )}
            </div>
            {pnl ? (
              <EquityCurveChart dataPoints={pnl.dataPoints} isPositive={isPositive} />
            ) : (
              <div className="h-[180px] flex items-center justify-center text-xs text-suwappu-text-secondary">
                Loading chart...
              </div>
            )}
          </div>
        </div>

        {/* PnL Heatmap */}
        <div className="px-3">
          <PnlHeatmap dataPoints={pnl?.dataPoints || []} />
        </div>

        {/* Chain Breakdown */}
        {pnl && pnl.chainBreakdown.length > 0 && (
          <div className="px-3">
            <ChainBreakdown chains={pnl.chainBreakdown} />
          </div>
        )}

        {/* Chain allocation bar */}
        {chainAllocations.length > 0 && (
          <div className="px-3">
            <div className="bg-white rounded-suwappu-xl p-3 shadow-suwappu-1">
              <h3 className="font-heading font-semibold text-sm text-suwappu-purple-deep mb-3">Chain Distribution</h3>
              <div className="h-2 rounded-full overflow-hidden flex bg-suwappu-sakura-light">
                {chainAllocations.map((c) => (
                  <div
                    key={c.chain}
                    style={{ width: `${c.pct}%`, backgroundColor: CHAIN_COLORS[c.chain] || '#6b7280' }}
                  />
                ))}
              </div>
              <div className="flex flex-wrap gap-3 mt-2">
                {chainAllocations.map((c) => (
                  <div key={c.chain} className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: CHAIN_COLORS[c.chain] || '#6b7280' }} />
                    <span className="text-xs text-suwappu-text-secondary capitalize">{c.chain} {c.pct}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Holdings */}
        <div className="px-3">
          <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-suwappu-sakura-mid/10">
              <span className="font-heading font-semibold text-sm text-suwappu-purple-deep">Holdings</span>
            </div>
            {tokens.length > 0 ? (
              <div className="divide-y divide-suwappu-sakura-mid/10">
                {tokens.map((token) => (
                  <TokenItem
                    key={`${token.chain}-${token.symbol}-${token.address}`}
                    symbol={token.symbol}
                    name={token.name}
                    value={formatUsd(token.usdValue)}
                    balance={token.balance}
                    icon={getTokenIcon(token)}
                  />
                ))}
              </div>
            ) : (
              <div className="p-6 text-center">
                <p className="font-heading font-semibold text-suwappu-purple-deep mb-1">No holdings yet</p>
                <p className="text-xs text-suwappu-text-secondary">Start by adding funds to your wallet</p>
              </div>
            )}
          </div>
        </div>

      </div>
    </AppLayout>
  )
}
