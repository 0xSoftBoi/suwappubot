import React from 'react'
import { useNavigate, useLocation } from 'react-router-dom'

export type NavItem = 'home' | 'wallet' | 'swap' | 'portfolio' | 'settings'

export interface BottomNavProps {
  active?: NavItem
  onNavigate?: (item: NavItem) => void
}

const navItems: { id: NavItem; label: string; path: string; icon: React.ReactNode }[] = [
  {
    id: 'home',
    label: 'Home',
    path: '/home',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
  {
    id: 'wallet',
    label: 'Wallet',
    path: '/wallet',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
      </svg>
    ),
  },
  {
    id: 'swap',
    label: 'Swap',
    path: '/swap',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
      </svg>
    ),
  },
  {
    id: 'portfolio',
    label: 'Portfolio',
    path: '/portfolio',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
  },
  {
    id: 'settings',
    label: 'Settings',
    path: '/settings',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
]

export function BottomNav({ active, onNavigate }: BottomNavProps) {
  const navigate = useNavigate()
  const location = useLocation()

  const handleNavigate = (item: typeof navItems[0]) => {
    if (onNavigate) {
      onNavigate(item.id)
    } else {
      navigate(item.path)
    }
  }

  // Determine active item from route if not explicitly provided
  const activeItem = active || navItems.find(item => location.pathname.startsWith(item.path))?.id || 'home'

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-suwappu-sakura-mid/20 safe-area-bottom">
      <div className="flex items-center justify-around h-16 px-2">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => handleNavigate(item)}
            className={`flex flex-col items-center justify-center gap-1 flex-1 py-2 transition-colors ${
              activeItem === item.id
                ? 'text-suwappu-magenta-mid'
                : 'text-suwappu-text-secondary hover:text-suwappu-text'
            }`}
          >
            {item.icon}
            <span className="text-xs font-heading font-medium">{item.label}</span>
          </button>
        ))}
      </div>
    </nav>
  )
}
