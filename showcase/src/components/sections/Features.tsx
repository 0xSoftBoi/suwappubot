'use client'

import { useRef } from 'react'
import { motion, useScroll, useTransform, MotionValue } from 'framer-motion'

const features = [
  {
    title: 'Cross-Chain Swaps',
    description: 'Seamlessly swap tokens across 7+ blockchains with best-rate aggregation powered by Li.Fi and Jupiter.',
    icon: (
      <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
      </svg>
    ),
    stat: '7+ Chains',
    bg: 'bg-white',
  },
  {
    title: 'Non-Custodial Security',
    description: 'Your keys, your crypto. TEE-backed wallets with Turnkey ensure only you control your funds. No KYC required.',
    icon: (
      <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
      </svg>
    ),
    stat: '100% Non-Custodial',
    bg: 'bg-suwappu-cream',
  },
  {
    title: 'Chat-Native Trading',
    description: 'Trade from Telegram, WhatsApp, or our mobile app. Simple commands like /s 100 USDC ETH get the job done.',
    icon: (
      <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
    ),
    stat: '3 Platforms',
    bg: 'bg-white',
  },
  {
    title: 'Instant Execution',
    description: 'Sub-second quote generation with real-time price updates. Confirm and your swap is on-chain instantly.',
    icon: (
      <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
    stat: '< 1s Quotes',
    bg: 'bg-suwappu-cream',
  },
]

function FeaturePanel({
  feature,
  index,
  progress,
}: {
  feature: (typeof features)[number]
  index: number
  progress: MotionValue<number>
}) {
  const total = features.length
  const segmentSize = 1 / total
  const start = index * segmentSize
  const end = start + segmentSize

  const opacity = useTransform(progress, [start, start + segmentSize * 0.15, end - segmentSize * 0.15, end], [0, 1, 1, 0])
  const y = useTransform(progress, [start, start + segmentSize * 0.2, end - segmentSize * 0.2, end], [60, 0, 0, -30])

  return (
    <motion.div
      style={{ opacity, y }}
      className="absolute inset-0 flex items-center"
    >
      <div className="max-w-5xl mx-auto px-6 w-full">
        <div className="grid md:grid-cols-2 gap-12 items-center">
          {/* Text */}
          <div className={index % 2 === 0 ? 'order-1' : 'order-1 md:order-2'}>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-suwappu-sakura-light/50 text-suwappu-magenta text-sm font-medium mb-4">
              <span className="w-1.5 h-1.5 rounded-full bg-suwappu-magenta" />
              Feature {index + 1} of {total}
            </div>
            <h3 className="font-heading text-3xl md:text-4xl font-bold text-suwappu-text mb-4">
              {feature.title}
            </h3>
            <p className="font-body text-lg text-suwappu-text-secondary leading-relaxed mb-6">
              {feature.description}
            </p>
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-suwappu-gradient text-white font-heading font-semibold text-sm">
              {feature.stat}
            </div>
          </div>

          {/* Visual */}
          <div className={index % 2 === 0 ? 'order-2' : 'order-2 md:order-1'}>
            <div className="relative w-full aspect-square max-w-sm mx-auto">
              <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-suwappu-sakura-light/40 to-suwappu-cream-mid/60 flex items-center justify-center">
                <div className="w-24 h-24 rounded-2xl bg-suwappu-gradient flex items-center justify-center text-white shadow-suwappu-glow">
                  {feature.icon}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

export default function Features() {
  const containerRef = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ['start start', 'end end'],
  })

  return (
    <section id="features">
      {/* Section Header */}
      <div className="py-16 px-6 text-center bg-suwappu-surface">
        <span className="inline-block px-4 py-1 rounded-full bg-suwappu-sakura-light/50 text-suwappu-magenta text-sm font-medium mb-4">
          Features
        </span>
        <h2 className="font-heading text-3xl md:text-4xl lg:text-5xl font-bold text-suwappu-text mb-4">
          Everything You Need to Trade
        </h2>
        <p className="font-body text-lg text-suwappu-text-secondary max-w-2xl mx-auto">
          Powerful features, simple interface. Trade smarter, not harder.
        </p>
      </div>

      {/* Sticky scroll container */}
      <div ref={containerRef} className="relative" style={{ height: `${features.length * 100}vh` }}>
        <div className="sticky top-0 h-screen overflow-hidden">
          {features.map((feature, index) => (
            <FeaturePanel
              key={feature.title}
              feature={feature}
              index={index}
              progress={scrollYProgress}
            />
          ))}

          {/* Progress dots */}
          <div className="absolute right-6 top-1/2 -translate-y-1/2 flex flex-col gap-3 z-20">
            {features.map((_, index) => (
              <ProgressDot key={index} index={index} progress={scrollYProgress} />
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function ProgressDot({
  index,
  progress,
}: {
  index: number
  progress: MotionValue<number>
}) {
  const total = features.length
  const segmentSize = 1 / total
  const start = index * segmentSize
  const mid = start + segmentSize * 0.5

  const scale = useTransform(progress, [start, mid, start + segmentSize], [1, 1.5, 1])
  const bgOpacity = useTransform(progress, [start, mid, start + segmentSize], [0.3, 1, 0.3])

  return (
    <motion.div
      style={{ scale }}
      className="w-2.5 h-2.5 rounded-full cursor-pointer"
    >
      <motion.div
        className="w-full h-full rounded-full bg-suwappu-magenta"
        style={{ opacity: bgOpacity }}
      />
    </motion.div>
  )
}
