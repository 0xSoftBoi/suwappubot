import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { AppLayout, AppHeader } from '../components/layout'
import { SettingsItem, ToggleItem } from '../components/ui'
import { WalletCard } from '../components/cards'
import { useAuth } from '../contexts/AuthContext'

type SettingsView = 'main' | 'slippage' | 'notifications' | 'wallets'

export function Settings() {
  const [view, setView] = useState<SettingsView>('main')
  const [slippage, setSlippage] = useState('0.5')
  const [priceAlerts, setPriceAlerts] = useState(true)
  const [txUpdates, setTxUpdates] = useState(true)
  const [promotions, setPromotions] = useState(false)
  const navigate = useNavigate()
  const { logout } = useAuth()

  const handleLogout = () => {
    logout()
    navigate({ to: '/' })
  }

  if (view === 'slippage') {
    const presets = ['0.1', '0.5', '1.0']
    return (
      <AppLayout
        header={<AppHeader title="Slippage" showBack onBack={() => setView('main')} />}
        activeNav="settings"
      >
        <div className="p-3 pb-20 space-y-4">
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
                className="flex-1 px-3 py-2 bg-suwappu-sakura-light/50 rounded-suwappu-lg text-sm font-mono text-center focus:outline-none focus:ring-2 focus:ring-suwappu-magenta-mid/30"
              />
              <span className="text-sm text-suwappu-text-secondary">%</span>
            </div>
          </div>

          {parseFloat(slippage) > 1 && (
            <div className="bg-suwappu-warning/10 border border-suwappu-warning/20 rounded-suwappu-lg p-3">
              <p className="text-xs text-orange-700">
                High slippage may result in unfavorable trades
              </p>
            </div>
          )}
        </div>
      </AppLayout>
    )
  }

  if (view === 'notifications') {
    return (
      <AppLayout
        header={<AppHeader title="Notifications" showBack onBack={() => setView('main')} />}
        activeNav="settings"
      >
        <div className="p-3 pb-20 space-y-3">
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
        </div>
      </AppLayout>
    )
  }

  if (view === 'wallets') {
    return (
      <AppLayout
        header={<AppHeader title="Linked Wallets" showBack onBack={() => setView('main')} />}
        activeNav="settings"
      >
        <div className="p-3 pb-20 space-y-3">
          <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 overflow-hidden divide-y divide-suwappu-sakura-mid/10">
            <WalletCard
              name="Turnkey Wallet"
              address="0x9876543210abcdef9876543210abcdef98765432"
              type="passkey"
              isPrimary
            />
            <WalletCard
              name="MetaMask"
              address="0x1234567890abcdef1234567890abcdef12345678"
              type="metamask"
              onAction={() => {}}
            />
          </div>

          <button className="w-full flex items-center justify-center gap-2 p-3 bg-white rounded-suwappu-xl shadow-suwappu-1 text-suwappu-magenta-mid font-heading font-semibold text-sm border-2 border-dashed border-suwappu-sakura-mid">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Wallet
          </button>
        </div>
      </AppLayout>
    )
  }

  // Main settings view
  return (
    <AppLayout header={<AppHeader title="Settings" />} activeNav="settings">
      <div className="p-3 pb-20 space-y-4">
        {/* User Profile */}
        <div className="bg-suwappu-sakura-light/50 rounded-suwappu-xl p-3">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-suwappu-gradient flex items-center justify-center">
              <span className="text-white font-bold">S</span>
            </div>
            <div className="flex-1">
              <p className="font-heading font-semibold text-sm text-suwappu-text">Suwappu User</p>
              <p className="text-xs text-suwappu-text-secondary">Connected via Passkey</p>
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
            <span className="font-mono text-sm text-suwappu-text">0x7a3b...9f2e</span>
            <button className="text-xs text-suwappu-magenta-mid font-medium">Change</button>
          </div>
        </div>

        {/* Settings Menu */}
        <div className="space-y-1">
          <SettingsItem icon="🔔" label="Notifications" hasArrow onClick={() => setView('notifications')} />
          <SettingsItem icon="📊" label="Slippage" value={`${slippage}%`} hasArrow onClick={() => setView('slippage')} />
          <SettingsItem icon="🌐" label="Language" value="English" hasArrow />
        </div>

        {/* Security Section */}
        <div>
          <p className="text-xs text-suwappu-text-secondary mb-2 px-1">Security</p>
          <div className="space-y-1">
            <SettingsItem icon="🔗" label="Linked Wallets" value="2" hasArrow onClick={() => setView('wallets')} />
            <SettingsItem icon="📱" label="Active Sessions" value="1" hasArrow />
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

        {/* Logout */}
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 p-2.5 rounded-suwappu-lg hover:bg-suwappu-error/10 transition-colors text-suwappu-error"
        >
          <span className="text-lg">🚪</span>
          <span className="flex-1 text-left text-sm font-heading font-medium">Log Out</span>
        </button>

        <div className="pt-4">
          <p className="text-[10px] text-suwappu-text-secondary text-center">
            Suwappu v1.0.0
          </p>
        </div>
      </div>
    </AppLayout>
  )
}
