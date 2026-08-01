/**
 * Data layer for the agent control-plane surfaces (pending approvals + audit
 * log) in the terminal. Wraps the live /v1/agent/* endpoints and isolates the
 * endpoints that do NOT exist yet behind clearly-marked TODO stubs, so wiring
 * them later is a one-file change.
 *
 * Auth note: /v1/agent/* is gated by agentFlexAuth (org `sk_live_...` API key
 * OR per-agent `suwappu_sk_...` bearer token) — NOT the terminal user's SIWE
 * session JWT. We reuse the terminal's existing bearer-token request path
 * (getAuthToken()) for consistency, but until the backend accepts the user's
 * session JWT on this surface (or the terminal has an org-key input), these
 * calls will 401 in production. See report for the exact gap.
 */
import { getAuthToken } from './auth'

const BASE_URL = import.meta.env.VITE_API_URL || ''

async function agentRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getAuthToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  let res: Response
  try {
    res = await fetch(`${BASE_URL}${path}`, { credentials: 'include', ...options, headers })
  } catch {
    throw { detail: "Can't reach Suwappu right now. Check your connection and try again.", status: 0 }
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }))
    const friendly =
      res.status === 401 ? 'Your session expired — reconnect your wallet.'
      : res.status === 403 ? "You don't have access to that."
      : res.status === 429 ? 'Too many requests — slow down a moment.'
      : res.status >= 500 ? 'Server hiccup — please retry in a few seconds.'
      : null
    throw { detail: body.detail || body.message || friendly || res.statusText, status: res.status }
  }
  return res.json()
}

export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired'

export interface AgentApprovalDetail {
  id: string
  status: ApprovalStatus
  chain: string
  value_usd: number | string | null
  created_at: string
  expires_at: string | null
}

/** Row shape we want for the pending-approvals list UI once a list endpoint exists. */
export interface PendingApproval {
  id: string
  agentId: string
  agentName?: string
  chain: string
  fromToken?: string
  toToken?: string
  valueUsd: number
  createdAt: string
  expiresAt: string | null
}

export type AuditEventType =
  | 'policy_created'
  | 'policy_updated'
  | 'approval_requested'
  | 'approval_decided'
  | 'approval_expired'
  | 'killswitch_triggered'
  | string

export interface AuditEvent {
  eventType: AuditEventType
  agentId: string | null
  orgId: string | null
  details: unknown
  createdAt: string
  entryHash: string
}

export interface AuditListResult {
  success: boolean
  events: AuditEvent[]
  count: number
}

export interface AuditVerifyResult {
  success: boolean
  valid: boolean
  checked: number
  firstBreakId?: string
}

export interface AuditQueryParams {
  eventType?: string
  agentId?: string
  since?: string
  limit?: number
}

export const approvalsApi = {
  /**
   * LIVE: GET /v1/agent/approvals/:id
   * Fetches a single approval by id. Useful for polling a known request
   * (e.g. one surfaced via a Telegram deep link) but cannot enumerate all
   * pending approvals for the current org/agent — see listPendingApprovals.
   */
  async getApproval(id: string): Promise<AgentApprovalDetail> {
    const res = await agentRequest<{
      success: boolean
      id: string
      status: ApprovalStatus
      chain: string
      value_usd: number | string | null
      created_at: string
      expires_at: string | null
    }>(`/v1/agent/approvals/${encodeURIComponent(id)}`)
    return {
      id: res.id,
      status: res.status,
      chain: res.chain,
      value_usd: res.value_usd,
      created_at: res.created_at,
      expires_at: res.expires_at,
    }
  },

  /**
   * LIVE: GET /v1/agent/audit
   */
  async getAuditLog(params: AuditQueryParams = {}): Promise<AuditListResult> {
    const search = new URLSearchParams()
    if (params.eventType) search.set('event_type', params.eventType)
    if (params.agentId) search.set('agent_id', params.agentId)
    if (params.since) search.set('since', params.since)
    if (params.limit) search.set('limit', String(params.limit))
    const qs = search.toString()
    return agentRequest<AuditListResult>(`/v1/agent/audit${qs ? `?${qs}` : ''}`)
  },

  /**
   * LIVE: GET /v1/agent/audit/verify
   */
  async verifyAuditChain(limit?: number): Promise<AuditVerifyResult> {
    const qs = limit ? `?limit=${limit}` : ''
    return agentRequest<AuditVerifyResult>(`/v1/agent/audit/verify${qs}`)
  },

  /**
   * TODO(backend): no list-pending-approvals endpoint exists yet
   * (e.g. GET /v1/agent/approvals?status=pending). Wire this up as soon as
   * that endpoint ships — this is the only function the Pending Approvals
   * panel needs changed. Returns an empty list today so the UI renders its
   * real empty state instead of fake data.
   */
  async listPendingApprovals(_params?: { agentId?: string }): Promise<PendingApproval[]> {
    return []
  },

  /**
   * TODO(backend): no web approve/deny endpoint exists yet
   * (e.g. POST /v1/agent/approvals/:id/decide { decision: 'approve' | 'deny' }).
   * Decisions currently only happen via the Telegram bot. Wire this up as
   * soon as that endpoint ships.
   */
  async decideApproval(_id: string, _decision: 'approve' | 'deny'): Promise<never> {
    throw new Error('not implemented: web approve/deny endpoint does not exist yet')
  },
}
