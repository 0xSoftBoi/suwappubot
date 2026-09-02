import { useRef, useEffect, useState } from 'react'
import { createChart, type IChartApi, type ISeriesApi, ColorType } from 'lightweight-charts'
import { usePortfolioHistory, type HistoryPeriod } from '../../hooks/usePortfolioHistory'
import { TerminalSkeleton } from '../foundation'
import { designTokens } from '@suwappu/design-tokens'

const PERIODS: { id: HistoryPeriod; label: string }[] = [
  { id: '24h', label: '24h' },
  { id: '7d', label: '7d' },
  { id: '30d', label: '30d' },
  { id: 'all', label: 'All' },
]

const summer = designTokens.colors.surface.summerBreeze

export function EquityCurve() {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const [period, setPeriod] = useState<HistoryPeriod>('30d')

  const { data, isLoading, isError, refetch } = usePortfolioHistory(period)

  // Initialize chart
  useEffect(() => {
    if (!containerRef.current) return

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: summer.muted,
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 10,
      },
      grid: {
        vertLines: { color: 'rgba(119, 191, 208, 0.22)' },
        horzLines: { color: 'rgba(119, 191, 208, 0.22)' },
      },
      rightPriceScale: {
        borderColor: summer.border,
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: summer.border,
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        vertLine: { color: summer.borderActive, width: 1, style: 3 },
        horzLine: { color: summer.borderActive, width: 1, style: 3 },
      },
      handleScroll: { vertTouchDrag: false },
    })

    const series = chart.addLineSeries({
      color: summer.accent,
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
      <div className="relative flex-1">
        <div ref={containerRef} className="absolute inset-0" />
        {isLoading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <TerminalSkeleton width={200} height={18} label="Loading portfolio history" />
          </div>
        ) : isError ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-sm text-terminal-text-muted">
            <span>Couldn't load history</span>
            <button
              type="button"
              onClick={() => refetch()}
              className="text-xs text-bear underline decoration-dotted"
            >
              Retry
            </button>
          </div>
        ) : data.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-terminal-text-muted">
            No history yet. Snapshots start after your first sign-in and accrue every 15 minutes.
          </div>
        ) : null}
      </div>
    </div>
  )
}
