import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'

// Custodial wallet overview (deposit addresses + balances). Polls so an
// incoming deposit appears without a manual refresh.
export function useWalletSummary(enabled = true) {
  const { isAuthenticated, isExternalWallet } = useAuth()
  return useQuery({
    queryKey: ['wallet-summary'],
    queryFn: () => api.getWalletSummary(),
    // Custodial only — external wallets manage their own funds on-chain.
    enabled: enabled && isAuthenticated && !isExternalWallet,
    staleTime: 10_000,
    refetchInterval: 15_000,
  })
}

export function useWithdraw() {
  const qc = useQueryClient()
  // Keep one key for the same logical withdrawal until the server confirms a
  // response. If the browser loses the response after broadcast and the user
  // retries the unchanged form, Python sees the same idempotency_key and does
  // not send funds twice. Changing any money/destination field creates a new
  // logical operation and therefore a new key.
  const pendingIdempotency = useRef<{ fingerprint: string; key: string } | null>(null)

  return useMutation({
    mutationFn: async (params: Parameters<typeof api.withdrawFunds>[0]) => {
      const normalized = {
        ...params,
        amount: String(params.amount),
        toAddress: params.toAddress.trim(),
      }
      const fingerprint = JSON.stringify(normalized)
      if (!pendingIdempotency.current || pendingIdempotency.current.fingerprint !== fingerprint) {
        pendingIdempotency.current = {
          fingerprint,
          key: crypto.randomUUID(),
        }
      }

      // api.withdrawFunds intentionally owns the endpoint/auth/error handling.
      // The intersection type keeps its public call signature stable while
      // sending the backend's mandatory replay-protection field over the wire.
      const request = {
        ...normalized,
        idempotency_key: pendingIdempotency.current.key,
      } as Parameters<typeof api.withdrawFunds>[0] & { idempotency_key: string; amount: string }

      return api.withdrawFunds(request)
    },
    onSuccess: () => {
      pendingIdempotency.current = null
      qc.invalidateQueries({ queryKey: ['wallet-summary'] })
      qc.invalidateQueries({ queryKey: ['portfolio'] })
    },
    // On error the key is deliberately retained. A retry of the same payload
    // must dedupe against a send whose HTTP response may have been lost.
  })
}
