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

import { describe, expect, it, mock } from 'bun:test'

import { assertUrlSafeForFetch, isPrivateIp, RegisterAgentSchema, safeFetch } from '../routes/validators'

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

	it('returns the vetted public IP literal for pinning (no DNS)', async () => {
		await expect(assertUrlSafeForFetch('http://8.8.8.8/')).resolves.toEqual([
			{ address: '8.8.8.8', family: 4 },
		])
	})
})

// ---------------------------------------------------------------------------
// DNS-rebinding / socket-pinning regression tests.
//
// The TOCTOU window these close: the guard resolves DNS, then the HTTP client
// re-resolves independently — an attacker's resolver can answer PUBLIC to the
// guard and PRIVATE (e.g. 169.254.169.254) to the client. safeFetch resolves
// exactly once and pins the socket to that vetted IP via a custom `lookup`, so
// the client never issues a second, race-able DNS query.
//
// We drive resolution through a mocked node:dns/promises and capture the
// node:http request options to prove the connection is pinned.
// ---------------------------------------------------------------------------

// Sequenced resolver: successive lookups return successive answers, simulating
// a rebinding authoritative server that flips its reply between queries.
let dnsAnswers: Array<Array<{ address: string; family: number }>> = []
mock.module('node:dns/promises', () => ({
	lookup: async () => {
		if (dnsAnswers.length === 0) throw new Error('ENOTFOUND')
		return dnsAnswers.shift()!
	},
}))

// Capture the options passed to http.request so we can inspect the pinned lookup.
let capturedRequestOptions: any = null
mock.module('node:http', () => {
	const request = (options: any, cb: (res: any) => void) => {
		capturedRequestOptions = options
		const res: any = {
			statusCode: 204,
			on: (event: string, handler: (...a: any[]) => void) => {
				if (event === 'end') queueMicrotask(() => handler())
				return res
			},
		}
		const req: any = {
			setTimeout: () => req,
			on: () => req,
			write: () => req,
			end: () => {
				queueMicrotask(() => cb(res))
				return req
			},
			destroy: () => req,
		}
		return req
	}
	return { default: { request }, request }
})

describe('safeFetch — DNS-rebinding socket pinning', () => {
	it('pins the connection to the vetted IP and cannot re-resolve to a rebound private IP', async () => {
		capturedRequestOptions = null
		// Resolver answers PUBLIC first (what the guard vets)…
		dnsAnswers = [[{ address: '93.184.216.34', family: 4 }]]

		const result = await safeFetch('http://rebind.attacker.example/webhook', {
			method: 'POST',
			body: '{}',
			timeoutMs: 1000,
		})
		expect(result.status).toBe(204)

		// The request must carry a custom lookup (the pin) and the original Host.
		expect(capturedRequestOptions).not.toBeNull()
		expect(capturedRequestOptions.hostname).toBe('rebind.attacker.example')
		expect(typeof capturedRequestOptions.lookup).toBe('function')

		// …now the attacker's resolver flips to a PRIVATE metadata IP. If the HTTP
		// client re-resolved, it would connect there. Instead the pinned lookup
		// ignores DNS entirely and hands back ONLY the vetted public IP.
		dnsAnswers = [[{ address: '169.254.169.254', family: 4 }]]
		const pinned = await new Promise<any>((resolve, reject) => {
			capturedRequestOptions.lookup('rebind.attacker.example', { all: true }, (err: any, addrs: any) =>
				err ? reject(err) : resolve(addrs),
			)
		})
		expect(pinned).toEqual([{ address: '93.184.216.34', family: 4 }])
		// The rebound private answer was never consumed → no second DNS query occurred.
		expect(dnsAnswers.length).toBe(1)
	})

	it('refuses to connect when the single vetted resolution is private (fail-closed)', async () => {
		capturedRequestOptions = null
		dnsAnswers = [[{ address: '169.254.169.254', family: 4 }]]
		await expect(safeFetch('http://metadata.attacker.example/')).rejects.toThrow(
			/private or metadata/,
		)
		// No connection attempt was made.
		expect(capturedRequestOptions).toBeNull()
	})
})
