/**
 * React Query hooks for token sniping.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type CreateSnipeRequest, type SnipeConfig } from '../lib/api'

export function useSnipeOrders() {
  return useQuery({
    queryKey: ['snipeOrders'],
    queryFn: () => api.getSnipeOrders(),
  })
}

export function useCreateSnipeOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateSnipeRequest) => api.createSnipeOrder(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['snipeOrders'] }),
  })
}

export function useCancelSnipeOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.cancelSnipeOrder(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['snipeOrders'] }),
  })
}

export function useSnipeConfig() {
  return useQuery({
    queryKey: ['snipeConfig'],
    queryFn: () => api.getSnipeConfig(),
  })
}

export function useUpdateSnipeConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (config: Partial<SnipeConfig>) => api.updateSnipeConfig(config),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['snipeConfig'] }),
  })
}
