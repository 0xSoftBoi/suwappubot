import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import '../../theme/suwappu.css'

// Telegram Mini App viewport parameters
const telegramViewport = {
  viewport: {
    viewports: {
      telegram: {
        name: 'Telegram Mini App',
        styles: { width: '390px', height: '680px' },
      },
      telegramSmall: {
        name: 'Telegram Small',
        styles: { width: '320px', height: '568px' },
      },
    },
    defaultViewport: 'telegram',
  },
}

const meta: Meta = {
  title: 'Suwappu App/Shell',
  parameters: {
    layout: 'fullscreen',
    ...telegramViewport,
    backgrounds: {
      default: 'app',
      values: [
        { name: 'app', value: '#FFFBFC' },
      ],
    },
  },
}

export default meta
type Story = StoryObj

// Compact App Header
function AppHeader({
  title = 'Suwappu',
  showBack = false,
  onBack,
  rightAction,
}: {
  title?: string
  showBack?: boolean
  onBack?: () => void
  rightAction?: React.ReactNode
}) {
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

// Bottom Navigation
type NavItem = 'home' | 'wallet' | 'swap' | 'portfolio' | 'settings'

function BottomNav({
  active = 'home',
  onNavigate,
}: {
  active?: NavItem
  onNavigate?: (item: NavItem) => void
}) {
  const items: { id: NavItem; label: string; icon: React.ReactNode }[] = [
    {
      id: 'home',
      label: 'Home',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
        </svg>
      ),
    },
    {
      id: 'wallet',
      label: 'Wallet',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
        </svg>
      ),
    },
    {
      id: 'swap',
      label: 'Swap',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
        </svg>
      ),
    },
    {
      id: 'portfolio',
      label: 'Portfolio',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      ),
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
    },
  ]

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-suwappu-sakura-mid/20 safe-area-bottom">
      <div className="flex items-center justify-around h-16 px-2">
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate?.(item.id)}
            className={`flex flex-col items-center justify-center gap-1 flex-1 py-2 transition-colors ${
              active === item.id
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

// App Layout wrapper
function AppLayout({
  children,
  header,
  activeNav = 'home',
  onNavigate,
}: {
  children: React.ReactNode
  header?: React.ReactNode
  activeNav?: NavItem
  onNavigate?: (item: NavItem) => void
}) {
  return (
    <div className="min-h-screen bg-suwappu-bg flex flex-col">
      {header}
      <main className="flex-1 pb-20 overflow-y-auto">
        {children}
      </main>
      <BottomNav active={activeNav} onNavigate={onNavigate} />
    </div>
  )
}

export const Header: Story = {
  render: () => (
    <div className="space-y-4 p-4 bg-suwappu-bg min-h-screen">
      <AppHeader title="Suwappu" />
      <AppHeader title="Wallet" showBack onBack={() => {}} />
      <AppHeader
        title="Settings"
        rightAction={
          <button className="p-1.5 text-suwappu-text-secondary">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        }
      />
    </div>
  ),
}

export const Navigation: Story = {
  render: () => {
    const [active, setActive] = useState<NavItem>('home')
    return (
      <div className="bg-suwappu-bg min-h-screen pb-16">
        <div className="p-4 text-center">
          <p className="font-body text-suwappu-text-secondary text-sm">
            Active: <span className="font-semibold text-suwappu-magenta-mid">{active}</span>
          </p>
        </div>
        <BottomNav active={active} onNavigate={setActive} />
      </div>
    )
  },
}

export const FullLayout: Story = {
  render: () => {
    const [active, setActive] = useState<NavItem>('home')
    return (
      <AppLayout
        header={<AppHeader title="Suwappu" />}
        activeNav={active}
        onNavigate={setActive}
      >
        <div className="p-4">
          <div className="bg-white rounded-suwappu-xl p-4 shadow-suwappu-1">
            <p className="font-body text-suwappu-text text-sm">
              App content goes here. Current screen: {active}
            </p>
          </div>
        </div>
      </AppLayout>
    )
  },
}
