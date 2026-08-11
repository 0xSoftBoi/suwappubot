import { useCallback, useMemo } from 'react'
import { AppState, Linking } from 'react-native'
import { useQueryClient } from '@tanstack/react-query'
import { useWallets } from './use-gecko'
import { analytics } from '../lib/analytics'
import { getAuthRevision, isAuthenticated } from '../lib/auth'
import { buildOnrampUrl, isOnrampConfigured } from '../lib/onramp'
import { queryKeys } from '../lib/queryKeys'
import { pickPrimaryEvmWallet } from '../lib/wallets'

/**
 * Drives the "Add money with a card" entry point.
 *
 * `available` is false — and callers must render nothing — unless both the
 * Onramp app id is configured (env var present) and the user's own wallet
 * address has actually loaded. The destination address always comes from
 * the wallets hook, never from client input.
 */
export function useOnramp() {
  const signedIn = isAuthenticated()
  const wallets = useWallets(signedIn)
  const qc = useQueryClient()

  const wallet = wallets.data ? pickPrimaryEvmWallet(wallets.data) : null
  const url = wallet ? buildOnrampUrl(wallet.address) : null
  const available = isOnrampConfigured() && Boolean(url)

  /** Refreshes balances once, the next time the app comes back to the
   * foreground after the card flow — covers the case where the purchase
   * completes in the browser and the user switches back before any query's
   * normal staleTime has elapsed. */
  const refreshOnReturn = useCallback(() => {
    const sub = AppState.addEventListener('change', (status) => {
      if (status !== 'active') return
      sub.remove()
      const authRevision = getAuthRevision()
      void qc.invalidateQueries({ queryKey: queryKeys.snapshot(authRevision) })
      void qc.invalidateQueries({ queryKey: queryKeys.wallets(authRevision) })
      void qc.invalidateQueries({ queryKey: queryKeys.earn(authRevision) })
    })
  }, [qc])

  const open = useCallback(() => {
    if (!url) return
    analytics.track('funding_method_chosen', { method: 'card_onramp' })
    refreshOnReturn()
    void Linking.openURL(url)
  }, [url, refreshOnReturn])

  return useMemo(() => ({ available, open }), [available, open])
}
