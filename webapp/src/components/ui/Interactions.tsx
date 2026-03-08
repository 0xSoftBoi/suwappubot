/**
 * Interactions - Micro-interaction components for enhanced UX
 * Includes animated buttons, pull-to-refresh, and success celebrations
 */
import { forwardRef, useState, useCallback, useEffect } from 'react'
import { motion, useAnimation, AnimatePresence } from 'framer-motion'

// ============================================================================
// Animated Button
// ============================================================================

export interface AnimatedButtonProps {
  /** Button children */
  children?: React.ReactNode
  /** Button variant */
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  /** Size variant */
  size?: 'sm' | 'md' | 'lg'
  /** Loading state */
  isLoading?: boolean
  /** Full width */
  fullWidth?: boolean
  /** Icon to show before label */
  leftIcon?: React.ReactNode
  /** Icon to show after label */
  rightIcon?: React.ReactNode
  /** Additional class names */
  className?: string
  /** Disabled state */
  disabled?: boolean
  /** Click handler */
  onClick?: () => void
  /** Button type */
  type?: 'button' | 'submit' | 'reset'
}

export const AnimatedButton = forwardRef<HTMLButtonElement, AnimatedButtonProps>(
  (
    {
      children,
      variant = 'primary',
      size = 'md',
      isLoading = false,
      fullWidth = false,
      leftIcon,
      rightIcon,
      className = '',
      disabled,
      onClick,
      type = 'button',
    },
    ref
  ) => {
    const baseStyles =
      'inline-flex items-center justify-center font-heading font-semibold rounded-suwappu-pill transition-all focus:outline-none focus:ring-2 focus:ring-offset-2'

    const variantStyles = {
      primary:
        'bg-suwappu-gradient text-white shadow-suwappu-button hover:shadow-suwappu-button-hover focus:ring-suwappu-magenta',
      secondary:
        'bg-white text-suwappu-magenta-mid border border-suwappu-sakura-mid hover:bg-suwappu-sakura-light focus:ring-suwappu-sakura-mid',
      ghost: 'bg-transparent text-suwappu-text hover:bg-suwappu-sakura-light/50 focus:ring-suwappu-sakura-mid',
      danger: 'bg-suwappu-error text-white hover:bg-red-600 focus:ring-suwappu-error',
    }

    const sizeStyles = {
      sm: 'px-3 py-1.5 text-xs gap-1.5',
      md: 'px-4 py-2 text-sm gap-2',
      lg: 'px-6 py-3 text-base gap-2.5',
    }

    const disabledStyles = 'opacity-50 cursor-not-allowed'

    return (
      <motion.button
        ref={ref}
        className={`
          ${baseStyles}
          ${variantStyles[variant]}
          ${sizeStyles[size]}
          ${fullWidth ? 'w-full' : ''}
          ${disabled || isLoading ? disabledStyles : ''}
          ${className}
        `}
        disabled={disabled || isLoading}
        onClick={onClick}
        type={type}
        whileTap={{ scale: disabled || isLoading ? 1 : 0.97 }}
        whileHover={{ scale: disabled || isLoading ? 1 : 1.02 }}
        transition={{ type: 'spring', stiffness: 400, damping: 17 }}
      >
        {isLoading ? (
          <motion.div
            className="w-4 h-4 border-2 border-current border-t-transparent rounded-full"
            animate={{ rotate: 360 }}
            transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
          />
        ) : (
          <>
            {leftIcon && <span className="flex-shrink-0">{leftIcon}</span>}
            {children}
            {rightIcon && <span className="flex-shrink-0">{rightIcon}</span>}
          </>
        )}
      </motion.button>
    )
  }
)

AnimatedButton.displayName = 'AnimatedButton'

// ============================================================================
// Confetti Celebration
// ============================================================================

interface ConfettiPiece {
  id: number
  x: number
  delay: number
  rotation: number
  color: string
}

const confettiColors = [
  '#FFD1DC', // sakura-light
  '#FFB7C5', // sakura-mid
  '#E91E8C', // magenta
  '#F8A5C2', // rose
  '#C44569', // magenta-mid
  '#6C3483', // purple
  '#87CEEB', // blue
  '#A8E6A3', // success
]

export function Confetti({
  active,
  duration = 3000,
  pieces = 50,
}: {
  active: boolean
  duration?: number
  pieces?: number
}) {
  const [confetti, setConfetti] = useState<ConfettiPiece[]>([])

  useEffect(() => {
    if (active) {
      const newConfetti: ConfettiPiece[] = Array.from({ length: pieces }, (_, i) => ({
        id: i,
        x: Math.random() * 100,
        delay: Math.random() * 0.5,
        rotation: Math.random() * 360,
        color: confettiColors[Math.floor(Math.random() * confettiColors.length)],
      }))
      setConfetti(newConfetti)

      const timer = setTimeout(() => {
        setConfetti([])
      }, duration)

      return () => clearTimeout(timer)
    }
  }, [active, duration, pieces])

  return (
    <AnimatePresence>
      {confetti.length > 0 && (
        <div className="fixed inset-0 pointer-events-none overflow-hidden z-50">
          {confetti.map((piece) => (
            <motion.div
              key={piece.id}
              className="absolute w-3 h-3 rounded-sm"
              style={{
                left: `${piece.x}%`,
                top: -20,
                backgroundColor: piece.color,
                rotate: piece.rotation,
              }}
              initial={{ y: -20, opacity: 1 }}
              animate={{
                y: '100vh',
                x: [0, Math.random() * 100 - 50, Math.random() * 100 - 50],
                rotate: piece.rotation + 720,
                opacity: [1, 1, 0],
              }}
              transition={{
                duration: 2 + Math.random(),
                delay: piece.delay,
                ease: 'easeOut',
              }}
            />
          ))}
        </div>
      )}
    </AnimatePresence>
  )
}

// ============================================================================
// Success Celebration Modal
// ============================================================================

export interface SuccessCelebrationProps {
  isOpen: boolean
  title?: string
  message?: string
  onClose: () => void
  /** Auto close after duration (ms) */
  autoCloseDuration?: number
  /** Legacy support: if true, treat as active */
  active?: boolean
}

export function SuccessCelebration({
  isOpen,
  title = 'Success!',
  message = 'Your transaction was completed successfully.',
  onClose,
  autoCloseDuration = 5000,
  active,
}: SuccessCelebrationProps) {
  const isVisible = isOpen || active || false

  useEffect(() => {
    if (isVisible && autoCloseDuration > 0) {
      const timer = setTimeout(onClose, autoCloseDuration)
      return () => clearTimeout(timer)
    }
  }, [isVisible, onClose, autoCloseDuration])

  return (
    <AnimatePresence>
      {isVisible && (
        <>
          <Confetti active={isVisible} />
          <motion.div
            className="fixed inset-0 bg-black/30 flex items-center justify-center z-40 p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          >
            <motion.div
              className="bg-white rounded-suwappu-xxl p-6 shadow-suwappu-4 max-w-sm w-full text-center"
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 25 }}
              onClick={(e) => e.stopPropagation()}
            >
              <motion.div
                className="w-20 h-20 mx-auto mb-4 bg-suwappu-success/20 rounded-full flex items-center justify-center"
                initial={{ scale: 0 }}
                animate={{ scale: [0, 1.2, 1] }}
                transition={{ delay: 0.2, duration: 0.5 }}
              >
                <motion.span
                  className="text-4xl"
                  initial={{ scale: 0, rotate: -180 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ delay: 0.4, type: 'spring' }}
                >
                  ✓
                </motion.span>
              </motion.div>

              <motion.h2
                className="text-xl font-heading font-bold text-suwappu-purple-deep mb-2"
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.3 }}
              >
                {title}
              </motion.h2>

              <motion.p
                className="text-sm text-suwappu-text-secondary mb-4"
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.4 }}
              >
                {message}
              </motion.p>

              <motion.button
                className="px-6 py-2 bg-suwappu-gradient text-white font-heading font-semibold rounded-suwappu-pill shadow-suwappu-button"
                onClick={onClose}
                whileTap={{ scale: 0.97 }}
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.5 }}
              >
                Done
              </motion.button>
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

// ============================================================================
// Pull to Refresh
// ============================================================================

export interface PullToRefreshProps {
  onRefresh: () => Promise<void>
  children: React.ReactNode
  /** Pull distance to trigger refresh */
  threshold?: number
}

export function PullToRefresh({ onRefresh, children, threshold = 80 }: PullToRefreshProps) {
  const [pullDistance, setPullDistance] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [startY, setStartY] = useState(0)
  const controls = useAnimation()

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const scrollTop = document.documentElement.scrollTop || document.body.scrollTop
    if (scrollTop === 0) {
      setStartY(e.touches[0].clientY)
    }
  }, [])

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (startY === 0 || isRefreshing) return

      const currentY = e.touches[0].clientY
      const diff = currentY - startY

      if (diff > 0) {
        const distance = Math.min(diff * 0.5, threshold * 1.5)
        setPullDistance(distance)
      }
    },
    [startY, isRefreshing, threshold]
  )

  const handleTouchEnd = useCallback(async () => {
    if (pullDistance >= threshold && !isRefreshing) {
      setIsRefreshing(true)
      await controls.start({ y: threshold / 2 })
      await onRefresh()
      setIsRefreshing(false)
    }
    setPullDistance(0)
    setStartY(0)
    controls.start({ y: 0 })
  }, [pullDistance, threshold, isRefreshing, onRefresh, controls])

  const progress = Math.min(pullDistance / threshold, 1)

  return (
    <div onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
      {/* Pull indicator */}
      <AnimatePresence>
        {(pullDistance > 0 || isRefreshing) && (
          <motion.div
            className="absolute left-0 right-0 flex justify-center z-10"
            initial={{ opacity: 0, y: -40 }}
            animate={{ opacity: 1, y: pullDistance - 40 }}
            exit={{ opacity: 0, y: -40 }}
          >
            <div className="bg-white rounded-full p-2 shadow-suwappu-2">
              <motion.div
                className="w-6 h-6 text-suwappu-magenta"
                animate={{ rotate: isRefreshing ? 360 : progress * 180 }}
                transition={isRefreshing ? { duration: 0.8, repeat: Infinity, ease: 'linear' } : { duration: 0 }}
              >
                {isRefreshing ? (
                  <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                ) : (
                  <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                  </svg>
                )}
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Content */}
      <motion.div animate={controls} style={{ y: pullDistance }}>
        {children}
      </motion.div>
    </div>
  )
}

// ============================================================================
// Haptic Feedback Wrapper
// ============================================================================

export interface HapticButtonProps {
  /** Button children */
  children?: React.ReactNode
  /** Haptic feedback type */
  haptic?: 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error'
  /** Legacy prop support */
  hapticType?: 'light' | 'medium' | 'heavy'
  /** Click handler */
  onClick?: () => void
  /** Additional class names */
  className?: string
  /** Disabled state */
  disabled?: boolean
  /** Button type */
  type?: 'button' | 'submit' | 'reset'
}

export const HapticButton = forwardRef<HTMLButtonElement, HapticButtonProps>(
  ({ haptic = 'light', hapticType, onClick, children, className, disabled, type = 'button' }, ref) => {
    const feedbackType = hapticType || haptic

    const handleClick = useCallback(() => {
      // Trigger haptic feedback if available (Telegram WebApp)
      if (typeof window !== 'undefined') {
        const tg = (window as { Telegram?: { WebApp?: { HapticFeedback?: { impactOccurred?: (style: string) => void; notificationOccurred?: (type: string) => void } } } }).Telegram
        if (tg?.WebApp?.HapticFeedback) {
          const feedback = tg.WebApp.HapticFeedback
          if (feedbackType === 'success' || feedbackType === 'warning' || feedbackType === 'error') {
            feedback.notificationOccurred?.(feedbackType)
          } else {
            feedback.impactOccurred?.(feedbackType)
          }
        }
      }
      onClick?.()
    }, [feedbackType, onClick])

    return (
      <button ref={ref} onClick={handleClick} className={className} disabled={disabled} type={type}>
        {children}
      </button>
    )
  }
)

HapticButton.displayName = 'HapticButton'

// ============================================================================
// Animated Card
// ============================================================================

export interface AnimatedCardProps {
  children: React.ReactNode
  className?: string
  onClick?: () => void
  /** Animation delay for staggered lists */
  delay?: number
}

export function AnimatedCard({ children, className = '', onClick, delay = 0 }: AnimatedCardProps) {
  return (
    <motion.div
      className={`bg-white rounded-suwappu-xl shadow-suwappu-1 ${onClick ? 'cursor-pointer hover:shadow-suwappu-2' : ''} ${className}`}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.3 }}
      whileHover={onClick ? { scale: 1.01 } : undefined}
      whileTap={onClick ? { scale: 0.99 } : undefined}
      onClick={onClick}
    >
      {children}
    </motion.div>
  )
}

// ============================================================================
// Animated List Item
// ============================================================================

export interface AnimatedListItemProps {
  children: React.ReactNode
  index?: number
  className?: string
  onClick?: () => void
}

export function AnimatedListItem({ children, index = 0, className = '', onClick }: AnimatedListItemProps) {
  return (
    <motion.div
      className={`${onClick ? 'cursor-pointer' : ''} ${className}`}
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05, duration: 0.2 }}
      whileHover={onClick ? { backgroundColor: 'rgba(255, 209, 220, 0.2)' } : undefined}
      whileTap={onClick ? { scale: 0.99 } : undefined}
      onClick={onClick}
    >
      {children}
    </motion.div>
  )
}
