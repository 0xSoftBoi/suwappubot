/**
 * Hook for managing user wallets
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

// Query keys
export const walletKeys = {
  all: ['wallets'] as const,
  list: () => [...walletKeys.all, 'list'] as const,
}

export interface WalletInfo {
  address: string
  name: string
  chainType: 'evm' | 'solana'
  provider: 'local' | 'turnkey' | 'external'
  isDefault: boolean
  createdAt: string | null
}

/**
 * Hook to list all user wallets
 */
export function useWallets() {
  return useQuery({
    queryKey: walletKeys.list(),
    queryFn: async (): Promise<WalletInfo[]> => {
      const response = await fetch(`${import.meta.env.VITE_API_URL || ''}/webapp/wallets`, {
        headers: api['getAuthHeaders']?.() || {},
      })
      if (!response.ok) throw new Error('Failed to fetch wallets')
      return response.json()
    },
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
  })
}

/**
 * Hook to add a wallet
 */
export function useAddWallet() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: { address: string; chainType?: 'evm' | 'solana'; name?: string }) => {
      const response = await fetch(`${import.meta.env.VITE_API_URL || ''}/webapp/wallets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify(params),
      })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to add wallet')
      }
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: walletKeys.list() })
    },
  })
}

/**
 * Hook to remove a wallet
 */
export function useRemoveWallet() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (address: string) => {
      const response = await fetch(
        `${import.meta.env.VITE_API_URL || ''}/webapp/wallets/${encodeURIComponent(address)}`,
        {
          method: 'DELETE',
          headers: getAuthHeaders(),
        }
      )
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to remove wallet')
      }
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: walletKeys.list() })
    },
  })
}

// Helper to get auth headers
function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {}

  // Get Telegram initData
  const initData = window.Telegram?.WebApp?.initData
  if (initData) {
    headers['X-Telegram-Init-Data'] = initData
  }

  // Get JWT from localStorage if available
  const token = localStorage.getItem('suwappu_auth_token')
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  return headers
}
