import { useCallback, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import type { WalletStats } from '../types/api'

const WALLETS_KEY = ['wallet-tracker', 'wallets'] as const
const ACTIVITIES_KEY = ['wallet-tracker', 'activities'] as const

export function useWalletTracker() {
  const queryClient = useQueryClient()
  const { isAuthenticated } = useAuth()

  const walletsQuery = useQuery({
    queryKey: WALLETS_KEY,
    queryFn: api.getTrackedWallets,
    enabled: isAuthenticated,
    staleTime: 15_000,
  })

  const activitiesQuery = useQuery({
    queryKey: ACTIVITIES_KEY,
    queryFn: api.getWalletActivities,
    enabled: isAuthenticated,
    staleTime: 15_000,
  })

  const saveWalletMutation = useMutation({
    mutationFn: api.addTrackedWallet,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: WALLETS_KEY })
    },
  })

  const removeWalletMutation = useMutation({
    mutationFn: api.removeTrackedWallet,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: WALLETS_KEY })
      queryClient.invalidateQueries({ queryKey: ACTIVITIES_KEY })
    },
  })

  const wallets = walletsQuery.data ?? []
  const activities = activitiesQuery.data ?? []
  const statsMap = useMemo<Record<string, WalletStats>>(() => ({}), [])

  const addWallet = useCallback((address: string, label?: string, chain?: string) => {
    saveWalletMutation.mutate({ address, label, chain })
  }, [saveWalletMutation])

  const removeWallet = useCallback((address: string) => {
    removeWalletMutation.mutate(address)
  }, [removeWalletMutation])

  const updateLabel = useCallback((address: string, label: string) => {
    const wallet = wallets.find(w => w.address === address)
    saveWalletMutation.mutate({
      address,
      label,
      chain: wallet?.chain,
    })
  }, [saveWalletMutation, wallets])

  const getStats = useCallback((_address: string): WalletStats | undefined => {
    return undefined
  }, [])

  return {
    wallets,
    activities,
    addWallet,
    removeWallet,
    updateLabel,
    getStats,
    statsMap,
    isLoading: walletsQuery.isLoading || activitiesQuery.isLoading,
    isSaving: saveWalletMutation.isPending || removeWalletMutation.isPending,
    error: walletsQuery.error || activitiesQuery.error || saveWalletMutation.error || removeWalletMutation.error,
  }
}
