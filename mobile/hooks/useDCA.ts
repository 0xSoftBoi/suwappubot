/**
 * React Query hooks for DCA orders.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type CreateDCARequest } from '../lib/api'

export function useDCAPlans() {
  return useQuery({
    queryKey: ['dca'],
    queryFn: () => api.getDCAOrders(),
  })
}

export function useCreateDCA() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateDCARequest) => api.createDCAOrder(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dca'] }),
  })
}

export function usePauseDCA() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.pauseDCA(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dca'] }),
  })
}

export function useResumeDCA() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.resumeDCA(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dca'] }),
  })
}

export function useCancelDCA() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.cancelDCA(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dca'] }),
  })
}

export function useDCAExecutions(dcaId: number) {
  return useQuery({
    queryKey: ['dca', dcaId, 'executions'],
    queryFn: () => api.getDCAExecutions(dcaId),
    enabled: !!dcaId,
  })
}
