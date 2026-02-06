'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { useInView } from 'framer-motion'
import { useRef, useState } from 'react'
import { staggerContainer, staggerItem } from '@/lib/animations'

const faqs = [
  {
    question: 'Is Suwappu non-custodial?',
    answer: 'Yes. Your private keys are secured in TEE-backed wallets powered by Turnkey. Only you can authorize transactions.',
  },
  {
    question: 'What chains are supported?',
    answer: 'Ethereum, BSC, Polygon, Arbitrum, Optimism, Base, and Solana. More chains coming soon.',
  },
  {
    question: 'How do swaps work?',
    answer: 'We aggregate quotes from Li.Fi and Jupiter to find the best rates across DEXs. Just send /s [amount] [token] [token] and confirm.',
  },
  {
    question: 'What are the fees?',
    answer: 'A flat 0.3% fee on swaps. No hidden charges, no subscription fees.',
  },
  {
    question: 'Do I need to download anything?',
    answer: 'No. Suwappu works natively in Telegram and WhatsApp. Just message @SuwappuBot to start.',
  },
  {
    question: 'How fast are swaps?',
    answer: 'Quote generation is under 1 second. Execution time depends on the blockchain, typically 5-30 seconds.',
  },
]

function FAQItem({ question, answer, isOpen, onToggle, index }: {
  question: string
  answer: string
  isOpen: boolean
  onToggle: () => void
  index: number
}) {
  return (
    <motion.div
      variants={staggerItem}
      custom={index}
      className="glass-card rounded-suwappu-xl overflow-hidden"
    >
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-6 text-left cursor-pointer"
      >
        <span className="font-heading text-lg font-semibold text-suwappu-text pr-4">
          {question}
        </span>
        <motion.span
          animate={{ rotate: isOpen ? 45 : 0 }}
          transition={{ duration: 0.2 }}
          className="flex-shrink-0 w-8 h-8 rounded-full bg-suwappu-gradient flex items-center justify-center text-white"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="px-6 pb-6">
              <p className="font-body text-suwappu-text-secondary leading-relaxed">
                {answer}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

export default function FAQ() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: '-100px' })
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  return (
    <section className="py-24 px-6 relative" id="faq">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute top-1/3 left-1/4 w-80 h-80 rounded-full opacity-15"
          style={{ background: 'radial-gradient(circle, #6C3483 0%, transparent 70%)' }}
        />
        <div
          className="absolute bottom-1/4 right-1/3 w-72 h-72 rounded-full opacity-10"
          style={{ background: 'radial-gradient(circle, #FFB7C5 0%, transparent 70%)' }}
        />
      </div>

      <div className="max-w-3xl mx-auto relative z-10" ref={ref}>
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <span className="inline-block px-4 py-1 rounded-full bg-suwappu-sakura-light/50 text-suwappu-magenta text-sm font-medium mb-4">
            FAQ
          </span>
          <h2 className="font-heading text-3xl md:text-4xl lg:text-5xl font-bold text-suwappu-text mb-4">
            Frequently Asked Questions
          </h2>
          <p className="font-body text-lg text-suwappu-text-secondary max-w-2xl mx-auto">
            Everything you need to know about trading with Suwappu
          </p>
        </motion.div>

        {/* Accordion */}
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate={isInView ? 'visible' : 'hidden'}
          className="space-y-4"
        >
          {faqs.map((faq, index) => (
            <FAQItem
              key={faq.question}
              question={faq.question}
              answer={faq.answer}
              isOpen={openIndex === index}
              onToggle={() => setOpenIndex(openIndex === index ? null : index)}
              index={index}
            />
          ))}
        </motion.div>
      </div>
    </section>
  )
}
