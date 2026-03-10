interface SparklineProps {
  data: number[]
  width?: number
  height?: number
  className?: string
}

export function Sparkline({ data, width = 50, height = 20, className = '' }: SparklineProps) {
  if (!data || data.length < 2) return null

  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1

  const points = data.map((val, i) => {
    const x = (i / (data.length - 1)) * width
    const y = height - ((val - min) / range) * (height - 2) - 1
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })

  const polylinePoints = points.join(' ')

  // Fill area under the line
  const fillPoints = `0,${height} ${polylinePoints} ${width},${height}`

  const isUp = data[data.length - 1] >= data[0]
  const strokeColor = isUp ? '#22c55e' : '#ef4444'
  const fillColor = isUp ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)'

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={`shrink-0 ${className}`}
      aria-hidden="true"
    >
      <polygon
        points={fillPoints}
        fill={fillColor}
      />
      <polyline
        points={polylinePoints}
        fill="none"
        stroke={strokeColor}
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
