import React, { useState, useEffect, useRef } from 'react'

export interface AnimatedNumberProps {
  value: number
  format?: 'currency' | 'percent' | 'token' | 'compact'
  decimals?: number
  prefix?: string
  suffix?: string
  colorChange?: boolean
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const DEFAULT_DECIMALS: Record<string, number> = {
  currency: 2,
  percent: 1,
  token: 6,
  compact: 2,
}

const SIZE_CLASSES = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-xl font-bold',
} as const

function formatNumber(val: number, format: string, decimals: number): string {
  switch (format) {
    case 'currency':
      return val.toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })
    case 'percent':
      return val.toFixed(decimals)
    case 'token':
      return parseFloat(val.toFixed(decimals)).toString()
    case 'compact':
      if (Math.abs(val) >= 1e9) return (val / 1e9).toFixed(1) + 'B'
      if (Math.abs(val) >= 1e6) return (val / 1e6).toFixed(1) + 'M'
      if (Math.abs(val) >= 1e3) return (val / 1e3).toFixed(1) + 'K'
      return val.toFixed(decimals)
    default:
      return val.toFixed(decimals)
  }
}

export const AnimatedNumber = React.memo(function AnimatedNumber({
  value,
  format = 'currency',
  decimals,
  prefix = '',
  suffix = '',
  colorChange = false,
  size = 'md',
  className = '',
}: AnimatedNumberProps) {
  const resolvedDecimals = decimals ?? DEFAULT_DECIMALS[format] ?? 2
  const prevValueRef = useRef(value)
  const [displayValue, setDisplayValue] = useState(value)
  const animationRef = useRef<number>()
  const [changeDirection, setChangeDirection] = useState<'up' | 'down' | null>(null)
  const colorTimeoutRef = useRef<ReturnType<typeof setTimeout>>()
  const hasReceivedValue = useRef(value !== 0)

  if (value !== 0) {
    hasReceivedValue.current = true
  }

  useEffect(() => {
    const from = prevValueRef.current
    const to = value
    prevValueRef.current = value

    if (from === to) return

    // Determine direction for color flash
    if (colorChange) {
      if (colorTimeoutRef.current) clearTimeout(colorTimeoutRef.current)
      setChangeDirection(to > from ? 'up' : 'down')
      colorTimeoutRef.current = setTimeout(() => {
        setChangeDirection(null)
      }, 300)
    }

    // Animate from old value to new value
    if (animationRef.current) cancelAnimationFrame(animationRef.current)

    const startTime = performance.now()
    const duration = 400

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime
      const progress = Math.min(elapsed / duration, 1)
      // ease-out: 1 - (1 - t)^3
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplayValue(from + (to - from) * eased)

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate)
      }
    }

    animationRef.current = requestAnimationFrame(animate)

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current)
    }
  }, [value, colorChange])

  // Cleanup color timeout on unmount
  useEffect(() => {
    return () => {
      if (colorTimeoutRef.current) clearTimeout(colorTimeoutRef.current)
    }
  }, [])

  // Loading / shimmer state: value is 0 and we never got a real value
  if (value === 0 && !hasReceivedValue.current) {
    return (
      <span
        className={`inline-block ${SIZE_CLASSES[size]} ${className}`}
      >
        <span className="suwappu-quote-shimmer inline-block h-[1em] w-16 rounded bg-suwappu-sakura-200/30 align-middle" />
      </span>
    )
  }

  const directionClass =
    changeDirection === 'up'
      ? 'suwappu-price-up text-green-500'
      : changeDirection === 'down'
        ? 'suwappu-price-down text-red-500'
        : ''

  const formatted = formatNumber(displayValue, format, resolvedDecimals)

  return (
    <span
      className={`inline-block tabular-nums transition-colors ${SIZE_CLASSES[size]} ${directionClass} ${className}`}
    >
      {prefix}
      {formatted}
      {suffix}
    </span>
  )
})
