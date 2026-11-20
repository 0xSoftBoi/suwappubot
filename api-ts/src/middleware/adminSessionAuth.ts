import { and, eq, sql } from 'drizzle-orm'
import { Effect, Either } from 'effect'
import type { Context, Next } from 'hono'
import { getCookie } from 'hono/cookie'
import { requireDb } from '../db/DrizzleService'
import { oauthIdentities } from '../db/schema'
import { runEffectEither } from '../runtime'
import { writeAuditLog } from '../services/audit'
import { adminKeyAuth } from './auth'
import { SESSION_COOKIE, verifyAuthJwt } from './flexAuth'

/**
 * Session `src` claims that are only ever minted for the account's own
 * authenticated login (api/main.py create_jwt_token call sites). A token with
 * NO `src` is the legacy forgeable shape from POST /public/swap/auth and must
 * never reach the admin surface, so absence is a hard reject here.
 */
const TRUSTED_SESSION_SRCS = new Set(['weak', 'siwe', 'passkey', 'telegram'])

/** Parse `ADMIN_EMAILS` ("a@x.com, b@y.com") into a lowercase allowlist. */
export function parseAdminEmails(raw: string | undefined): string[] {
	if (!raw) return []
	return [
		...new Set(
			raw
				.split(',')
				.map((e) => e.trim().toLowerCase())
				.filter((e) => e.includes('@')),
		),
	]
}

export interface AdminAuthOptions {
	jwtSecret?: string | undefined
	/** Lowercased allowlist from `parseAdminEmails`. Empty disables session login. */
	adminEmails: string[]
}

/**
 * Admin auth: the existing `X-Admin-Key`, OR a signed-in staff session.
 *
 * The session path exists so a non-technical owner can open the admin
 * dashboard with "Continue with Google" instead of pasting an API key. It is
 * deliberately narrow:
 *
 *  - Off unless `ADMIN_EMAILS` is set.
 *  - Read-only: GET/HEAD only. The session rides a cookie, so allowing writes
 *    would need CSRF protection this surface does not have. Anything that
 *    mutates still requires the key.
 *  - The token must verify (HS256, pinned) and carry a trusted `src`.
 *  - Authorisation is NOT the token's claims. It is a database fact: the
 *    token's user must own a Google identity whose email Google reports as
 *    verified and which is on the allowlist. Other providers are excluded
 *    because they do not vouch for the address.
 *
 * Every other request falls through to `adminKeyAuth` unchanged, including
 * its per-IP brute-force lockout and audit log.
 */
export function adminAuth(validKey: string | undefined, opts: AdminAuthOptions) {
	const keyAuth = adminKeyAuth(validKey)

	return async (c: Context, next: Next) => {
		const method = c.req.method.toUpperCase()
		const sessionEligible =
			!c.req.header('X-Admin-Key') &&
			opts.adminEmails.length > 0 &&
			Boolean(opts.jwtSecret) &&
			(method === 'GET' || method === 'HEAD')

		if (sessionEligible) {
			const email = await resolveAdminEmail(c, opts)
			if (email) {
				const forwarded = c.req.header('x-forwarded-for')
				const hops = forwarded?.split(',').map((s) => s.trim()).filter(Boolean) ?? []
				writeAuditLog({
					userId: 0,
					eventType: 'admin.auth',
					details: { method, path: c.req.path, via: 'session', email },
					ipAddress: hops[hops.length - 1] ?? 'unknown',
				})
				c.set('adminEmail', email)
				return next()
			}
		}

		return keyAuth(c, next)
	}
}

async function resolveAdminEmail(c: Context, opts: AdminAuthOptions): Promise<string | null> {
	const authHeader = c.req.header('Authorization')
	const token =
		(authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined) ??
		getCookie(c, SESSION_COOKIE)
	if (!token || !opts.jwtSecret) return null

	let userId: number
	try {
		const decoded = verifyAuthJwt(token, opts.jwtSecret)
		if (!decoded.src || !TRUSTED_SESSION_SRCS.has(decoded.src)) return null
		if (!Number.isInteger(decoded.userId) || decoded.userId <= 0) return null
		userId = decoded.userId
	} catch {
		return null
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb
			return yield* Effect.tryPromise({
				try: () =>
					db
						.select({ email: sql<string>`lower(${oauthIdentities.email})` })
						.from(oauthIdentities)
						.where(
							and(
								eq(oauthIdentities.userId, userId),
								eq(oauthIdentities.provider, 'google'),
								eq(oauthIdentities.isVerified, true),
							),
						),
				catch: (e) => new Error(`Database error: ${e}`),
			})
		}),
	)
	// Fail closed on any lookup error.
	if (Either.isLeft(result)) return null

	const match = result.right.find((row) => row.email && opts.adminEmails.includes(row.email))
	return match?.email ?? null
}

declare module 'hono' {
	interface ContextVariableMap {
		adminEmail?: string
	}
}
