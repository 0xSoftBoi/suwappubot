/**
 * Onboarding - Guided tour components for first-time users
 * Stub implementation — to be fully built out later.
 */
import { useState } from 'react'

export interface OnboardingStep {
  id: string
  title: string
  description: string
  target?: string
  image?: string
}

export interface OnboardingModalProps {
  isOpen: boolean
  steps: OnboardingStep[]
  onComplete: () => void
  onSkip: () => void
}

export function OnboardingModal({ isOpen, steps, onComplete, onSkip }: OnboardingModalProps) {
  const [currentStep, setCurrentStep] = useState(0)

  if (!isOpen || steps.length === 0) return null

  const step = steps[currentStep]
  const isLast = currentStep === steps.length - 1

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-suwappu-xxl p-6 max-w-sm w-full shadow-suwappu-3 text-center">
        <h3 className="font-heading font-bold text-lg text-suwappu-purple-deep mb-2">{step.title}</h3>
        <p className="text-sm text-suwappu-text-secondary mb-4">{step.description}</p>
        <div className="flex justify-center gap-2">
          <button onClick={onSkip} className="text-xs text-suwappu-text-secondary">
            Skip
          </button>
          <button
            onClick={isLast ? onComplete : () => setCurrentStep((s) => s + 1)}
            className="px-4 py-2 bg-suwappu-magenta-mid text-white text-sm font-heading font-semibold rounded-suwappu-lg"
          >
            {isLast ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  )
}

export interface TooltipSpotlightProps {
  target: string
  content: string
  isVisible?: boolean
}

export function TooltipSpotlight({ isVisible }: TooltipSpotlightProps) {
  if (!isVisible) return null
  return null
}

export interface UseOnboardingOptions {
  steps: OnboardingStep[]
  autoShow?: boolean
}

export const defaultOnboardingSteps: OnboardingStep[] = [
  { id: 'welcome', title: 'Welcome to Suwappu!', description: 'Your cross-chain DEX companion.' },
  { id: 'swap', title: 'Easy Swapping', description: 'Swap tokens across multiple chains.' },
  { id: 'wallet', title: 'Your Wallet', description: 'Manage your wallets and balances.' },
]

export function useOnboarding({ steps, autoShow = false }: UseOnboardingOptions) {
  const storageKey = 'suwappu_onboarding_completed'
  const completed = typeof window !== 'undefined' && localStorage.getItem(storageKey) === 'true'
  const [isOpen, setIsOpen] = useState(autoShow && !completed)

  return {
    isOpen,
    steps,
    completeOnboarding: () => {
      setIsOpen(false)
      if (typeof window !== 'undefined') {
        localStorage.setItem(storageKey, 'true')
      }
    },
    resetOnboarding: () => {
      if (typeof window !== 'undefined') {
        localStorage.removeItem(storageKey)
      }
      setIsOpen(true)
    },
  }
}
