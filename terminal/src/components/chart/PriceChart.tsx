import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { createChart, type IChartApi, type ISeriesApi, ColorType, LineStyle } from 'lightweight-charts'
import { ChartToolbar } from './ChartToolbar'
import { useChartData } from '../../hooks/useChartData'
import { usePair } from '../../contexts/PairContext'
import { useTrading } from '../../contexts/TradingContext'
import type { OHLCVCandle } from '../../types/api'

const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1D'] as const
type Interval = typeof INTERVALS[number]

function computeSMA(candles: OHLCVCandle[], period: number) {
  const result: { time: number; value: number }[] = []
  for (let i = period - 1; i < candles.length; i++) {
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) {
      sum += candles[j].close
    }
    result.push({ time: candles[i].time, value: sum / period })
  }
  return result
}

export function PriceChart() {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const lineSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const sma20Ref = useRef<ISeriesApi<'Line'> | null>(null)
  const sma50Ref = useRef<ISeriesApi<'Line'> | null>(null)

  const { chartInterval: interval, setChartInterval } = useTrading()
  const [chartType, setChartType] = useState<'candle' | 'line'>('candle')

  const { selectedPair, selectedChain } = usePair()

  // Use the base token address for chart data
  const tokenAddress = selectedPair.base?.address ?? null

  const { data: candles, isLoading } = useChartData(
    tokenAddress,
    selectedChain,
    interval
  )

  // Compute SMA data
  const sma20Data = useMemo(() => candles ? computeSMA(candles, 20) : [], [candles])
  const sma50Data = useMemo(() => candles ? computeSMA(candles, 50) : [], [candles])

  // Initialize chart
  useEffect(() => {
    if (!containerRef.current) return

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#7aa1b4',
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 11,
      },
      grid: {
        vertLines: {
          color: 'rgba(80, 164, 190, 0.18)',
          style: LineStyle.Dotted,
        },
        horzLines: {
          color: 'rgba(80, 164, 190, 0.16)',
          style: LineStyle.Dotted,
        },
      },
      crosshair: {
        vertLine: { color: 'rgba(14, 165, 233, 0.55)', width: 1, style: LineStyle.Dashed },
        horzLine: { color: 'rgba(14, 165, 233, 0.55)', width: 1, style: LineStyle.Dashed },
      },
      rightPriceScale: {
        borderColor: 'rgba(80, 164, 190, 0.28)',
        scaleMargins: { top: 0.1, bottom: 0.25 },
      },
      timeScale: {
        borderColor: 'rgba(80, 164, 190, 0.28)',
        timeVisible: true,
        secondsVisible: false,
      },
      handleScroll: { vertTouchDrag: false },
    })

    chartRef.current = chart

    // Candlestick series
    const candleSeries = chart.addCandlestickSeries({
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    })
    candleSeriesRef.current = candleSeries

    // Line series (for line chart mode)
    const lineSeries = chart.addLineSeries({
      color: '#E66D85',
      lineWidth: 2,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
      visible: false,
    })
    lineSeriesRef.current = lineSeries

    // Volume histogram
    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    })
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    })
    volumeSeriesRef.current = volumeSeries

    // SMA 20 line
    const sma20 = chart.addLineSeries({
      color: '#f59e0b',
      lineWidth: 1,
      lineStyle: LineStyle.Solid,
      crosshairMarkerVisible: false,
      priceLineVisible: false,
      lastValueVisible: false,
    })
    sma20Ref.current = sma20

    // SMA 50 line
    const sma50 = chart.addLineSeries({
      color: '#8b5cf6',
      lineWidth: 1,
      lineStyle: LineStyle.Solid,
      crosshairMarkerVisible: false,
      priceLineVisible: false,
      lastValueVisible: false,
    })
    sma50Ref.current = sma50

    // Resize observer
    const observer = new ResizeObserver(entries => {
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

  // Toggle candle/line visibility when chartType changes
  useEffect(() => {
    if (candleSeriesRef.current) {
      candleSeriesRef.current.applyOptions({ visible: chartType === 'candle' })
    }
    if (lineSeriesRef.current) {
      lineSeriesRef.current.applyOptions({ visible: chartType === 'line' })
    }
  }, [chartType])

  // Update data when candles change
  useEffect(() => {
    if (!candles || !candleSeriesRef.current || !volumeSeriesRef.current || !lineSeriesRef.current) return

    const candleData = candles.map(c => ({
      time: c.time as number,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }))

    const lineData = candles.map(c => ({
      time: c.time as number,
      value: c.close,
    }))

    const volumeData = candles.map(c => ({
      time: c.time as number,
      value: c.volume,
      color: c.close >= c.open ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)',
    }))

    candleSeriesRef.current.setData(candleData)
    lineSeriesRef.current.setData(lineData)
    volumeSeriesRef.current.setData(volumeData)

    // SMA overlays
    if (sma20Ref.current) sma20Ref.current.setData(sma20Data)
    if (sma50Ref.current) sma50Ref.current.setData(sma50Data)

    // Fit content
    chartRef.current?.timeScale().fitContent()
  }, [candles, sma20Data, sma50Data])

  const handleIntervalChange = useCallback((i: string) => {
    setChartInterval(i as Interval)
  }, [setChartInterval])

  const pairLabel = selectedPair.base && selectedPair.quote
    ? `${selectedPair.base.symbol}/${selectedPair.quote.symbol}`
    : null

  return (
    <div className="h-full flex flex-col">
      <ChartToolbar
        interval={interval}
        onIntervalChange={handleIntervalChange}
        chartType={chartType}
        onChartTypeChange={setChartType}
      />
      <div ref={containerRef} className="flex-1 relative">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-terminal-text-muted text-sm animate-pulse">
              Loading {pairLabel ?? 'chart'}...
            </div>
          </div>
        )}
        {!isLoading && !candles && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div className="text-terminal-text-muted text-sm">Select a trading pair</div>
              <div className="text-terminal-text-muted text-xs mt-1">Use Cmd+K to search</div>
            </div>
          </div>
        )}
        {!isLoading && candles && candles.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center bg-terminal-bg/60">
            <div className="rounded-md border border-terminal-border bg-terminal-bg-secondary/90 px-4 py-3 text-center shadow-lg">
              <div className="text-terminal-text-secondary text-sm">Chart provider is not connected yet.</div>
              <div className="text-terminal-text-muted text-xs mt-1">Live OHLCV will appear here when the feed is wired.</div>
            </div>
          </div>
        )}
        {/* SMA legend */}
        {candles && candles.length > 0 && (
          <div className="absolute top-1 left-2 flex gap-3 text-[10px] font-mono z-10 pointer-events-none">
            <span className="text-amber-400">SMA 20</span>
            <span className="text-violet-400">SMA 50</span>
          </div>
        )}
      </div>
    </div>
  )
}
