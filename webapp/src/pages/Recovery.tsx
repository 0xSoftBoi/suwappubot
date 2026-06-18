import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppLayout, AppHeader } from '../components/layout'
import { isPasskeySupported, registerPasskey } from '../lib/turnkey-passkey'
import { getInitData } from '../lib/telegram'
import { getAuthToken } from '../lib/auth'

const API_BASE = import.meta.env.VITE_API_URL || ''

type RecoveryView = 'status' | 'setup' | 'initiate' | 'complete'

type RecoveryStatus = {
  has_recovery: boolean
  recovery_email: string | null
  setup_at: string | null
  has_turnkey_wallet: boolean
}

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const initData = getInitData()
  if (initData) headers['X-Telegram-Init-Data'] = initData
  const token = getAuthToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  return headers
}

async function apiFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: { ...getHeaders(), ...(options.headers as Record<string, string>) },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: 'Request failed' }))
    throw new Error(body.detail || body.message || 'Request failed')
  }
  return response.json()
}

export function Recovery() {
  const [view, setView] = useState<RecoveryView>('status')
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [status, setStatus] = useState<RecoveryStatus | null>(null)

  // Form state
  const [email, setEmail] = useState('')
  const [recoveryEmail, setRecoveryEmail] = useState('')
  const [recoveryStep, setRecoveryStep] = useState<'email' | 'sent' | 'passkey'>('email')

  const navigate = useNavigate()

  const loadStatus = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const data = await apiFetch<RecoveryStatus>('/webapp/recovery/status')
      setStatus(data)
    } catch (err: any) {
      console.error('Failed to load recovery status:', err)
      setError(err.message || 'Failed to load recovery status')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  const handleSetupEmail = async () => {
    if (!email || !email.includes('@')) {
      setError('Please enter a valid email address')
      return
    }

    try {
      setIsSubmitting(true)
      setError(null)
      await apiFetch('/webapp/recovery/setup', {
        method: 'POST',
        body: JSON.stringify({ email }),
      })
      setSuccess('Recovery email saved successfully')
      setEmail('')
      await loadStatus()
      setView('status')
    } catch (err: any) {
      setError(err.message || 'Failed to set up recovery email')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleInitiateRecovery = async () => {
    if (!recoveryEmail || !recoveryEmail.includes('@')) {
      setError('Please enter your recovery email')
      return
    }

    try {
      setIsSubmitting(true)
      setError(null)
      await apiFetch('/webapp/recovery/initiate', {
        method: 'POST',
        body: JSON.stringify({ email: recoveryEmail }),
      })
      setRecoveryStep('sent')
      setSuccess('Recovery email sent. Check your inbox.')
    } catch (err: any) {
      setError(err.message || 'Failed to initiate recovery')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCompleteRecovery = async () => {
    if (!isPasskeySupported()) {
      setError('Passkeys are not supported in this browser')
      return
    }

    try {
      setIsSubmitting(true)
      setError(null)

      const result = await registerPasskey('Recovery Passkey')

      if (!result.success) {
        setError(result.error || 'Failed to create new passkey')
        return
      }

      setSuccess('Wallet recovered successfully! You can now access your funds.')
      setRecoveryStep('email')
      setView('status')
      await loadStatus()
    } catch (err: any) {
      setError(err.detail || err.message || 'Failed to complete recovery')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isLoading) {
    return (
      <AppLayout header={<AppHeader title="Recovery" showBack onBack={() => navigate('/settings')} />} activeNav="settings">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-suwappu-magenta-mid"></div>
        </div>
      </AppLayout>
    )
  }

  // Setup recovery email view
  if (view === 'setup') {
    return (
      <AppLayout
        header={<AppHeader title="Set Up Recovery" showBack onBack={() => setView('status')} />}
        activeNav="settings"
      >
        <div className="p-3 pb-20 space-y-4">
          <div className="bg-white rounded-suwappu-xl p-4 shadow-suwappu-1">
            <p className="text-xs text-suwappu-text-secondary mb-3">
              Enter an email address to use for wallet recovery. If you lose access to your
              Telegram account or passkey device, you can recover your wallet using this email.
            </p>

            <input
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(null) }}
              placeholder="your@email.com"
              className="w-full px-3 py-2 bg-suwappu-sakura-light/50 rounded-suwappu-lg text-sm focus:outline-none focus:ring-2 focus:ring-suwappu-magenta-mid/30"
            />
          </div>

          {error && (
            <div className="bg-suwappu-error/10 border border-suwappu-error/20 rounded-suwappu-lg p-3">
              <p className="text-xs text-red-700">{error}</p>
            </div>
          )}

          <button
            onClick={handleSetupEmail}
            disabled={isSubmitting || !email}
            className="w-full py-3 bg-suwappu-gradient text-white rounded-suwappu-lg font-heading font-semibold disabled:opacity-50"
          >
            {isSubmitting ? 'Saving...' : 'Save Recovery Email'}
          </button>
        </div>
      </AppLayout>
    )
  }

  // Initiate recovery view
  if (view === 'initiate') {
    return (
      <AppLayout
        header={<AppHeader title="Recover Wallet" showBack onBack={() => { setView('status'); setRecoveryStep('email') }} />}
        activeNav="settings"
      >
        <div className="p-3 pb-20 space-y-4">
          {recoveryStep === 'email' && (
            <>
              <div className="bg-white rounded-suwappu-xl p-4 shadow-suwappu-1">
                <p className="text-xs text-suwappu-text-secondary mb-3">
                  Enter the recovery email you set up previously. We'll send a recovery link
                  to verify your identity.
                </p>

                <input
                  type="email"
                  value={recoveryEmail}
                  onChange={(e) => { setRecoveryEmail(e.target.value); setError(null) }}
                  placeholder="your@email.com"
                  className="w-full px-3 py-2 bg-suwappu-sakura-light/50 rounded-suwappu-lg text-sm focus:outline-none focus:ring-2 focus:ring-suwappu-magenta-mid/30"
                />
              </div>

              {error && (
                <div className="bg-suwappu-error/10 border border-suwappu-error/20 rounded-suwappu-lg p-3">
                  <p className="text-xs text-red-700">{error}</p>
                </div>
              )}

              <button
                onClick={handleInitiateRecovery}
                disabled={isSubmitting || !recoveryEmail}
                className="w-full py-3 bg-suwappu-gradient text-white rounded-suwappu-lg font-heading font-semibold disabled:opacity-50"
              >
                {isSubmitting ? 'Sending...' : 'Send Recovery Email'}
              </button>
            </>
          )}

          {recoveryStep === 'sent' && (
            <>
              <div className="bg-white rounded-suwappu-xl p-4 shadow-suwappu-1 text-center">
                <div className="text-4xl mb-3">📧</div>
                <p className="font-heading font-semibold text-sm text-suwappu-text mb-2">
                  Check Your Email
                </p>
                <p className="text-xs text-suwappu-text-secondary">
                  We've sent a recovery link to your email. Follow the instructions
                  in the email, then come back here to register a new passkey.
                </p>
              </div>

              {success && (
                <div className="bg-suwappu-success/10 border border-suwappu-success/20 rounded-suwappu-lg p-3">
                  <p className="text-xs text-green-700">{success}</p>
                </div>
              )}

              <button
                onClick={() => setRecoveryStep('passkey')}
                className="w-full py-3 bg-suwappu-gradient text-white rounded-suwappu-lg font-heading font-semibold"
              >
                I've Verified My Email
              </button>
            </>
          )}

          {recoveryStep === 'passkey' && (
            <>
              <div className="bg-white rounded-suwappu-xl p-4 shadow-suwappu-1 text-center">
                <div className="text-4xl mb-3">🔑</div>
                <p className="font-heading font-semibold text-sm text-suwappu-text mb-2">
                  Register New Passkey
                </p>
                <p className="text-xs text-suwappu-text-secondary">
                  Create a new passkey to regain access to your wallet.
                  You'll be prompted by your device's biometric authentication.
                </p>
              </div>

              {error && (
                <div className="bg-suwappu-error/10 border border-suwappu-error/20 rounded-suwappu-lg p-3">
                  <p className="text-xs text-red-700">{error}</p>
                </div>
              )}

              <button
                onClick={handleCompleteRecovery}
                disabled={isSubmitting}
                className="w-full py-3 bg-suwappu-gradient text-white rounded-suwappu-lg font-heading font-semibold disabled:opacity-50"
              >
                {isSubmitting ? 'Registering...' : 'Register New Passkey'}
              </button>
            </>
          )}
        </div>
      </AppLayout>
    )
  }

  // Main status view
  const hasRecovery = status?.has_recovery
  const hasTurnkey = status?.has_turnkey_wallet
  const maskedEmail = status?.recovery_email
    ? status.recovery_email.substring(0, 3) + '***' + status.recovery_email.substring(status.recovery_email.indexOf('@'))
    : null

  return (
    <AppLayout
      header={<AppHeader title="Recovery" showBack onBack={() => navigate('/settings')} />}
      activeNav="settings"
    >
      <div className="p-3 pb-20 space-y-4">
        {success && (
          <div className="bg-suwappu-success/10 border border-suwappu-success/20 rounded-suwappu-lg p-3">
            <p className="text-xs text-green-700">{success}</p>
          </div>
        )}

        {error && (
          <div className="bg-suwappu-error/10 border border-suwappu-error/20 rounded-suwappu-lg p-3">
            <p className="text-xs text-red-700">{error}</p>
          </div>
        )}

        {!hasTurnkey ? (
          <div className="bg-white rounded-suwappu-xl p-4 shadow-suwappu-1 text-center">
            <div className="text-4xl mb-3">🔒</div>
            <p className="font-heading font-semibold text-sm text-suwappu-text mb-2">
              Not Available
            </p>
            <p className="text-xs text-suwappu-text-secondary">
              Wallet recovery is only available for Turnkey (passkey) wallets.
              Create a passkey wallet to enable recovery options.
            </p>
          </div>
        ) : hasRecovery ? (
          <>
            <div className="bg-white rounded-suwappu-xl p-4 shadow-suwappu-1">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-suwappu-success/10 flex items-center justify-center">
                  <span className="text-lg">✓</span>
                </div>
                <div>
                  <p className="font-heading font-semibold text-sm text-suwappu-text">
                    Recovery Set Up
                  </p>
                  <p className="text-xs text-suwappu-text-secondary">
                    Your wallet is protected
                  </p>
                </div>
              </div>

              <div className="space-y-2 bg-suwappu-sakura-light/50 rounded-suwappu-lg p-3">
                <div className="flex justify-between">
                  <span className="text-xs text-suwappu-text-secondary">Email</span>
                  <span className="text-xs font-mono text-suwappu-text">{maskedEmail}</span>
                </div>
                {status?.setup_at && (
                  <div className="flex justify-between">
                    <span className="text-xs text-suwappu-text-secondary">Since</span>
                    <span className="text-xs text-suwappu-text">
                      {new Date(status.setup_at).toLocaleDateString()}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <button
              onClick={() => { setView('setup'); setError(null); setSuccess(null) }}
              className="w-full py-3 bg-white border border-suwappu-sakura-mid/30 text-suwappu-text rounded-suwappu-lg font-heading font-semibold text-sm"
            >
              Update Recovery Email
            </button>
          </>
        ) : (
          <>
            <div className="bg-white rounded-suwappu-xl p-4 shadow-suwappu-1 text-center">
              <div className="text-4xl mb-3">🔑</div>
              <p className="font-heading font-semibold text-sm text-suwappu-text mb-2">
                Set Up Recovery
              </p>
              <p className="text-xs text-suwappu-text-secondary">
                Protect your wallet by adding a recovery email. If you lose access
                to your Telegram or passkey device, you can recover your funds.
              </p>
            </div>

            <button
              onClick={() => { setView('setup'); setError(null); setSuccess(null) }}
              className="w-full py-3 bg-suwappu-gradient text-white rounded-suwappu-lg font-heading font-semibold"
            >
              Set Up Recovery Email
            </button>
          </>
        )}

        {/* Recovery initiation - always available for users who lost access */}
        <div className="pt-2">
          <p className="text-xs text-suwappu-text-secondary mb-2 px-1">Lost access?</p>
          <button
            onClick={() => { setView('initiate'); setError(null); setSuccess(null) }}
            className="w-full flex items-center gap-3 p-3 bg-white rounded-suwappu-xl shadow-suwappu-1 text-sm font-heading font-medium text-suwappu-text"
          >
            <span className="text-lg">🔄</span>
            <span className="flex-1 text-left">Recover Wallet</span>
            <svg className="w-4 h-4 text-suwappu-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </AppLayout>
  )
}
