/**
 * Thin client for Intercepta (Web3 Antivirus) address risk screening.
 *
 * Hackathon build note (ETHGlobal Tokyo 2026 "Agent Swap Passport", see
 * docs/plans/ethglobal-tokyo2026-agent-passport.md Phase 2 "Intercepta" — owns
 * the $2k bounty): screen the on-chain counterparty of a metered payment
 * BEFORE the charge is finalized.
 *
 *   GET https://api.web3antivirus.io/api/public/v2/extension/account/{address}/quick-scan
 *   Header: X-API-KEY: <key>
 *
 * Mirrors lib/worldId.ts's convention: a plain async function that takes its
 * config as parameters (resolved by the caller from EnvService via
 * runEffectEither) rather than depending on the Effect Layer graph directly.
 * This keeps the client trivially testable and consistent with the other
 * hackathon integration (worldId.ts) already in this codebase.
 *
 * FAIL-CLOSED CONTRACT (money-path — do not weaken this):
 *   - No API key configured -> reject (InterceptaUnavailableError), never a
 *     "safe" default. INTERCEPTA_API_KEY is obtained via a self-serve
 *     Typeform (docs.web3antivirus.io/reference/getting-started-1) and is NOT
 *     YET PROVISIONED as of this hackathon build, so in practice this branch
 *     is what fires today — callers MUST treat it as "screening unavailable,
 *     reject the payment", never as "allow".
 *   - Network error / timeout / non-2xx -> reject (InterceptaUnavailableError).
 *   - Malformed response body (missing/non-numeric toxicScore) -> treated as a
 *     failed scan (InterceptaUnavailableError), NOT defaulted to a numeric
 *     "safe" or "risky" score. A vendor API that starts returning garbage is
 *     exactly the scenario fail-closed is meant to catch — silently coercing
 *     to some sentinel score would just move the same footgun one level down.
 *   - Only a well-formed 2xx body with a numeric toxicScore is treated as a
 *     successful scan that the middleware can compare against the threshold.
 */

import { logger } from './logger'

export interface InterceptaScanResult {
	address: string
	toxicScore: number
	traits: string[]
	/** Raw vendor response, kept for debugging/audit; not required by callers. */
	raw?: unknown
}

/**
 * Tagged failure: screening could not be performed at all (config missing,
 * network error, malformed response). Callers must treat this the same as
 * "risky" for the purposes of gating a charge — i.e. reject, don't allow.
 */
export class InterceptaUnavailableError extends Error {
	readonly _tag = 'InterceptaUnavailableError' as const
	readonly reason: string

	constructor(reason: string) {
		super(`InterceptaUnavailableError: ${reason}`)
		this.name = 'InterceptaUnavailableError'
		this.reason = reason
	}
}

const QUICK_SCAN_BASE_URL = 'https://api.web3antivirus.io/api/public/v2/extension/account'
const CACHE_TTL_MS = 60_000

interface CacheEntry {
	result: InterceptaScanResult
	expiresAt: number
}

// In-memory TTL cache: risk doesn't need re-checking on every single call, and
// this is a single-process cache (fine for a hackathon build; a shared cache
// like Redis would be the production follow-up for multi-instance deploys).
const scanCache = new Map<string, CacheEntry>()

function getCached(address: string): InterceptaScanResult | undefined {
	const key = address.toLowerCase()
	const entry = scanCache.get(key)
	if (!entry) return undefined
	if (entry.expiresAt < Date.now()) {
		scanCache.delete(key)
		return undefined
	}
	return entry.result
}

function setCached(address: string, result: InterceptaScanResult): void {
	scanCache.set(address.toLowerCase(), { result, expiresAt: Date.now() + CACHE_TTL_MS })
}

export interface InterceptaConfig {
	apiKey?: string | undefined
	timeoutMs?: number
}

/**
 * Quick-scan an address for toxicity/risk traits. Never throws: resolves to
 * either a successful InterceptaScanResult or rejects with
 * InterceptaUnavailableError — callers MUST treat the rejection as
 * "screening unavailable, fail closed" and never as "clean".
 */
export async function quickScan(
	address: string,
	config: InterceptaConfig,
): Promise<InterceptaScanResult> {
	const normalized = address.toLowerCase()

	const cached = getCached(normalized)
	if (cached) return cached

	if (!config.apiKey) {
		logger.warn(
			{ address: normalized },
			'[intercepta] INTERCEPTA_API_KEY not configured — failing closed (screening unavailable)',
		)
		throw new InterceptaUnavailableError('api_key_not_configured')
	}

	const url = `${QUICK_SCAN_BASE_URL}/${encodeURIComponent(address)}/quick-scan`
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? 5000)

	let res: Response
	try {
		res = await fetch(url, {
			method: 'GET',
			headers: { 'X-API-KEY': config.apiKey },
			signal: controller.signal,
		})
	} catch (e) {
		logger.warn(
			{ address: normalized, err: e instanceof Error ? e.message : String(e) },
			'[intercepta] quick-scan request failed — failing closed',
		)
		throw new InterceptaUnavailableError(
			e instanceof Error ? `request_error: ${e.message}` : 'request_error',
		)
	} finally {
		clearTimeout(timer)
	}

	if (!res.ok) {
		logger.warn(
			{ address: normalized, status: res.status },
			'[intercepta] quick-scan non-2xx response — failing closed',
		)
		throw new InterceptaUnavailableError(`http_${res.status}`)
	}

	const body = await res.json().catch(() => undefined)

	// Defensive parse: tolerate missing/malformed fields. A missing or
	// non-numeric toxicScore is treated as a failed scan (fail-closed), NOT
	// defaulted to a "safe" score.
	const toxicScoreRaw = (body as Record<string, unknown> | undefined)?.toxicScore
	const traitsRaw = (body as Record<string, unknown> | undefined)?.traits

	if (typeof toxicScoreRaw !== 'number' || Number.isNaN(toxicScoreRaw)) {
		logger.warn(
			{ address: normalized, body },
			'[intercepta] quick-scan returned malformed toxicScore — failing closed',
		)
		throw new InterceptaUnavailableError('malformed_response')
	}

	const traits = Array.isArray(traitsRaw)
		? traitsRaw.filter((t): t is string => typeof t === 'string')
		: []

	const result: InterceptaScanResult = {
		address: normalized,
		toxicScore: toxicScoreRaw,
		traits,
		raw: body,
	}

	setCached(normalized, result)
	return result
}
