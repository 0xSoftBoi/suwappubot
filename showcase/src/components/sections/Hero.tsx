'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, useInView, useMotionValue, animate } from 'framer-motion'
import { staggerContainer, staggerItem, buttonHover } from '@/lib/animations'

function SwapCounter() {
  const count = useMotionValue(0)
  const [display, setDisplay] = useState('0')
  const ref = useRef<HTMLDivElement>(null)
  const isInView = useInView(ref, { once: true })

  useEffect(() => {
    if (!isInView) return
    const controls = animate(count, 10000, {
      duration: 2,
      ease: 'easeOut',
      onUpdate: (v) => setDisplay(Math.floor(v).toLocaleString()),
    })
    return controls.stop
  }, [isInView, count])

  return (
    <div ref={ref} className="mt-6 text-sm text-suwappu-text-secondary font-medium">
      <span className="text-suwappu-purple font-bold text-base">{display}+</span>{' '}
      swaps executed
    </div>
  )
}

export default function Hero() {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
      {/* Animated Gradient Background */}
      <div className="absolute inset-0 animated-gradient opacity-15" />

      {/* Radial gradient overlay */}
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse at 50% 0%, rgba(255,248,240,0.5) 0%, transparent 50%), radial-gradient(ellipse at 100% 100%, rgba(108,52,131,0.15) 0%, transparent 50%)',
        }}
      />

      {/* Content */}
      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="relative z-10 max-w-6xl mx-auto px-6 pt-24 pb-20"
      >
        <div className="grid md:grid-cols-2 gap-12 items-center">
          {/* Left side - Text content */}
          <div className="text-left">
            {/* Live badge */}
            <motion.div variants={staggerItem} className="mb-6">
              <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/80 border border-suwappu-sakura-light/40 text-sm font-medium text-suwappu-purple">
                <span className="w-2 h-2 rounded-full bg-suwappu-success animate-pulse" />
                Live on 7+ Chains
              </span>
            </motion.div>

            {/* Main Headline */}
            <motion.h1
              variants={staggerItem}
              className="font-heading text-4xl md:text-5xl lg:text-6xl font-bold text-suwappu-text mb-4 leading-tight"
            >
              Swap Across Chains.{' '}
              <span className="gradient-text">From Any Chat.</span>
            </motion.h1>

            {/* Description */}
            <motion.p
              variants={staggerItem}
              className="font-body text-lg text-suwappu-text-secondary mb-8 max-w-lg leading-relaxed"
            >
              The fastest way to swap tokens across 7+ blockchains. Non-custodial,
              best-rate aggregation, and it works right inside Telegram.
            </motion.p>

            {/* CTA Buttons */}
            <motion.div
              variants={staggerItem}
              className="flex flex-wrap gap-4"
            >
              <motion.a
                href="https://t.me/SuwappuBot"
                target="_blank"
                rel="noopener noreferrer"
                variants={buttonHover}
                initial="rest"
                whileHover="hover"
                whileTap="tap"
                className="btn-suwappu inline-flex items-center gap-2 px-8 py-4 rounded-suwappu-pill bg-suwappu-gradient text-white font-heading font-semibold text-lg shadow-suwappu-button hover:shadow-suwappu-button-hover transition-shadow"
              >
                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/>
                </svg>
                Try on Telegram
              </motion.a>

              <motion.a
                href="#demos"
                variants={buttonHover}
                initial="rest"
                whileHover="hover"
                whileTap="tap"
                className="inline-flex items-center gap-2 px-8 py-4 rounded-suwappu-pill bg-white/80 border border-suwappu-sakura-light/40 font-heading font-semibold text-lg text-suwappu-purple hover:bg-white transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Watch Demo
              </motion.a>
            </motion.div>

            {/* Trust Badges */}
            <motion.div
              variants={staggerItem}
              className="flex flex-wrap gap-3 mt-6"
            >
              {[
                { icon: '\u{1F512}', label: 'Non-Custodial' },
                { icon: '\u26A1', label: 'Best Rates' },
                { icon: '\u{1F517}', label: '7+ Chains' },
              ].map((badge) => (
                <span
                  key={badge.label}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/60 border border-suwappu-sakura-light/30 text-xs font-medium text-suwappu-text-secondary"
                >
                  <span>{badge.icon}</span>
                  {badge.label}
                </span>
              ))}
            </motion.div>

            {/* Swap Counter */}
            <motion.div variants={staggerItem}>
              <SwapCounter />
            </motion.div>
          </div>

          {/* Right side - Phone frame with video */}
          <motion.div
            variants={staggerItem}
            className="flex justify-center md:justify-end"
          >
            <div className="relative">
              {/* Decorative glow behind phone */}
              <div
                className="absolute -inset-8 rounded-full blur-3xl opacity-30"
                style={{
                  background: 'radial-gradient(circle, rgba(106,27,154,0.3) 0%, rgba(255,183,197,0.2) 50%, transparent 70%)',
                }}
              />

              {/* Floating phone */}
              <motion.div
                animate={{ y: [0, -10, 0] }}
                transition={{ duration: 4, ease: 'easeInOut', repeat: Infinity }}
                className="relative"
              >
                <div className="phone-frame mx-auto" style={{ maxWidth: '300px' }}>
                  <div className="phone-screen relative aspect-[9/19.5]">
                    <video
                      autoPlay
                      muted
                      loop
                      playsInline
                      className="w-full h-full object-cover"
                    >
                      <source src="/videos/telegram-bot-demo.mp4" type="video/mp4" />
                    </video>
                  </div>
                </div>
              </motion.div>
            </div>
          </motion.div>
        </div>
      </motion.div>

      {/* Scroll Indicator */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.5, duration: 0.6 }}
        className="absolute bottom-8 left-1/2 -translate-x-1/2"
      >
        <motion.div
          animate={{ y: [0, 8, 0] }}
          transition={{ duration: 1.5, repeat: Infinity }}
          className="w-6 h-10 rounded-full border-2 border-suwappu-sakura-mid/50 flex justify-center pt-2"
        >
          <motion.div
            animate={{ opacity: [1, 0, 1] }}
            transition={{ duration: 1.5, repeat: Infinity }}
            className="w-1.5 h-1.5 rounded-full bg-suwappu-magenta"
          />
        </motion.div>
      </motion.div>
    </section>
  )
}
