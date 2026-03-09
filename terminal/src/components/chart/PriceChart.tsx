import { useRef, useEffect, useState, useCallback } from 'react'
import { createChart, type IChartApi, type ISeriesApi, ColorType } from 'lightweight-charts'
import { ChartToolbar } from './ChartToolbar'
import { useChartData } from '../../hooks/useChartData'

const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1D'] as const
type Interval = typeof INTERVALS[number]

export function PriceChart() {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null)

  const [interval, setInterval] = useState<Interval>('1h')
  const [chartType, setChartType] = useState<'candle' | 'line'>('candle')

  // TODO: Get pair from context/header selection
  const { data: candles, isLoading } = useChartData(
    '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
    'ethereum',
    interval
  )

  // Initialize chart
  useEffect(() => {
    if (!containerRef.current) return

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#8888a0',
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: '#1e1e30' },
        horzLines: { color: '#1e1e30' },
      },
      crosshair: {
        vertLine: { color: '#55556a', width: 1, style: 3 },
        horzLine: { color: '#55556a', width: 1, style: 3 },
      },
      rightPriceScale: {
        borderColor: '#1e1e30',
        scaleMargins: { top: 0.1, bottom: 0.25 },
      },
      timeScale: {
        borderColor: '#1e1e30',
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

    // Volume histogram
    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    })
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    })
    volumeSeriesRef.current = volumeSeries

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

  // Update data when candles change
  useEffect(() => {
    if (!candles || !candleSeriesRef.current || !volumeSeriesRef.current) return

    const candleData = candles.map(c => ({
      time: c.time as number,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }))

    const volumeData = candles.map(c => ({
      time: c.time as number,
      value: c.volume,
      color: c.close >= c.open ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)',
    }))

    candleSeriesRef.current.setData(candleData)
    volumeSeriesRef.current.setData(volumeData)

    // Fit content
    chartRef.current?.timeScale().fitContent()
  }, [candles])

  // Keyboard shortcuts for intervals
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      const key = e.key
      if (key === '1') setInterval('1m')
      else if (key === '2') setInterval('5m')
      else if (key === '3') setInterval('15m')
      else if (key === '4') setInterval('1h')
      else if (key === '5') setInterval('4h')
      else if (key === '6') setInterval('1D')
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  const handleIntervalChange = useCallback((i: string) => {
    setInterval(i as Interval)
  }, [])

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
            <div className="text-terminal-text-muted text-sm animate-pulse">Loading chart...</div>
          </div>
        )}
        {!isLoading && !candles && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div className="text-terminal-text-muted text-sm">Select a trading pair</div>
              <div className="text-terminal-text-muted text-xs mt-1">Use ⌘K to search</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
