/**
 * How to react when the session probe (`GET /auth/me`) fails.
 *
 * The boot path used to run `catch { if (token) clearAuthToken() }`, which
 * signed the user out on ANY failure — including a transient 5xx from the
 * upstream Python API or a dropped connection. Losing a valid session because
 * a proxy hiccuped for one second is a real bug: the token was still good, and
 * the user had to re-authenticate for no reason.
 *
 * The rule now: only the server explicitly rejecting the credentials (401)
 * invalidates the stored session. Everything else keeps it and, when the
 * failure looks transient, is worth retrying.
 *
 * `request()` (lib/api.ts) throws `{ detail, status }`, where `status` is 0 for
 * a network/CORS failure and the HTTP status otherwise. `api.getMe()` also
 * throws a synthetic `{ status: 401 }` when the server answers 200 but reports
 * the session as unauthenticated — that IS a real rejection, so it clears.
 */

function statusOf(err: unknown): number | undefined {
	if (typeof err !== 'object' || err === null) return undefined
	const status = (err as { status?: unknown }).status
	return typeof status === 'number' ? status : undefined
}

/**
 * True only for an explicit auth rejection. Anything unrecognized returns
 * false: the safe default is to KEEP the session, never to sign someone out
 * because we couldn't classify an error.
 */
export function shouldClearSession(err: unknown): boolean {
	return statusOf(err) === 401
}

/**
 * Transient failures worth another attempt: a network/CORS drop (status 0) or
 * any 5xx. Deliberately excludes 403 and 429 — those are real answers from a
 * reachable server, and retrying 429 makes rate limiting worse.
 */
export function isRetryableAuthError(err: unknown): boolean {
	const status = statusOf(err)
	if (status === undefined) return false
	return status === 0 || status >= 500
}
