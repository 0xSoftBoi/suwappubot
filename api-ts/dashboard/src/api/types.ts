export interface StatsResponse {
  success: boolean
  agents: { total: number; active: number }
  swaps: { total: number; last_24h: number }
  webhooks: { total: number; pending: number; delivered: number; failed: number }
}

export interface Pagination {
  total: number
  limit: number
  offset: number
  has_more: boolean
}

export interface AdminAgent {
  id: number
  uuid: string
  name: string
  description: string | null
  is_active: boolean
  rate_limit_tier: string
  total_requests: number | null
  total_swaps: number | null
  callback_url: string | null
  created_at: string
  last_active_at: string | null
}

export interface AgentsResponse {
  success: boolean
  agents: AdminAgent[]
  pagination: Pagination
}

export interface AdminSwap {
  id: number
  user_id: number
  agent_id: number | null
  agent_uuid: string | null
  status: string | null
  tx_hash: string | null
  from_chain: string
  to_chain: string
  from_token: string
  to_token: string
  from_amount: string
  to_amount: string | null
  from_amount_usd: number | null
  to_amount_usd: number | null
  route_provider: string | null
  error_message: string | null
  created_at: string | null
  completed_at: string | null
}

export interface SwapsResponse {
  success: boolean
  swaps: AdminSwap[]
  pagination: Pagination
}

export interface AdminWebhook {
  id: number
  agent_id: number
  event_type: string
  status: string | null
  attempts: number | null
  last_error: string | null
  response_status: number | null
  callback_url: string
  created_at: string | null
  delivered_at: string | null
}

export interface WebhooksResponse {
  success: boolean
  events: AdminWebhook[]
  pagination: Pagination
}
