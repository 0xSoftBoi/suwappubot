import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export function useLinkedWallets() {
  return useQuery({
    queryKey: ['linkedWallets'],
    queryFn: () => api.getLinkedWallets(),
    staleTime: 60 * 1000, // 1 minute
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  })
}

export function useLinkWallet() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      address,
      signature,
      nonce,
    }: {
      address: string
      signature: string
      nonce: string
    }) => {
      return api.linkWallet(address, signature, nonce)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['linkedWallets'] })
      queryClient.invalidateQueries({ queryKey: ['portfolio'] })
    },
  })
}

export function useUnlinkWallet() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (address: string) => api.unlinkWallet(address),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['linkedWallets'] })
      queryClient.invalidateQueries({ queryKey: ['portfolio'] })
    },
  })
}

export function useWalletChallenge() {
  return useMutation({
    mutationFn: (address: string) => api.requestWalletChallenge(address),
  })
}
