import { useEffect, useRef } from 'react'
import { createChart, type LineData, type Time } from 'lightweight-charts'

interface MiniChartProps {
  data: LineData<Time>[]
  width?: number
  height?: number
  color?: string
}

export function MiniChart({ data, width = 80, height = 32, color }: MiniChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return

    const isPositive = data.length >= 2 && data[data.length - 1].value >= data[0].value
    const lineColor = color || (isPositive ? '#22c55e' : '#ef4444')

    const chart = createChart(containerRef.current, {
      width,
      height,
      layout: { background: { color: 'transparent' }, textColor: 'transparent' },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      timeScale: { visible: false },
      rightPriceScale: { visible: false },
      crosshair: {
        mode: 0,
        vertLine: { visible: false },
        horzLine: { visible: false },
      },
      handleScroll: false,
      handleScale: false,
    })

    const series = chart.addAreaSeries({
      lineColor,
      topColor: `${lineColor}33`,
      bottomColor: 'transparent',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    })

    series.setData(data)
    chart.timeScale().fitContent()

    return () => chart.remove()
  }, [data, width, height, color])

  return <div ref={containerRef} className="inline-block" />
}
