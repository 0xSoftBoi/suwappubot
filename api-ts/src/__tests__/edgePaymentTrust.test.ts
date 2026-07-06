import { describe, expect, it } from 'bun:test'
import { EDGE_PAYMENT_HEADER, signEdgeReceipt, verifyEdgeReceipt } from '../lib/edgePaymentTrust'

const SECRET = 'test-shared-secret-do-not-use-in-prod'
const METHOD = 'POST'
const PATH = '/v1/agent/quote'
const NOW = 1_800_000_000 // fixed reference "now" in seconds

describe('edgePaymentTrust', () => {
	it('exposes the documented header name', () => {
		expect(EDGE_PAYMENT_HEADER).toBe('x-suwappu-edge-payment')
	})

	it('round-trips a freshly signed receipt as trusted', () => {
		const header = signEdgeReceipt(SECRET, METHOD, PATH, NOW)
		const result = verifyEdgeReceipt({ secret: SECRET, header, method: METHOD, path: PATH, nowSec: NOW })
		expect(result).toEqual({ trusted: true })
	})

	it('accepts lowercase method input by uppercasing before signing/verifying', () => {
		const header = signEdgeReceipt(SECRET, 'post', PATH, NOW)
		const result = verifyEdgeReceipt({ secret: SECRET, header, method: 'post', path: PATH, nowSec: NOW })
		expect(result).toEqual({ trusted: true })
	})

	it('rejects a receipt older than the default 300s skew window', () => {
		const header = signEdgeReceipt(SECRET, METHOD, PATH, NOW - 301)
		const result = verifyEdgeReceipt({ secret: SECRET, header, method: METHOD, path: PATH, nowSec: NOW })
		expect(result.trusted).toBe(false)
		expect((result as { reason: string }).reason).toBe('expired')
	})

	it('accepts a receipt right at the skew boundary', () => {
		const header = signEdgeReceipt(SECRET, METHOD, PATH, NOW - 300)
		const result = verifyEdgeReceipt({ secret: SECRET, header, method: METHOD, path: PATH, nowSec: NOW })
		expect(result).toEqual({ trusted: true })
	})

	it('rejects a timestamp too far in the future (beyond skew)', () => {
		const header = signEdgeReceipt(SECRET, METHOD, PATH, NOW + 301)
		const result = verifyEdgeReceipt({ secret: SECRET, header, method: METHOD, path: PATH, nowSec: NOW })
		expect(result.trusted).toBe(false)
		expect((result as { reason: string }).reason).toBe('expired')
	})

	it('respects a custom maxSkewSec override', () => {
		const header = signEdgeReceipt(SECRET, METHOD, PATH, NOW - 60)
		const tight = verifyEdgeReceipt({
			secret: SECRET,
			header,
			method: METHOD,
			path: PATH,
			nowSec: NOW,
			maxSkewSec: 30,
		})
		expect(tight.trusted).toBe(false)

		const loose = verifyEdgeReceipt({
			secret: SECRET,
			header,
			method: METHOD,
			path: PATH,
			nowSec: NOW,
			maxSkewSec: 120,
		})
		expect(loose).toEqual({ trusted: true })
	})

	it('rejects a receipt signed with the wrong secret', () => {
		const header = signEdgeReceipt('some-other-secret', METHOD, PATH, NOW)
		const result = verifyEdgeReceipt({ secret: SECRET, header, method: METHOD, path: PATH, nowSec: NOW })
		expect(result.trusted).toBe(false)
		expect((result as { reason: string }).reason).toBe('signature_mismatch')
	})

	it('rejects a receipt whose path was tampered / mismatches the request path', () => {
		const header = signEdgeReceipt(SECRET, METHOD, PATH, NOW)
		const result = verifyEdgeReceipt({
			secret: SECRET,
			header,
			method: METHOD,
			path: '/v1/agent/swap',
			nowSec: NOW,
		})
		expect(result.trusted).toBe(false)
		expect((result as { reason: string }).reason).toBe('signature_mismatch')
	})

	it('rejects a receipt whose method was tampered / mismatches the request method', () => {
		const header = signEdgeReceipt(SECRET, 'GET', PATH, NOW)
		const result = verifyEdgeReceipt({ secret: SECRET, header, method: 'POST', path: PATH, nowSec: NOW })
		expect(result.trusted).toBe(false)
		expect((result as { reason: string }).reason).toBe('signature_mismatch')
	})

	it('never throws on a malformed header and fails closed', () => {
		const cases = [
			'',
			'not-a-receipt-at-all',
			'v1.notanumber.deadbeef',
			'v1.1800000000',
			'v2.1800000000.deadbeef',
			'v1.1800000000.not-hex!!',
			'v1.1800000000.', // empty signature
			'a.b.c.d',
		]
		for (const header of cases) {
			expect(() =>
				verifyEdgeReceipt({ secret: SECRET, header, method: METHOD, path: PATH, nowSec: NOW }),
			).not.toThrow()
			const result = verifyEdgeReceipt({ secret: SECRET, header, method: METHOD, path: PATH, nowSec: NOW })
			expect(result.trusted).toBe(false)
		}
	})

	it('fails closed on a missing header', () => {
		const result = verifyEdgeReceipt({ secret: SECRET, header: undefined, method: METHOD, path: PATH, nowSec: NOW })
		expect(result).toEqual({ trusted: false, reason: 'missing_header' })
	})

	it('fails closed when the shared secret is empty (metering never bypassed by accident)', () => {
		const header = signEdgeReceipt(SECRET, METHOD, PATH, NOW)
		const result = verifyEdgeReceipt({ secret: '', header, method: METHOD, path: PATH, nowSec: NOW })
		expect(result).toEqual({ trusted: false, reason: 'no_secret' })
	})

	it('rejects a signature of the wrong length instead of throwing on timingSafeEqual', () => {
		const header = signEdgeReceipt(SECRET, METHOD, PATH, NOW)
		const truncated = header.slice(0, -2) // drop the last hex byte
		const result = verifyEdgeReceipt({ secret: SECRET, header: truncated, method: METHOD, path: PATH, nowSec: NOW })
		expect(result.trusted).toBe(false)
	})
})
