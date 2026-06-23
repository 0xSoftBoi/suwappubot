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
import { designTokens } from '@suwappu/design-tokens'

const trading = designTokens.colors.trading

const RANGES = ['1H', '6H', '1D', '1W', '1M', 'ALL'] as const
type Range = (typeof RANGES)[number]

const AXIS_TEXT = '#8aa2b4'
const GRID = 'rgba(148, 184, 215, 0.07)'
const BORDER = 'rgba(148, 184, 215, 0.16)'

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
        vertLine: { color: 'rgba(56,189,248,0.5)', width: 1, labelBackgroundColor: '#0e3a52' },
        horzLine: { color: 'rgba(56,189,248,0.5)', width: 1, labelBackgroundColor: '#0e3a52' },
      },
      rightPriceScale: { borderColor: BORDER, scaleMargins: { top: 0.12, bottom: 0.08 } },
      timeScale: { borderColor: BORDER, timeVisible: true, secondsVisible: false },
      handleScroll: { vertTouchDrag: false },
    })
    chartRef.current = chart

    const area = chart.addAreaSeries({
      lineColor: '#38bdf8',
      topColor: 'rgba(56, 189, 248, 0.4)',
      bottomColor: 'rgba(56, 189, 248, 0.02)',
      lineWidth: 2,
      priceFormat: { type: 'custom', formatter: (v: number) => `${v.toFixed(0)}%`, minMove: 0.1 },
    })
    area.applyOptions({
      autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
    })
    // 50/50 reference line so a coin-flip market reads instantly.
    area.createPriceLine({
      price: 50,
      color: 'rgba(148,184,215,0.35)',
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
    const line = up ? trading.bull : trading.bear
    areaRef.current.applyOptions({
      lineColor: line,
      topColor: up ? 'rgba(34, 197, 94, 0.34)' : 'rgba(239, 68, 68, 0.3)',
      bottomColor: up ? 'rgba(34, 197, 94, 0.02)' : 'rgba(239, 68, 68, 0.02)',
    })
    areaRef.current.setData(points.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })))
    chartRef.current?.timeScale().fitContent()
  }, [points])

  const changeUp = (windowChange ?? 0) >= 0

  // The chart container must stay mounted at all times — the one-time init
  // effect captures containerRef on mount, so an early return before this div
  // exists would leave the canvas un-created when a market is later selected.
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-terminal-border px-3 py-2.5">
        <p className="line-clamp-2 text-[13px] font-semibold leading-snug text-terminal-text">
          {market ? market.question : 'Odds history'}
        </p>
        <div className="mt-1.5 flex items-end gap-2">
          {market && displayPct != null ? (
            <>
              <span className="font-mono text-2xl font-bold leading-none text-terminal-text tabular-nums">
                {displayPct.toFixed(0)}
                <span className="text-base text-terminal-text-muted">%</span>
              </span>
              <span className="pb-0.5 text-[11px] text-terminal-text-muted">
                {activeToken?.outcome ?? ''} chance
              </span>
              {windowChange != null && (
                <span
                  className={`pb-0.5 font-mono text-[11px] font-semibold ${changeUp ? 'text-bull' : 'text-bear'}`}
                >
                  {changeUp ? '▲' : '▼'} {Math.abs(windowChange).toFixed(1)}pt
                </span>
              )}
            </>
          ) : (
            <span className="text-[11px] text-terminal-text-muted">Select a market to see its odds</span>
          )}
        </div>
        {market && tokens.length > 1 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {tokens.map((t, i) => (
              <button
                key={t.tokenId}
                onClick={() => setTokenIdx(i)}
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                  i === tokenIdx
                    ? 'bg-sakura-500/15 text-sakura-500 ring-1 ring-sakura-500/40'
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

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-[10px] border border-white/5 bg-[radial-gradient(circle_at_80%_-10%,rgba(56,189,248,0.1),transparent_42%),linear-gradient(180deg,#0b1622_0%,#0a121d_100%)]">
        <div ref={containerRef} className="h-full w-full" />
        {!market && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div className="text-slate-300 text-sm">Select a market</div>
              <div className="text-slate-500 text-xs mt-1">Pick a market to see its odds history</div>
            </div>
          </div>
        )}
        {market && isLoading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-slate-400 text-sm animate-pulse">Loading odds…</div>
          </div>
        )}
        {market && !isLoading && points && points.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="rounded-md border border-white/10 bg-slate-900/80 px-4 py-3 text-center shadow-lg">
              <div className="text-slate-200 text-sm">No price history yet.</div>
              <div className="text-slate-500 text-xs mt-1">
                Polymarket has no trades for this outcome in this window.
              </div>
            </div>
          </div>
        )}
        {market && !isLoading && !activeToken && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-slate-400 text-xs">No chartable outcome for this market.</div>
          </div>
        )}
      </div>
    </div>
  )
}
