'use client'

import { motion } from 'framer-motion'
import { useInView } from 'framer-motion'
import { useRef, useEffect, useState } from 'react'
import { staggerContainer, staggerItem, cardHover } from '@/lib/animations'

function AnimatedCounter({ end, suffix = '', prefix = '' }: { end: number; suffix?: string; prefix?: string }) {
  const [count, setCount] = useState(0)
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true })

  useEffect(() => {
    if (!isInView) return
    let startTime: number | null = null
    const duration = 2000

    function animate(currentTime: number) {
      if (!startTime) startTime = currentTime
      const elapsed = currentTime - startTime
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setCount(Math.floor(eased * end))
      if (progress < 1) requestAnimationFrame(animate)
    }

    requestAnimationFrame(animate)
  }, [isInView, end])

  return (
    <span ref={ref}>
      {prefix}{count.toLocaleString()}{suffix}
    </span>
  )
}

const metrics = [
  {
    label: 'Total Swaps',
    end: 10000,
    suffix: '+',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
      </svg>
    ),
  },
  {
    label: 'Volume',
    end: 5,
    prefix: '$',
    suffix: 'M+',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    label: 'Active Users',
    end: 2500,
    suffix: '+',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    label: 'Chains',
    end: 7,
    suffix: '+',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
      </svg>
    ),
  },
]

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

const partners = [
  { name: 'Li.Fi', gradient: 'from-purple-500 to-pink-500' },
  { name: 'Jupiter', gradient: 'from-green-400 to-teal-500' },
  { name: 'Turnkey', gradient: 'from-blue-500 to-indigo-500' },
]

export default function SocialProof() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: '-100px' })

  return (
    <section className="py-24 px-6 relative" id="social-proof">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute top-1/4 right-0 w-96 h-96 rounded-full opacity-15"
          style={{ background: 'radial-gradient(circle, #FFB7C5 0%, transparent 70%)' }}
        />
        <div
          className="absolute bottom-1/4 left-0 w-96 h-96 rounded-full opacity-15"
          style={{ background: 'radial-gradient(circle, #6C3483 0%, transparent 70%)' }}
        />
      </div>

      <div className="max-w-6xl mx-auto relative z-10" ref={ref}>
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <span className="inline-block px-4 py-1 rounded-full bg-suwappu-sakura-light/50 text-suwappu-magenta text-sm font-medium mb-4">
            Community
          </span>
          <h2 className="font-heading text-3xl md:text-4xl lg:text-5xl font-bold text-suwappu-text mb-4">
            Trusted by Traders Worldwide
          </h2>
        </motion.div>

        {/* Key Metrics */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6 mb-20"
        >
          {metrics.map((metric) => (
            <div key={metric.label} className="glass-card rounded-suwappu-xl p-6 text-center">
              <div className="w-12 h-12 rounded-suwappu-lg bg-suwappu-gradient flex items-center justify-center text-white mx-auto mb-3">
                {metric.icon}
              </div>
              <div className="font-heading text-3xl md:text-4xl font-bold gradient-text mb-1">
                <AnimatedCounter end={metric.end} suffix={metric.suffix} prefix={metric.prefix} />
              </div>
              <div className="font-body text-sm text-suwappu-text-secondary">
                {metric.label}
              </div>
            </div>
          ))}
        </motion.div>

        {/* Testimonials */}
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate={isInView ? 'visible' : 'hidden'}
          className="mb-20"
        >
          <div className="flex gap-6 overflow-x-auto pb-4 md:grid md:grid-cols-3 md:overflow-visible md:pb-0">
            {testimonials.map((testimonial, index) => (
              <motion.div
                key={testimonial.name}
                variants={staggerItem}
                custom={index}
                className="min-w-[300px] md:min-w-0"
              >
                <motion.div
                  variants={cardHover}
                  initial="rest"
                  whileHover="hover"
                  className="h-full p-6 rounded-suwappu-xl glass-card"
                >
                  {/* Quote mark */}
                  <div className="text-4xl text-suwappu-magenta/30 font-display leading-none mb-2">
                    &ldquo;
                  </div>
                  <p className="font-body text-suwappu-text-secondary mb-6 leading-relaxed">
                    {testimonial.quote}
                  </p>
                  <div>
                    <div className="font-heading font-semibold text-suwappu-text">
                      {testimonial.name}
                    </div>
                    <div className="font-body text-sm text-suwappu-text-secondary">
                      {testimonial.role}
                    </div>
                  </div>
                </motion.div>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Partner Logos */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="text-center"
        >
          <p className="font-body text-sm text-suwappu-text-secondary uppercase tracking-wider mb-8">
            Powered By
          </p>
          <div className="flex items-center justify-center gap-10 md:gap-16">
            {partners.map((partner) => (
              <div
                key={partner.name}
                className="group cursor-default"
              >
                <span
                  className={`font-heading text-2xl md:text-3xl font-bold transition-all duration-300 filter grayscale group-hover:grayscale-0 bg-gradient-to-r ${partner.gradient} bg-clip-text text-transparent opacity-50 group-hover:opacity-100`}
                >
                  {partner.name}
                </span>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  )
}
