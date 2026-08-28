import type { Context, Next } from 'hono'

const STRONG_SESSION_SOURCES = new Set(['siwe', 'telegram', 'passkey'])
const SESSION_COOKIE = 'suwappu_auth'

/**
 * First-party browser origins allowed to rely on the HttpOnly session cookie for
 * a spend-affecting request. The cookie is server-set and JS cannot mint it;
 * SameSite is useful but is not the sole CSRF boundary here.
 */
const FIRST_PARTY_SPEND_ORIGINS = new Set([
	'https://terminal.suwappu.bot',
	'https://suwappu.bot',
	'https://www.suwappu.bot',
	'https://app.suwappu.bot',
])

function cookieHeaderHasSession(cookieHeader: string | null): boolean {
	if (!cookieHeader) return false
	return cookieHeader
		.split(';')
		.some((part) => part.trim().startsWith(`${SESSION_COOKIE}=`) && part.trim().length > SESSION_COOKIE.length + 1)
}

/**
 * Decode only the JWT payload's provenance tag.
 *
 * This is NOT authentication. The downstream flexAuth/Python session verifier
 * still validates the JWT signature and user. This preflight is an additional
 * deny gate: a legitimately server-signed but intentionally weak bearer (the
 * legacy public swap auth shape) must never reach a server-signing route. An
 * attacker changing `src` in the payload invalidates the signature and is then
 * rejected downstream.
 */
export function bearerSessionSource(authorization: string | null): string | null {
	if (!authorization?.startsWith('Bearer ')) return null
	const token = authorization.slice(7).trim()
	const parts = token.split('.')
	if (parts.length !== 3 || !parts[1]) return null

	try {
		const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
		const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
		const payload = JSON.parse(atob(padded)) as { src?: unknown }
		return typeof payload.src === 'string' ? payload.src : null
	} catch {
		return null
	}
}

export type TrustedSpendDecision =
	| { ok: true; via: 'strong_bearer' | 'first_party_cookie' }
	| { ok: false; reason: 'weak_bearer' | 'missing_trading_proof' | 'untrusted_cookie_origin' }

export function trustedSpendDecision(request: Request): TrustedSpendDecision {
	const authorization = request.headers.get('Authorization')
	if (authorization) {
		const source = bearerSessionSource(authorization)
		if (source && STRONG_SESSION_SOURCES.has(source)) return { ok: true, via: 'strong_bearer' }

		// Important: do not silently fall back to a cookie when a weak bearer is
		// present. Both flexAuth and Python intentionally prefer Authorization;
		// allowing the request here would mean downstream authenticates the weak
		// credential we were trying to exclude.
		return { ok: false, reason: 'weak_bearer' }
	}

	if (!cookieHeaderHasSession(request.headers.get('Cookie'))) {
		return { ok: false, reason: 'missing_trading_proof' }
	}

	const origin = request.headers.get('Origin')
	if (!origin || !FIRST_PARTY_SPEND_ORIGINS.has(origin)) {
		return { ok: false, reason: 'untrusted_cookie_origin' }
	}
	return { ok: true, via: 'first_party_cookie' }
}

/**
 * Pre-auth guard for routes where Suwappu signs/broadcasts or otherwise mutates
 * spend state. The actual authentication middleware still runs after this.
 */
export function trustedSpendPreflight() {
	return async (c: Context, next: Next) => {
		const decision = trustedSpendDecision(c.req.raw)
		if (!decision.ok) {
			return c.json(
			{
				error: 'Trading proof required',
				code: 'TRADING_PROOF_REQUIRED',
				message: 'Reconnect with a wallet, passkey, or Telegram before authorizing this action.',
			},
			403,
		)
		}
		await next()
	}
}
