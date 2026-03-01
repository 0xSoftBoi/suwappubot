import { useEffect, useRef } from 'react'
import { createChart, type IChartApi, type CandlestickData, type Time } from 'lightweight-charts'

interface TokenChartProps {
  data: CandlestickData<Time>[]
  timeframe: string
  onTimeframeChange: (tf: string) => void
  height?: number
}

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d']

export function TokenChart({ data, timeframe, onTimeframeChange, height = 400 }: TokenChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)

  useEffect(() => {
    if (!chartContainerRef.current) return

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: 'transparent' },
        textColor: '#9ca3af',
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.05)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.05)' },
      },
      width: chartContainerRef.current.clientWidth,
      height,
      timeScale: { timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
    })

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderDownColor: '#ef4444',
      borderUpColor: '#22c55e',
      wickDownColor: '#ef4444',
      wickUpColor: '#22c55e',
    })

    if (data.length > 0) {
      candleSeries.setData(data)
      chart.timeScale().fitContent()
    }

    chartRef.current = chart

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth })
      }
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      chart.remove()
    }
  }, [data, height])

  return (
    <div>
      <div className="flex gap-1 mb-2 px-2">
        {TIMEFRAMES.map(tf => (
          <button
            key={tf}
            onClick={() => onTimeframeChange(tf)}
            className={`px-2 py-1 text-xs rounded ${
              timeframe === tf
                ? 'bg-suwappu-magenta-mid text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            {tf}
          </button>
        ))}
      </div>
      <div ref={chartContainerRef} />
    </div>
  )
}
