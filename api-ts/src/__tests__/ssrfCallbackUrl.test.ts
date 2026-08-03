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

import { afterAll, describe, expect, it, mock } from 'bun:test'

import { assertUrlSafeForFetch, isPrivateIp, safeFetch } from '../routes/ssrfGuard'
import { RegisterAgentSchema } from '../routes/validators'

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

	// MEDIUM fix: the old isPrivateIpv6 only recognized the ::ffff:-COMPRESSED
	// spelling. Expanded / alternate spellings of the same IPv4-mapped or
	// IPv4-compatible address slipped through as "public" and the socket then
	// pinned straight to the internal target. These MUST all be private now.
	it('flags EXPANDED / alternate IPv4-mapped & compatible IPv6 spellings (bypass fix)', () => {
		// Fully-expanded IPv4-mapped, dotted tail → metadata IP.
		expect(isPrivateIp('0:0:0:0:0:ffff:169.254.169.254')).toBe(true)
		// Fully-expanded IPv4-mapped, hex tail (a9fe:a9fe === 169.254.169.254).
		expect(isPrivateIp('0:0:0:0:0:ffff:a9fe:a9fe')).toBe(true)
		// Deprecated IPv4-compatible, compressed hex tail.
		expect(isPrivateIp('::a9fe:a9fe')).toBe(true)
		// Deprecated IPv4-compatible, fully expanded dotted tail.
		expect(isPrivateIp('0:0:0:0:0:0:169.254.169.254')).toBe(true)
		// Expanded loopback mapped forms too.
		expect(isPrivateIp('0:0:0:0:0:ffff:127.0.0.1')).toBe(true)
		// A genuinely public mapped address stays public.
		expect(isPrivateIp('0:0:0:0:0:ffff:8.8.8.8')).toBe(false)
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
// These two mocks replace CORE NODE MODULES process-wide, and mock.module() is not
// undone when this file ends — leaving a fake DNS resolver and a fake http.request
// installed for every test file that runs afterwards. Capture the real modules first
// and restore them in afterAll.
const REAL_DNS = { ...(await import('node:dns/promises')) }
const REAL_HTTP = { ...(await import('node:http')) }

afterAll(() => {
	mock.module('node:dns/promises', () => REAL_DNS)
	mock.module('node:http', () => REAL_HTTP)
})

let dnsAnswers: Array<Array<{ address: string; family: number }>> = []
mock.module('node:dns/promises', () => ({
	lookup: async () => {
		if (dnsAnswers.length === 0) throw new Error('ENOTFOUND')
		return dnsAnswers.shift()!
	},
}))

// Capture the options passed to http.request so we can inspect the pinned lookup.
let capturedRequestOptions: any = null
// Every http.request is recorded here (host it targeted) so tests can assert
// which hops were actually attempted — and prove a private target was NOT hit.
let connectAttempts: Array<{ hostname: string; port: number }> = []
// Programmable responder: successive requests get successive responses. When the
// queue is exhausted, default to a terminal 204. Each entry: { statusCode, location? }.
let httpResponses: Array<{ statusCode: number; location?: string }> = []
mock.module('node:http', () => {
	const request = (options: any, cb: (res: any) => void) => {
		capturedRequestOptions = options
		connectAttempts.push({ hostname: options.hostname, port: options.port })
		const spec = httpResponses.shift() ?? { statusCode: 204 }
		const res: any = {
			statusCode: spec.statusCode,
			headers: spec.location ? { location: spec.location } : {},
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

// ---------------------------------------------------------------------------
// Redirect-following SSRF regression tests.
//
// BEFORE this change: safeFetch did NOT follow redirects at all — a 3xx was
// returned as-is ({ status: 302 }). That left a redirect-based SSRF gap: any
// redirect-following client pointed at a public URL that 302s to
// http://169.254.169.254/ would hit the internal target. These tests assert the
// NEW follow-with-revet+repin behavior: every hop is re-validated and re-pinned,
// a private redirect target is blocked (fail closed), and the chain is bounded.
//
// "before" state, stated honestly: with the old code the first test below would
// see status 302 returned (never following), so the assertion that a private
// hop is *blocked by a thrown rejection* would FAIL (no throw, just a 302). The
// new code follows the redirect, re-vets the private target, and throws.
// ---------------------------------------------------------------------------

describe('safeFetch — safe redirect following (re-vet + re-pin every hop)', () => {
	it('does NOT follow a redirect to a private IP and fails closed', async () => {
		capturedRequestOptions = null
		connectAttempts = []
		// Hop 1: public host resolves public, server replies 302 → metadata IP.
		dnsAnswers = [[{ address: '93.184.216.34', family: 4 }]]
		httpResponses = [{ statusCode: 302, location: 'http://169.254.169.254/latest/meta-data/' }]

		await expect(
			safeFetch('http://public.example/webhook', { timeoutMs: 1000 }),
		).rejects.toThrow(/private or metadata/)

		// Only the first (public) hop was ever attempted; the private target was
		// re-vetted BEFORE any socket to it — it must never be connected to.
		expect(connectAttempts).toEqual([{ hostname: 'public.example', port: 80 }])
		expect(connectAttempts.some((a) => a.hostname === '169.254.169.254')).toBe(false)
	})

	it('follows a benign redirect to another PUBLIC host, re-pinned to that host', async () => {
		capturedRequestOptions = null
		connectAttempts = []
		// Hop 1: first.example (public) → 302 to https://second.example/next
		// Hop 2: second.example (public) → 204 terminal.
		dnsAnswers = [
			[{ address: '93.184.216.34', family: 4 }],
			[{ address: '198.51.100.7', family: 4 }],
		]
		httpResponses = [
			{ statusCode: 302, location: 'http://second.example/next' },
			{ statusCode: 204 },
		]

		const result = await safeFetch('http://first.example/webhook', {
			method: 'POST',
			body: '{}',
			timeoutMs: 2000,
		})
		expect(result.status).toBe(204)

		// Both hops attempted, in order; the 2nd hop targeted the redirected host.
		expect(connectAttempts.map((a) => a.hostname)).toEqual(['first.example', 'second.example'])
		// After a 302 on a POST, method downgrades to GET (body dropped).
		expect(capturedRequestOptions.method).toBe('GET')
		expect(capturedRequestOptions.hostname).toBe('second.example')
		// And the final hop is PINNED to second.example's vetted IP (not first's).
		const pinnedFinal = await new Promise<any>((resolve, reject) => {
			capturedRequestOptions.lookup('second.example', { all: true }, (err: any, addrs: any) =>
				err ? reject(err) : resolve(addrs),
			)
		})
		expect(pinnedFinal).toEqual([{ address: '198.51.100.7', family: 4 }])
	})

	it('fails closed when the redirect chain exceeds the max', async () => {
		capturedRequestOptions = null
		connectAttempts = []
		// A public host that endlessly redirects to itself. Provide plenty of
		// public DNS answers and 302 responses so the cap — not DNS — trips.
		dnsAnswers = Array.from({ length: 10 }, () => [{ address: '93.184.216.34', family: 4 }])
		httpResponses = Array.from({ length: 10 }, () => ({
			statusCode: 302 as const,
			location: 'http://loop.example/again',
		}))

		await expect(
			safeFetch('http://loop.example/start', { timeoutMs: 2000, maxRedirects: 5 }),
		).rejects.toThrow(/maximum of 5 redirects/)

		// Exactly 6 hops attempted: the initial request + 5 followed redirects,
		// then the 6th redirect trips the cap and throws (fail closed).
		expect(connectAttempts.length).toBe(6)
	})

	it('never follows a redirect to a non-http(s) scheme', async () => {
		capturedRequestOptions = null
		connectAttempts = []
		dnsAnswers = [[{ address: '93.184.216.34', family: 4 }]]
		httpResponses = [{ statusCode: 302, location: 'file:///etc/passwd' }]

		await expect(
			safeFetch('http://public.example/webhook', { timeoutMs: 1000 }),
		).rejects.toThrow(/non-http/)
		expect(connectAttempts).toEqual([{ hostname: 'public.example', port: 80 }])
	})

	// LOW fix (cross-host header leak): a redirect to a DIFFERENT host must not
	// carry the HMAC signature / auth headers — otherwise the signed webhook body
	// is replayed with a valid signature to an unintended host.
	it('DROPS signature/auth headers when a redirect crosses to a new host', async () => {
		capturedRequestOptions = null
		connectAttempts = []
		dnsAnswers = [
			[{ address: '93.184.216.34', family: 4 }],
			[{ address: '198.51.100.7', family: 4 }],
		]
		// Use 307 so method/body are preserved — proving the header drop is driven
		// by the host change, not by the method-downgrade path.
		httpResponses = [
			{ statusCode: 307, location: 'http://evil.example/collect' },
			{ statusCode: 204 },
		]

		const result = await safeFetch('http://first.example/webhook', {
			method: 'POST',
			body: '{}',
			headers: {
				'Content-Type': 'application/json',
				'X-Suwappu-Signature': 'deadbeef',
				'X-Suwappu-Timestamp': '1700000000',
				Authorization: 'Bearer secret',
				'X-Suwappu-Event': 'webhook.test',
			},
			timeoutMs: 2000,
		})
		expect(result.status).toBe(204)

		// Final hop targeted the new host…
		expect(capturedRequestOptions.hostname).toBe('evil.example')
		// …with the signing/auth headers stripped…
		const sent = capturedRequestOptions.headers as Record<string, string>
		expect(sent['X-Suwappu-Signature']).toBeUndefined()
		expect(sent['X-Suwappu-Timestamp']).toBeUndefined()
		expect(sent.Authorization).toBeUndefined()
		// …but non-sensitive headers preserved (307 keeps method + body).
		expect(sent['X-Suwappu-Event']).toBe('webhook.test')
		expect(capturedRequestOptions.method).toBe('POST')
	})

	// LOW fix (timeout): when the total deadline is exhausted, throw a clean
	// timeout error BEFORE issuing another hop (never floor to a ~1ms socket).
	it('throws a clean timeout when the total deadline is exhausted', async () => {
		capturedRequestOptions = null
		connectAttempts = []
		dnsAnswers = [[{ address: '93.184.216.34', family: 4 }]]
		httpResponses = []

		// timeoutMs 0 → the deadline is already spent when the loop begins, so the
		// guard must throw a timeout instead of issuing a doomed request.
		await expect(
			safeFetch('http://public.example/webhook', { timeoutMs: 0 }),
		).rejects.toThrow(/timed out/)
		// No socket was ever attempted.
		expect(connectAttempts).toEqual([])
	})
})
