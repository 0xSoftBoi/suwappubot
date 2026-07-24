import { isIP } from 'node:net'
import { lookup } from 'node:dns/promises'
import type { LookupFunction } from 'node:net'
import http from 'node:http'
import https from 'node:https'

// ---------------------------------------------------------------------------
// SSRF transport guard
//
// Extracted from validators.ts so the Zod schema file stays a pure schema file.
// validators.ts imports { isPublicUrl } from here for its callback_url refine;
// agent.ts imports { assertUrlSafeForFetch, safeFetch } for the webhook test.
// ---------------------------------------------------------------------------

/** Hostnames that resolve to cloud-metadata / internal endpoints. */
const BLOCKED_HOSTNAMES = new Set([
	'localhost',
	'metadata.google.internal',
	'instance-data.ec2.internal',
])

/**
 * Case-insensitive set of request headers that authenticate/sign the payload to
 * the ORIGINAL host. They must never be replayed to a different host reached via
 * a redirect (a redirect target could otherwise harvest a valid HMAC signature).
 */
const SENSITIVE_HEADERS = new Set([
	'x-suwappu-signature',
	'x-suwappu-timestamp',
	'authorization',
	'cookie',
	'x-suwappu-auth',
])

/** Drop signature/auth headers (used when a redirect crosses to a new host). */
function dropSensitiveHeaders(
	headers: Record<string, string>,
): Record<string, string> {
	const out: Record<string, string> = {}
	for (const [k, v] of Object.entries(headers)) {
		if (!SENSITIVE_HEADERS.has(k.toLowerCase())) out[k] = v
	}
	return out
}

/**
 * Classify a raw IPv4 dotted-quad string as private / loopback / link-local /
 * unspecified / CGNAT / multicast / reserved. Malformed input is treated as
 * unsafe (returns true) so callers fail closed.
 */
function isPrivateIpv4(ip: string): boolean {
	const parts = ip.split('.')
	if (parts.length !== 4) return true
	const octets = parts.map((p) => Number(p))
	if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true
	const [a, b] = octets
	if (a === 0) return true // 0.0.0.0/8 "this host" / unspecified
	if (a === 127) return true // 127.0.0.0/8 loopback
	if (a === 10) return true // 10.0.0.0/8
	if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
	if (a === 192 && b === 168) return true // 192.168.0.0/16
	if (a === 169 && b === 254) return true // 169.254.0.0/16 link-local (incl. IMDS)
	if (a === 100 && b >= 64 && b <= 127) return true // 100.64.0.0/10 CGNAT
	if (a >= 224) return true // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
	return false
}

/**
 * Expand any IPv6 literal spelling to its full 8-hextet numeric form.
 * Handles `::` compression and an embedded trailing IPv4 group (both the
 * IPv4-mapped `::ffff:1.2.3.4` and IPv4-compatible `::1.2.3.4` shapes).
 * Returns null on malformed input so the caller can fail closed.
 */
function expandIpv6(input: string): number[] | null {
	let s = input.toLowerCase().split('%')[0] // strip zone id
	if (s.length === 0) return null

	// Convert a trailing embedded IPv4 (last group) into two hextets.
	const embedded = s.match(/^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
	if (embedded) {
		const o = embedded[2].split('.').map(Number)
		if (o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null
		const h1 = ((o[0] << 8) | o[1]).toString(16)
		const h2 = ((o[2] << 8) | o[3]).toString(16)
		s = `${embedded[1]}${h1}:${h2}`
	}

	const halves = s.split('::')
	if (halves.length > 2) return null // more than one "::" is invalid

	const parseGroups = (str: string): number[] =>
		str === ''
			? []
			: str.split(':').map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : Number.NaN))

	const head = parseGroups(halves[0])
	const tail = halves.length === 2 ? parseGroups(halves[1]) : []
	if (head.some(Number.isNaN) || tail.some(Number.isNaN)) return null

	let hextets: number[]
	if (halves.length === 2) {
		const fill = 8 - head.length - tail.length
		if (fill < 0) return null
		hextets = [...head, ...Array(fill).fill(0), ...tail]
	} else {
		hextets = head
	}
	if (hextets.length !== 8) return null
	return hextets
}

/**
 * Classify a raw IPv6 string as loopback / unspecified / ULA (fc00::/7) /
 * link-local (fe80::/10) / multicast, plus ALL spellings of IPv4-mapped
 * (::ffff:0:0/96) and the deprecated IPv4-compatible (::/96) forms — expanded
 * or compressed, dotted or hex. Fails closed on malformed input.
 */
function isPrivateIpv6(ip: string): boolean {
	const h = expandIpv6(ip)
	if (h === null) return true // fail closed on anything we can't parse

	// Unspecified :: and loopback ::1
	if (h.every((x) => x === 0)) return true
	if (h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0 && h[6] === 0 && h[7] === 1) {
		return true
	}

	// IPv4-mapped / IPv4-compatible: hextets 0-4 all zero AND hextet 5 in
	// {0x0000, 0xffff}. Extract the trailing 32 bits and classify as IPv4.
	if (
		h[0] === 0 &&
		h[1] === 0 &&
		h[2] === 0 &&
		h[3] === 0 &&
		h[4] === 0 &&
		(h[5] === 0x0000 || h[5] === 0xffff)
	) {
		const v4 = `${(h[6] >> 8) & 0xff}.${h[6] & 0xff}.${(h[7] >> 8) & 0xff}.${h[7] & 0xff}`
		return isPrivateIpv4(v4)
	}

	// Prefix checks on the first hextet.
	const first = h[0]
	const highByte = first >> 8
	if (highByte === 0xfc || highByte === 0xfd) return true // ULA fc00::/7
	if (first >= 0xfe80 && first <= 0xfebf) return true // link-local fe80::/10
	if (highByte === 0xff) return true // multicast ff00::/8
	return false
}

/**
 * True if the given IP literal (v4 or v6) points at a private, loopback,
 * link-local, or otherwise internal address. Non-IP input returns false
 * (it is not an IP literal — DNS names are handled separately).
 */
export function isPrivateIp(ip: string): boolean {
	const v = isIP(ip)
	if (v === 4) return isPrivateIpv4(ip)
	if (v === 6) return isPrivateIpv6(ip)
	return false
}

/**
 * Synchronous SSRF guard for a user-supplied URL. Rejects:
 *  - non-http(s) schemes
 *  - literal private / loopback / link-local / metadata IPs (v4 & v6)
 *  - numeric host encodings (decimal 2130706433, octal, hex 0x7f000001)
 *  - explicitly blocked hostnames (localhost, cloud-metadata names)
 * DNS names that pass are allowed here and re-checked against their resolved
 * addresses before any fetch (see assertUrlSafeForFetch) to defeat rebinding.
 */
export function isPublicUrl(url: string): boolean {
	let parsed: URL
	try {
		parsed = new URL(url)
	} catch {
		return false
	}
	// (1) Only http(s) — blocks file:, gopher:, ftp:, data:, etc.
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false

	let host = parsed.hostname.toLowerCase()
	// Strip IPv6 literal brackets: [::1] -> ::1
	if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1)

	// (2) Explicit hostname blocklist
	if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.localhost')) return false

	// (3) IP literal → classify directly
	const ipVer = isIP(host)
	if (ipVer !== 0) return !isPrivateIp(host)

	// (4) Reject numeric host encodings that bypass dotted-quad checks:
	//     decimal (2130706433), hex (0x7f000001), octal (0177.0.0.1), and
	//     any host built only from digits/hex-octets/dots.
	if (/^0x[0-9a-f]+$/.test(host)) return false // whole-host hex
	if (/^\d+$/.test(host)) return false // whole-host decimal
	if (/^0[0-7]+$/.test(host)) return false // whole-host octal
	if (/(^|\.)0x[0-9a-f]+(\.|$)/.test(host)) return false // hex octet component
	if (/(^|\.)0[0-7]+(\.|$)/.test(host)) return false // octal octet component
	if (/^[0-9.]+$/.test(host)) return false // all-numeric dotted but not a valid IPv4

	// Otherwise a DNS name — safe to store; resolved+re-checked before fetch.
	return true
}

/** A resolved, vetted target address to which the connection will be pinned. */
export interface PinnedAddress {
	address: string
	family: 4 | 6
}

/**
 * Async SSRF guard used immediately before fetching a stored callback URL.
 * Re-runs the synchronous checks, then resolves the hostname (A + AAAA) and
 * rejects if ANY resolved address is private/internal. Resolving right before
 * the fetch closes the DNS-rebinding window left by store-time validation.
 *
 * Returns the exact set of vetted addresses so the caller can PIN the socket to
 * them (see safeFetch) — closing the TOCTOU window where a re-resolution by the
 * HTTP client could land on a freshly-rebound private IP. Throws an Error
 * (message suitable for the caller's error shape) when unsafe.
 */
export async function assertUrlSafeForFetch(url: string): Promise<PinnedAddress[]> {
	if (!isPublicUrl(url)) {
		throw new Error('callback_url must not point to a private or metadata endpoint')
	}
	const host = new URL(url).hostname.replace(/^\[|\]$/g, '')
	// IP literals were already fully validated by isPublicUrl.
	const literalVer = isIP(host)
	if (literalVer !== 0) return [{ address: host, family: literalVer as 4 | 6 }]

	let addresses: { address: string; family: number }[]
	try {
		addresses = await lookup(host, { all: true })
	} catch {
		throw new Error('callback_url host could not be resolved')
	}
	if (addresses.length === 0 || addresses.some((a) => isPrivateIp(a.address))) {
		throw new Error('callback_url resolves to a private or metadata endpoint')
	}
	return addresses.map((a) => ({ address: a.address, family: a.family as 4 | 6 }))
}

/** Minimal response shape returned by safeFetch (only what callers need). */
export interface SafeFetchResult {
	status: number
}

export interface SafeFetchInit {
	method?: string
	headers?: Record<string, string>
	body?: string
	timeoutMs?: number
	/** Max redirect hops to follow before failing closed. Default 5. */
	maxRedirects?: number
}

/** Result of a single hop: the status plus (if a redirect) the raw Location. */
interface HopResult {
	status: number
	location: string | undefined
}

/**
 * Issue exactly ONE request to `url`, PINNED to the given pre-vetted addresses.
 * Returns the status and the Location header (if present) without following it.
 * The redirect-following policy lives in {@link safeFetch}; this helper never
 * re-resolves or chases anything.
 */
function fetchOneHop(
	url: string,
	pinned: PinnedAddress[],
	method: string,
	headers: Record<string, string> | undefined,
	body: string | undefined,
	timeoutMs: number,
): Promise<HopResult> {
	const parsed = new URL(url)
	const isHttps = parsed.protocol === 'https:'
	const transport = isHttps ? https : http

	// Pinned lookup: ignore the hostname entirely and hand back only the
	// pre-validated address(es). No network DNS query happens here, so a
	// rebinding resolver can never influence which IP the socket connects to.
	const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
		const opts = typeof options === 'object' && options !== null ? options : {}
		if (opts.all) {
			callback(
				null,
				// biome-ignore lint/suspicious/noExplicitAny: node's overloaded lookup callback
				pinned.map((p) => ({ address: p.address, family: p.family })) as any,
			)
		} else {
			// Honor a requested address family when one was asked for; otherwise
			// fall back to the first vetted address.
			const wanted = opts.family === 4 || opts.family === 6 ? opts.family : undefined
			const chosen = (wanted ? pinned.find((p) => p.family === wanted) : undefined) ?? pinned[0]
			callback(null, chosen.address, chosen.family)
		}
	}

	return new Promise<HopResult>((resolve, reject) => {
		const req = transport.request(
			{
				protocol: parsed.protocol,
				hostname: parsed.hostname.replace(/^\[|\]$/g, ''),
				port: parsed.port || (isHttps ? 443 : 80),
				path: `${parsed.pathname}${parsed.search}`,
				method,
				headers,
				lookup: pinnedLookup,
				// SNI + cert hostname stay the original host (node derives servername
				// from `hostname`), so TLS validation is unaffected by the IP pin.
			},
			(res) => {
				const status = res.statusCode ?? 0
				const loc = res.headers.location
				const location = Array.isArray(loc) ? loc[0] : loc
				// Drain and discard the body; we only surface the status code.
				res.on('data', () => {})
				res.on('end', () => resolve({ status, location }))
				res.on('error', reject)
			},
		)
		req.setTimeout(timeoutMs, () => {
			req.destroy(new Error('The operation timed out.'))
		})
		req.on('error', reject)
		if (body !== undefined) req.write(body)
		req.end()
	})
}

/**
 * SSRF-safe HTTP(S) request that defeats DNS rebinding by PINNING the socket to
 * the exact address(es) that {@link assertUrlSafeForFetch} validated — and that
 * follows redirects SAFELY by re-vetting AND re-pinning EVERY hop.
 *
 * Mechanism (per hop): the request is issued via node:http/node:https to the
 * ORIGINAL hostname (so the Host header and TLS SNI/cert validation are
 * preserved), but a custom `lookup` short-circuits DNS to return only the
 * pre-vetted addresses. The HTTP client therefore cannot perform a fresh,
 * un-vetted resolution that a rebinding attacker could race.
 *
 * Redirect handling: on a 3xx with a Location, the next URL is resolved
 * (relative Locations are resolved against the current URL) and run through the
 * SAME {@link assertUrlSafeForFetch} guard — scheme must be http(s), and the
 * freshly-resolved IP must be public — before we connect, pinned, to that hop.
 * A redirect to a private/loopback/link-local/metadata target is NEVER followed
 * and surfaces as a rejection (fail closed), not a success. The chain is bounded
 * by `maxRedirects` (default 5); exceeding it throws.
 *
 * Header safety on redirect: if a redirect crosses to a DIFFERENT host, the
 * signing/auth headers (X-Suwappu-Signature, X-Suwappu-Timestamp, Authorization,
 * Cookie, …) are stripped so the HMAC-signed webhook payload is never replayed
 * with a valid signature to an unintended host.
 *
 * Timeout: `timeoutMs` (default 10s) is a TOTAL deadline across the whole
 * operation — redirects cannot multiply it. Once the deadline is exhausted the
 * call throws a clean timeout error BEFORE issuing another hop (rather than
 * flooring to a 1ms socket that instantly fails).
 *
 * Method on redirect (standard semantics): 303 → GET (drop body); 301/302 with
 * a non-GET/HEAD method → GET (drop body), matching prevailing browser/agent
 * behavior and avoiding replay of the signed webhook body to a redirected host;
 * 307/308 → method and body preserved.
 *
 * Throws (rejects) on unsafe URL, resolution failure, timeout, redirect-limit
 * overflow, or transport error — matching the previous fetch() error semantics.
 */
export async function safeFetch(url: string, init: SafeFetchInit = {}): Promise<SafeFetchResult> {
	const timeoutMs = init.timeoutMs ?? 10_000
	const maxRedirects = init.maxRedirects ?? 5
	const deadline = Date.now() + timeoutMs

	let currentUrl = url
	let method = init.method ?? 'GET'
	let headers = init.headers
	let body = init.body

	for (let hop = 0; ; hop++) {
		const pinned = await assertUrlSafeForFetch(currentUrl)
		// Fail closed: never connect if the vetted set somehow contains a private IP.
		if (pinned.length === 0 || pinned.some((p) => isPrivateIp(p.address))) {
			throw new Error('callback_url resolves to a private or metadata endpoint')
		}

		// TOTAL deadline: redirects share one budget. Once it is spent, throw a
		// clean timeout rather than issuing a doomed ~0ms socket.
		const remaining = deadline - Date.now()
		if (remaining <= 0) {
			throw new Error('callback_url request timed out')
		}

		const { status, location } = await fetchOneHop(
			currentUrl,
			pinned,
			method,
			headers,
			body,
			remaining,
		)

		// Not a redirect (or no Location to follow) → done.
		const isRedirect = status === 301 || status === 302 || status === 303 || status === 307 || status === 308
		if (!isRedirect || location === undefined) {
			return { status }
		}

		if (hop >= maxRedirects) {
			throw new Error(`callback_url exceeded the maximum of ${maxRedirects} redirects`)
		}

		// Resolve the next URL (handles relative Location) against the current URL.
		let nextUrl: URL
		try {
			nextUrl = new URL(location, currentUrl)
		} catch {
			throw new Error('callback_url redirected to an invalid Location')
		}
		if (nextUrl.protocol !== 'http:' && nextUrl.protocol !== 'https:') {
			throw new Error('callback_url redirected to a non-http(s) scheme')
		}

		// Cross-host redirect → strip signature/auth headers so the signed body is
		// never replayed with valid credentials to a different host.
		if (headers && nextUrl.host !== new URL(currentUrl).host) {
			headers = dropSensitiveHeaders(headers)
		}

		// Adjust method/body per standard redirect semantics.
		if (status === 303 || ((status === 301 || status === 302) && method !== 'GET' && method !== 'HEAD')) {
			method = 'GET'
			body = undefined
			if (headers) {
				const { 'Content-Type': _ct, 'Content-Length': _cl, ...rest } = headers
				headers = rest
			}
		}
		// 307/308 keep method + body as-is.

		currentUrl = nextUrl.toString()
		// Loop: the next hop is re-vetted AND re-pinned by assertUrlSafeForFetch.
	}
}
