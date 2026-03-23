import { useRef, useEffect } from 'react'
import { createChart, type CandlestickData, type Time, type IChartApi } from 'lightweight-charts'

const TIMEFRAMES = ['5m', '15m', '1h', '4h', '1d']

interface TokenChartProps {
  data: CandlestickData<Time>[]
  timeframe: string
  onTimeframeChange: (tf: string) => void
  height?: number
}

export function TokenChart({ data, timeframe, onTimeframeChange, height = 300 }: TokenChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const chart = createChart(containerRef.current, {
      height,
      layout: {
        background: { color: '#ffffff' },
        textColor: '#64748b',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: '#f1f5f9' },
        horzLines: { color: '#f1f5f9' },
      },
      rightPriceScale: { borderColor: '#e2e8f0' },
      timeScale: { borderColor: '#e2e8f0', timeVisible: true },
    })

    const series = chart.addCandlestickSeries({
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    })

    if (data.length > 0) {
      series.setData(data)
      chart.timeScale().fitContent()
    }

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
    }
  }, [data, height])

  return (
    <div>
      <div className="flex gap-1 mb-2">
        {TIMEFRAMES.map(tf => (
          <button
            key={tf}
            onClick={() => onTimeframeChange(tf)}
            className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
              timeframe === tf
                ? 'bg-suwappu-magenta-mid text-white'
                : 'text-suwappu-text-secondary hover:bg-suwappu-sakura-light'
            }`}
          >
            {tf}
          </button>
        ))}
      </div>
      <div ref={containerRef} />
      {data.length === 0 && (
        <div className="flex items-center justify-center" style={{ height }}>
          <p className="text-sm text-suwappu-text-secondary">No chart data available</p>
        </div>
      )}
    </div>
  )
}
