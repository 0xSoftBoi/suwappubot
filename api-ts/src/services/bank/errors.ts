import { Data } from 'effect'

export type BankErrorCode =
	| 'VALIDATION'
	| 'NOT_FOUND'
	| 'FORBIDDEN'
	| 'CONFLICT'
	| 'INSUFFICIENT_FUNDS'
	| 'LIMIT_EXCEEDED'
	| 'POLICY_BLOCKED'
	| 'ACCOUNT_STATE'
	| 'ASSET_UNSUPPORTED'
	| 'WALLET_UNAVAILABLE'
	| 'SIGNING_UNAVAILABLE'
	| 'UPSTREAM'
	| 'DB'
	| 'NOT_CONFIGURED'
	| 'LENDER_POOL_UNFUNDED'
	| 'POOL_UNFUNDED'
	| 'EXPOSURE_LIMIT'
	| 'RAMP_UNAVAILABLE'
	| 'RECEIVABLES_UNAVAILABLE'
	| 'PROVIDER_NOT_CONFIGURED'
	| 'PROVIDER_DOCS_REQUIRED'
	| 'RAIL_NO_PROVIDER'
	| 'ISSUER_NOT_CONFIGURED'
	| 'INSUFFICIENT_AVAILABLE'
	| 'LOCK_BUSY'

const STATUS: Record<BankErrorCode, number> = {
	VALIDATION: 400,
	NOT_FOUND: 404,
	FORBIDDEN: 403,
	CONFLICT: 409,
	INSUFFICIENT_FUNDS: 422,
	LIMIT_EXCEEDED: 422,
	POLICY_BLOCKED: 403,
	ACCOUNT_STATE: 409,
	ASSET_UNSUPPORTED: 400,
	WALLET_UNAVAILABLE: 409,
	SIGNING_UNAVAILABLE: 503,
	UPSTREAM: 502,
	DB: 500,
	NOT_CONFIGURED: 503,
	LENDER_POOL_UNFUNDED: 503,
	POOL_UNFUNDED: 503,
	EXPOSURE_LIMIT: 422,
	RAMP_UNAVAILABLE: 503,
	RECEIVABLES_UNAVAILABLE: 503,
	PROVIDER_NOT_CONFIGURED: 503,
	PROVIDER_DOCS_REQUIRED: 422,
	RAIL_NO_PROVIDER: 422,
	ISSUER_NOT_CONFIGURED: 503,
	INSUFFICIENT_AVAILABLE: 422,
	LOCK_BUSY: 503, // retryable (Retry-After set by routes/bank.ts): a per-wallet lock could not be acquired in time; retry with the SAME idempotency key
}

/** Typed bank failure. `missing` names the exact external input when code is NOT_CONFIGURED. */
export class BankError extends Data.TaggedError('BankError')<{
	readonly code: BankErrorCode
	readonly message: string
	readonly missing?: string
	/** Stable machine-readable refusal reason (e.g. credit/receivables refusals); clients match on this, not on `message`. */
	readonly reason?: string
	readonly cause?: unknown
}> {
	get status(): number {
		return STATUS[this.code]
	}
}

export const bankErr = (code: BankErrorCode, message: string, extra?: { missing?: string; reason?: string; cause?: unknown }) =>
	new BankError({ code, message, ...extra })
