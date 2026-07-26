import { afterEach, describe, expect, it } from 'bun:test'
import { resolveTrustedClientIp } from '../middleware/ipRateLimit'

/**
 * Regression coverage for resolveTrustedClientIp's cf-connecting-ip anti-spoofing
 * gate (not covered by ipRateLimit.test.ts, which only exercises resolveClientIp).
 *
 * cf-connecting-ip is trivially forgeable by any direct-to-origin caller. It must
 * only be trusted when CF_PROVENANCE_SECRET is configured AND the request also
 * presents a matching cf-provenance header (proof it actually transited the
 * configured Cloudflare edge). This property is what protects the starter-credit
 * anti-farm cap (AgentService.registerAgent) and the IP rate limiter from an
 * attacker simply setting cf-connecting-ip to a fresh value on every request.
 *
 * These run in-process: resolveTrustedClientIp reads CF_PROVENANCE_SECRET lazily
 * per call, so mutating process.env here is safe and order-independent. An earlier
 * module-scope constant forced these cases into spawned child processes, which made
 * the suite flaky under CPU contention.
 */

const SECRET = 'test-cf-provenance-secret'
const FORGED_CF = '203.0.113.99'
const XFF_TRUSTED_HOP = '198.51.100.9'
const SOCKET = '192.0.2.1'

const originalSecret = process.env.CF_PROVENANCE_SECRET

function setSecret(value: string | undefined) {
	if (value === undefined) delete process.env.CF_PROVENANCE_SECRET
	else process.env.CF_PROVENANCE_SECRET = value
}

afterEach(() => setSecret(originalSecret))

describe('resolveTrustedClientIp (cf-connecting-ip anti-spoofing gate)', () => {
	describe('with CF_PROVENANCE_SECRET configured', () => {
		it('ignores cf-connecting-ip when no provenance header is presented', () => {
			setSecret(SECRET)
			const result = resolveTrustedClientIp(FORGED_CF, XFF_TRUSTED_HOP, SOCKET, 1, undefined)
			expect(result).not.toBe(FORGED_CF)
			expect(result).toBe(XFF_TRUSTED_HOP)
		})

		it('ignores cf-connecting-ip when the provenance header is present but wrong', () => {
			setSecret(SECRET)
			const result = resolveTrustedClientIp(
				FORGED_CF,
				XFF_TRUSTED_HOP,
				SOCKET,
				1,
				'not-the-real-secret',
			)
			expect(result).not.toBe(FORGED_CF)
			expect(result).toBe(XFF_TRUSTED_HOP)
		})

		it('honors cf-connecting-ip only when the provenance header matches the secret', () => {
			setSecret(SECRET)
			expect(resolveTrustedClientIp('1.2.3.4', XFF_TRUSTED_HOP, SOCKET, 1, SECRET)).toBe('1.2.3.4')
		})

		it('falls back to XFF when cf-connecting-ip is absent despite valid provenance', () => {
			setSecret(SECRET)
			expect(resolveTrustedClientIp(undefined, XFF_TRUSTED_HOP, SOCKET, 1, SECRET)).toBe(
				XFF_TRUSTED_HOP,
			)
		})

		it('falls back to the socket IP when neither cf-connecting-ip nor XFF is present', () => {
			setSecret(SECRET)
			expect(resolveTrustedClientIp(undefined, undefined, SOCKET, 1, SECRET)).toBe(SOCKET)
		})
	})

	describe('with CF_PROVENANCE_SECRET unset (deployment default)', () => {
		it('ignores cf-connecting-ip regardless of any provenance header', () => {
			setSecret(undefined)
			const result = resolveTrustedClientIp(FORGED_CF, XFF_TRUSTED_HOP, SOCKET, 1, SECRET)
			expect(result).not.toBe(FORGED_CF)
			expect(result).toBe(XFF_TRUSTED_HOP)
		})

		it('treats an empty-string secret as unconfigured, not as a matchable value', () => {
			setSecret('')
			const result = resolveTrustedClientIp(FORGED_CF, XFF_TRUSTED_HOP, SOCKET, 1, '')
			expect(result).not.toBe(FORGED_CF)
			expect(result).toBe(XFF_TRUSTED_HOP)
		})
	})

	it('cannot be farmed by rotating a forged cf-connecting-ip on every request', () => {
		// The starter-credit cap is keyed on the resolved IP; if a forged header won,
		// every request would land in a fresh bucket and the 3/IP/day cap would be moot.
		setSecret(undefined)
		const resolved = ['1.1.1.1', '2.2.2.2', '3.3.3.3'].map((forged) =>
			resolveTrustedClientIp(forged, XFF_TRUSTED_HOP, SOCKET, 1, undefined),
		)
		expect(new Set(resolved).size).toBe(1)
		expect(resolved[0]).toBe(XFF_TRUSTED_HOP)
	})
})
