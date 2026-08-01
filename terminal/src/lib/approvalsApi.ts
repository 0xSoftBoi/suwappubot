/**
 * Data layer for the agent control-plane surfaces (pending approvals + audit
 * log) in the terminal. Wraps the USER-authenticated /webapp/approvals* and
 * /webapp/audit* endpoints (api-ts/src/routes/webapp.ts) — same flexAuth
 * (Telegram init-data or the terminal's Bearer JWT) the rest of the terminal
 * already uses. No agent-key / org-key surface involved here.
 */
import { getAuthToken } from './auth'

const BASE_URL = import.meta.env.VITE_API_URL || ''

class ApprovalApiError extends Error {
  status: number
  code?: string
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

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
    throw new ApprovalApiError(
      "Can't reach Suwappu right now. Check your connection and try again.",
      0,
    )
  }
  const body = await res.json().catch(() => ({}) as Record<string, unknown>)
  if (!res.ok) {
    const friendly =
      res.status === 401 ? 'Your session expired — reconnect your wallet.'
      : res.status === 403 ? "You don't have access to that."
      : res.status === 429 ? 'Too many requests — slow down a moment.'
      : res.status >= 500 ? 'Server hiccup — please retry in a few seconds.'
      : null
    const detail =
      (body as { error?: string; detail?: string; message?: string }).error ||
      (body as { detail?: string }).detail ||
      (body as { message?: string }).message ||
      friendly ||
      res.statusText
    const code = (body as { code?: string }).code
    throw new ApprovalApiError(detail, res.status, code)
  }
  return body as T
}

export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired'

/** Row shape returned by GET /webapp/approvals. */
export interface PendingApproval {
  id: string
  agentId: string
  agentName?: string
  chain: string
  fromToken?: string
  toToken?: string
  fromAmount?: string
  valueUsd: number
  status: ApprovalStatus
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
  /** Set to 'no org chain' when the caller owns agents but no org — there is
   * no well-defined hash chain to walk. UI should render this as a neutral
   * "not applicable" state, not a false "valid" badge. */
  note?: string
}

export interface AuditQueryParams {
  eventType?: string
  agentId?: string
  since?: string
  limit?: number
}

interface RawApprovalRow {
  id: string
  agent_name: string | null
  chain: string
  value_usd: number | string | null
  status: ApprovalStatus
  created_at: string
  expires_at: string | null
  intent?: { fromToken?: string; toToken?: string; fromAmount?: string } | null
}

function toPendingApproval(row: RawApprovalRow): PendingApproval {
  return {
    id: row.id,
    agentId: row.agent_name ?? row.id,
    agentName: row.agent_name ?? undefined,
    chain: row.chain,
    fromToken: row.intent?.fromToken,
    toToken: row.intent?.toToken,
    fromAmount: row.intent?.fromAmount,
    valueUsd: typeof row.value_usd === 'string' ? Number(row.value_usd) : (row.value_usd ?? 0),
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  }
}

export const approvalsApi = {
  /**
   * GET /webapp/approvals?status=pending&limit=50 — the caller's own
   * agent-approval requests, user-authenticated (flexAuth).
   */
  async listPendingApprovals(_params?: { agentId?: string }): Promise<PendingApproval[]> {
    const res = await agentRequest<{ approvals: RawApprovalRow[] }>(
      '/webapp/approvals?status=pending&limit=50',
    )
    return (res.approvals ?? []).map(toPendingApproval)
  },

  /**
   * POST /webapp/approvals/:id/decide { decision } — approve or deny a
   * pending approval. The endpoint returns 404 (not found/not yours), 409
   * (already decided or expired), or 200 on success; callers should surface
   * the server's `error` message and refetch the list either way.
   */
  async decideApproval(
    id: string,
    decision: 'approve' | 'deny',
    stepUpChallenge?: string,
  ): Promise<{ success: true; id: string; status: ApprovalStatus }> {
    return agentRequest(`/webapp/approvals/${encodeURIComponent(id)}/decide`, {
      method: 'POST',
      body: JSON.stringify(
        stepUpChallenge ? { decision, step_up_challenge: stepUpChallenge } : { decision },
      ),
    })
  },

  /**
   * POST /webapp/approvals/:id/step-up/challenge — mint a short-TTL,
   * single-use step-up nonce required before /decide can approve when
   * APPROVAL_STEP_UP_REQUIRED is on. Deny never needs this.
   */
  async getStepUpChallenge(id: string): Promise<{ challenge: string; expires_at: string }> {
    return agentRequest(`/webapp/approvals/${encodeURIComponent(id)}/step-up/challenge`, {
      method: 'POST',
    })
  },

  /**
   * GET /webapp/audit — audit events visible to the authenticated user
   * (their own agents' rows plus their org's rows, if they own one).
   */
  async getAuditLog(params: AuditQueryParams = {}): Promise<AuditListResult> {
    const search = new URLSearchParams()
    if (params.eventType) search.set('event_type', params.eventType)
    if (params.since) search.set('since', params.since)
    if (params.limit) search.set('limit', String(params.limit))
    const qs = search.toString()
    return agentRequest<AuditListResult>(`/webapp/audit${qs ? `?${qs}` : ''}`)
  },

  /**
   * GET /webapp/audit/verify — walk the hash chain the caller can see. When
   * the caller owns no org, the backend returns `{valid: true, checked: 0,
   * note: 'no org chain'}` — a no-op, not a verified chain.
   */
  async verifyAuditChain(limit?: number): Promise<AuditVerifyResult> {
    const qs = limit ? `?limit=${limit}` : ''
    return agentRequest<AuditVerifyResult>(`/webapp/audit/verify${qs}`)
  },
}

export { ApprovalApiError }
