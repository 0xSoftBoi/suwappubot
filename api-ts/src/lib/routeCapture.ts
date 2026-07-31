/**
 * Counterfactual route capture.
 *
 * The quote path calls LI.FI `/quote`, which returns a SINGLE best route. The
 * alternatives it considered are never surfaced, so every swap we execute
 * throws away the only data that could tell us whether the chosen route was
 * the right one. This module mirrors a sampled share of quotes to
 * `/advanced/routes` (which does return multiple routes) purely to record
 * them.
 *
 * RATE LIMIT (the reason this is sampled, not universal): LI.FI enforces one
 * shared quota across `/quote`, `/advanced/routes` and
 * `/advanced/stepTransaction` — 100 RPM by default on a two-hour rolling
 * window. Mirroring every quote would DOUBLE consumption on the user-facing
 * path, so a data-collection call could rate-limit a real user's swap. Two
 * guards prevent that:
 *
 *   1. Sampling — only ROUTE_CAPTURE_SAMPLE_PCT of quotes are mirrored.
 *   2. A circuit breaker on the rate-limit headers LI.FI returns. When
 *      remaining headroom drops below RATE_LIMIT_FLOOR, capture stops until
 *      the window resets.
 *
 * The user path ALWAYS wins the budget. Capture is fire-and-forget: it never
 * blocks, never delays, and never fails a quote. If it throws, the quote is
 * unaffected.
 */

import { createHash } from 'node:crypto'
import { logger } from './logger'

const LIFI_ROUTES_URL = 'https://li.quest/v1/advanced/routes'

/** Percentage (0–100) of quotes mirrored for capture. */
function samplePct(): number {
	const raw = Number(process.env.ROUTE_CAPTURE_SAMPLE_PCT)
	if (!Number.isFinite(raw)) return 20
	return Math.min(Math.max(raw, 0), 100)
}

function captureEnabled(): boolean {
	// Kill switch — set to 'false' to stop all capture without a deploy.
	return (process.env.ROUTE_CAPTURE_ENABLED ?? 'true').toLowerCase() !== 'false'
}

/**
 * Stop capturing when fewer than this many requests remain in the LI.FI
 * window, reserving the tail of the budget for real user quotes.
 */
const RATE_LIMIT_FLOOR = Math.max(0, Number(process.env.ROUTE_CAPTURE_RL_FLOOR) || 20)

// Circuit breaker state. Set when a response shows we are near the ceiling;
// cleared once the reported reset time passes.
let breakerOpenUntilMs = 0

/** True when capture is currently suppressed by the rate-limit breaker. */
export function isBreakerOpen(): boolean {
	return Date.now() < breakerOpenUntilMs
}

/** Reset breaker state — tests only. */
export function _resetBreaker(): void {
	breakerOpenUntilMs = 0
}

/**
 * Inspect rate-limit headers and open the breaker if headroom is low.
 * Exported for testing; LI.FI returns the current limit on every response.
 */
export function observeRateLimitHeaders(headers: Headers): void {
	const remainingRaw =
		headers.get('x-ratelimit-remaining') ?? headers.get('ratelimit-remaining')
	if (remainingRaw === null) return

	const remaining = Number(remainingRaw)
	if (!Number.isFinite(remaining) || remaining > RATE_LIMIT_FLOOR) return

	const resetRaw = headers.get('x-ratelimit-reset') ?? headers.get('ratelimit-reset')
	const resetSeconds = Number(resetRaw)
	// Fall back to a conservative 60s pause when no reset hint is given.
	const pauseMs = Number.isFinite(resetSeconds) && resetSeconds > 0
		? Math.min(resetSeconds * 1000, 2 * 60 * 60 * 1000)
		: 60_000

	breakerOpenUntilMs = Date.now() + pauseMs
	logger.warn(
		'[routeCapture] rate-limit headroom low (%s left) — capture paused for %sms',
		remaining,
		pauseMs,
	)
}

/** Deterministic identity for a route, for dedupe across repeated quotes. */
export function routeHash(parts: {
	provider?: string | null
	tool?: string | null
	fromChain: string
	toChain: string
	fromToken: string
	toToken: string
}): string {
	return createHash('sha256')
		.update(
			[
				parts.provider ?? '',
				parts.tool ?? '',
				parts.fromChain,
				parts.toChain,
				parts.fromToken,
				parts.toToken,
			].join('|'),
		)
		.digest('hex')
		.slice(0, 64)
}

/** Decide whether this particular quote gets mirrored. */
export function shouldCapture(): boolean {
	if (!captureEnabled()) return false
	if (isBreakerOpen()) return false
	const pct = samplePct()
	if (pct <= 0) return false
	if (pct >= 100) return true
	return Math.random() * 100 < pct
}

export interface CapturedRoute {
	provider: string | null
	tool: string | null
	quotedToAmount: string | null
	quotedToAmountUsd: number | null
	quotedGasUsd: number | null
	quotedFeeUsd: number | null
	quotedDurationS: number | null
	rank: number
	routeHash: string
}

export interface CaptureParams {
	fromChain: string
	toChain: string
	fromToken: string
	toToken: string
	fromAmount: string
	fromAddress: string
	/** Token symbols for the shape columns (addresses go to LI.FI). */
	fromTokenSymbol: string
	toTokenSymbol: string
}

interface LifiRoutesResponse {
	routes?: Array<{
		steps?: Array<{ tool?: string; toolDetails?: { name?: string } }>
		toAmount?: string
		toAmountUSD?: string
		gasCostUSD?: string
		steps_?: unknown
		tags?: string[]
	}>
}

function num(v: unknown): number | null {
	const n = Number(v)
	return Number.isFinite(n) ? n : null
}

/**
 * Fetch the alternative routes for a quote shape.
 *
 * Returns [] on ANY failure — this is best-effort observability and must never
 * surface an error to the caller.
 */
export async function fetchRouteCandidates(
	params: CaptureParams,
	apiKey?: string,
): Promise<CapturedRoute[]> {
	try {
		const controller = new AbortController()
		// Hard timeout — capture must never linger behind a user request.
		const timeout = setTimeout(() => controller.abort(), 5_000)

		const res = await fetch(LIFI_ROUTES_URL, {
			method: 'POST',
			signal: controller.signal,
			headers: {
				'Content-Type': 'application/json',
				...(apiKey ? { 'x-lifi-api-key': apiKey } : {}),
			},
			body: JSON.stringify({
				fromChainId: Number(params.fromChain),
				toChainId: Number(params.toChain),
				fromTokenAddress: params.fromToken,
				toTokenAddress: params.toToken,
				fromAmount: params.fromAmount,
				fromAddress: params.fromAddress,
			}),
		}).finally(() => clearTimeout(timeout))

		observeRateLimitHeaders(res.headers)

		if (!res.ok) {
			logger.debug('[routeCapture] /advanced/routes returned %s', res.status)
			return []
		}

		const body = (await res.json()) as LifiRoutesResponse
		const routes = body.routes ?? []

		return routes.map((r, i) => {
			const tool = r.steps?.[0]?.toolDetails?.name ?? r.steps?.[0]?.tool ?? null
			return {
				provider: 'lifi',
				tool,
				quotedToAmount: r.toAmount ?? null,
				quotedToAmountUsd: num(r.toAmountUSD),
				quotedGasUsd: num(r.gasCostUSD),
				quotedFeeUsd: null,
				quotedDurationS: null,
				rank: i,
				routeHash: routeHash({
					provider: 'lifi',
					tool,
					fromChain: params.fromChain,
					toChain: params.toChain,
					fromToken: params.fromTokenSymbol,
					toToken: params.toTokenSymbol,
				}),
			}
		})
	} catch (e) {
		// Includes the abort timeout. Never propagate.
		logger.debug('[routeCapture] capture failed (ignored): %s', String(e))
		return []
	}
}

/**
 * Lazily-created database client for capture writes.
 *
 * The main app reaches the DB through Effect (`requireDb`), but capture is
 * invoked from a fire-and-forget path outside any Effect context — threading
 * DrizzleService through would change `getQuote`'s Effect requirements for a
 * purely optional side-channel. A single lazily-initialized client keeps one
 * pool for capture and leaves the request path's typing untouched.
 */
let captureDbPromise: Promise<unknown | null> | null = null

async function captureDb() {
	if (captureDbPromise === null) {
		captureDbPromise = (async () => {
			const url = process.env.DATABASE_URL
			if (!url) return null
			try {
				const { createDbClient } = await import('../db/client')
				return createDbClient(url)
			} catch (e) {
				logger.debug('[routeCapture] db client init failed: %s', String(e))
				return null
			}
		})()
	}
	// Typed loosely on purpose — only .insert() is used, and the schema import
	// below supplies the table typing.
	return (await captureDbPromise) as ReturnType<
		typeof import('../db/client').createDbClient
	> | null
}

export interface CaptureQuoteParams {
	quoteId: string
	fromChain: string
	toChain: string
	fromTokenAddress: string
	toTokenAddress: string
	fromTokenSymbol: string
	toTokenSymbol: string
	fromAmount: string
	fromAmountUsd: number | null
	fromAddress: string
	/** Tool name of the route `/quote` actually selected, for was_selected. */
	selectedTool: string | null
}

/**
 * Fetch and persist the candidate routes for a quote.
 *
 * Fire-and-forget: callers do NOT await this and it never throws. Any failure
 * (LI.FI down, rate limited, DB unavailable) is logged at debug and dropped —
 * losing a capture sample is always preferable to affecting a user's quote.
 */
export async function captureQuoteRoutes(params: CaptureQuoteParams): Promise<void> {
	try {
		const candidates = await fetchRouteCandidates(
			{
				fromChain: params.fromChain,
				toChain: params.toChain,
				fromToken: params.fromTokenAddress,
				toToken: params.toTokenAddress,
				fromAmount: params.fromAmount,
				fromAddress: params.fromAddress,
				fromTokenSymbol: params.fromTokenSymbol,
				toTokenSymbol: params.toTokenSymbol,
			},
			process.env.LIFI_API_KEY,
		)

		if (candidates.length === 0) return

		const db = await captureDb()
		if (!db) return
		const { swapRouteCandidates } = await import('../db/schema/swaps')

		await db.insert(swapRouteCandidates).values(
			candidates.map((c) => ({
				quoteId: params.quoteId,
				fromChain: params.fromChain,
				toChain: params.toChain,
				fromToken: params.fromTokenSymbol,
				toToken: params.toTokenSymbol,
				fromAmountUsd: params.fromAmountUsd,
				provider: c.provider,
				tool: c.tool,
				quotedToAmount: c.quotedToAmount,
				quotedToAmountUsd: c.quotedToAmountUsd,
				quotedGasUsd: c.quotedGasUsd,
				quotedFeeUsd: c.quotedFeeUsd,
				quotedDurationS: c.quotedDurationS,
				rank: c.rank,
				// Best-effort: match the tool `/quote` chose. The two endpoints can
				// disagree, in which case no row is marked selected — that is
				// recorded honestly rather than guessed.
				wasSelected: params.selectedTool !== null && c.tool === params.selectedTool,
				routeHash: c.routeHash,
			})),
		)

		// INFO, not debug: capture is a sampled background process with no
		// user-visible surface, so this line is the only operational signal
		// that the pipeline is alive and writing. Logged after the insert
		// commits, so it confirms persistence rather than just the fetch.
		logger.info(
			'[routeCapture] captured %d candidates for quote %s',
			candidates.length,
			params.quoteId,
		)
	} catch (e) {
		// WARN so a persistently broken capture path is visible, while still
		// never affecting the quote that triggered it.
		logger.warn('[routeCapture] persist failed (ignored): %s', String(e))
	}
}
