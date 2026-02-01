import { useQuery } from '@tanstack/react-query'
import { adminFetch } from '../api/client'
import type { StatsResponse, AgentsResponse, SwapsResponse, WebhooksResponse } from '../api/types'

export function useStats() {
  return useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: () => adminFetch<StatsResponse>('/admin/stats'),
    refetchInterval: 30_000,
  })
}

export function useAgents(params: { limit?: number; offset?: number; status?: string } = {}) {
  const { limit = 20, offset = 0, status } = params
  const qs = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  if (status) qs.set('status', status)

  return useQuery({
    queryKey: ['admin', 'agents', limit, offset, status],
    queryFn: () => adminFetch<AgentsResponse>(`/admin/agents?${qs}`),
  })
}

export function useSwaps(params: { limit?: number; offset?: number; status?: string; agent_id?: number } = {}) {
  const { limit = 20, offset = 0, status, agent_id } = params
  const qs = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  if (status) qs.set('status', status)
  if (agent_id) qs.set('agent_id', String(agent_id))

  return useQuery({
    queryKey: ['admin', 'swaps', limit, offset, status, agent_id],
    queryFn: () => adminFetch<SwapsResponse>(`/admin/swaps?${qs}`),
  })
}

export function useWebhooks(params: { limit?: number; offset?: number; status?: string; event_type?: string } = {}) {
  const { limit = 20, offset = 0, status, event_type } = params
  const qs = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  if (status) qs.set('status', status)
  if (event_type) qs.set('event_type', event_type)

  return useQuery({
    queryKey: ['admin', 'webhooks', limit, offset, status, event_type],
    queryFn: () => adminFetch<WebhooksResponse>(`/admin/webhooks?${qs}`),
  })
}
