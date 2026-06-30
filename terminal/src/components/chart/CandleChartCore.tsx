import { useRef, useEffect, useMemo, useState } from 'react'
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  ColorType,
  LineStyle,
  CrosshairMode,
} from 'lightweight-charts'
import type { OHLCVCandle } from '../../types/api'
import { designTokens } from '@suwappu/design-tokens'

const trading = designTokens.colors.trading
const brand = designTokens.colors.brand

// Pro dark chart surface — high-contrast candles on deep navy, the way every
// serious trading terminal (Hyperliquid, Coinbase Advanced, Axiom) renders.
const AXIS_TEXT = '#8aa2b4'
const GRID = 'rgba(148, 184, 215, 0.07)'
const BORDER = 'rgba(148, 184, 215, 0.16)'
const CROSSHAIR = 'rgba(56, 189, 248, 0.5)'

function computeSMA(candles: OHLCVCandle[], period: number) {
  const result: { time: UTCTimestamp; value: number }[] = []
  for (let i = period - 1; i < candles.length; i++) {
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += candles[j].close
    result.push({ time: candles[i].time as UTCTimestamp, value: sum / period })
  }
  return result
}

interface OHLCReadout {
  open: number
  high: number
  low: number
  close: number
  changePct: number
}

interface Props {
  candles: OHLCVCandle[] | undefined
  isLoading: boolean
  chartType: 'candle' | 'line'
  label?: string | null
  selectPrompt?: { title: string; subtitle?: string }
  emptyState?: { title: string; subtitle?: string }
  showSMA?: boolean
}

// The shared candlestick/line renderer used by every OHLCV chart in the
// terminal (spot pairs, perps markets). Owns the lightweight-charts lifecycle
// and a live OHLC crosshair readout; the caller owns toolbar + data fetching.
export function CandleChartCore({
  candles: rawCandles,
  isLoading,
  chartType,
  label,
  selectPrompt,
  emptyState,
  showSMA = true,
}: Props) {
  // lightweight-charts hard-asserts that series data is strictly ascending and
  // unique by time — a single duplicate/out-of-order timestamp throws and takes
  // the whole terminal down via the error boundary. Some feeds (esp. when
  // switching tickers) return candles with a repeated bucket timestamp, so
  // sanitize here once: sort ascending and collapse duplicate timestamps,
  // keeping the last (most complete) candle for each bucket.
  const candles = useMemo(() => {
    if (!rawCandles) return rawCandles
    const byTime = new Map<number, (typeof rawCandles)[number]>()
    for (const c of rawCandles) byTime.set(c.time as number, c)
    return Array.from(byTime.values()).sort((a, b) => (a.time as number) - (b.time as number))
  }, [rawCandles])

  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const lineSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const sma20Ref = useRef<ISeriesApi<'Line'> | null>(null)
  const sma50Ref = useRef<ISeriesApi<'Line'> | null>(null)

  // Live OHLC under the crosshair; null → show the latest candle.
  const [hover, setHover] = useState<OHLCReadout | null>(null)

  const sma20Data = useMemo(
    () => (showSMA && candles ? computeSMA(candles, 20) : []),
    [candles, showSMA]
  )
  const sma50Data = useMemo(
    () => (showSMA && candles ? computeSMA(candles, 50) : []),
    [candles, showSMA]
  )

  const latest = useMemo<OHLCReadout | null>(() => {
    if (!candles || candles.length === 0) return null
    const c = candles[candles.length - 1]
    return {
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      changePct: c.open !== 0 ? ((c.close - c.open) / c.open) * 100 : 0,
    }
  }, [candles])

  const readout = hover ?? latest

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
        mode: CrosshairMode.Normal,
        vertLine: { color: CROSSHAIR, width: 1, style: LineStyle.Solid, labelBackgroundColor: '#0e3a52' },
        horzLine: { color: CROSSHAIR, width: 1, style: LineStyle.Solid, labelBackgroundColor: '#0e3a52' },
      },
      rightPriceScale: { borderColor: BORDER, scaleMargins: { top: 0.12, bottom: 0.26 } },
      timeScale: { borderColor: BORDER, timeVisible: true, secondsVisible: false },
      handleScroll: { vertTouchDrag: false },
    })

    chartRef.current = chart

    const candleSeries = chart.addCandlestickSeries({
      upColor: trading.bull,
      downColor: trading.bear,
      borderUpColor: trading.bull,
      borderDownColor: trading.bear,
      wickUpColor: trading.bull,
      wickDownColor: trading.bear,
    })
    candleSeriesRef.current = candleSeries

    const lineSeries = chart.addLineSeries({
      color: '#38bdf8',
      lineWidth: 2,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
      visible: false,
    })
    lineSeriesRef.current = lineSeries

    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    })
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })
    volumeSeriesRef.current = volumeSeries

    const sma20 = chart.addLineSeries({
      color: brand.persimmonCore,
      lineWidth: 1,
      crosshairMarkerVisible: false,
      priceLineVisible: false,
      lastValueVisible: false,
    })
    sma20Ref.current = sma20

    const sma50 = chart.addLineSeries({
      color: '#a78bfa',
      lineWidth: 1,
      crosshairMarkerVisible: false,
      priceLineVisible: false,
      lastValueVisible: false,
    })
    sma50Ref.current = sma50

    // Live OHLC readout under the crosshair.
    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !candleSeriesRef.current) {
        setHover(null)
        return
      }
      const d = param.seriesData.get(candleSeriesRef.current) as
        | { open: number; high: number; low: number; close: number }
        | undefined
      if (!d) {
        setHover(null)
        return
      }
      setHover({
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
        changePct: d.open !== 0 ? ((d.close - d.open) / d.open) * 100 : 0,
      })
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

  // Toggle candle/line visibility.
  useEffect(() => {
    candleSeriesRef.current?.applyOptions({ visible: chartType === 'candle' })
    lineSeriesRef.current?.applyOptions({ visible: chartType === 'line' })
  }, [chartType])

  // Push data whenever candles change.
  useEffect(() => {
    if (!candles || !candleSeriesRef.current || !volumeSeriesRef.current || !lineSeriesRef.current)
      return

    candleSeriesRef.current.setData(
      candles.map((c) => ({
        time: c.time as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }))
    )
    lineSeriesRef.current.setData(
      candles.map((c) => ({ time: c.time as UTCTimestamp, value: c.close }))
    )
    volumeSeriesRef.current.setData(
      candles.map((c) => ({
        time: c.time as UTCTimestamp,
        value: c.volume,
        color: c.close >= c.open ? 'rgba(34, 197, 94, 0.28)' : 'rgba(239, 68, 68, 0.26)',
      }))
    )

    sma20Ref.current?.setData(sma20Data)
    sma50Ref.current?.setData(sma50Data)

    chartRef.current?.timeScale().fitContent()
  }, [candles, sma20Data, sma50Data])

  const fmt = (n: number) =>
    n >= 1000 ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : n >= 1 ? n.toFixed(2) : n.toPrecision(4)
  const up = (readout?.changePct ?? 0) >= 0

  return (
    <div className="relative h-full w-full overflow-hidden rounded-[10px] border border-white/5 bg-[radial-gradient(circle_at_80%_-10%,rgba(56,189,248,0.12),transparent_40%),linear-gradient(180deg,#0b1622_0%,#0a121d_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      {/* Live OHLC + indicator legend */}
      {readout && (
        <div className="pointer-events-none absolute left-2.5 top-2 z-10 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[10.5px] leading-none">
          <span className="flex gap-2 text-slate-300/90">
            <span>O<span className="ml-1 text-slate-100">{fmt(readout.open)}</span></span>
            <span>H<span className="ml-1 text-slate-100">{fmt(readout.high)}</span></span>
            <span>L<span className="ml-1 text-slate-100">{fmt(readout.low)}</span></span>
            <span>C<span className="ml-1 text-slate-100">{fmt(readout.close)}</span></span>
          </span>
          <span className={up ? 'text-bull' : 'text-bear'}>
            {up ? '+' : ''}
            {readout.changePct.toFixed(2)}%
          </span>
          {showSMA && (
            <span className="flex gap-2">
              <span className="text-[#e58d2b]">SMA20</span>
              <span className="text-[#a78bfa]">SMA50</span>
            </span>
          )}
        </div>
      )}

      <div ref={containerRef} className="h-full w-full" />

      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-slate-400 text-sm animate-pulse">Loading {label ?? 'chart'}…</div>
        </div>
      )}
      {!isLoading && !candles && selectPrompt && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <div className="text-slate-300 text-sm">{selectPrompt.title}</div>
            {selectPrompt.subtitle && (
              <div className="text-slate-500 text-xs mt-1">{selectPrompt.subtitle}</div>
            )}
          </div>
        </div>
      )}
      {!isLoading && candles && candles.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="rounded-md border border-white/10 bg-slate-900/80 px-4 py-3 text-center shadow-lg">
            <div className="text-slate-200 text-sm">{emptyState?.title ?? 'No chart data available.'}</div>
            {emptyState?.subtitle && (
              <div className="text-slate-500 text-xs mt-1">{emptyState.subtitle}</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
