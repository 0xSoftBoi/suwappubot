'use client'

import { useEffect, useRef } from 'react'
import { useInView, useMotionValue, animate } from 'framer-motion'

interface AnimatedCounterProps {
  value: string
  label: string
}

function parseValue(value: string): { prefix: string; number: number; suffix: string; decimals: number } {
  const match = value.match(/^([<>]?)(\d+(?:\.\d+)?)(.*)$/)
  if (!match) return { prefix: '', number: 0, suffix: value, decimals: 0 }
  const numStr = match[2]
  const decimals = numStr.includes('.') ? numStr.split('.')[1].length : 0
  return {
    prefix: match[1],
    number: parseFloat(numStr),
    suffix: match[3],
    decimals,
  }
}

export default function AnimatedCounter({ value, label }: AnimatedCounterProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const isInView = useInView(ref, { once: true, margin: '-50px' })
  const motionValue = useMotionValue(0)
  const { prefix, number, suffix, decimals } = parseValue(value)

  useEffect(() => {
    if (!isInView) return

    const controls = animate(motionValue, number, {
      duration: 2,
      ease: 'easeOut',
      onUpdate: (latest) => {
        if (ref.current) {
          ref.current.textContent = `${prefix}${decimals > 0 ? latest.toFixed(decimals) : Math.round(latest)}${suffix}`
        }
      },
    })

    return controls.stop
  }, [isInView, motionValue, number, prefix, suffix, decimals])

  return (
    <div className="text-center">
      <span ref={ref} className="block text-4xl font-bold font-heading gradient-text">
        {`${prefix}0${suffix}`}
      </span>
      <span className="block mt-1 text-sm font-body text-suwappu-text-secondary">{label}</span>
    </div>
  )
}
