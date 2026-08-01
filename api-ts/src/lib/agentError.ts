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

/**
 * Build a JSON error response for agent-facing HTTP endpoints (REST + MCP HTTP
 * transport). Strictly additive: keeps the existing `success` / `error` shape,
 * appends a stable `error_code`, and SPREADS any endpoint-specific extra fields
 * (e.g. `hint`, `example`, `details`) at the top level so pre-existing response
 * shapes are byte-for-byte preserved for older SDK/agent consumers. Never nest
 * these under a new wrapper key — that would silently break clients that read
 * `resp.hint` / `resp.details` directly.
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
			...(extra ?? {}),
		},
		status,
	)
}
