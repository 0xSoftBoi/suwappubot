import { useRef, useEffect } from 'react'
import { createChart, type LineData, type Time, type IChartApi } from 'lightweight-charts'

interface MiniChartProps {
  data: LineData<Time>[]
  width?: number
  height?: number
}

export function MiniChart({ data, width = 80, height = 32 }: MiniChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)

  useEffect(() => {
    if (!containerRef.current || data.length < 2) return

    const isUp = data[data.length - 1].value >= data[0].value
    const color = isUp ? '#22c55e' : '#ef4444'

    const chart = createChart(containerRef.current, {
      width,
      height,
      layout: { background: { color: 'transparent' }, textColor: 'transparent' },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      crosshair: { mode: 0 },
      rightPriceScale: { visible: false },
      timeScale: { visible: false },
      handleScroll: false,
      handleScale: false,
    })

    const series = chart.addLineSeries({
      color,
      lineWidth: 1.5,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    })

    series.setData(data)
    chart.timeScale().fitContent()
    chartRef.current = chart

    return () => {
      chart.remove()
      chartRef.current = null
    }
  }, [data, width, height])

  if (data.length < 2) {
    return <div style={{ width, height }} className="bg-suwappu-sakura-light/30 rounded" />
  }

  return <div ref={containerRef} style={{ width, height }} />
}
