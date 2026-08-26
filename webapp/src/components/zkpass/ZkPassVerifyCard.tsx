import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../lib/api'
import { openExternalLink, isTelegramWebApp } from '../../lib/telegram'
import type { ZkPassStatus } from '../../types/api'

// The SDK's own `launch()` signature returns `Promise<unknown>` (it can also
// resolve to a `TransgateError` instance when the allocator/validator task
// check fails) — this narrows the success shape per Transgate-JS-SDK's
// `Result` type (lib/types.d.ts) so we can safely spread it into the verify
// request body below.
interface TransgateProofResult {
  taskId: string
  uHash: string
  publicFields: unknown[]
  publicFieldsHash: string
  validatorAddress: string
  validatorSignature: string
  allocatorAddress: string
  allocatorSignature: string
  recipient?: string
}

/**
 * Self-contained "Verify with zkPass" card for the Settings screen.
 *
 * zkPass TransGate is a browser extension — it is never available inside
 * Telegram's embedded WebView. We check `isTransgateAvailable()` before
 * ever calling `launch()` so we can show a clear "open in browser" message
 * instead of letting the SDK fail confusingly.
 */
export function ZkPassVerifyCard() {
  const { t } = useTranslation()

  const [status, setStatus] = useState<ZkPassStatus | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isVerifying, setIsVerifying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [extensionAvailable, setExtensionAvailable] = useState<boolean | null>(null)

  const loadStatus = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const data = await api.getZkPassStatus()
      setStatus(data)
    } catch (err: any) {
      console.error('Failed to load zkPass status:', err)
      setError(err.detail || err.message || t('settings.identityLoadError'))
    } finally {
      setIsLoading(false)
    }
  }, [t])

  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  const handleVerify = async () => {
    setError(null)
    setIsVerifying(true)
    try {
      const [{ default: TransgateConnect }, config] = await Promise.all([
        import('@zkpass/transgate-js-sdk'),
        api.getZkPassConfig(),
      ])

      const connector = new TransgateConnect(config.appId)
      const isAvailable = await connector.isTransgateAvailable()
      setExtensionAvailable(isAvailable)

      if (!isAvailable) {
        return
      }

      const result = (await connector.launch(config.schemaId, undefined)) as TransgateProofResult
      if (!result || typeof result !== 'object' || !('taskId' in result)) {
        setError(t('settings.identityCancelled'))
        return
      }
      // The SDK's launch() result does not echo back the schemaId used to
      // request it (confirmed against Transgate-JS-SDK's `Result` type) —
      // the backend's signature verification needs it, so it must be sent
      // alongside the raw result explicitly.
      const verifyResult = await api.verifyZkPass({ ...result, schemaId: config.schemaId })
      setStatus((prev) => ({
        verified: verifyResult.isValid,
        verifiedAt: verifyResult.isValid ? new Date().toISOString() : prev?.verifiedAt ?? null,
        schemaId: verifyResult.isValid ? config.schemaId : prev?.schemaId ?? null,
      }))

      if (!verifyResult.isValid) {
        setError(t('settings.identityCancelled'))
      }
    } catch (err: any) {
      console.error('zkPass verification failed:', err)
      setError(err.detail || err.message || t('settings.identityCancelled'))
    } finally {
      setIsVerifying(false)
    }
  }

  const handleOpenInBrowser = () => {
    if (isTelegramWebApp()) {
      openExternalLink(window.location.href)
    } else {
      window.open(window.location.href, '_blank', 'noopener,noreferrer')
    }
  }

  if (isLoading) {
    return (
      <div className="bg-white rounded-suwappu-xl p-4 shadow-suwappu-1 flex items-center justify-center h-24">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-suwappu-magenta-mid"></div>
      </div>
    )
  }

  const verified = status?.verified ?? false

  return (
    <div className="p-3 pb-20 space-y-4">
      {error && (
        <div className="bg-suwappu-error/10 border border-suwappu-error/20 rounded-suwappu-lg p-3">
          <p className="text-xs text-red-700">{error}</p>
        </div>
      )}

      <div className="bg-white rounded-suwappu-xl p-4 shadow-suwappu-1 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-lg">🪪</span>
            <span className="font-heading font-semibold text-sm text-suwappu-text">
              {t('settings.identityTitle')}
            </span>
          </div>
          <span
            className={`text-xs font-medium px-2 py-1 rounded-full ${
              verified
                ? 'bg-suwappu-success/10 text-suwappu-success'
                : 'bg-suwappu-text-secondary/10 text-suwappu-text-secondary'
            }`}
          >
            {verified ? t('settings.identityVerified') : t('settings.identityUnverified')}
          </span>
        </div>

        <p className="text-xs text-suwappu-text-secondary">
          {t('settings.identityDescription')}
        </p>

        {verified && status?.schemaId && (
          <div className="flex items-center justify-between text-xs text-suwappu-text-secondary bg-suwappu-sakura-light/30 rounded-suwappu-lg px-3 py-2">
            <span>{t('settings.identitySchema')}</span>
            <span className="font-mono">{status.schemaId}</span>
          </div>
        )}

        {extensionAvailable === false && (
          <div className="bg-suwappu-warning/10 border border-suwappu-warning/20 rounded-suwappu-lg p-3 space-y-2">
            <p className="text-xs text-orange-700">
              {t('settings.identityExtensionRequired')}
            </p>
            <button
              onClick={handleOpenInBrowser}
              className="w-full py-2 bg-white border border-suwappu-warning/30 text-orange-700 rounded-suwappu-lg text-xs font-heading font-semibold"
            >
              {t('settings.identityOpenInBrowser')}
            </button>
          </div>
        )}

        {!verified && (
          <button
            onClick={handleVerify}
            disabled={isVerifying}
            className="w-full py-3 bg-suwappu-gradient text-white rounded-suwappu-lg font-heading font-semibold disabled:opacity-50"
          >
            {isVerifying ? t('settings.identityVerifying') : t('settings.identityVerifyButton')}
          </button>
        )}
      </div>
    </div>
  )
}
