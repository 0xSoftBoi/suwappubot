import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
  return useMutation({
    mutationFn: api.withdrawFunds,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wallet-summary'] })
      qc.invalidateQueries({ queryKey: ['portfolio'] })
    },
  })
}
