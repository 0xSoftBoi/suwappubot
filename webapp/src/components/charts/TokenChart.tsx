import { useRef, useEffect, useState } from 'react'
import {
  createChart,
  CandlestickSeries,
  type CandlestickData,
  type Time,
  type IChartApi,
  type ISeriesApi,
} from 'lightweight-charts'

const TIMEFRAMES = ['5m', '15m', '1h', '4h', '1d']

const THEMES = {
  light: {
    background: '#ffffff',
    textColor: '#64748b',
    grid: '#f1f5f9',
    border: '#e2e8f0',
  },
  dark: {
    background: '#0f172a',
    textColor: '#94a3b8',
    grid: '#1e293b',
    border: '#334155',
  },
}

function usePrefersDark(): boolean {
  const [dark, setDark] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
  )
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!mq) return
    const onChange = (e: MediaQueryListEvent) => setDark(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return dark
}

interface TokenChartProps {
  data: CandlestickData<Time>[]
  timeframe: string
  onTimeframeChange: (tf: string) => void
  height?: number
  /** true when the chain has no OHLCV source — distinct from a load failure. */
  unsupported?: boolean
}

export function TokenChart({
  data,
  timeframe,
  onTimeframeChange,
  height = 300,
  unsupported = false,
}: TokenChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const isDark = usePrefersDark()

  // Create the chart ONCE. Previously `data` was in this dependency array, so
  // every price update destroyed and rebuilt the whole chart — which threw away
  // the user's zoom/pan and made live updates impossible.
  useEffect(() => {
    if (!containerRef.current) return

    const chart = createChart(containerRef.current, {
      height,
      layout: { background: { color: 'transparent' }, textColor: '#64748b', fontSize: 11 },
      grid: { vertLines: { color: '#f1f5f9' }, horzLines: { color: '#f1f5f9' } },
      rightPriceScale: { borderColor: '#e2e8f0' },
      timeScale: { borderColor: '#e2e8f0', timeVisible: true },
    })

    seriesRef.current = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    })
    chartRef.current = chart

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth })
      }
    }
    window.addEventListener('resize', handleResize)
    handleResize()

    return () => {
      window.removeEventListener('resize', handleResize)
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
  }, [height])

  // Repaint on theme change without tearing the chart down.
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const t = isDark ? THEMES.dark : THEMES.light
    chart.applyOptions({
      layout: { background: { color: t.background }, textColor: t.textColor },
      grid: { vertLines: { color: t.grid }, horzLines: { color: t.grid } },
      rightPriceScale: { borderColor: t.border },
      timeScale: { borderColor: t.border, timeVisible: true },
    })
  }, [isDark])

  // Feed data separately so refreshes update the series in place.
  useEffect(() => {
    const series = seriesRef.current
    if (!series) return
    series.setData(data)
    if (data.length > 0) chartRef.current?.timeScale().fitContent()
  }, [data])

  const isEmpty = data.length === 0

  return (
    <div>
      <div className="flex gap-1 mb-2">
        {TIMEFRAMES.map(tf => (
          <button
            key={tf}
            onClick={() => onTimeframeChange(tf)}
            disabled={unsupported}
            className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
              timeframe === tf
                ? 'bg-suwappu-magenta-mid text-white'
                : 'text-suwappu-text-secondary hover:bg-suwappu-sakura-light'
            } ${unsupported ? 'opacity-40 cursor-not-allowed' : ''}`}
          >
            {tf}
          </button>
        ))}
      </div>
      <div ref={containerRef} style={isEmpty ? { display: 'none' } : undefined} />
      {isEmpty && (
        <div className="flex items-center justify-center px-4 text-center" style={{ height }}>
          <p className="text-sm text-suwappu-text-secondary">
            {unsupported
              ? 'Charts aren’t available on this chain yet.'
              : 'No chart data available for this token.'}
          </p>
        </div>
      )}
    </div>
  )
}
