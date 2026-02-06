'use client'

import { useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useInView } from 'framer-motion'
import VideoPlayer from '@/components/ui/VideoPlayer'
import { tabContent } from '@/lib/animations'

const platforms = [
  {
    id: 'telegram-bot',
    name: 'Telegram Bot',
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/>
      </svg>
    ),
    description: 'Quick commands, inline keyboards, instant confirmations',
    video: '/videos/telegram-bot-demo.mp4',
    poster: '/images/telegram-poster.jpg',
    features: [
      'Simple /s command for swaps',
      'Inline keyboard confirmations',
      'Real-time price updates',
      'Transaction status tracking',
    ],
  },
  {
    id: 'mini-app',
    name: 'Mini App',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
      </svg>
    ),
    description: 'Full trading dashboard inside Telegram',
    video: '/videos/mini-app-demo.mp4',
    poster: '/images/miniapp-poster.jpg',
    features: [
      'Portfolio overview',
      'Advanced swap interface',
      'Price alerts management',
      'Transaction history',
    ],
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
      </svg>
    ),
    description: 'Trade with interactive message buttons',
    video: '/videos/whatsapp-demo.mp4',
    poster: '/images/whatsapp-poster.jpg',
    features: [
      'Interactive button messages',
      'Token picker flow',
      'Reply-based confirmations',
      'Status notifications',
    ],
  },
  {
    id: 'mobile',
    name: 'Mobile App',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
      </svg>
    ),
    description: 'Native iOS & Android experience',
    video: '/videos/mobile-app-demo.mp4',
    poster: '/images/mobile-poster.jpg',
    features: [
      'Tab-based navigation',
      'Token discovery',
      'Push notifications',
      'Biometric security',
    ],
  },
]

export default function PlatformDemos() {
  const [activeTab, setActiveTab] = useState('telegram-bot')
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: '-100px' })

  const activePlatform = platforms.find(p => p.id === activeTab)!

  return (
    <section className="py-24 px-6 relative" id="demos">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-suwappu-sakura-light/10 to-transparent" />

      <div className="max-w-6xl mx-auto relative z-10" ref={ref}>
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-12"
        >
          <span className="inline-block px-4 py-1 rounded-full bg-suwappu-purple/10 text-suwappu-purple text-sm font-medium mb-4">
            Platform Demos
          </span>
          <h2 className="font-heading text-3xl md:text-4xl lg:text-5xl font-bold text-suwappu-text mb-4">
            Trade From Anywhere
          </h2>
          <p className="font-body text-lg text-suwappu-text-secondary max-w-2xl mx-auto">
            Choose your preferred platform. Same powerful features,
            optimized for each interface.
          </p>
        </motion.div>

        {/* Tab Navigation */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="flex flex-wrap justify-center gap-2 mb-12"
        >
          {platforms.map((platform) => (
            <motion.button
              key={platform.id}
              onClick={() => setActiveTab(platform.id)}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className={`
                flex items-center gap-2 px-5 py-3 rounded-suwappu-pill font-heading font-medium transition-all
                ${activeTab === platform.id
                  ? 'bg-suwappu-gradient text-white shadow-suwappu-button'
                  : 'glass text-suwappu-text hover:bg-white/60'
                }
              `}
            >
              {platform.icon}
              <span className="hidden sm:inline">{platform.name}</span>
            </motion.button>
          ))}
        </motion.div>

        {/* Content Area */}
        <div className="grid md:grid-cols-2 gap-12 items-center">
          {/* Video Player */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            animate={isInView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.6, delay: 0.3 }}
          >
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                variants={tabContent}
                initial="hidden"
                animate="visible"
                exit="exit"
              >
                <VideoPlayer
                  src={activePlatform.video}
                  poster={activePlatform.poster}
                  title={`${activePlatform.name} Demo`}
                />
              </motion.div>
            </AnimatePresence>
          </motion.div>

          {/* Platform Info */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            animate={isInView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.6, delay: 0.4 }}
          >
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                variants={tabContent}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="space-y-6"
              >
                <div>
                  <h3 className="font-heading text-2xl md:text-3xl font-bold text-suwappu-text mb-2">
                    {activePlatform.name}
                  </h3>
                  <p className="font-body text-lg text-suwappu-text-secondary">
                    {activePlatform.description}
                  </p>
                </div>

                {/* Feature List */}
                <ul className="space-y-3">
                  {activePlatform.features.map((feature, index) => (
                    <motion.li
                      key={feature}
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.1 }}
                      className="flex items-center gap-3"
                    >
                      <span className="w-6 h-6 rounded-full bg-suwappu-success/20 flex items-center justify-center flex-shrink-0">
                        <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      </span>
                      <span className="font-body text-suwappu-text">{feature}</span>
                    </motion.li>
                  ))}
                </ul>

                {/* CTA */}
                <motion.a
                  href={activeTab === 'telegram-bot' ? 'https://t.me/SuwappuBot' : '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-suwappu-pill bg-suwappu-gradient text-white font-heading font-semibold shadow-suwappu-button hover:shadow-suwappu-button-hover transition-shadow"
                >
                  Try {activePlatform.name}
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                  </svg>
                </motion.a>
              </motion.div>
            </AnimatePresence>
          </motion.div>
        </div>
      </div>
    </section>
  )
}
