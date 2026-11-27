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
}

/** Typed bank failure. `missing` names the exact external input when code is NOT_CONFIGURED. */
export class BankError extends Data.TaggedError('BankError')<{
	readonly code: BankErrorCode
	readonly message: string
	readonly missing?: string
	readonly cause?: unknown
}> {
	get status(): number {
		return STATUS[this.code]
	}
}

export const bankErr = (code: BankErrorCode, message: string, extra?: { missing?: string; cause?: unknown }) =>
	new BankError({ code, message, ...extra })
