import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { SwapExecuteRequest } from '../types/api'

export function useSwapExecute() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (request: SwapExecuteRequest) => api.executeSwap(request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolio'] })
      queryClient.invalidateQueries({ queryKey: ['swap-history'] })
    },
  })
}
