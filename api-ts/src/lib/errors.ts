/**
 * describeError — surfaces the full error chain (message + `.cause`) instead
 * of letting a wrapper like `ValidationError({ message: \`Failed to X: ${e}\` })`
 * drop the underlying Postgres/Drizzle error, which lives on `error.cause`.
 *
 * See docs/DECISIONS.md "Demo hardening 2026-09-26" — upstream error bodies
 * (verifier 400s, pg errors) were silently dropped before logging.
 *
 * Bounded to 3 levels of `.cause` and 500 chars total so a pathological
 * circular/huge error can't blow up logs.
 */
const MAX_CAUSE_DEPTH = 3
const MAX_LENGTH = 500

function messageOf(e: unknown): string {
	if (e instanceof Error) return e.message
	if (typeof e === 'string') return e
	try {
		return JSON.stringify(e)
	} catch {
		return String(e)
	}
}

export function describeError(e: unknown): string {
	let out = messageOf(e)
	let current: unknown = e
	for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
		const cause = current instanceof Error ? current.cause : undefined
		if (cause === undefined || cause === null) break
		out += `; cause: ${messageOf(cause)}`
		current = cause
	}
	return out.length > MAX_LENGTH ? `${out.slice(0, MAX_LENGTH)}…` : out
}
