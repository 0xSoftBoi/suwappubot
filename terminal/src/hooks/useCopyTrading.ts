import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { FollowSettings, TopTrader } from '../types/api'

const MOCK_TRADERS: TopTrader[] = [
  { id: 't1', address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', name: 'vitalik.eth', pnl7d: 42350, pnl30d: 187200, winRate: 73.2, followers: 14520, copiers: 4356, totalTrades: 812 },
  { id: 't2', address: '0x1234567890abcdef1234567890abcdef12345678', name: 'DegenSpartan', pnl7d: 31200, pnl30d: 95400, winRate: 68.5, followers: 8340, copiers: 2502, totalTrades: 644 },
  { id: 't3', address: '0x2345678901abcdef2345678901abcdef23456789', name: 'CryptoMaestro', pnl7d: 28100, pnl30d: 112800, winRate: 71.0, followers: 6720, copiers: 2016, totalTrades: 588 },
  { id: 't4', address: '0x3456789012abcdef3456789012abcdef34567890', pnl7d: 19800, pnl30d: 67500, winRate: 62.3, followers: 3150, copiers: 945, totalTrades: 402 },
  { id: 't5', address: '0x4567890123abcdef4567890123abcdef45678901', name: 'AlphaHunter', pnl7d: 15400, pnl30d: 48200, winRate: 58.9, followers: 2890, copiers: 867, totalTrades: 351 },
  { id: 't6', address: '0x5678901234abcdef5678901234abcdef56789012', pnl7d: -3200, pnl30d: 22100, winRate: 51.2, followers: 1420, copiers: 426, totalTrades: 214 },
  { id: 't7', address: '0x6789012345abcdef6789012345abcdef67890123', name: 'OnchainWiz', pnl7d: 8900, pnl30d: 34600, winRate: 64.7, followers: 4210, copiers: 1263, totalTrades: 497 },
  { id: 't8', address: '0x7890123456abcdef7890123456abcdef78901234', pnl7d: -8500, pnl30d: -12300, winRate: 43.1, followers: 890, copiers: 267, totalTrades: 173 },
]

export function useTopTraders(timeframe?: string, limit?: number) {
  return useQuery({
    queryKey: ['top-traders', timeframe, limit],
    queryFn: async () => {
      try {
        return await api.getTopTraders(timeframe, limit)
      } catch {
        return MOCK_TRADERS.slice(0, limit ?? MOCK_TRADERS.length)
      }
    },
    staleTime: 30_000,
  })
}

export function useTraderProfile(traderId: string | null) {
  return useQuery({
    queryKey: ['trader-profile', traderId],
    queryFn: () => api.getTraderProfile(traderId!),
    enabled: !!traderId,
    staleTime: 30_000,
  })
}

export function useFollowTrader() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ traderId, settings }: { traderId: string; settings: FollowSettings }) =>
      api.followTrader(traderId, settings),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['following'] })
      queryClient.invalidateQueries({ queryKey: ['top-traders'] })
    },
  })
}

export function useUnfollowTrader() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (traderId: string) => api.unfollowTrader(traderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['following'] })
      queryClient.invalidateQueries({ queryKey: ['top-traders'] })
    },
  })
}

export function useFollowing() {
  return useQuery({
    queryKey: ['following'],
    queryFn: () => api.getFollowing(),
    staleTime: 15_000,
  })
}

export function useCopyTrades(limit?: number) {
  return useQuery({
    queryKey: ['copy-trades', limit],
    queryFn: () => api.getCopyTrades(limit),
    staleTime: 10_000,
  })
}

export function useUpdateFollowSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ traderId, settings }: { traderId: string; settings: FollowSettings }) =>
      api.updateFollowSettings(traderId, settings),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['following'] })
    },
  })
}
