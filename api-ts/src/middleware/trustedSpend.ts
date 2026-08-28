import type { Context, Next } from 'hono'

const STRONG_SESSION_SOURCES = new Set(['siwe', 'telegram', 'passkey'])

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
