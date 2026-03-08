import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppLayout, AppHeader } from '../components/layout'
import { SettingsItem, ToggleItem } from '../components/ui'
import { WalletCard } from '../components/cards'
import { useAuth, formatAddress } from '../contexts/AuthContext'
import { api } from '../lib/api'
import type { UserPreferences, LinkedWalletInfo, UserProfile } from '../types/api'

type SettingsView = 'main' | 'slippage' | 'notifications' | 'wallets' | 'gas'

// Slippage stored as basis points (50 = 0.5%)
const bpToPercent = (bp: number) => (bp / 100).toFixed(1)
const percentToBp = (pct: string) => Math.round(parseFloat(pct) * 100)

export function Settings() {
  const [view, setView] = useState<SettingsView>('main')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // User data from API
  const [user, setUser] = useState<UserProfile | null>(null)
  const [preferences, setPreferences] = useState<UserPreferences | null>(null)
  const [wallets, setWallets] = useState<LinkedWalletInfo[]>([])

  // Local editing state for slippage
  const [slippageInput, setSlippageInput] = useState('0.5')

  const navigate = useNavigate()
  const { logout, telegramUser, walletInfo } = useAuth()

  // Load preferences on mount
  const loadPreferences = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const data = await api.getUserPreferences()
      setUser(data.user)
      setPreferences(data.preferences)
      setWallets(data.wallets)
      setSlippageInput(bpToPercent(data.preferences.defaultSlippage))
    } catch (err: any) {
      console.error('Failed to load preferences:', err)
      setError(err.detail || err.message || 'Failed to load settings')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadPreferences()
  }, [loadPreferences])

  // Save preferences to backend
  const savePreferences = useCallback(async (updates: Partial<UserPreferences>) => {
    if (!preferences) return

    try {
      setIsSaving(true)
      const result = await api.updateUserPreferences(updates)
      if (result.success) {
        setPreferences(result.preferences)
      }
    } catch (err: any) {
      console.error('Failed to save preferences:', err)
      setError(err.detail || err.message || 'Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }, [preferences])

  const handleLogout = () => {
    logout()
    navigate('/')
  }

  // Display name from API or fallback
  const displayName = user?.firstName
    ? `${user.firstName}${user.lastName ? ' ' + user.lastName : ''}`
    : user?.username
    ? `@${user.username}`
    : telegramUser?.first_name || 'User'

  // Connected wallet address
  const primaryWallet = wallets.find(w => w.isDefault) || wallets[0]
  const walletAddress = primaryWallet?.address || walletInfo?.address

  if (isLoading) {
    return (
      <AppLayout header={<AppHeader title="Settings" />} activeNav="settings">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-suwappu-magenta-mid"></div>
        </div>
      </AppLayout>
    )
  }

  if (view === 'slippage') {
    const presets = ['0.1', '0.5', '1.0']
    const currentSlippage = slippageInput

    const handleSaveSlippage = async () => {
      const bp = percentToBp(slippageInput)
      if (bp > 0 && bp <= 5000) { // Max 50%
        await savePreferences({ defaultSlippage: bp })
        setView('main')
      }
    }

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
                  onClick={() => setSlippageInput(preset)}
                  className={`flex-1 py-2 rounded-suwappu-lg text-sm font-heading font-semibold transition-colors ${
                    currentSlippage === preset
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
                value={slippageInput}
                onChange={(e) => setSlippageInput(e.target.value)}
                className="flex-1 px-3 py-2 bg-suwappu-sakura-light/50 rounded-suwappu-lg text-sm font-mono text-center focus:outline-none focus:ring-2 focus:ring-suwappu-magenta-mid/30"
              />
              <span className="text-sm text-suwappu-text-secondary">%</span>
            </div>
          </div>

          {parseFloat(slippageInput) > 1 && (
            <div className="bg-suwappu-warning/10 border border-suwappu-warning/20 rounded-suwappu-lg p-3">
              <p className="text-xs text-orange-700">
                High slippage may result in unfavorable trades
              </p>
            </div>
          )}

          <button
            onClick={handleSaveSlippage}
            disabled={isSaving}
            className="w-full py-3 bg-suwappu-gradient text-white rounded-suwappu-lg font-heading font-semibold disabled:opacity-50"
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </AppLayout>
    )
  }

  if (view === 'notifications') {
    const handleToggle = async (key: keyof UserPreferences, currentValue: boolean) => {
      await savePreferences({ [key]: !currentValue })
    }

    return (
      <AppLayout
        header={<AppHeader title="Notifications" showBack onBack={() => setView('main')} />}
        activeNav="settings"
      >
        <div className="p-3 pb-20 space-y-3">
          <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 divide-y divide-suwappu-sakura-mid/10">
            <ToggleItem
              icon="🔔"
              label="Notifications"
              description="Enable all notifications"
              enabled={preferences?.notificationsEnabled ?? true}
              onToggle={() => handleToggle('notificationsEnabled', preferences?.notificationsEnabled ?? true)}
            />
          </div>

          <p className="text-xs text-suwappu-text-secondary px-1">
            More notification settings coming soon: price alerts, transaction updates, and promotions.
          </p>
        </div>
      </AppLayout>
    )
  }

  // Gas Settings View
  if (view === 'gas') {
    const gasPresets = [
      { id: 'slow', label: '🐢 Slow', description: 'Lower fees, may take longer', multiplier: 0.8 },
      { id: 'normal', label: '⚡ Normal', description: 'Balanced speed and cost', multiplier: 1.0 },
      { id: 'fast', label: '🚀 Fast', description: 'Higher fees, faster confirmation', multiplier: 1.2 },
      { id: 'auto', label: '🤖 Auto', description: 'Automatically adjust based on network', multiplier: 1.0 },
    ]

    const gasMode = preferences?.gasMode || 'auto'

    const handleGasChange = async (mode: string) => {
      await savePreferences({ gasMode: mode })
    }

    return (
      <AppLayout
        header={<AppHeader title="Gas Settings" showBack onBack={() => setView('main')} />}
        activeNav="settings"
      >
        <div className="p-3 pb-20 space-y-4">
          <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 overflow-hidden">
            <div className="px-3 py-2 border-b border-suwappu-sakura-mid/10">
              <span className="font-heading font-semibold text-sm text-suwappu-purple-deep">
                Transaction Speed
              </span>
            </div>
            <div className="divide-y divide-suwappu-sakura-mid/10">
              {gasPresets.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => handleGasChange(preset.id)}
                  className="w-full px-3 py-3 flex items-center gap-3 hover:bg-suwappu-sakura-light/30 transition-colors"
                >
                  <div className="flex-1 text-left">
                    <p className="font-medium text-sm text-suwappu-text">{preset.label}</p>
                    <p className="text-xs text-suwappu-text-secondary">{preset.description}</p>
                  </div>
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                    gasMode === preset.id 
                      ? 'border-suwappu-magenta-mid bg-suwappu-magenta-mid' 
                      : 'border-suwappu-text-secondary/30'
                  }`}>
                    {gasMode === preset.id && (
                      <span className="text-white text-xs">✓</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <p className="text-xs text-suwappu-text-secondary px-1">
            Gas settings affect transaction speed and fees. Auto mode is recommended for most users.
          </p>

          <div className="bg-suwappu-sakura-light/30 rounded-suwappu-lg p-3">
            <p className="text-xs text-suwappu-text-secondary">
              💡 <strong>Tip:</strong> Use Fast during high network activity for quicker confirmations. 
              Slow is best for non-urgent transactions to save on fees.
            </p>
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
          {wallets.length > 0 ? (
            <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 overflow-hidden divide-y divide-suwappu-sakura-mid/10">
              {wallets.map((wallet) => (
                <WalletCard
                  key={wallet.address}
                  name={wallet.name}
                  address={wallet.address}
                  type={wallet.provider === 'turnkey' ? 'passkey' : 'walletconnect'}
                  isPrimary={wallet.isDefault}
                />
              ))}
            </div>
          ) : (
            <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-6 text-center">
              <p className="text-sm text-suwappu-text-secondary">No wallets linked yet</p>
            </div>
          )}

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
  const slippageDisplay = preferences ? bpToPercent(preferences.defaultSlippage) : '0.5'

  return (
    <AppLayout header={<AppHeader title="Settings" />} activeNav="settings">
      <div className="p-3 pb-20 space-y-4">
        {error && (
          <div className="bg-suwappu-error/10 border border-suwappu-error/20 rounded-suwappu-lg p-3">
            <p className="text-xs text-red-700">{error}</p>
          </div>
        )}

        {/* User Profile */}
        <div className="bg-suwappu-sakura-light/50 rounded-suwappu-xl p-3">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-suwappu-gradient flex items-center justify-center">
              <span className="text-white font-bold">
                {displayName.charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="flex-1">
              <p className="font-heading font-semibold text-sm text-suwappu-text">{displayName}</p>
              <p className="text-xs text-suwappu-text-secondary">
                {telegramUser ? 'Connected via Telegram' : 'Connected via Passkey'}
              </p>
            </div>
          </div>
        </div>

        {/* Connected Wallet */}
        {walletAddress && (
          <div className="bg-white rounded-suwappu-xl border border-suwappu-sakura-mid/20 p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-suwappu-text-secondary">Connected Wallet</span>
              <div className="w-2 h-2 rounded-full bg-suwappu-success" />
            </div>
            <div className="flex items-center justify-between">
              <span className="font-mono text-sm text-suwappu-text">
                {formatAddress(walletAddress)}
              </span>
              <button
                onClick={() => setView('wallets')}
                className="text-xs text-suwappu-magenta-mid font-medium"
              >
                Manage
              </button>
            </div>
          </div>
        )}

        {/* Settings Menu */}
        <div className="space-y-1">
          <SettingsItem icon="🔔" label="Notifications" hasArrow onClick={() => setView('notifications')} />
          <SettingsItem icon="📊" label="Slippage" value={`${slippageDisplay}%`} hasArrow onClick={() => setView('slippage')} />
          <SettingsItem icon="⛽" label="Gas Settings" value={preferences?.gasMode ? preferences.gasMode.charAt(0).toUpperCase() + preferences.gasMode.slice(1) : 'Auto'} hasArrow onClick={() => setView('gas')} />
          <SettingsItem icon="🌐" label="Language" value="English" hasArrow />
        </div>

        {/* Security Section */}
        <div>
          <p className="text-xs text-suwappu-text-secondary mb-2 px-1">Security</p>
          <div className="space-y-1">
            <SettingsItem
              icon="🔗"
              label="Linked Wallets"
              value={String(wallets.length)}
              hasArrow
              onClick={() => setView('wallets')}
            />
          </div>
        </div>

        {/* Support */}
        <div>
          <p className="text-xs text-suwappu-text-secondary mb-2 px-1">Support</p>
          <div className="space-y-1">
            <SettingsItem icon="❓" label="Help Center" hasArrow onClick={() => window.open('https://suwappu.bot/help', '_blank')} />
            <SettingsItem icon="💬" label="Contact Support" hasArrow onClick={() => window.open('https://t.me/suwappubot', '_blank')} />
            <SettingsItem icon="📄" label="Terms of Service" hasArrow onClick={() => window.open('https://suwappu.bot/terms', '_blank')} />
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

        {/* Version Info */}
        <div className="pt-4 space-y-1">
          <p className="text-xs text-suwappu-text-secondary text-center font-mono bg-suwappu-sakura-light/50 py-2 px-4 rounded-lg inline-block mx-auto">
            Webapp v1.4.0 • API {import.meta.env.VITE_API_URL?.includes('devapi') ? 'DEV' : 'PROD'}
          </p>
        </div>
      </div>
    </AppLayout>
  )
}
