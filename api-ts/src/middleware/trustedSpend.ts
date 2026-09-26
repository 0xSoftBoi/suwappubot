import type { Context, Next } from 'hono'
import { logger } from '../lib/logger'

const STRONG_SESSION_SOURCES = new Set(['siwe', 'telegram', 'passkey'])
const SESSION_COOKIE = 'suwappu_auth'
const FIRST_PARTY_CONTROL_ORIGINS = new Set([
	'https://terminal.suwappu.bot',
	'https://suwappu.bot',
	'https://www.suwappu.bot',
	'https://app.suwappu.bot',
])

function decodeSource(token: string): string | null {
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

function hasSessionCookie(cookieHeader: string | null): boolean {
	if (!cookieHeader) return false
	return cookieHeader
		.split(';')
		.some((part) => part.trim().startsWith(`${SESSION_COOKIE}=`) && part.trim().length > SESSION_COOKIE.length + 1)
}

/**
 * This only classifies credential provenance. Downstream authentication still
 * verifies the JWT signature and user identity before the request can run.
 */
export function bearerSessionSource(authorization: string | null): string | null {
	if (!authorization?.startsWith('Bearer ')) return null
	return decodeSource(authorization.slice(7).trim())
}

export type TrustedSpendDecision =
	| { ok: true; via: 'strong_bearer' }
	| { ok: false; reason: 'weak_bearer' | 'missing_trading_proof' }

export function trustedSpendDecision(request: Request): TrustedSpendDecision {
	const authorization = request.headers.get('Authorization')
	if (!authorization) {
		// Cookie-only OAuth sessions intentionally prove identity but not control
		// of a trading credential. Terminal's strong login paths also store their
		// JWT client-side and send it as Bearer, so requiring that stronger signal
		// removes the ambiguous cookie-only case.
		return { ok: false, reason: 'missing_trading_proof' }
	}

	const source = bearerSessionSource(authorization)
	if (source && STRONG_SESSION_SOURCES.has(source)) return { ok: true, via: 'strong_bearer' }
	return { ok: false, reason: 'weak_bearer' }
}

export type TrustedControlDecision =
	| { ok: true; via: 'strong_bearer' | 'first_party_cookie' }
	| { ok: false; reason: 'weak_bearer' | 'missing_session' | 'untrusted_origin' }

/**
 * Pause/cancel controls reduce future trading risk and do not sign or broadcast
 * a transaction themselves. A first-party HttpOnly session cookie is enough for
 * these controls, provided no weaker Authorization header is present and the
 * browser Origin is one of our own surfaces. Python still verifies the cookie
 * signature and order ownership downstream.
 */
export function trustedControlDecision(request: Request): TrustedControlDecision {
	const authorization = request.headers.get('Authorization')
	if (authorization) {
		const source = bearerSessionSource(authorization)
		if (source && STRONG_SESSION_SOURCES.has(source)) return { ok: true, via: 'strong_bearer' }
		// Python prefers Authorization over Cookie; never let a weak bearer hide
		// behind a good cookie or the downstream would authenticate the weak token.
		return { ok: false, reason: 'weak_bearer' }
	}

	if (!hasSessionCookie(request.headers.get('Cookie'))) {
		return { ok: false, reason: 'missing_session' }
	}
	const origin = request.headers.get('Origin')
	if (!origin || !FIRST_PARTY_CONTROL_ORIGINS.has(origin)) {
		return { ok: false, reason: 'untrusted_origin' }
	}
	return { ok: true, via: 'first_party_cookie' }
}

export function trustedSpendPreflight() {
	return async (c: Context, next: Next) => {
		const decision = trustedSpendDecision(c.req.raw)
		if (!decision.ok) {
			// Deliberately omit Authorization, Cookie, request body, user/wallet ids,
			// and query values. We only need enough metadata to distinguish a stale
			// OAuth session from a missing step-up flow in production telemetry.
			logger.warn(
				{
					event: 'trading_proof_denied',
					reason: decision.reason,
					method: c.req.method,
					path: c.req.path,
				},
				'[Auth] Protected action denied before authentication',
			)
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
