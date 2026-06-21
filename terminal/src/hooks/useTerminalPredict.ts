import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import type { PredictOrderParams } from '../types/api'

// The signed-in user's held Polymarket positions (DB-backed, PnL refreshed by
// the predict_monitor service). Drives the Positions panel + claimable surfacing.
export function usePredictionPositions() {
  const { isAuthenticated } = useAuth()
  return useQuery({
    queryKey: ['terminal-predict-positions'],
    queryFn: () => api.getPredictionPositions(),
    enabled: isAuthenticated,
    staleTime: 15_000,
    refetchInterval: 30_000,
  })
}

export function usePlacePredictionOrder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (params: PredictOrderParams) => api.placePredictionOrder(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['terminal-predict-positions'] })
      queryClient.invalidateQueries({ queryKey: ['prediction-markets'] })
    },
  })
}

// On-chain redemption of a resolved, claimable winning position → pUSD on
// Polygon. Refreshes positions so the redeemed row drops out of "claimable".
export function useRedeemPrediction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (positionId: number) => api.redeemPrediction(positionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['terminal-predict-positions'] })
    },
  })
}
