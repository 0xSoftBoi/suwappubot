import { eq } from 'drizzle-orm'
import { Effect, Either } from 'effect'
import type { Context, Next } from 'hono'
import type { Agent } from '../db'
import { requireDb, users } from '../db'
import { logger } from '../lib/logger'
import { runEffectEither } from '../runtime'
import type { TelegramUser } from '../services'
import { resolveRequestIp } from './ipRateLimit'
import type { AuthUser } from './flexAuth'

// `cf-ipcountry` is trivially spoofable by any direct caller UNLESS the
// request actually transited Cloudflare. We mirror the provenance gate from
// ipRateLimit.ts: only trust cf-* headers when the caller also presents the
// shared secret that a configured Cloudflare Worker/Transform Rule attaches
// at the edge (`cf-provenance: <secret>`).
//
// Read lazily rather than captured at module scope, same rationale as
// ipRateLimit.ts's cfProvenanceSecret(): a module-scope constant would be
// frozen by whichever importer loads this file first.
function cfProvenanceSecret(): string {
	return process.env.CF_PROVENANCE_SECRET?.trim() || ''
}

function restrictedCountries(): Set<string> {
	const raw = process.env.DERIVATIVES_RESTRICTED_COUNTRIES?.trim() || 'US'
	return new Set(
		raw
			.split(',')
			.map((c) => c.trim().toUpperCase())
			.filter((c) => c.length > 0),
	)
}

// Lightweight, self-contained private/loopback/link-local check. Deliberately
// NOT reusing routes/ssrfGuard.ts's isPrivateIp — middleware shouldn't reach
// into routes/, and geo-lookups only need "is this worth looking up at all",
// not SSRF-grade DNS-rebinding rigor.
function isPrivateOrLocalIp(ip: string): boolean {
	if (!ip || ip === 'unknown' || ip === 'localhost') return true
	if (ip === '127.0.0.1' || ip === '::1') return true

	const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
	if (v4) {
		const a = Number(v4[1])
		const b = Number(v4[2])
		if (a === 10 || a === 127) return true
		if (a === 172 && b >= 16 && b <= 31) return true
		if (a === 192 && b === 168) return true
		if (a === 169 && b === 254) return true
		return false
	}

	const lower = ip.toLowerCase()
	if (lower.startsWith('fc') || lower.startsWith('fd')) return true // ULA fc00::/7
	if (lower.startsWith('fe80')) return true // link-local fe80::/10
	return false
}

// fast-geoip is CJS with `export =`; imported lazily (dynamic import) so the
// (small, mmap'd) dataset is only touched by processes that actually hit the
// fallback path, and so a broken/missing install degrades to "no geoip"
// rather than failing module load for the whole service.
let geoipModulePromise: Promise<typeof import('fast-geoip') | null> | null = null
function loadGeoip(): Promise<typeof import('fast-geoip') | null> {
	if (!geoipModulePromise) {
		geoipModulePromise = import('fast-geoip').catch((err) => {
			logger.warn({ err }, '[regionGate] fast-geoip unavailable; GeoIP fallback disabled')
			return null
		})
	}
	return geoipModulePromise
}

declare module 'hono' {
	interface ContextVariableMap {
		// Cache of the resolved observed country for this request, keyed once
		// so a route that mounts regionGate() twice (blanket compliance pass +
		// a second pass after per-route auth resolves the caller's identity,
		// see perps.ts/predict.ts) doesn't redo the header/GeoIP resolution.
		__regionGateObservedCountry?: string | null
	}
}

/**
 * Resolve the caller's country. Trusts `cf-ipcountry` only with verified (or
 * unconfigured) Cloudflare provenance; otherwise falls back to an OFFLINE
 * GeoIP lookup (fast-geoip) keyed off the spoof-resistant client IP shared
 * with the rate limiter (resolveRequestIp). Never calls an external HTTP geo
 * API. Skips the lookup entirely for private/loopback/local IPs (dev,
 * internal health checks). Fails open (undefined = unknown) on any error.
 */
async function resolveObservedCountry(c: Context): Promise<string | undefined> {
	const cached = c.get('__regionGateObservedCountry')
	if (cached !== undefined) return cached ?? undefined

	const secret = cfProvenanceSecret()
	const provenanceHeader = c.req.header('cf-provenance')?.trim()
	const provenanceOk = !secret || provenanceHeader === secret
	const headerCountry = c.req.header('cf-ipcountry')?.trim().toUpperCase()

	if (provenanceOk && headerCountry) {
		c.set('__regionGateObservedCountry', headerCountry)
		return headerCountry
	}

	// Header absent, or present but untrusted (provenance configured and
	// mismatched) — resolve from the client IP instead.
	let resolved: string | undefined
	try {
		const ip = resolveRequestIp(c)
		if (!isPrivateOrLocalIp(ip)) {
			const geoip = await loadGeoip()
			const info = await geoip?.lookup(ip)
			resolved = info?.country?.trim().toUpperCase() || undefined
		}
	} catch (err) {
		logger.warn({ err }, '[regionGate] GeoIP lookup failed; failing open')
		resolved = undefined
	}

	c.set('__regionGateObservedCountry', resolved ?? null)
	return resolved
}

interface StickyUserRegion {
	userId: number
	region: string | null
}

async function lookupUserRegion(
	where: ReturnType<typeof eq>,
): Promise<StickyUserRegion | null> {
	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb
			const rows = yield* Effect.tryPromise({
				try: () =>
					db
						.select({ userId: users.id, region: users.region })
						.from(users)
						.where(where)
						.limit(1),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})
			return rows[0] ?? null
		}),
	)

	if (Either.isLeft(result)) {
		logger.warn({ err: result.left }, '[regionGate] user region lookup failed; failing open')
		return null
	}
	return result.right
}

/**
 * Resolve the region-relevant identity for THIS request, if one is already
 * authenticated by an earlier middleware in the chain:
 *  - agent routes (perps.ts/predict.ts trade endpoints): c.get('agent').ownerUserId
 *  - webapp Mini App routes (webapp.ts protectedWebapp): c.get('telegramUser').id
 *  - webapp data routes (webappData.ts, flexAuth): c.get('authUser').userId — already
 *    the resolved internal user id, no telegram lookup needed
 * Priority is arbitrary since these are mutually exclusive per route. Returns
 * null (not "unauthenticated" 401 — this middleware never gates on auth
 * presence) when nothing is set, or on any DB failure (fail-open, logged).
 */
async function resolveStickyUserContext(c: Context): Promise<StickyUserRegion | null> {
	try {
		const agent = c.get('agent') as Agent | undefined
		if (agent?.ownerUserId != null) {
			return await lookupUserRegion(eq(users.id, agent.ownerUserId))
		}

		const authUser = c.get('authUser') as AuthUser | undefined
		if (authUser?.userId != null) {
			return await lookupUserRegion(eq(users.id, authUser.userId))
		}

		const telegramUser = c.get('telegramUser') as TelegramUser | undefined
		if (telegramUser?.id != null) {
			return await lookupUserRegion(eq(users.telegramId, telegramUser.id))
		}

		return null
	} catch (err) {
		logger.warn({ err }, '[regionGate] failed to resolve sticky user context; failing open')
		return null
	}
}

// Fire-and-forget sticky write. Never awaited by the request path — a slow
// or failed write must not delay/soften the 451 already decided, nor block
// an allowed request. Failures are logged, not surfaced.
function persistUserRegion(userId: number, region: string): void {
	runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb
			yield* Effect.tryPromise({
				try: () => db.update(users).set({ region }).where(eq(users.id, userId)),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})
		}),
	)
		.then((result) => {
			if (Either.isLeft(result)) {
				logger.warn(
					{ err: result.left, userId, region },
					'[regionGate] failed to persist sticky region',
				)
			}
		})
		.catch((err) => {
			logger.warn({ err, userId, region }, '[regionGate] failed to persist sticky region')
		})
}

function blockedResponse(c: Context) {
	return c.json(
		{
			error: 'REGION_RESTRICTED',
			message: 'Futures and prediction markets are not available in your region.',
		},
		451,
	)
}

/**
 * Blocks requests originating from restricted regions (compliance control for
 * derivatives-adjacent surfaces: perps and prediction markets).
 *
 * Decision order:
 *  1. Stored `users.region` (sticky) is restricted -> 451 immediately,
 *     regardless of the current request's IP/header (a VPN cannot unblock a
 *     user already flagged restricted).
 *  2. Observed country (trusted cf-ipcountry, else offline GeoIP fallback
 *     off the client IP) is restricted -> 451, AND best-effort persist it to
 *     `users.region` if an authenticated user is in context (sticky write,
 *     also feeds the Python bot's own region gate — shared column).
 *  3. Stored region is empty and observed country is known & non-restricted
 *     -> best-effort persist it (backfill). A non-empty stored region is
 *     NEVER overwritten with a non-restricted value once set — that would
 *     let a restricted user "launder" their sticky flag via a clean IP.
 *  4. Otherwise allow.
 *
 * No identity in context (public/unauthenticated routes, or this middleware
 * running before per-route auth resolves one — see perps.ts/predict.ts,
 * which mount this twice: once blanket for the IP/header check, again after
 * agentBearerAuth() on trade-executing routes for the sticky part) simply
 * skips steps 1 and 3; only the IP/header check applies. All DB access
 * fails open with a logged warning.
 */
export function regionGate() {
	const restricted = restrictedCountries()

	return async (c: Context, next: Next) => {
		const [observedCountry, userCtx] = await Promise.all([
			resolveObservedCountry(c),
			resolveStickyUserContext(c),
		])

		const storedRegion = userCtx?.region?.trim().toUpperCase() || undefined

		if (storedRegion && restricted.has(storedRegion)) {
			return blockedResponse(c)
		}

		if (observedCountry && restricted.has(observedCountry)) {
			if (userCtx && storedRegion !== observedCountry) {
				persistUserRegion(userCtx.userId, observedCountry)
			}
			return blockedResponse(c)
		}

		if (observedCountry && userCtx && !storedRegion) {
			persistUserRegion(userCtx.userId, observedCountry)
		}

		await next()
	}
}
