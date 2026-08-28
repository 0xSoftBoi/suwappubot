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

type WithdrawParams = Parameters<typeof api.withdrawFunds>[0]
type WithdrawResult = Awaited<ReturnType<typeof api.withdrawFunds>>

type WithdrawError = {
  status?: number
  detail?: unknown
}

function withdrawalFingerprint(params: WithdrawParams): string {
  return [
    params.chain.trim().toLowerCase(),
    params.token.trim().toUpperCase(),
    String(params.amount),
    params.toAddress.trim(),
    params.memo?.trim() ?? '',
  ].join('|')
}

function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }
  throw { detail: 'Secure withdrawal retry protection is unavailable in this browser.', status: 0 }
}

export function useWithdraw() {
  const qc = useQueryClient()
  const { needsTradingProof } = useAuth()

  // Keep one key for one exact withdrawal intent until the server confirms it.
  // If the network drops after submission, retrying the same intent reuses the
  // same key so the backend can return the original result rather than repeat it.
  const intentRef = useRef<{ fingerprint: string; key: string } | null>(null)

  return useMutation({
    mutationFn: async (params: WithdrawParams): Promise<WithdrawResult> => {
      // OAuth-only sessions prove account identity, not control of a trading
      // credential. Keep the withdrawal boundary consistent with Swap/Perps/
      // Predict: require the user to step up with wallet, passkey, or Telegram.
      if (needsTradingProof) {
        throw {
          status: 403,
          detail: 'Reconnect with a wallet, passkey, or Telegram before withdrawing.',
        }
      }

      const fingerprint = withdrawalFingerprint(params)
      if (!intentRef.current || intentRef.current.fingerprint !== fingerprint) {
        intentRef.current = { fingerprint, key: newIdempotencyKey() }
      }

      const payload = {
        ...params,
        idempotency_key: intentRef.current.key,
      }

      try {
        return await api.withdrawFunds(payload)
      } catch (error) {
        const e = error as WithdrawError

        if (e.status === 409 && e.detail && typeof e.detail === 'object') {
          const duplicate = e.detail as { message?: string; txHash?: string | null; status?: string | null }
          if (duplicate.txHash) {
            return {
              ok: true,
              txHash: duplicate.txHash,
              status: duplicate.status ?? 'submitted',
            } as WithdrawResult
          }
          throw {
            status: 409,
            detail: duplicate.message ?? 'This withdrawal is already being submitted. Check your balance before retrying.',
          }
        }
        throw error
      }
    },
    onSuccess: () => {
      intentRef.current = null
      qc.invalidateQueries({ queryKey: ['wallet-summary'] })
      qc.invalidateQueries({ queryKey: ['portfolio'] })
    },
  })
}
