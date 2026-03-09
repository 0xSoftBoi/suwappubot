import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { CreateAlertParams } from '../types/api'

export function useAlerts() {
  const queryClient = useQueryClient()

  const alerts = useQuery({
    queryKey: ['alerts'],
    queryFn: () => api.getAlerts(),
    staleTime: 30_000,
    refetchInterval: 60_000,
  })

  const createAlert = useMutation({
    mutationFn: (params: CreateAlertParams) => api.createAlert(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] })
    },
  })

  const deleteAlert = useMutation({
    mutationFn: (alertId: string) => api.deleteAlert(alertId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] })
    },
  })

  return { alerts, createAlert, deleteAlert }
}
