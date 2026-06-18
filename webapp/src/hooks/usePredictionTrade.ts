import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { PredictionOrderRequest } from '../types/prediction'

export function usePredictionTrade() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (order: PredictionOrderRequest) => api.placePredictionOrder(order),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prediction', 'positions'] })
      queryClient.invalidateQueries({ queryKey: ['prediction', 'orderbook'] })
      queryClient.invalidateQueries({ queryKey: ['prediction', 'market'] })
    },
  })
}
