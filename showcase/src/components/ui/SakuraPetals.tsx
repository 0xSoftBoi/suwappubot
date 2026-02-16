'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'

interface Petal {
  id: number
  x: number
  delay: number
  duration: number
  size: number
  rotation: number
}

export default function SakuraPetals({ count = 6 }: { count?: number }) {
  const [petals, setPetals] = useState<Petal[]>([])

  useEffect(() => {
    const newPetals: Petal[] = Array.from({ length: count }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      delay: Math.random() * 5,
      duration: 8 + Math.random() * 6,
      size: 6 + Math.random() * 5,
      rotation: Math.random() * 360,
    }))
    setPetals(newPetals)
  }, [count])

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
      {petals.map((petal) => (
        <motion.div
          key={petal.id}
          className="absolute"
          style={{
            left: `${petal.x}%`,
            top: '-20px',
            width: petal.size,
            height: petal.size,
          }}
          initial={{
            y: -20,
            x: 0,
            rotate: petal.rotation,
            opacity: 0,
          }}
          animate={{
            y: '110vh',
            x: [0, 30, -20, 40, 0],
            rotate: petal.rotation + 720,
            opacity: [0, 0.5, 0.5, 0.5, 0],
          }}
          transition={{
            duration: petal.duration,
            delay: petal.delay,
            repeat: Infinity,
            ease: 'linear',
            x: {
              duration: petal.duration,
              ease: 'easeInOut',
              repeat: Infinity,
            },
          }}
        >
          <svg
            viewBox="0 0 100 100"
            className="w-full h-full"
            style={{ filter: 'drop-shadow(0 1px 2px rgba(196, 69, 105, 0.3))' }}
          >
            <defs>
              <linearGradient id={`petal-gradient-${petal.id}`} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#FFD1DC" />
                <stop offset="50%" stopColor="#FFB7C5" />
                <stop offset="100%" stopColor="#F8A5C2" />
              </linearGradient>
            </defs>
            <path
              d="M50 0 C80 20 100 50 80 80 C60 100 40 100 20 80 C0 50 20 20 50 0"
              fill={`url(#petal-gradient-${petal.id})`}
            />
          </svg>
        </motion.div>
      ))}
    </div>
  )
}
