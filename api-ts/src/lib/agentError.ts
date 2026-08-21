import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

/**
 * Canonical structured error codes for agent-facing responses (REST /v1/agent/*,
 * MCP tool calls, and A2A JSON-RPC). This list is a stable contract consumed by
 * external SDKs — do NOT add, remove, or rename values without a version bump.
 */
export type AgentErrorCode =
	| 'UNAUTHORIZED'
	| 'INVALID_API_KEY'
	| 'INSUFFICIENT_SCOPE'
	| 'RATE_LIMITED'
	| 'PAYMENT_REQUIRED'
	| 'INSUFFICIENT_CREDITS'
	| 'VALIDATION_ERROR'
	| 'QUOTE_EXPIRED'
	| 'QUOTE_NOT_FOUND'
	| 'WALLET_NOT_FOUND'
	| 'POLICY_VIOLATION'
	| 'CHAIN_UNSUPPORTED'
	| 'TOKEN_UNKNOWN'
	| 'MARKET_NOT_FOUND'
	| 'UPSTREAM_ERROR'
	| 'NOT_FOUND'
	| 'INTERNAL'

const DOCS_BASE = 'https://suwappu.bot/docs'

/**
 * Stable remediation entry point for each public agent error category.
 *
 * Keep these links broad and durable rather than guessing an endpoint-specific
 * slug. A future generated reference layer can narrow them to exact operation
 * docs without changing the error-code contract.
 */
export function documentationUrlForAgentError(code: AgentErrorCode): string {
	switch (code) {
		case 'UNAUTHORIZED':
		case 'INVALID_API_KEY':
		case 'INSUFFICIENT_SCOPE':
		case 'RATE_LIMITED':
			return `${DOCS_BASE}/authentication/overview`
		case 'PAYMENT_REQUIRED':
		case 'INSUFFICIENT_CREDITS':
			return `${DOCS_BASE}/billing/agentic-payments`
		case 'POLICY_VIOLATION':
			return `${DOCS_BASE}/protocols/overview`
		default:
			return `${DOCS_BASE}/api-reference/overview`
	}
}

/**
 * Build a JSON error response for agent-facing HTTP endpoints (REST + MCP HTTP
 * transport). Strictly additive: keeps the existing `success` / `error` shape,
 * appends a stable `error_code` and remediation URL, and SPREADS any
 * endpoint-specific extra fields (e.g. `hint`, `example`, `details`) at the top
 * level so pre-existing response shapes are preserved for older SDK/agent
 * consumers. Never nest these under a new wrapper key — that would silently
 * break clients that read `resp.hint` / `resp.details` directly.
 */
export function agentError(
	c: Context,
	status: ContentfulStatusCode,
	code: AgentErrorCode,
	message: string,
	extra?: Record<string, unknown>,
) {
	return c.json(
		{
			success: false as const,
			error: message,
			error_code: code,
			documentation_url: documentationUrlForAgentError(code),
			...(extra ?? {}),
		},
		status,
	)
}
