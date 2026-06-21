import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import type { PerpsExecuteParams } from '../types/api'

// HyperLiquid connection status for the signed-in user. Gates the perps order
// ticket: until the user connects their HL API wallet, execution is unavailable
// and the workspace shows a connect prompt instead.
export function usePerpsAccount() {
  const { isAuthenticated } = useAuth()
  return useQuery({
    queryKey: ['perps-account'],
    queryFn: () => api.getPerpsAccount(),
    enabled: isAuthenticated,
    staleTime: 30_000,
  })
}

// Live open positions from HyperLiquid (keyed server-side by the user's HL
// address). Polls so PnL stays fresh while the desk is open.
export function useTerminalPerpsPositions() {
  const { isAuthenticated } = useAuth()
  return useQuery({
    queryKey: ['terminal-perps-positions'],
    queryFn: () => api.getTerminalPerpsPositions(),
    enabled: isAuthenticated,
    staleTime: 8_000,
    refetchInterval: 12_000,
  })
}

export function useConnectPerps() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ apiKey, apiSecret }: { apiKey: string; apiSecret: string }) =>
      api.connectPerps(apiKey, apiSecret),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['perps-account'] })
      queryClient.invalidateQueries({ queryKey: ['terminal-perps-positions'] })
    },
  })
}

export function useExecutePerps() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (params: PerpsExecuteParams) => api.executePerps(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['terminal-perps-positions'] })
    },
  })
}

export function useClosePerps() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ positionId, percent }: { positionId: number; percent?: number }) =>
      api.closePerps(positionId, percent),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['terminal-perps-positions'] })
    },
  })
}
