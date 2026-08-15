import { useRef, useEffect } from 'react'
import { createChart, LineSeries, type LineData, type Time, type IChartApi } from 'lightweight-charts'

interface MarketLineChartProps {
  data: LineData<Time>[]
  height?: number
  color?: string
}

/** Full-width line chart for funding/odds history detail views (lightweight-charts v5). */
export function MarketLineChart({ data, height = 220, color = '#a855f7' }: MarketLineChartProps) {
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

    const series = chart.addSeries(LineSeries, {
      color,
      lineWidth: 2,
      priceLineVisible: false,
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
  }, [data, height, color])

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center" style={{ height }}>
        <p className="text-sm text-suwappu-text-secondary">No history available yet</p>
      </div>
    )
  }

  return <div ref={containerRef} />
}
