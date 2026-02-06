'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

type ChatPhase =
  | 'typing-command'
  | 'waiting-bot'
  | 'bot-typing'
  | 'quote-in'
  | 'confirm-visible'
  | 'confirm-click'
  | 'success'
  | 'pause'
  | 'fade-out'

const COMMAND = '/s 100 USDC ETH'
const TYPE_SPEED = 50
const BOT_THINK_DELAY = 500
const QUOTE_TO_CONFIRM_DELAY = 1000
const CONFIRM_CLICK_DELAY = 500
const SUCCESS_DELAY = 500
const LOOP_PAUSE = 3000

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 px-3 py-2">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-suwappu-cyan/60"
          animate={{ y: [0, -4, 0] }}
          transition={{
            duration: 0.5,
            repeat: Infinity,
            delay: i * 0.15,
            ease: 'easeInOut',
          }}
        />
      ))}
    </div>
  )
}

function BotAvatar() {
  return (
    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-suwappu-magenta to-suwappu-purple flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
      S
    </div>
  )
}

function Timestamp({ text }: { text: string }) {
  return <span className="text-[10px] text-white/30 mt-0.5">{text}</span>
}

export default function ChatSimulation() {
  const [phase, setPhase] = useState<ChatPhase>('typing-command')
  const [typedChars, setTypedChars] = useState(0)
  const [sparkles, setSparkles] = useState<{ id: number; x: number; y: number }[]>([])

  const reset = useCallback(() => {
    setTypedChars(0)
    setSparkles([])
    setPhase('typing-command')
  }, [])

  // Phase state machine
  useEffect(() => {
    let timeout: NodeJS.Timeout

    switch (phase) {
      case 'typing-command':
        if (typedChars < COMMAND.length) {
          timeout = setTimeout(() => setTypedChars((c) => c + 1), TYPE_SPEED)
        } else {
          timeout = setTimeout(() => setPhase('waiting-bot'), BOT_THINK_DELAY)
        }
        break

      case 'waiting-bot':
        timeout = setTimeout(() => setPhase('bot-typing'), 300)
        break

      case 'bot-typing':
        timeout = setTimeout(() => setPhase('quote-in'), 800)
        break

      case 'quote-in':
        timeout = setTimeout(() => setPhase('confirm-visible'), QUOTE_TO_CONFIRM_DELAY)
        break

      case 'confirm-visible':
        timeout = setTimeout(() => setPhase('confirm-click'), CONFIRM_CLICK_DELAY)
        break

      case 'confirm-click':
        timeout = setTimeout(() => setPhase('success'), SUCCESS_DELAY)
        break

      case 'success':
        // Generate sparkles
        const newSparkles = Array.from({ length: 6 }, (_, i) => ({
          id: i,
          x: Math.random() * 200 - 100,
          y: Math.random() * -60 - 20,
        }))
        setSparkles(newSparkles)
        timeout = setTimeout(() => setPhase('pause'), LOOP_PAUSE)
        break

      case 'pause':
        timeout = setTimeout(() => setPhase('fade-out'), 200)
        break

      case 'fade-out':
        timeout = setTimeout(reset, 600)
        break
    }

    return () => clearTimeout(timeout)
  }, [phase, typedChars, reset])

  const showCommand = phase !== 'fade-out'
  const showBotTyping = phase === 'bot-typing'
  const showQuote =
    phase === 'quote-in' ||
    phase === 'confirm-visible' ||
    phase === 'confirm-click' ||
    phase === 'success' ||
    phase === 'pause'
  const showConfirm =
    phase === 'confirm-visible' ||
    phase === 'confirm-click' ||
    phase === 'success' ||
    phase === 'pause'
  const confirmClicked =
    phase === 'confirm-click' || phase === 'success' || phase === 'pause'
  const showSuccess = phase === 'success' || phase === 'pause'

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: phase === 'fade-out' ? 0 : 1 }}
      transition={{ duration: 0.5 }}
      className="w-full max-w-xs mx-auto rounded-2xl overflow-hidden bg-suwappu-ocean shadow-lg border border-white/10"
    >
      {/* Chat Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10 bg-suwappu-ocean">
        <BotAvatar />
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-heading font-semibold">Suwappu Bot</p>
          <div className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-suwappu-success animate-pulse" />
            <span className="text-[10px] text-suwappu-success/80">online</span>
          </div>
        </div>
      </div>

      {/* Chat Messages */}
      <div className="px-3 py-4 space-y-3 min-h-[260px] flex flex-col justify-end">
        <AnimatePresence mode="wait">
          {/* User message */}
          {showCommand && typedChars > 0 && (
            <motion.div
              key="user-msg"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-end"
            >
              <div className="max-w-[85%] px-3 py-2 rounded-2xl rounded-br-md bg-gradient-to-r from-[#2B5DDE] to-[#4A8CFF] text-white text-sm font-mono">
                {COMMAND.slice(0, typedChars)}
                {typedChars < COMMAND.length && (
                  <motion.span
                    animate={{ opacity: [1, 0] }}
                    transition={{ duration: 0.5, repeat: Infinity }}
                    className="inline-block w-0.5 h-3.5 bg-white ml-0.5 align-middle"
                  />
                )}
              </div>
              <Timestamp text="12:01" />
            </motion.div>
          )}

          {/* Bot typing indicator */}
          {showBotTyping && (
            <motion.div
              key="bot-typing"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex items-end gap-2"
            >
              <BotAvatar />
              <div className="glass-card rounded-2xl rounded-bl-md">
                <TypingIndicator />
              </div>
            </motion.div>
          )}

          {/* Bot quote response */}
          {showQuote && (
            <motion.div
              key="bot-quote"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="flex items-start gap-2"
            >
              <BotAvatar />
              <div className="flex-1 min-w-0">
                <div className="glass-card rounded-2xl rounded-bl-md px-3 py-2.5 max-w-[90%] border border-white/10">
                  {/* Quote card */}
                  <p className="text-[11px] text-suwappu-cyan/70 mb-1.5 font-heading">Swap Quote</p>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-white text-sm font-semibold">100 USDC</span>
                    <svg className="w-3.5 h-3.5 text-suwappu-magenta" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                    <span className="text-suwappu-success text-sm font-semibold">0.042 ETH</span>
                  </div>
                  <div className="space-y-0.5 text-[10px] text-white/50">
                    <p>Rate: 1 ETH = 2,381 USDC</p>
                    <p>Fee: 0.3% | via Li.Fi</p>
                  </div>
                </div>
                <Timestamp text="12:01" />
              </div>
            </motion.div>
          )}

          {/* Confirm button */}
          {showConfirm && (
            <motion.div
              key="confirm-btn"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{
                opacity: 1,
                scale: confirmClicked ? [1, 0.95, 1] : 1,
              }}
              transition={{ duration: 0.3 }}
              className="flex justify-start pl-8"
            >
              <motion.div
                animate={
                  !confirmClicked
                    ? { scale: [1, 1.04, 1] }
                    : {}
                }
                transition={{
                  duration: 1.2,
                  repeat: confirmClicked ? 0 : Infinity,
                  ease: 'easeInOut',
                }}
                className={`px-6 py-1.5 rounded-xl text-sm font-heading font-semibold transition-all ${
                  confirmClicked
                    ? 'bg-suwappu-success/30 text-suwappu-success border border-suwappu-success/40'
                    : 'bg-gradient-to-r from-suwappu-magenta to-suwappu-purple text-white shadow-md'
                }`}
              >
                {confirmClicked ? 'Confirmed' : 'Confirm Swap'}
              </motion.div>
            </motion.div>
          )}

          {/* Success message */}
          {showSuccess && (
            <motion.div
              key="success-msg"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="flex items-start gap-2 relative"
            >
              <BotAvatar />
              <div className="flex-1 min-w-0 relative">
                <div className="glass-card rounded-2xl rounded-bl-md px-3 py-2.5 max-w-[90%] border border-suwappu-success/30">
                  <p className="text-suwappu-success text-sm font-semibold">
                    Swap Complete!
                  </p>
                  <p className="text-[10px] text-white/50 mt-0.5">
                    0.042 ETH received in your wallet
                  </p>
                </div>
                <Timestamp text="12:02" />

                {/* Sparkle particles */}
                {sparkles.map((s) => (
                  <motion.span
                    key={s.id}
                    initial={{ opacity: 1, x: 0, y: 0, scale: 1 }}
                    animate={{
                      opacity: 0,
                      x: s.x,
                      y: s.y,
                      scale: 0,
                    }}
                    transition={{ duration: 1, ease: 'easeOut' }}
                    className="absolute top-0 left-8 text-suwappu-warning text-xs pointer-events-none"
                  >
                    *
                  </motion.span>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}
