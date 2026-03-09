import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { CreateDCAParams } from '../types/api'

export function useDCA() {
  const queryClient = useQueryClient()

  const orders = useQuery({
    queryKey: ['dca-orders'],
    queryFn: () => api.getDCAOrders(),
    staleTime: 30_000,
    refetchInterval: 60_000,
  })

  const createOrder = useMutation({
    mutationFn: (params: CreateDCAParams) => api.createDCAOrder(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dca-orders'] })
    },
  })

  const cancelOrder = useMutation({
    mutationFn: (orderId: string) => api.cancelDCAOrder(orderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dca-orders'] })
    },
  })

  const pauseOrder = useMutation({
    mutationFn: (orderId: string) => api.pauseDCAOrder(orderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dca-orders'] })
    },
  })

  return { orders, createOrder, cancelOrder, pauseOrder }
}
