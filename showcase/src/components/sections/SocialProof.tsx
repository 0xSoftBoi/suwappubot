'use client'

import { useRef, useState, useEffect, useCallback } from 'react'
import { motion, useInView, AnimatePresence } from 'framer-motion'

const testimonials = [
  {
    quote: 'Suwappu makes cross-chain swaps feel effortless. I just type a command and it finds the best rate across every DEX. Game changer.',
    name: 'Alex K.',
    role: 'DeFi Trader',
  },
  {
    quote: 'The speed is unreal. Quote in under a second, swap confirmed in seconds. And I never have to leave Telegram.',
    name: 'Maria S.',
    role: 'Crypto Enthusiast',
  },
  {
    quote: 'Non-custodial and works on 7 chains? I moved all my trading to Suwappu. The TEE wallet security gives me real peace of mind.',
    name: 'David L.',
    role: 'Portfolio Manager',
  },
]

export default function SocialProof() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: '-100px' })
  const [current, setCurrent] = useState(0)
  const [paused, setPaused] = useState(false)

  const next = useCallback(() => {
    setCurrent((prev) => (prev + 1) % testimonials.length)
  }, [])

  // Auto-rotate every 5 seconds
  useEffect(() => {
    if (paused) return
    const timer = setInterval(next, 5000)
    return () => clearInterval(timer)
  }, [paused, next])

  return (
    <section className="py-24 px-6 bg-suwappu-cream" id="social-proof" ref={ref}>
      <div className="max-w-3xl mx-auto relative z-10">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-12"
        >
          <span className="inline-block px-4 py-1 rounded-full bg-suwappu-sakura-light/50 text-suwappu-magenta text-sm font-medium mb-4">
            Community
          </span>
          <h2 className="font-heading text-3xl md:text-4xl lg:text-5xl font-bold text-suwappu-text mb-4">
            Trusted by Traders
          </h2>
        </motion.div>

        {/* Testimonial Carousel */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="relative"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          <div className="overflow-hidden rounded-2xl bg-white p-8 md:p-12 border border-suwappu-sakura-light/30 min-h-[260px] flex items-center">
            <AnimatePresence mode="wait">
              <motion.div
                key={current}
                initial={{ opacity: 0, x: 30 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -30 }}
                transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                className="text-center w-full"
              >
                {/* Quote */}
                <div className="text-3xl text-suwappu-magenta/20 font-heading leading-none mb-4">
                  &ldquo;
                </div>
                <p className="font-body text-lg md:text-xl text-suwappu-text leading-relaxed mb-6">
                  {testimonials[current].quote}
                </p>
                <div>
                  <div className="font-heading font-semibold text-suwappu-text">
                    {testimonials[current].name}
                  </div>
                  <div className="font-body text-sm text-suwappu-text-secondary">
                    {testimonials[current].role}
                  </div>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Dot Indicators */}
          <div className="flex justify-center gap-2 mt-6">
            {testimonials.map((_, index) => (
              <button
                key={index}
                onClick={() => setCurrent(index)}
                className={`w-2.5 h-2.5 rounded-full transition-all duration-300 ${
                  index === current
                    ? 'bg-suwappu-magenta w-8'
                    : 'bg-suwappu-sakura-mid/40 hover:bg-suwappu-sakura-mid'
                }`}
                aria-label={`Go to testimonial ${index + 1}`}
              />
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  )
}
