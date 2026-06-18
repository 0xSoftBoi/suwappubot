/**
 * Onboarding - First-time user guided tour
 * Step-by-step introduction to key features with progress indicators
 */
import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// ============================================================================
// Types
// ============================================================================

export interface OnboardingStep {
  id: string
  title: string
  description: string
  icon: string
  /** Optional illustration or image URL */
  illustration?: string
  /** Highlight a specific element selector */
  highlightSelector?: string
  /** Legacy support */
  target?: string
  image?: string
}

export interface OnboardingModalProps {
  /** Whether onboarding is visible */
  isOpen: boolean
  /** Steps to show */
  steps: OnboardingStep[]
  /** Called when onboarding completes */
  onComplete: () => void
  /** Called when user skips */
  onSkip?: () => void
  /** Storage key for persistence */
  storageKey?: string
}

// ============================================================================
// Default Onboarding Steps
// ============================================================================

export const defaultOnboardingSteps: OnboardingStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to Suwappu!',
    description: 'Your gateway to cross-chain trading. Swap tokens across 7+ blockchains with the best rates.',
    icon: '🌸',
  },
  {
    id: 'swap',
    title: 'Easy Token Swaps',
    description: 'Trade any token in seconds. We find the best routes across multiple DEXs and bridges.',
    icon: '🔄',
  },
  {
    id: 'portfolio',
    title: 'Track Your Portfolio',
    description: 'See all your tokens across every chain in one unified view with real-time prices.',
    icon: '📊',
  },
  {
    id: 'wallet',
    title: 'Secure Wallet',
    description: 'Your keys, your crypto. We use passkey authentication for maximum security.',
    icon: '🔐',
  },
  {
    id: 'alerts',
    title: 'Price Alerts',
    description: 'Set alerts for any token and get notified when prices hit your targets.',
    icon: '🔔',
  },
]

// ============================================================================
// Onboarding Modal
// ============================================================================

export function OnboardingModal({
  isOpen,
  steps,
  onComplete,
  onSkip,
  storageKey = 'suwappu_onboarding_complete',
}: OnboardingModalProps) {
  const [currentStep, setCurrentStep] = useState(0)

  const handleNext = useCallback(() => {
    if (currentStep < steps.length - 1) {
      setCurrentStep((prev) => prev + 1)
    } else {
      // Complete onboarding
      localStorage.setItem(storageKey, 'true')
      onComplete()
    }
  }, [currentStep, steps.length, onComplete, storageKey])

  const handleSkip = useCallback(() => {
    localStorage.setItem(storageKey, 'true')
    onSkip?.()
    onComplete()
  }, [onComplete, onSkip, storageKey])

  const handlePrev = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1)
    }
  }, [currentStep])

  // Reset step when modal opens
  useEffect(() => {
    if (isOpen) {
      setCurrentStep(0)
    }
  }, [isOpen])

  const step = steps[currentStep]
  const isLastStep = currentStep === steps.length - 1
  const progress = ((currentStep + 1) / steps.length) * 100

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="bg-white rounded-t-suwappu-xxxl sm:rounded-suwappu-xxl w-full sm:max-w-md shadow-suwappu-4 overflow-hidden"
            initial={{ y: '100%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '100%', opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          >
            {/* Progress bar */}
            <div className="h-1 bg-suwappu-sakura-light">
              <motion.div
                className="h-full bg-suwappu-gradient"
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>

            {/* Skip button */}
            <div className="flex justify-end p-3 pb-0">
              <button
                onClick={handleSkip}
                className="text-xs text-suwappu-text-secondary hover:text-suwappu-text transition-colors"
              >
                Skip tour
              </button>
            </div>

            {/* Step content */}
            <div className="px-6 pb-6">
              <AnimatePresence mode="wait">
                <motion.div
                  key={step.id}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.2 }}
                  className="text-center"
                >
                  {/* Icon */}
                  <motion.div
                    className="w-24 h-24 mx-auto mb-4 bg-suwappu-sakura-light rounded-full flex items-center justify-center"
                    initial={{ scale: 0.5 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.1, type: 'spring' }}
                  >
                    <span className="text-5xl">{step.icon}</span>
                  </motion.div>

                  {/* Title */}
                  <h2 className="text-xl font-heading font-bold text-suwappu-purple-deep mb-2">{step.title}</h2>

                  {/* Description */}
                  <p className="text-sm text-suwappu-text-secondary leading-relaxed">{step.description}</p>
                </motion.div>
              </AnimatePresence>

              {/* Step indicators */}
              <div className="flex justify-center gap-2 mt-6 mb-4">
                {steps.map((_, index) => (
                  <button
                    key={index}
                    onClick={() => setCurrentStep(index)}
                    className={`w-2 h-2 rounded-full transition-all ${
                      index === currentStep
                        ? 'bg-suwappu-magenta w-6'
                        : index < currentStep
                          ? 'bg-suwappu-success'
                          : 'bg-suwappu-sakura-mid'
                    }`}
                  />
                ))}
              </div>

              {/* Navigation buttons */}
              <div className="flex gap-3">
                {currentStep > 0 && (
                  <motion.button
                    onClick={handlePrev}
                    className="flex-1 px-4 py-3 text-sm font-heading font-semibold text-suwappu-magenta-mid bg-white border border-suwappu-sakura-mid rounded-suwappu-pill hover:bg-suwappu-sakura-light transition-colors"
                    whileTap={{ scale: 0.98 }}
                  >
                    Back
                  </motion.button>
                )}
                <motion.button
                  onClick={handleNext}
                  className="flex-1 px-4 py-3 text-sm font-heading font-bold text-white bg-suwappu-gradient rounded-suwappu-pill shadow-suwappu-button hover:shadow-suwappu-button-hover transition-shadow"
                  whileTap={{ scale: 0.98 }}
                >
                  {isLastStep ? "Let's Go!" : 'Next'}
                </motion.button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ============================================================================
// Tooltip Spotlight
// ============================================================================

export interface TooltipSpotlightProps {
  /** Target element selector */
  targetSelector: string
  /** Tooltip content */
  content: string
  /** Position relative to target */
  position?: 'top' | 'bottom' | 'left' | 'right'
  /** Called when tooltip is dismissed */
  onDismiss: () => void
  /** Whether to show */
  isVisible: boolean
  /** Legacy support */
  target?: string
}

export function TooltipSpotlight({
  targetSelector,
  content,
  position = 'bottom',
  onDismiss,
  isVisible,
  target,
}: TooltipSpotlightProps) {
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null)
  const selector = targetSelector || target || ''

  useEffect(() => {
    if (isVisible && selector) {
      const targetEl = document.querySelector(selector)
      if (targetEl) {
        setTargetRect(targetEl.getBoundingClientRect())
      }
    }
  }, [isVisible, selector])

  if (!isVisible || !targetRect) return null

  const positionStyles = {
    top: {
      top: targetRect.top - 10,
      left: targetRect.left + targetRect.width / 2,
      transform: 'translate(-50%, -100%)',
    },
    bottom: {
      top: targetRect.bottom + 10,
      left: targetRect.left + targetRect.width / 2,
      transform: 'translate(-50%, 0)',
    },
    left: {
      top: targetRect.top + targetRect.height / 2,
      left: targetRect.left - 10,
      transform: 'translate(-100%, -50%)',
    },
    right: {
      top: targetRect.top + targetRect.height / 2,
      left: targetRect.right + 10,
      transform: 'translate(0, -50%)',
    },
  }

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onDismiss}
      >
        {/* Overlay with cutout */}
        <div className="absolute inset-0 bg-black/60" />

        {/* Spotlight on target */}
        <motion.div
          className="absolute bg-transparent rounded-lg ring-4 ring-white/50"
          style={{
            top: targetRect.top - 4,
            left: targetRect.left - 4,
            width: targetRect.width + 8,
            height: targetRect.height + 8,
          }}
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
        />

        {/* Tooltip */}
        <motion.div
          className="absolute bg-white rounded-suwappu-lg p-3 shadow-suwappu-3 max-w-xs"
          style={positionStyles[position]}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1 }}
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-sm text-suwappu-text">{content}</p>
          <button
            onClick={onDismiss}
            className="mt-2 text-xs text-suwappu-magenta-mid font-medium hover:underline"
          >
            Got it
          </button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

// ============================================================================
// Hook for Onboarding State
// ============================================================================

export interface UseOnboardingOptions {
  /** Storage key for persistence */
  storageKey?: string
  /** Steps to use */
  steps?: OnboardingStep[]
  /** Auto-show for new users */
  autoShow?: boolean
}

export function useOnboarding({
  storageKey = 'suwappu_onboarding_complete',
  steps = defaultOnboardingSteps,
  autoShow = true,
}: UseOnboardingOptions = {}) {
  const [isOpen, setIsOpen] = useState(false)
  const [hasCompleted, setHasCompleted] = useState(false)

  // Check if onboarding was completed
  useEffect(() => {
    const completed = localStorage.getItem(storageKey) === 'true'
    setHasCompleted(completed)

    // Auto-show for new users
    if (autoShow && !completed) {
      // Small delay to let the page render first
      const timer = setTimeout(() => {
        setIsOpen(true)
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [storageKey, autoShow])

  const showOnboarding = useCallback(() => {
    setIsOpen(true)
  }, [])

  const hideOnboarding = useCallback(() => {
    setIsOpen(false)
  }, [])

  const completeOnboarding = useCallback(() => {
    localStorage.setItem(storageKey, 'true')
    setHasCompleted(true)
    setIsOpen(false)
  }, [storageKey])

  const resetOnboarding = useCallback(() => {
    localStorage.removeItem(storageKey)
    setHasCompleted(false)
  }, [storageKey])

  return {
    isOpen,
    hasCompleted,
    steps,
    showOnboarding,
    hideOnboarding,
    completeOnboarding,
    resetOnboarding,
  }
}
