import { afterEach, describe, expect, test } from 'bun:test'
import {
	_resetBreaker,
	isBreakerOpen,
	observeRateLimitHeaders,
	routeHash,
	shouldCapture,
} from '../lib/routeCapture'

/**
 * Guards the two mechanisms that keep counterfactual capture from harming the
 * user-facing quote path.
 *
 * LI.FI enforces ONE shared rate-limit pool across /quote and /advanced/routes
 * (100 RPM default, two-hour rolling window). Capture mirrors quotes to
 * /advanced/routes, so without sampling and a circuit breaker a data-collection
 * call could rate-limit a real user's swap. These tests exist so a future edit
 * cannot quietly remove either guard.
 */

const ORIGINAL_ENV = { ...process.env }

afterEach(() => {
	process.env = { ...ORIGINAL_ENV }
	_resetBreaker()
})

describe('capture sampling', () => {
	test('kill switch disables capture entirely', () => {
		process.env.ROUTE_CAPTURE_ENABLED = 'false'
		process.env.ROUTE_CAPTURE_SAMPLE_PCT = '100'
		expect(shouldCapture()).toBe(false)
	})

	test('0% never captures, 100% always captures', () => {
		process.env.ROUTE_CAPTURE_SAMPLE_PCT = '0'
		for (let i = 0; i < 50; i++) expect(shouldCapture()).toBe(false)

		process.env.ROUTE_CAPTURE_SAMPLE_PCT = '100'
		for (let i = 0; i < 50; i++) expect(shouldCapture()).toBe(true)
	})

	test('a malformed sample percentage falls back to the default, not to 100%', () => {
		process.env.ROUTE_CAPTURE_SAMPLE_PCT = 'not-a-number'
		// Default is 20% — over 400 draws, landing on all-true would mean the
		// fallback silently became "always capture".
		const results = Array.from({ length: 400 }, () => shouldCapture())
		expect(results.some((r) => !r)).toBe(true)
	})

	test('out-of-range percentages are clamped', () => {
		process.env.ROUTE_CAPTURE_SAMPLE_PCT = '-50'
		expect(shouldCapture()).toBe(false)

		process.env.ROUTE_CAPTURE_SAMPLE_PCT = '5000'
		expect(shouldCapture()).toBe(true)
	})
})

describe('rate-limit circuit breaker', () => {
	function headers(h: Record<string, string>): Headers {
		return new Headers(h)
	}

	test('stays closed when headroom is healthy', () => {
		observeRateLimitHeaders(headers({ 'x-ratelimit-remaining': '95' }))
		expect(isBreakerOpen()).toBe(false)
	})

	test('opens when remaining headroom drops to the floor', () => {
		observeRateLimitHeaders(
			headers({ 'x-ratelimit-remaining': '3', 'x-ratelimit-reset': '30' }),
		)
		expect(isBreakerOpen()).toBe(true)
	})

	test('an open breaker suppresses capture even at 100% sampling', () => {
		process.env.ROUTE_CAPTURE_SAMPLE_PCT = '100'
		expect(shouldCapture()).toBe(true)

		observeRateLimitHeaders(headers({ 'x-ratelimit-remaining': '1' }))
		expect(shouldCapture()).toBe(false)
	})

	test('missing rate-limit headers leave the breaker untouched', () => {
		observeRateLimitHeaders(headers({}))
		expect(isBreakerOpen()).toBe(false)
	})

	test('a nonsense reset value still pauses capture', () => {
		observeRateLimitHeaders(
			headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': 'soon' }),
		)
		expect(isBreakerOpen()).toBe(true)
	})
})

describe('routeHash', () => {
	const base = {
		provider: 'lifi',
		tool: 'stargate',
		fromChain: '1',
		toChain: '8453',
		fromToken: 'USDC',
		toToken: 'ETH',
	}

	test('is stable for identical inputs', () => {
		expect(routeHash(base)).toBe(routeHash({ ...base }))
	})

	test('differs when the tool differs', () => {
		expect(routeHash(base)).not.toBe(routeHash({ ...base, tool: 'across' }))
	})

	test('handles null provider/tool without throwing', () => {
		expect(routeHash({ ...base, provider: null, tool: null })).toHaveLength(64)
	})
})
