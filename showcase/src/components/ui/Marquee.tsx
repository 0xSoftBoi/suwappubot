'use client'

import { useRef } from 'react'
import { motion, useInView } from 'framer-motion'

const chains = [
  { name: 'Ethereum', color: '#627EEA' },
  { name: 'BSC', color: '#F0B90B' },
  { name: 'Polygon', color: '#8247E5' },
  { name: 'Arbitrum', color: '#28A0F0' },
  { name: 'Optimism', color: '#FF0420' },
  { name: 'Base', color: '#0052FF' },
  { name: 'Solana', color: '#9945FF' },
]

const partners = [
  { name: 'Li.Fi', color: '#B57BFF' },
  { name: 'Jupiter', color: '#C7F284' },
  { name: 'Turnkey', color: '#00D4AA' },
]

const items = [
  ...chains.map((c) => ({ ...c, type: 'chain' as const })),
  ...partners.map((p) => ({ ...p, type: 'partner' as const })),
]

function MarqueeRow({ reverse = false }: { reverse?: boolean }) {
  return (
    <div className="flex overflow-hidden">
      <div
        className={`flex shrink-0 items-center gap-8 ${
          reverse ? 'animate-marquee-reverse' : 'animate-marquee'
        }`}
      >
        {/* Duplicate items for seamless loop */}
        {[...items, ...items].map((item, i) => (
          <div
            key={`${item.name}-${i}`}
            className="group flex items-center gap-3 px-5 py-2.5 rounded-full bg-white border border-suwappu-sakura-light/30 hover:border-suwappu-sakura-mid/50 transition-all duration-300 cursor-default"
          >
            <span
              className="w-3 h-3 rounded-full shrink-0 transition-transform duration-300 group-hover:scale-125"
              style={{ backgroundColor: item.color }}
            />
            <span className="font-heading text-sm font-medium text-suwappu-text-secondary group-hover:text-suwappu-text transition-colors whitespace-nowrap">
              {item.name}
            </span>
            {item.type === 'partner' && (
              <span className="text-[10px] font-heading uppercase tracking-wider text-suwappu-magenta/60 bg-suwappu-sakura-light/40 px-1.5 py-0.5 rounded">
                Partner
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Marquee() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: '-50px' })

  return (
    <section ref={ref} className="py-10 bg-suwappu-cream overflow-hidden">
      <motion.div
        initial={{ opacity: 0 }}
        animate={isInView ? { opacity: 1 } : {}}
        transition={{ duration: 0.8 }}
      >
        <p className="text-center font-heading text-sm font-medium text-suwappu-text-secondary uppercase tracking-wider mb-6">
          Supported Chains &amp; Partners
        </p>
        <div className="space-y-4">
          <MarqueeRow />
          <MarqueeRow reverse />
        </div>
      </motion.div>
    </section>
  )
}
