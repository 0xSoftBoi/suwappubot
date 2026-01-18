import React from 'react'

export interface AppHeaderProps {
  title?: string
  showBack?: boolean
  onBack?: () => void
  rightAction?: React.ReactNode
}

export function AppHeader({
  title = 'Suwappu',
  showBack = false,
  onBack,
  rightAction,
}: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-suwappu-sakura-mid/20">
      <div className="flex items-center justify-between h-12 px-3">
        <div className="flex items-center gap-2 min-w-[40px]">
          {showBack ? (
            <button
              onClick={onBack}
              className="p-1.5 -ml-1.5 text-suwappu-text-secondary hover:text-suwappu-text transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          ) : (
            <div className="w-7 h-7 rounded-full bg-suwappu-gradient flex items-center justify-center">
              <span className="text-white text-xs font-bold">S</span>
            </div>
          )}
        </div>

        <h1 className="font-heading font-bold text-sm text-suwappu-purple-deep truncate">
          {title}
        </h1>

        <div className="min-w-[40px] flex justify-end">
          {rightAction}
        </div>
      </div>
    </header>
  )
}
