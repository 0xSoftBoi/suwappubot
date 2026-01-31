/**
 * React Query hooks for wallet CRUD operations.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export function useWallets() {
  return useQuery({
    queryKey: ['wallets'],
    queryFn: () => api.getLinkedWallets(),
  })
}

export function useCreateWallet() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (chainType: string) => api.createWallet(chainType),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wallets'] })
    },
  })
}

export function useSetDefaultWallet() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (address: string) => api.setDefaultWallet(address),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wallets'] })
    },
  })
}

export function useUnlinkWallet() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (address: string) => api.unlinkWallet(address),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wallets'] })
    },
  })
}
