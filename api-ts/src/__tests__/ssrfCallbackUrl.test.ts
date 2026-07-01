/**
 * Regression tests for the SSRF callback_url guard (MEDIUM fix).
 *
 * Covers the bypasses of the original string-match `isPublicUrl`:
 *  - decimal-encoded IP (http://2130706433/ === 127.0.0.1)
 *  - octal / hex encoded IPs
 *  - IPv6-mapped loopback (::ffff:127.0.0.1)
 *  - cloud-metadata endpoint (169.254.169.254)
 * while still ALLOWING normal public https URLs.
 *
 * These assertions FAIL against the pre-fix validator (which allowed all of the
 * above) and PASS against the hardened guard.
 */

import { describe, expect, it } from 'bun:test'

import { assertUrlSafeForFetch, isPrivateIp, RegisterAgentSchema } from '../routes/validators'

/** True when the schema accepts the given callback_url. */
function accepts(url: string): boolean {
	return RegisterAgentSchema.safeParse({ name: 'test-agent', callback_url: url }).success
}

describe('SSRF callback_url guard — RegisterAgentSchema', () => {
	it('REJECTS decimal-encoded loopback (http://2130706433/)', () => {
		expect(accepts('http://2130706433/')).toBe(false)
	})

	it('REJECTS hex- and octal-encoded loopback', () => {
		expect(accepts('http://0x7f000001/')).toBe(false)
		expect(accepts('http://0177.0.0.1/')).toBe(false)
	})

	it('REJECTS IPv6-mapped loopback (::ffff:127.0.0.1)', () => {
		expect(accepts('http://[::ffff:127.0.0.1]/')).toBe(false)
		expect(accepts('http://[::ffff:7f00:0001]/')).toBe(false)
		expect(accepts('http://[::1]/')).toBe(false)
	})

	it('REJECTS cloud-metadata endpoint (169.254.169.254)', () => {
		expect(accepts('http://169.254.169.254/latest/meta-data/')).toBe(false)
	})

	it('REJECTS ULA / link-local IPv6 and non-http schemes', () => {
		expect(accepts('http://[fc00::1]/')).toBe(false)
		expect(accepts('http://[fe80::1]/')).toBe(false)
		expect(accepts('file:///etc/passwd')).toBe(false)
		expect(accepts('gopher://127.0.0.1/')).toBe(false)
	})

	it('still REJECTS plain private / loopback literals', () => {
		expect(accepts('http://127.0.0.1/hook')).toBe(false)
		expect(accepts('http://10.0.0.1/hook')).toBe(false)
		expect(accepts('http://192.168.1.1/hook')).toBe(false)
		expect(accepts('http://localhost:8080/hook')).toBe(false)
	})

	it('ALLOWS a normal public https URL', () => {
		expect(accepts('https://api.example.com/webhook')).toBe(true)
		expect(accepts('https://hooks.slack.com/services/xxx')).toBe(true)
	})
})

describe('isPrivateIp classification', () => {
	it('flags private / loopback / link-local / mapped addresses', () => {
		expect(isPrivateIp('127.0.0.1')).toBe(true)
		expect(isPrivateIp('10.1.2.3')).toBe(true)
		expect(isPrivateIp('169.254.169.254')).toBe(true)
		expect(isPrivateIp('0.0.0.0')).toBe(true)
		expect(isPrivateIp('::1')).toBe(true)
		expect(isPrivateIp('::ffff:127.0.0.1')).toBe(true)
		expect(isPrivateIp('fc00::1')).toBe(true)
		expect(isPrivateIp('fe80::1')).toBe(true)
	})

	it('does not flag public addresses', () => {
		expect(isPrivateIp('8.8.8.8')).toBe(false)
		expect(isPrivateIp('1.1.1.1')).toBe(false)
		expect(isPrivateIp('2606:4700:4700::1111')).toBe(false)
	})
})

describe('assertUrlSafeForFetch — fetch-time re-validation', () => {
	it('rejects metadata / private IP literals', async () => {
		await expect(assertUrlSafeForFetch('http://169.254.169.254/')).rejects.toThrow()
		await expect(assertUrlSafeForFetch('http://2130706433/')).rejects.toThrow()
		await expect(assertUrlSafeForFetch('http://[::ffff:127.0.0.1]/')).rejects.toThrow()
	})

	it('accepts a public IP literal without resolving DNS', async () => {
		await expect(assertUrlSafeForFetch('http://8.8.8.8/')).resolves.toBeUndefined()
	})
})
