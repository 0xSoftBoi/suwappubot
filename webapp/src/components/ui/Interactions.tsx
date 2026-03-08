/**
 * Interactions - Animated UI components for interactive elements
 * Stub implementation — to be fully built out later.
 */
import type { ReactNode } from 'react'

export interface AnimatedButtonProps {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  variant?: 'primary' | 'secondary' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  fullWidth?: boolean
  className?: string
}

export function AnimatedButton({
  children,
  onClick,
  disabled,
  variant = 'primary',
  size = 'md',
  fullWidth,
  className = '',
}: AnimatedButtonProps) {
  const baseClass = 'font-heading font-semibold rounded-suwappu-xl transition-all active:scale-[0.98]'
  const sizeClass = size === 'lg' ? 'py-3 px-6 text-sm' : size === 'sm' ? 'py-1.5 px-3 text-xs' : 'py-2 px-4 text-sm'
  const variantClass =
    variant === 'primary'
      ? 'bg-gradient-to-r from-suwappu-magenta-mid to-suwappu-purple-deep text-white shadow-suwappu-2'
      : variant === 'secondary'
        ? 'bg-white text-suwappu-text border border-suwappu-sakura-mid/30'
        : 'text-suwappu-text-secondary'
  const widthClass = fullWidth ? 'w-full' : ''

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${baseClass} ${sizeClass} ${variantClass} ${widthClass} ${className} disabled:opacity-50`}
    >
      {children}
    </button>
  )
}

export interface SuccessCelebrationProps {
  active?: boolean
}

export function Confetti({ active, duration: _duration, pieces: _pieces }: { active?: boolean; duration?: number; pieces?: number }) {
  if (!active) return null
  return null // Visual effect stub
}

export function SuccessCelebration({ active }: SuccessCelebrationProps) {
  if (!active) return null
  return null
}

export interface PullToRefreshProps {
  onRefresh: () => Promise<void>
  children: ReactNode
}

export function PullToRefresh({ children }: PullToRefreshProps) {
  return <>{children}</>
}

export interface HapticButtonProps extends AnimatedButtonProps {
  hapticType?: 'light' | 'medium' | 'heavy'
}

export function HapticButton(props: HapticButtonProps) {
  return <AnimatedButton {...props} />
}

export interface AnimatedCardProps {
  children: ReactNode
  className?: string
}

export function AnimatedCard({ children, className = '' }: AnimatedCardProps) {
  return <div className={className}>{children}</div>
}

export interface AnimatedListItemProps {
  children: ReactNode
  index?: number
}

export function AnimatedListItem({ children }: AnimatedListItemProps) {
  return <>{children}</>
}
