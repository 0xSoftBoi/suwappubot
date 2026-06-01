import { describe, expect, it } from 'bun:test'
import { resolveClientIp } from '../middleware/ipRateLimit'

// Regression tests for the spoofable x-forwarded-for rate-limit bypass.
// The service runs behind a single trusted proxy (AWS ALB) that APPENDS the
// real client IP to the right of x-forwarded-for. The spoof-resistant value is
// therefore the entry `trustedProxyCount` hops from the RIGHT, not the leftmost.
describe('resolveClientIp', () => {
	const TRUSTED = 1

	it('uses the proxy-appended (rightmost) entry for single-hop traffic', () => {
		// Legitimate request through one proxy: chain is just the client IP.
		expect(resolveClientIp('203.0.113.7', undefined, TRUSTED)).toBe('203.0.113.7')
	})

	it('ignores attacker-padded leftmost entries (the spoof)', () => {
		// Attacker sets x-forwarded-for: <spoof>; proxy appends real client IP.
		// Old code keyed on the leftmost spoofed value (rotatable per request);
		// new code must key on the proxy-appended rightmost value.
		expect(resolveClientIp('1.1.1.1', '198.51.100.9', TRUSTED)).toBe('198.51.100.9')
		expect(resolveClientIp('1.1.1.2, 198.51.100.9', undefined, TRUSTED)).toBe('198.51.100.9')
		expect(resolveClientIp('1.1.1.3, 1.1.1.4, 198.51.100.9', undefined, TRUSTED)).toBe(
			'198.51.100.9',
		)
	})

	it('keeps the rate-limit key stable while an attacker rotates spoofed IPs', () => {
		// All three forged requests resolve to the same real client key, so the
		// limiter still buckets them together instead of letting the attacker
		// escape the window by changing the header.
		const a = resolveClientIp('9.9.9.1, 198.51.100.9', undefined, TRUSTED)
		const b = resolveClientIp('9.9.9.2, 198.51.100.9', undefined, TRUSTED)
		const c = resolveClientIp('', '198.51.100.9', TRUSTED)
		expect(a).toBe(b)
		expect(b).toBe(c)
	})

	it('falls back to the socket IP when no forwarded header is present', () => {
		expect(resolveClientIp(undefined, '198.51.100.9', TRUSTED)).toBe('198.51.100.9')
		expect(resolveClientIp('', '198.51.100.9', TRUSTED)).toBe('198.51.100.9')
		expect(resolveClientIp('   ', '198.51.100.9', TRUSTED)).toBe('198.51.100.9')
	})

	it("falls back to 'unknown' only when nothing identifies the client", () => {
		expect(resolveClientIp(undefined, undefined, TRUSTED)).toBe('unknown')
		expect(resolveClientIp('', '', TRUSTED)).toBe('unknown')
	})

	it('trims whitespace around entries', () => {
		expect(resolveClientIp('  203.0.113.7  ', undefined, TRUSTED)).toBe('203.0.113.7')
		expect(resolveClientIp('1.1.1.1 ,  198.51.100.9 ', undefined, TRUSTED)).toBe('198.51.100.9')
	})

	it('supports multi-hop proxy chains via trustedProxyCount', () => {
		// e.g. CloudFront -> ALB: real client is 2 hops from the right.
		expect(
			resolveClientIp('attacker, 203.0.113.7, 70.0.0.1', undefined, 2),
		).toBe('203.0.113.7')
	})
})
