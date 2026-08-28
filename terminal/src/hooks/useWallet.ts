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
  // Modern wallet browsers all expose crypto.randomUUID(); keep a secure
  // fallback for embedded browsers that expose Web Crypto but not randomUUID.
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
  // Fail closed rather than sending a withdrawal without replay protection.
  throw { detail: 'Secure withdrawal retry protection is unavailable in this browser.', status: 0 }
}

export function useWithdraw() {
  const qc = useQueryClient()

  // Keep one key for one exact withdrawal intent until the server confirms it.
  // If the network drops *after* Python reserved/sent the withdrawal, pressing
  // confirm again reuses this key; the backend's unique idempotency claim then
  // returns the already-submitted transaction instead of sending twice.
  const intentRef = useRef<{ fingerprint: string; key: string } | null>(null)

  return useMutation({
    mutationFn: async (params: WithdrawParams): Promise<WithdrawResult> => {
      const fingerprint = withdrawalFingerprint(params)
      if (!intentRef.current || intentRef.current.fingerprint !== fingerprint) {
        intentRef.current = { fingerprint, key: newIdempotencyKey() }
      }

      // api.withdrawFunds JSON-stringifies its argument, so this additional
      // snake_case field reaches the FastAPI WalletWithdrawBody even though the
      // older public method signature intentionally stays source-compatible.
      const payload = {
        ...params,
        idempotency_key: intentRef.current.key,
      }

      try {
        return await api.withdrawFunds(payload)
      } catch (error) {
        const e = error as WithdrawError

        // A retry after a lost response is expected to hit the backend's
        // idempotency guard. Recover the existing txHash and surface it as the
        // original successful submission instead of telling the user to try a
        // third time with a new transfer intent.
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
      // A completed response means the next identical user action is genuinely
      // a new withdrawal and must get a fresh idempotency key.
      intentRef.current = null
      qc.invalidateQueries({ queryKey: ['wallet-summary'] })
      qc.invalidateQueries({ queryKey: ['portfolio'] })
    },
  })
}
