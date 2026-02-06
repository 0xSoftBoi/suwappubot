'use client'

import { useRef } from 'react'
import { motion, useInView } from 'framer-motion'
import { timelineStep, connectorLine } from '@/lib/animations'
import ChatSimulation from '@/components/ui/ChatSimulation'

const steps = [
  {
    number: 1,
    title: 'Connect',
    description: 'Start a chat with @SuwappuBot on Telegram or WhatsApp. Your secure wallet is created instantly.',
    icon: (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
    ),
  },
  {
    number: 2,
    title: 'Swap',
    description: 'Send a simple command like "/s 100 USDC ETH" and get instant quotes from multiple DEX aggregators.',
    icon: (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
      </svg>
    ),
  },
  {
    number: 3,
    title: 'Confirm',
    description: 'Review the quote and tap confirm. Your swap executes instantly with real-time status updates.',
    icon: (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
]

export default function HowItWorks() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: '-100px' })

  return (
    <section className="py-24 px-6 relative" id="how-it-works">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full opacity-10"
          style={{ background: 'radial-gradient(circle, #FFB7C5 0%, transparent 60%)' }}
        />
      </div>

      <div className="max-w-5xl mx-auto relative z-10" ref={ref}>
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <span className="inline-block px-4 py-1 rounded-full bg-suwappu-cyan/30 text-suwappu-navy text-sm font-medium mb-4">
            How It Works
          </span>
          <h2 className="font-heading text-3xl md:text-4xl lg:text-5xl font-bold text-suwappu-text mb-4">
            Three Steps to Trade
          </h2>
          <p className="font-body text-lg text-suwappu-text-secondary max-w-2xl mx-auto">
            No apps to download, no wallets to configure. Just start chatting.
          </p>
        </motion.div>

        {/* Timeline */}
        <div className="relative">
          {/* Desktop Timeline */}
          <div className="hidden md:flex items-start justify-between">
            {steps.map((step, index) => (
              <div key={step.number} className="flex flex-col items-center flex-1 relative">
                {/* Connector Line */}
                {index < steps.length - 1 && (
                  <motion.div
                    variants={connectorLine}
                    initial="hidden"
                    animate={isInView ? 'visible' : 'hidden'}
                    custom={index}
                    className="absolute top-12 left-1/2 w-full h-1 bg-gradient-to-r from-suwappu-sakura-mid to-suwappu-magenta-mid"
                    style={{ transformOrigin: 'left' }}
                  />
                )}

                {/* Step Circle */}
                <motion.div
                  variants={timelineStep}
                  initial="hidden"
                  animate={isInView ? 'visible' : 'hidden'}
                  custom={index}
                  className="relative z-10 w-24 h-24 rounded-full bg-suwappu-gradient flex items-center justify-center text-white shadow-suwappu-glow"
                >
                  {step.icon}
                </motion.div>

                {/* Step Content */}
                <motion.div
                  variants={timelineStep}
                  initial="hidden"
                  animate={isInView ? 'visible' : 'hidden'}
                  custom={index}
                  className="text-center mt-6 px-4"
                >
                  <span className="inline-block w-8 h-8 rounded-full bg-suwappu-sakura-light text-suwappu-magenta font-heading font-bold mb-2">
                    {step.number}
                  </span>
                  <h3 className="font-heading text-xl font-bold text-suwappu-text mb-2">
                    {step.title}
                  </h3>
                  <p className="font-body text-suwappu-text-secondary text-sm max-w-xs mx-auto">
                    {step.description}
                  </p>
                </motion.div>
              </div>
            ))}
          </div>

          {/* Mobile Timeline */}
          <div className="md:hidden space-y-8">
            {steps.map((step, index) => (
              <motion.div
                key={step.number}
                variants={timelineStep}
                initial="hidden"
                animate={isInView ? 'visible' : 'hidden'}
                custom={index}
                className="flex gap-4"
              >
                {/* Step Circle */}
                <div className="relative flex flex-col items-center">
                  <div className="w-16 h-16 rounded-full bg-suwappu-gradient flex items-center justify-center text-white shadow-suwappu-glow">
                    {step.icon}
                  </div>
                  {index < steps.length - 1 && (
                    <div className="w-0.5 flex-1 bg-gradient-to-b from-suwappu-sakura-mid to-suwappu-magenta-mid mt-4" />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 pb-8">
                  <span className="inline-block w-6 h-6 rounded-full bg-suwappu-sakura-light text-suwappu-magenta font-heading font-bold text-sm mb-1">
                    {step.number}
                  </span>
                  <h3 className="font-heading text-lg font-bold text-suwappu-text mb-1">
                    {step.title}
                  </h3>
                  <p className="font-body text-suwappu-text-secondary text-sm">
                    {step.description}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Example in Action */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.8 }}
          className="mt-16 text-center"
        >
          <p className="font-body text-suwappu-text-secondary mb-6">Example in action:</p>
          <ChatSimulation />
          <p className="font-body text-sm text-suwappu-text-secondary mt-6">
            Swap 100 USDC to ETH with the best available rate
          </p>
        </motion.div>
      </div>
    </section>
  )
}
