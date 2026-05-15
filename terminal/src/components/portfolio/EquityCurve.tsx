import { useRef, useEffect, useState } from 'react'
import { createChart, type IChartApi, type ISeriesApi, ColorType } from 'lightweight-charts'
import { usePortfolioHistory, type HistoryPeriod } from '../../hooks/usePortfolioHistory'

const PERIODS: { id: HistoryPeriod; label: string }[] = [
  { id: '24h', label: '24h' },
  { id: '7d', label: '7d' },
  { id: '30d', label: '30d' },
  { id: 'all', label: 'All' },
]

export function EquityCurve() {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const [period, setPeriod] = useState<HistoryPeriod>('30d')

  const { data } = usePortfolioHistory(period)

  // Initialize chart
  useEffect(() => {
    if (!containerRef.current) return

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#8888a0',
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 10,
      },
      grid: {
        vertLines: { color: '#1e1e30' },
        horzLines: { color: '#1e1e30' },
      },
      rightPriceScale: {
        borderColor: '#1e1e30',
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: '#1e1e30',
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        vertLine: { color: '#55556a', width: 1, style: 3 },
        horzLine: { color: '#55556a', width: 1, style: 3 },
      },
      handleScroll: { vertTouchDrag: false },
    })

    const series = chart.addLineSeries({
      color: '#E66D85',
      lineWidth: 2,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 3,
      priceLineVisible: false,
      lastValueVisible: true,
    })

    chartRef.current = chart
    seriesRef.current = series

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

  // Update data
  useEffect(() => {
    if (!seriesRef.current || !data.length) return
    seriesRef.current.setData(data)
    chartRef.current?.timeScale().fitContent()
  }, [data])

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1 px-3 py-1">
        {PERIODS.map(p => (
          <button
            key={p.id}
            onClick={() => setPeriod(p.id)}
            className={`terminal-tab text-xs ${period === p.id ? 'terminal-tab-active' : ''}`}
          >
            {p.label}
          </button>
        ))}
      </div>
      {data.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-sm text-terminal-text-muted">
          Portfolio history is not connected yet.
        </div>
      ) : (
        <div ref={containerRef} className="flex-1" />
      )}
    </div>
  )
}
