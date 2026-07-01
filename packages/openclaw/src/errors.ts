/**
 * Typed error hierarchy for the Suwappu agent API.
 *
 * Agents need to *branch* on failures (retry a rate-limit, top up on a payment
 * error, fix inputs on a validation error, alert a human on auth failure) — a
 * bare `Error` with a string message can't support that. Every failed request
 * throws a `SuwappuError` subclass carrying the HTTP status, the server
 * `requestId` (for support), and any structured detail the API returned.
 *
 * The API uses two envelope shapes; both are parsed here:
 *   - handler:  { success: false, error, message?, fields? }
 *   - gateway:  { error, requestId, timestamp }
 */

export interface SuwappuErrorInit {
	status: number
	message: string
	/** Short machine-readable error label from the API (`error` field), if any. */
	code?: string
	/** Server request id (gateway envelope) — quote this when contacting support. */
	requestId?: string
	/** Per-field validation messages (handler `fields`), if any. */
	fields?: Record<string, string>
	/** Milliseconds the caller should wait before retrying (from `Retry-After`). */
	retryAfterMs?: number
	/** Raw parsed response body, for escape-hatch inspection. */
	body?: unknown
}

/** Base class — every Suwappu API failure is an instance of this. */
export class SuwappuError extends Error {
	readonly status: number
	readonly code?: string
	readonly requestId?: string
	readonly fields?: Record<string, string>
	readonly retryAfterMs?: number
	readonly body?: unknown

	constructor(init: SuwappuErrorInit) {
		super(init.message)
		this.name = 'SuwappuError'
		this.status = init.status
		this.code = init.code
		this.requestId = init.requestId
		this.fields = init.fields
		this.retryAfterMs = init.retryAfterMs
		this.body = init.body
		// Restore prototype chain for instanceof across the tsc/ES target boundary.
		Object.setPrototypeOf(this, new.target.prototype)
	}

	/** True for failures worth retrying after a wait (rate limits, 5xx, network). */
	get isRetryable(): boolean {
		return this.status === 429 || this.status >= 500 || this.status === 0
	}
}

/** 401 — missing/invalid API key. Not retryable; rotate or re-register. */
export class SuwappuAuthError extends SuwappuError {
	constructor(init: SuwappuErrorInit) {
		super(init)
		this.name = 'SuwappuAuthError'
	}
}

/**
 * 402 — payment required (MPP / x402 micropayment challenge). `body` holds the
 * payment challenge so a wallet-enabled agent can satisfy it and retry.
 */
export class SuwappuPaymentRequiredError extends SuwappuError {
	constructor(init: SuwappuErrorInit) {
		super(init)
		this.name = 'SuwappuPaymentRequiredError'
	}
}

/** 400 / 422 — invalid input. `fields` pinpoints what to fix. Not retryable. */
export class SuwappuValidationError extends SuwappuError {
	constructor(init: SuwappuErrorInit) {
		super(init)
		this.name = 'SuwappuValidationError'
	}
}

/** 403 — authenticated but not permitted (e.g. wallet not owned by this agent). */
export class SuwappuForbiddenError extends SuwappuError {
	constructor(init: SuwappuErrorInit) {
		super(init)
		this.name = 'SuwappuForbiddenError'
	}
}

/** 404 — resource not found. */
export class SuwappuNotFoundError extends SuwappuError {
	constructor(init: SuwappuErrorInit) {
		super(init)
		this.name = 'SuwappuNotFoundError'
	}
}

/** 429 — rate limited. `retryAfterMs` is set when the server sends `Retry-After`. */
export class SuwappuRateLimitError extends SuwappuError {
	constructor(init: SuwappuErrorInit) {
		super(init)
		this.name = 'SuwappuRateLimitError'
	}
}

/** 5xx — upstream/server failure. Retryable for idempotent requests. */
export class SuwappuServerError extends SuwappuError {
	constructor(init: SuwappuErrorInit) {
		super(init)
		this.name = 'SuwappuServerError'
	}
}

/** Transport failure — no HTTP response (DNS, connection reset). `status` is 0. */
export class SuwappuNetworkError extends SuwappuError {
	constructor(init: Omit<SuwappuErrorInit, 'status'> & { status?: number }) {
		super({ ...init, status: init.status ?? 0 })
		this.name = 'SuwappuNetworkError'
	}
}

/** The request exceeded its timeout (`timeoutMs`). A `SuwappuNetworkError`. */
export class SuwappuTimeoutError extends SuwappuNetworkError {
	constructor(init: Omit<SuwappuErrorInit, 'status'> & { status?: number }) {
		super(init)
		this.name = 'SuwappuTimeoutError'
	}
}

/** Parse a `Retry-After` header (delta-seconds or HTTP-date) to milliseconds. */
export function parseRetryAfter(header: string | null, now = Date.now()): number | undefined {
	if (!header) return undefined
	const secs = Number(header)
	if (Number.isFinite(secs)) return Math.max(0, secs * 1000)
	const date = Date.parse(header)
	if (Number.isFinite(date)) return Math.max(0, date - now)
	return undefined
}

/** Build the right `SuwappuError` subclass from an HTTP response. */
export function errorFromResponse(
	status: number,
	body: unknown,
	headers?: Headers,
): SuwappuError {
	const obj = body && typeof body === 'object' ? (body as Record<string, unknown>) : undefined
	const message =
		(typeof obj?.message === 'string' && obj.message) ||
		(typeof obj?.error === 'string' && obj.error) ||
		(typeof body === 'string' && body) ||
		`Suwappu API error ${status}`
	const init: SuwappuErrorInit = {
		status,
		message,
		code: typeof obj?.error === 'string' ? obj.error : undefined,
		requestId: typeof obj?.requestId === 'string' ? obj.requestId : undefined,
		fields:
			obj?.fields && typeof obj.fields === 'object'
				? (obj.fields as Record<string, string>)
				: undefined,
		retryAfterMs: parseRetryAfter(headers?.get('Retry-After') ?? null),
		body,
	}

	switch (status) {
		case 401:
			return new SuwappuAuthError(init)
		case 402:
			return new SuwappuPaymentRequiredError(init)
		case 403:
			return new SuwappuForbiddenError(init)
		case 404:
			return new SuwappuNotFoundError(init)
		case 400:
		case 422:
			return new SuwappuValidationError(init)
		case 429:
			return new SuwappuRateLimitError(init)
		default:
			if (status >= 500) return new SuwappuServerError(init)
			return new SuwappuError(init)
	}
}
