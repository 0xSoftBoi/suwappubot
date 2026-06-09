import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { optimisticRemoveById } from '../lib/optimistic'
import type { CreateLimitOrderParams } from '../types/api'

export function useLimitOrders() {
  const queryClient = useQueryClient()

  const orders = useQuery({
    queryKey: ['limit-orders'],
    queryFn: () => api.getLimitOrders(),
    staleTime: 15_000,
    refetchInterval: 30_000,
  })

  const createOrder = useMutation({
    mutationFn: (params: CreateLimitOrderParams) => api.createLimitOrder(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['limit-orders'] })
    },
  })

  const cancelOrder = useMutation({
    mutationFn: (orderId: string) => api.cancelLimitOrder(orderId),
    ...optimisticRemoveById(queryClient, ['limit-orders']),
  })

  return { orders, createOrder, cancelOrder }
}
