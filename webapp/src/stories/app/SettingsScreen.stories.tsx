import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import '../../theme/suwappu.css'

const meta: Meta = {
  title: 'Suwappu App/Settings',
  parameters: {
    layout: 'fullscreen',
    viewport: {
      viewports: {
        telegram: {
          name: 'Telegram Mini App',
          styles: { width: '390px', height: '680px' },
        },
      },
      defaultViewport: 'telegram',
    },
    backgrounds: {
      default: 'app',
      values: [{ name: 'app', value: '#FFFBFC' }],
    },
  },
}

export default meta
type Story = StoryObj

// Settings Drawer
function SettingsDrawer({
  isOpen,
  onClose,
}: {
  isOpen: boolean
  onClose: () => void
}) {
  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40"
        onClick={onClose}
      />
      {/* Drawer */}
      <div className="fixed inset-y-0 right-0 w-[85%] max-w-sm bg-white shadow-2xl z-50 flex flex-col animate-slide-in">
        <div className="flex items-center justify-between p-3 border-b border-suwappu-sakura-mid/20">
          <span className="font-heading font-bold text-sm text-suwappu-purple-deep">Settings</span>
          <button onClick={onClose} className="p-1.5 text-suwappu-text-secondary">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          {/* User Profile */}
          <div className="bg-suwappu-sakura-light/50 rounded-suwappu-xl p-3">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-suwappu-gradient flex items-center justify-center">
                <span className="text-white font-bold">JD</span>
              </div>
              <div className="flex-1">
                <p className="font-heading font-semibold text-sm text-suwappu-text">@johndoe</p>
                <p className="text-xs text-suwappu-text-secondary">Telegram User</p>
              </div>
            </div>
          </div>

          {/* Connected Wallet */}
          <div className="bg-white rounded-suwappu-xl border border-suwappu-sakura-mid/20 p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-suwappu-text-secondary">Connected Wallet</span>
              <div className="w-2 h-2 rounded-full bg-suwappu-success" />
            </div>
            <div className="flex items-center justify-between">
              <span className="font-mono text-sm text-suwappu-text">0x1234...5678</span>
              <button className="text-xs text-suwappu-magenta-mid font-medium">Change</button>
            </div>
          </div>

          {/* Settings Menu */}
          <div className="space-y-1">
            <SettingsItem icon="🔔" label="Notifications" hasArrow />
            <SettingsItem icon="🎨" label="Appearance" hasArrow />
            <SettingsItem icon="⛽" label="Default Gas" value="Medium" hasArrow />
            <SettingsItem icon="📊" label="Slippage" value="0.5%" hasArrow />
            <SettingsItem icon="🌐" label="Language" value="English" hasArrow />
          </div>

          {/* Security Section */}
          <div>
            <p className="text-xs text-suwappu-text-secondary mb-2 px-1">Security</p>
            <div className="space-y-1">
              <SettingsItem icon="🔐" label="Create Passkey Wallet" hasArrow />
              <SettingsItem icon="🔗" label="Linked Wallets" value="1" hasArrow />
              <SettingsItem icon="📱" label="Active Sessions" value="2" hasArrow />
            </div>
          </div>

          {/* Support */}
          <div>
            <p className="text-xs text-suwappu-text-secondary mb-2 px-1">Support</p>
            <div className="space-y-1">
              <SettingsItem icon="❓" label="Help Center" hasArrow />
              <SettingsItem icon="💬" label="Contact Support" hasArrow />
              <SettingsItem icon="📄" label="Terms of Service" hasArrow />
            </div>
          </div>
        </div>

        <div className="p-3 border-t border-suwappu-sakura-mid/20">
          <p className="text-[10px] text-suwappu-text-secondary text-center">
            Suwappu v1.0.0
          </p>
        </div>
      </div>
    </>
  )
}

// Settings Item
function SettingsItem({
  icon,
  label,
  value,
  hasArrow,
  danger,
}: {
  icon: string
  label: string
  value?: string
  hasArrow?: boolean
  danger?: boolean
}) {
  return (
    <button className={`w-full flex items-center gap-3 p-2.5 rounded-suwappu-lg hover:bg-suwappu-sakura-light/30 transition-colors ${danger ? 'text-suwappu-error' : ''}`}>
      <span className="text-lg">{icon}</span>
      <span className={`flex-1 text-left text-sm font-heading font-medium ${danger ? 'text-suwappu-error' : 'text-suwappu-text'}`}>
        {label}
      </span>
      {value && <span className="text-xs text-suwappu-text-secondary">{value}</span>}
      {hasArrow && (
        <svg className="w-4 h-4 text-suwappu-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      )}
    </button>
  )
}

// Header with menu button
function Header({ onMenuClick }: { onMenuClick?: () => void }) {
  return (
    <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-suwappu-sakura-mid/20">
      <div className="flex items-center justify-between h-12 px-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-suwappu-gradient flex items-center justify-center">
            <span className="text-white text-xs font-bold">S</span>
          </div>
          <span className="font-heading font-bold text-sm text-suwappu-purple-deep">Suwappu</span>
        </div>
        <button onClick={onMenuClick} className="p-1.5 text-suwappu-text-secondary">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </div>
    </header>
  )
}

// Bottom Nav (minimal for settings context)
function BottomNav() {
  const items = [
    { id: 'home', label: 'Home', icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    )},
    { id: 'wallet', label: 'Wallet', icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
      </svg>
    )},
    { id: 'swap', label: 'Swap', icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
      </svg>
    )},
    { id: 'portfolio', label: 'Portfolio', icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    )},
  ]

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-suwappu-sakura-mid/20">
      <div className="flex items-center justify-around h-16 px-2">
        {items.map((item) => (
          <button
            key={item.id}
            className="flex flex-col items-center gap-1 flex-1 py-2 text-suwappu-text-secondary transition-colors"
          >
            {item.icon}
            <span className="text-xs font-heading font-medium">{item.label}</span>
          </button>
        ))}
      </div>
    </nav>
  )
}

export const DrawerClosed: Story = {
  render: () => {
    const [isOpen, setIsOpen] = useState(false)
    return (
      <div className="min-h-screen bg-suwappu-bg overflow-x-hidden max-w-full">
        <Header onMenuClick={() => setIsOpen(true)} />
        <main className="p-3 pb-20">
          <div className="bg-white rounded-suwappu-xl p-4 shadow-suwappu-1 text-center">
            <p className="text-sm text-suwappu-text-secondary">
              Click the menu icon to open settings
            </p>
          </div>
        </main>
        <BottomNav />
        <SettingsDrawer isOpen={isOpen} onClose={() => setIsOpen(false)} />
      </div>
    )
  },
}

export const DrawerOpen: Story = {
  render: () => {
    const [isOpen, setIsOpen] = useState(true)
    return (
      <div className="min-h-screen bg-suwappu-bg overflow-x-hidden max-w-full">
        <Header onMenuClick={() => setIsOpen(true)} />
        <main className="p-3 pb-20">
          <div className="bg-white rounded-suwappu-xl p-4 shadow-suwappu-1">
            <p className="text-sm text-suwappu-text-secondary text-center">
              Main content behind drawer
            </p>
          </div>
        </main>
        <BottomNav />
        <SettingsDrawer isOpen={isOpen} onClose={() => setIsOpen(false)} />
      </div>
    )
  },
}

export const SlippageSettings: Story = {
  render: () => {
    const [slippage, setSlippage] = useState('0.5')
    const presets = ['0.1', '0.5', '1.0']

    return (
      <div className="min-h-screen bg-suwappu-bg overflow-x-hidden max-w-full">
        <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-suwappu-sakura-mid/20">
          <div className="flex items-center justify-between h-12 px-3">
            <button className="p-1.5 -ml-1.5 text-suwappu-text-secondary">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <span className="font-heading font-bold text-sm text-suwappu-purple-deep">Slippage</span>
            <div className="w-8" />
          </div>
        </header>
        <main className="p-3 pb-20 space-y-4">
          <div className="bg-white rounded-suwappu-xl p-4 shadow-suwappu-1">
            <p className="text-xs text-suwappu-text-secondary mb-3">
              Slippage tolerance is the maximum price change you're willing to accept
            </p>

            <div className="flex gap-2 mb-3">
              {presets.map((preset) => (
                <button
                  key={preset}
                  onClick={() => setSlippage(preset)}
                  className={`flex-1 py-2 rounded-suwappu-lg text-sm font-heading font-semibold transition-colors ${
                    slippage === preset
                      ? 'bg-suwappu-gradient text-white'
                      : 'bg-suwappu-sakura-light text-suwappu-text'
                  }`}
                >
                  {preset}%
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={slippage}
                onChange={(e) => setSlippage(e.target.value)}
                className="flex-1 px-3 py-2 bg-suwappu-sakura-light/50 rounded-suwappu-lg text-sm font-mono text-center focus:outline-hidden focus:ring-2 focus:ring-suwappu-magenta-mid/30"
              />
              <span className="text-sm text-suwappu-text-secondary">%</span>
            </div>
          </div>

          {parseFloat(slippage) > 1 && (
            <div className="bg-suwappu-warning/10 border border-suwappu-warning/20 rounded-suwappu-lg p-3">
              <p className="text-xs text-suwappu-warning">
                High slippage may result in unfavorable trades
              </p>
            </div>
          )}
        </main>
        <BottomNav />
      </div>
    )
  },
}

export const NotificationSettings: Story = {
  render: () => {
    const [priceAlerts, setPriceAlerts] = useState(true)
    const [txUpdates, setTxUpdates] = useState(true)
    const [promotions, setPromotions] = useState(false)

    return (
      <div className="min-h-screen bg-suwappu-bg overflow-x-hidden max-w-full">
        <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-suwappu-sakura-mid/20">
          <div className="flex items-center justify-between h-12 px-3">
            <button className="p-1.5 -ml-1.5 text-suwappu-text-secondary">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <span className="font-heading font-bold text-sm text-suwappu-purple-deep">Notifications</span>
            <div className="w-8" />
          </div>
        </header>
        <main className="p-3 pb-20 space-y-3">
          <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 divide-y divide-suwappu-sakura-mid/10">
            <ToggleItem
              icon="📈"
              label="Price Alerts"
              description="Get notified when tokens hit your target"
              enabled={priceAlerts}
              onToggle={() => setPriceAlerts(!priceAlerts)}
            />
            <ToggleItem
              icon="🔄"
              label="Transaction Updates"
              description="Swap confirmations and status updates"
              enabled={txUpdates}
              onToggle={() => setTxUpdates(!txUpdates)}
            />
            <ToggleItem
              icon="🎁"
              label="Promotions"
              description="News, updates, and special offers"
              enabled={promotions}
              onToggle={() => setPromotions(!promotions)}
            />
          </div>
        </main>
        <BottomNav />
      </div>
    )
  },
}

function ToggleItem({
  icon,
  label,
  description,
  enabled,
  onToggle,
}: {
  icon: string
  label: string
  description: string
  enabled: boolean
  onToggle: () => void
}) {
  return (
    <div className="flex items-center gap-3 p-3">
      <span className="text-lg">{icon}</span>
      <div className="flex-1">
        <p className="font-heading font-semibold text-sm text-suwappu-text">{label}</p>
        <p className="text-xs text-suwappu-text-secondary">{description}</p>
      </div>
      <button
        onClick={onToggle}
        className={`relative w-11 h-6 rounded-full transition-colors ${
          enabled ? 'bg-suwappu-gradient' : 'bg-suwappu-text-secondary/30'
        }`}
      >
        <div
          className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${
            enabled ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  )
}

export const LinkedWallets: Story = {
  render: () => (
    <div className="min-h-screen bg-suwappu-bg overflow-x-hidden max-w-full">
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-suwappu-sakura-mid/20">
        <div className="flex items-center justify-between h-12 px-3">
          <button className="p-1.5 -ml-1.5 text-suwappu-text-secondary">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="font-heading font-bold text-sm text-suwappu-purple-deep">Linked Wallets</span>
          <div className="w-8" />
        </div>
      </header>
      <main className="p-3 pb-20 space-y-3">
        <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 overflow-hidden">
          <div className="flex items-center gap-3 p-3 border-b border-suwappu-sakura-mid/10">
            <div className="w-10 h-10 rounded-full bg-suwappu-gradient flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
              </svg>
            </div>
            <div className="flex-1">
              <p className="font-heading font-semibold text-sm text-suwappu-text">Turnkey Wallet</p>
              <p className="font-mono text-xs text-suwappu-text-secondary">0x9876...4321</p>
            </div>
            <div className="px-2 py-0.5 bg-suwappu-success/20 rounded-full">
              <span className="text-[10px] text-suwappu-success font-medium">Primary</span>
            </div>
          </div>

        </div>

        <button className="w-full flex items-center justify-center gap-2 p-3 bg-white rounded-suwappu-xl shadow-suwappu-1 text-suwappu-magenta-mid font-heading font-semibold text-sm border-2 border-dashed border-suwappu-sakura-mid">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Wallet
        </button>
      </main>
      <BottomNav />
    </div>
  ),
}
