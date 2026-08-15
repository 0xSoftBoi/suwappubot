import { useRef, useEffect, useState, useMemo } from 'react'
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  ColorType,
  LineStyle,
  CrosshairMode,
} from 'lightweight-charts'
import type { PredictionMarket } from '../../types/api'
import { usePredictHistory } from '../../hooks/usePredictHistory'
import { TerminalEmptyState, TerminalSkeleton } from '../foundation'

const RANGES = ['1H', '6H', '1D', '1W', '1M', 'ALL'] as const
type Range = (typeof RANGES)[number]

// Institutional register (see src/index.css / WS-A report §2). lightweight-charts
// takes literal colours, so these mirror the theme vars rather than read them.
const CANVAS = '#0A0B0F'
const AXIS_TEXT = '#9BA1AB'
const GRID = 'rgba(236,237,239,0.06)'
const BORDER = 'rgba(236,237,239,0.13)'
const ACCENT = '#E58D2B'
const UP = '#2FBF71'
const DOWN = '#E5484D'

interface Props {
  market: PredictionMarket | null
}

// Probability-over-time chart for a Polymarket market on a pro dark surface.
// Pick which outcome's line to view (binary markets default to the first) and
// the time window. Values are implied probability in percent (0–100).
export function ProbabilityChart({ market }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const areaRef = useRef<ISeriesApi<'Area'> | null>(null)

  const [range, setRange] = useState<Range>('1W')
  const [tokenIdx, setTokenIdx] = useState(0)
  const [hoverPct, setHoverPct] = useState<number | null>(null)

  const tokens = useMemo(() => market?.tokens?.filter((t) => t.tokenId) ?? [], [market])
  const activeToken = tokens[tokenIdx] ?? tokens[0] ?? null

  const { data: points, isLoading } = usePredictHistory(activeToken?.tokenId ?? null, range)

  const last = points && points.length > 0 ? points[points.length - 1].value : null
  const first = points && points.length > 0 ? points[0].value : null
  const windowChange = last != null && first != null ? last - first : null
  const displayPct = hoverPct ?? last

  // Initialize chart once.
  useEffect(() => {
    if (!containerRef.current) return

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: AXIS_TEXT,
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: GRID, style: LineStyle.Solid },
        horzLines: { color: GRID, style: LineStyle.Solid },
      },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: { color: 'rgba(229,141,43,0.55)', width: 1, labelBackgroundColor: ACCENT },
        horzLine: { color: 'rgba(229,141,43,0.55)', width: 1, labelBackgroundColor: ACCENT },
      },
      rightPriceScale: { borderColor: BORDER, scaleMargins: { top: 0.12, bottom: 0.08 } },
      timeScale: { borderColor: BORDER, timeVisible: true, secondsVisible: false },
      handleScroll: { vertTouchDrag: false },
    })
    chartRef.current = chart

    const area = chart.addAreaSeries({
      lineColor: ACCENT,
      topColor: 'rgba(229,141,43,0.28)',
      bottomColor: 'rgba(229,141,43,0.02)',
      lineWidth: 2,
      priceFormat: { type: 'custom', formatter: (v: number) => `${v.toFixed(0)}%`, minMove: 0.1 },
    })
    area.applyOptions({
      autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
    })
    // 50/50 reference line so a coin-flip market reads instantly.
    area.createPriceLine({
      price: 50,
      color: 'rgba(236,237,239,0.22)',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: false,
    })
    areaRef.current = area

    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !areaRef.current) {
        setHoverPct(null)
        return
      }
      const d = param.seriesData.get(areaRef.current) as { value: number } | undefined
      setHoverPct(d ? d.value : null)
    })

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        chart.applyOptions({ width, height })
      }
    })
    observer.observe(containerRef.current)

    return () => {
      observer.disconnect()
      chart.remove()
      chartRef.current = null
    }
  }, [])

  // Recolor + push data; green when the outcome trended up over the window.
  useEffect(() => {
    if (!points || !areaRef.current) return
    const up = points.length > 1 ? points[points.length - 1].value >= points[0].value : true
    areaRef.current.applyOptions({
      lineColor: up ? UP : DOWN,
      topColor: up ? 'rgba(47,191,113,0.28)' : 'rgba(229,72,77,0.26)',
      bottomColor: up ? 'rgba(47,191,113,0.02)' : 'rgba(229,72,77,0.02)',
    })
    // lightweight-charts hard-asserts strictly-ascending, unique timestamps —
    // a duplicate/out-of-order point (plausible from tick-level Polymarket
    // history) throws and white-screens the terminal. Dedupe by time (keep
    // last) and sort ascending before setData.
    const byTime = new Map<number, number>()
    for (const p of points) byTime.set(p.time as number, p.value)
    const safe = Array.from(byTime.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([time, value]) => ({ time: time as UTCTimestamp, value }))
    areaRef.current.setData(safe)
    chartRef.current?.timeScale().fitContent()
  }, [points])

  const changeUp = (windowChange ?? 0) >= 0

  // The chart container must stay mounted at all times — the one-time init
  // effect captures containerRef on mount, so an early return before this div
  // exists would leave the canvas un-created when a market is later selected.
  return (
    <div className="flex h-full flex-col">
      <div className="hairline-b px-3 py-2.5">
        <p className="line-clamp-2 text-[13px] font-semibold leading-snug text-terminal-text">
          {market ? market.question : 'Odds history'}
        </p>
        <div className="mt-1.5 flex items-end gap-2">
          {market && displayPct != null ? (
            <>
              {/* Probability is the hero number. */}
              <span className="font-mono text-3xl font-semibold leading-none tnum text-terminal-text">
                {displayPct.toFixed(0)}
                <span className="text-lg text-terminal-text-muted">%</span>
              </span>
              <span className="pb-0.5 text-[11px] text-terminal-text-muted">
                {activeToken?.outcome ?? ''} chance
              </span>
              {windowChange != null && (
                <span
                  className={`pb-0.5 font-mono text-[11px] font-semibold tnum ${changeUp ? 'text-bull' : 'text-bear'}`}
                >
                  <span aria-hidden="true">{changeUp ? '▲' : '▼'}</span>{' '}
                  {changeUp ? '+' : '−'}
                  {Math.abs(windowChange).toFixed(1)}pt
                </span>
              )}
            </>
          ) : (
            <span className="text-[11px] text-terminal-text-muted">
              Select a market to see its odds
            </span>
          )}
        </div>
        {market && tokens.length > 1 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {tokens.map((t, i) => (
              <button
                key={t.tokenId}
                onClick={() => setTokenIdx(i)}
                aria-pressed={i === tokenIdx}
                className={`rounded-terminal-pill px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                  i === tokenIdx
                    ? 'accent-wash text-terminal-accent ring-1 ring-terminal-border-active'
                    : 'text-terminal-text-secondary hover:bg-terminal-bg-tertiary/60 hover:text-terminal-text'
                }`}
              >
                {t.outcome}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="terminal-theme-inset flex items-center gap-1 px-2 py-1.5">
        {RANGES.map((r) => (
          <button
            key={r}
            onClick={() => setRange(r)}
            disabled={!market}
            className={`terminal-theme-control min-h-[26px] min-w-[34px] px-2 py-0.5 font-mono text-[11px] leading-none transition-colors disabled:opacity-40 ${
              range === r
                ? 'terminal-theme-control-active text-terminal-text'
                : 'text-terminal-text-secondary hover:text-terminal-text'
            }`}
          >
            {r}
          </button>
        ))}
      </div>

      <div
        className="hairline relative min-h-0 flex-1 overflow-hidden rounded-terminal-inset"
        style={{ backgroundColor: CANVAS }}
      >
        <div ref={containerRef} className="h-full w-full" />
        {!market && (
          <div className="absolute inset-0 flex items-center justify-center">
            <TerminalEmptyState
              className="bg-transparent"
              kicker="Odds history"
              title="Select a market"
              description="Pick a market to chart its implied probability over time."
            />
          </div>
        )}
        {market && isLoading && (
          <div className="absolute inset-0 flex flex-col justify-end gap-2 p-4">
            <TerminalSkeleton height={10} width="80%" label="Loading odds" />
            <TerminalSkeleton height={10} width="64%" />
            <TerminalSkeleton height={10} width="72%" />
          </div>
        )}
        {market && !isLoading && points && points.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="terminal-theme-overlay px-4 py-3 text-center">
              <div className="text-sm font-semibold text-terminal-text">No price history yet</div>
              <div className="mt-1 text-xs text-terminal-text-secondary">
                Polymarket has no trades for this outcome in this window. Try a wider range.
              </div>
            </div>
          </div>
        )}
        {market && !isLoading && !activeToken && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-xs text-terminal-text-muted">
              No chartable outcome for this market.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
