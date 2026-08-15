import { useEffect, useRef } from 'react'
import { createChart, type IChartApi, type ISeriesApi, type UTCTimestamp, ColorType, LineStyle } from 'lightweight-charts'
import { TerminalSkeleton } from '../foundation'

// Same institutional dark register as CandleChartCore — lightweight-charts
// draws to <canvas>, so literal colors (not CSS vars) are required.
const ACCENT = '#E58D2B'
const AXIS_TEXT = '#9BA1AB'
const GRID = 'rgba(236, 237, 239, 0.06)'
const BORDER = 'rgba(236, 237, 239, 0.13)'

export interface MiniLinePoint {
  time: UTCTimestamp
  value: number
}

interface Props {
  data: MiniLinePoint[] | undefined
  isLoading: boolean
  emptyLabel?: string
  formatValue?: (value: number) => string
}

// A lightweight, chrome-free line chart for single-series histories (perp
// funding rate over time, prediction-market odds over time). Deliberately
// simpler than CandleChartCore — no OHLC readout, no volume, no SMAs.
export function MiniLineChart({ data, isLoading, emptyLabel = 'No history yet.', formatValue }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Line'> | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: AXIS_TEXT,
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 10,
      },
      grid: {
        vertLines: { color: GRID, style: LineStyle.Solid },
        horzLines: { color: GRID, style: LineStyle.Solid },
      },
      rightPriceScale: {
        borderColor: BORDER,
        scaleMargins: { top: 0.15, bottom: 0.15 },
      },
      timeScale: { borderColor: BORDER, timeVisible: true, secondsVisible: false },
      handleScroll: { vertTouchDrag: false },
    })
    chartRef.current = chart

    const series = chart.addLineSeries({
      color: ACCENT,
      lineWidth: 2,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 3,
      priceFormat: formatValue ? { type: 'custom', formatter: formatValue, minMove: 0.0001 } : undefined,
    })
    seriesRef.current = series

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!data || !seriesRef.current) return
    seriesRef.current.setData(data)
    chartRef.current?.timeScale().fitContent()
  }, [data])

  return (
    <div className="hairline relative h-full min-h-[160px] w-full overflow-hidden rounded-[10px] bg-terminal-bg">
      <div ref={containerRef} className="h-full w-full" />
      {isLoading && (
        <div className="absolute inset-0 flex items-end justify-center gap-1 px-6 pb-4" aria-hidden="true">
          {Array.from({ length: 16 }).map((_, i) => (
            <TerminalSkeleton key={i} width={6} height={10 + ((i * 29) % 40)} radius="control" />
          ))}
        </div>
      )}
      {!isLoading && data && data.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-xs text-terminal-text-muted">{emptyLabel}</div>
        </div>
      )}
    </div>
  )
}
