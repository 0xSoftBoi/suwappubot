/**
 * Data layer for the agent control-plane surfaces (pending approvals + audit
 * log) in the terminal. Wraps the owner-facing (human) approval + audit
 * endpoints on api-ts/src/routes/agent.ts:
 *   GET  /v1/agent/approvals?status=pending
 *   POST /v1/agent/approvals/:id/approve
 *   POST /v1/agent/approvals/:id/deny
 *   POST /v1/agent/approvals/:id/step-up/challenge
 *   GET  /v1/agent/audit
 *   GET  /v1/agent/audit/verify
 *
 * These routes are gated by flexAuth() (api-ts/src/middleware/flexAuth.ts),
 * which accepts EITHER X-Telegram-Init-Data OR `Authorization: Bearer <jwt>`
 * (header or same-site session cookie). The terminal's existing session JWT
 * (webapp/src/lib/auth.ts -> getAuthToken(), minted via wallet/passkey/
 * telegram/oauth sign-in) satisfies the Bearer-JWT branch of flexAuth, so it
 * is reused as-is here — this is NOT an agent API key, and must never be one:
 * agent.ts explicitly routes approve/deny/list through flexAuth (human JWT
 * only), while GET /approvals/:id (agent's own poll) is a separate
 * agentBearerAuth()-gated route this file does not call.
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
    const code = (body as { code?: string; error_code?: string }).code
      ?? (body as { error_code?: string }).error_code
    throw new ApprovalApiError(detail, res.status, code)
  }
  return body as T
}

export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired' | 'consumed'

/** Economic terms captured on the approval row (see api-ts/src/lib/approvalTerms.ts).
 * fromToken/toToken are raw addresses ('So111...' for native SOL etc.), amountIn/
 * amountOutMin are raw base-unit strings (wei/lamports) — no decimals metadata
 * is stored on the approval row, so amounts are shown in raw-unit form. */
export interface ApprovalPayload {
  isSolana: boolean
  fromChain: string
  toChain: string
  fromToken: string
  toToken: string
  amountIn: string
  amountOutMin: string
  walletAddress: string
  slippageBps?: number
  slippage?: number
  valueUsd: number
}

/** Row shape returned by GET /v1/agent/approvals. */
export interface PendingApproval {
  id: string
  agentId: string
  organizationId: string | null
  actionType: string
  payload: ApprovalPayload
  reason: string | null
  status: ApprovalStatus
  createdAt: string
  expiresAt: string
  decidedAt: string | null
}

export type AuditEventType =
  | 'policy.allow'
  | 'policy.block'
  | 'policy.require_approval'
  | 'approval.created'
  | 'approval.approved'
  | 'approval.denied'
  | 'approval.step_up_issued'
  | 'approval.validation_failed'
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
  /** Present when the caller has no well-defined hash chain to walk (e.g. no
   * org context). UI must render a neutral "not applicable" state here, not a
   * false "valid" badge. */
  note?: string
}

export interface AuditQueryParams {
  eventType?: string
  since?: string
  limit?: number
}

interface RawApprovalRow {
  approval_id: string
  agent_id: string
  organization_id: string | null
  action_type: string
  payload: ApprovalPayload
  reason: string | null
  status: ApprovalStatus
  created_at: string
  expires_at: string
  decided_at: string | null
}

function toPendingApproval(row: RawApprovalRow): PendingApproval {
  return {
    id: row.approval_id,
    agentId: row.agent_id,
    organizationId: row.organization_id,
    actionType: row.action_type,
    payload: row.payload,
    reason: row.reason,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    decidedAt: row.decided_at,
  }
}

export const approvalsApi = {
  /**
   * GET /v1/agent/approvals?status=pending — the caller's own owned-org
   * approval requests, human-authenticated (flexAuth: Telegram init-data or
   * the terminal's Bearer JWT). Never accepts an agent key.
   */
  async listPendingApprovals(): Promise<PendingApproval[]> {
    const res = await agentRequest<{ success: boolean; approvals: RawApprovalRow[] }>(
      '/v1/agent/approvals?status=pending',
    )
    return (res.approvals ?? []).map(toPendingApproval)
  },

  /**
   * POST /v1/agent/approvals/:id/approve or /deny. On step-up-gated approve,
   * the server 400s with `code: 'STEP_UP_REQUIRED'` (surfaced via
   * ApprovalApiError.code) — callers retry once via getStepUpChallenge().
   */
  async decideApproval(
    id: string,
    decision: 'approve' | 'deny',
    stepUpChallenge?: string,
  ): Promise<{ success: true; approval_id: string; status: ApprovalStatus }> {
    const path = `/v1/agent/approvals/${encodeURIComponent(id)}/${decision === 'approve' ? 'approve' : 'deny'}`
    return agentRequest(path, {
      method: 'POST',
      body: stepUpChallenge ? JSON.stringify({ step_up_challenge: stepUpChallenge }) : undefined,
    })
  },

  /**
   * POST /v1/agent/approvals/:id/step-up/challenge — mint a short-TTL,
   * single-use step-up nonce required before approve can succeed when
   * APPROVAL_STEP_UP_REQUIRED is on. Deny never needs this.
   */
  async getStepUpChallenge(id: string): Promise<{ challenge: string; expires_at: string }> {
    return agentRequest(`/v1/agent/approvals/${encodeURIComponent(id)}/step-up/challenge`, {
      method: 'POST',
    })
  },

  /**
   * GET /v1/agent/audit — ** AUTH MISMATCH, NOT SATISFIED BY THE TERMINAL'S
   * CREDENTIAL. ** This route (and /audit/verify below) is gated by
   * agentFlexAuth() (api-ts/src/middleware/agentFlexAuth.ts), which accepts
   * ONLY an org API key (X-API-Key / Bearer sk_live_...) or an agent bearer
   * token (Bearer suwappu_sk_...) — it does NOT accept the human session JWT
   * the terminal holds (that's flexAuth(), used by the approvals endpoints
   * above). There is no owner-facing/webapp audit route in this branch to
   * fall back to. Calling this with the terminal's token will 401. Left
   * wired (not faked) so the panel surfaces the real server error rather
   * than a fabricated result — see AuditLogPanel's banner. Fix requires
   * either a new owner-JWT-gated audit route server-side, or accepting JWT
   * in agentFlexAuth for read-only audit scope.
   */
  async getAuditLog(params: AuditQueryParams = {}): Promise<AuditListResult> {
    const search = new URLSearchParams()
    if (params.eventType) search.set('event_type', params.eventType)
    if (params.since) search.set('since', params.since)
    if (params.limit) search.set('limit', String(params.limit))
    const qs = search.toString()
    return agentRequest<AuditListResult>(`/v1/agent/audit${qs ? `?${qs}` : ''}`)
  },

  /**
   * GET /v1/agent/audit/verify — walk the hash chain the caller can see.
   */
  async verifyAuditChain(limit?: number): Promise<AuditVerifyResult> {
    const qs = limit ? `?limit=${limit}` : ''
    return agentRequest<AuditVerifyResult>(`/v1/agent/audit/verify${qs}`)
  },
}

export { ApprovalApiError }
