import { isIP } from 'node:net'
import { lookup } from 'node:dns/promises'
import type { LookupFunction } from 'node:net'
import http from 'node:http'
import https from 'node:https'
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Shared field schemas
// ---------------------------------------------------------------------------

/** Maximum swap amount in token units (prevents accidental whole-portfolio swaps). */
const MAX_SWAP_AMOUNT = 1_000_000

/** Hostnames that resolve to cloud-metadata / internal endpoints. */
const BLOCKED_HOSTNAMES = new Set([
	'localhost',
	'metadata.google.internal',
	'instance-data.ec2.internal',
])

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
 * Classify a raw IPv6 string as loopback / unspecified / ULA (fc00::/7) /
 * link-local (fe80::/10) / multicast, including IPv4-mapped forms
 * (::ffff:127.0.0.1 and ::ffff:7f00:0001). Fails closed on malformed input.
 */
function isPrivateIpv6(ip: string): boolean {
	const addr = ip.toLowerCase().split('%')[0] // strip zone id
	if (addr === '::1' || addr === '::') return true // loopback / unspecified
	// IPv4-mapped, dotted form: ::ffff:127.0.0.1
	const mappedDotted = addr.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
	if (mappedDotted) return isPrivateIpv4(mappedDotted[1])
	// IPv4-mapped, hex form: ::ffff:7f00:0001
	const mappedHex = addr.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
	if (mappedHex) {
		const hi = parseInt(mappedHex[1], 16)
		const lo = parseInt(mappedHex[2], 16)
		const v4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`
		return isPrivateIpv4(v4)
	}
	// Prefix checks on the first hextet.
	const firstHextet = addr.split(':')[0]
	if (firstHextet !== '') {
		const first = parseInt(firstHextet, 16)
		if (!Number.isNaN(first)) {
			const highByte = first >> 8
			if (highByte === 0xfc || highByte === 0xfd) return true // ULA fc00::/7
			if (first >= 0xfe80 && first <= 0xfebf) return true // link-local fe80::/10
			if (highByte === 0xff) return true // multicast ff00::/8
		}
	}
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
function isPublicUrl(url: string): boolean {
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
}

/**
 * SSRF-safe HTTP(S) request that defeats DNS rebinding by PINNING the socket to
 * the exact address(es) that {@link assertUrlSafeForFetch} validated.
 *
 * Mechanism: the request is issued via node:http/node:https to the ORIGINAL
 * hostname (so the Host header and TLS SNI/cert validation are preserved), but a
 * custom `lookup` short-circuits DNS resolution to return only the pre-vetted
 * addresses. The HTTP client therefore cannot perform a fresh, un-vetted
 * resolution that a rebinding attacker could race — there is no second DNS
 * query. As defense-in-depth, the pinned addresses are re-checked for privacy
 * inside the lookup and the connection is refused if any is internal.
 *
 * Throws (rejects) on unsafe URL, resolution failure, timeout, or transport
 * error — matching the previous fetch() error semantics.
 */
export async function safeFetch(url: string, init: SafeFetchInit = {}): Promise<SafeFetchResult> {
	const pinned = await assertUrlSafeForFetch(url)
	// Fail closed: never connect if the vetted set somehow contains a private IP.
	if (pinned.length === 0 || pinned.some((p) => isPrivateIp(p.address))) {
		throw new Error('callback_url resolves to a private or metadata endpoint')
	}

	const parsed = new URL(url)
	const isHttps = parsed.protocol === 'https:'
	const transport = isHttps ? https : http
	const timeoutMs = init.timeoutMs ?? 10_000

	// Pinned lookup: ignore the hostname entirely and hand back only the
	// pre-validated address(es). No network DNS query happens here, so a
	// rebinding resolver can never influence which IP the socket connects to.
	const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
		const all = typeof options === 'object' && options?.all
		if (all) {
			callback(
				null,
				// biome-ignore lint/suspicious/noExplicitAny: node's overloaded lookup callback
				pinned.map((p) => ({ address: p.address, family: p.family })) as any,
			)
		} else {
			callback(null, pinned[0].address, pinned[0].family)
		}
	}

	return await new Promise<SafeFetchResult>((resolve, reject) => {
		const req = transport.request(
			{
				protocol: parsed.protocol,
				hostname: parsed.hostname.replace(/^\[|\]$/g, ''),
				port: parsed.port || (isHttps ? 443 : 80),
				path: `${parsed.pathname}${parsed.search}`,
				method: init.method ?? 'GET',
				headers: init.headers,
				lookup: pinnedLookup,
				// SNI + cert hostname stay the original host (node derives servername
				// from `hostname`), so TLS validation is unaffected by the IP pin.
			},
			(res) => {
				const status = res.statusCode ?? 0
				// Drain and discard the body; we only surface the status code.
				res.on('data', () => {})
				res.on('end', () => resolve({ status }))
				res.on('error', reject)
			},
		)
		req.setTimeout(timeoutMs, () => {
			req.destroy(new Error('The operation timed out.'))
		})
		req.on('error', reject)
		if (init.body !== undefined) req.write(init.body)
		req.end()
	})
}

const callbackUrlSchema = z
	.string()
	.url('Invalid callback URL')
	.refine(isPublicUrl, 'callback_url must not point to a private or metadata endpoint')

/** EVM address: 0x + 40 hex chars, rejecting the zero address. */
const evmAddressSchema = z
	.string()
	.regex(/^0x[0-9a-fA-F]{40}$/, 'Invalid EVM address format')
	.refine(
		(addr) => addr.toLowerCase() !== '0x0000000000000000000000000000000000000000',
		'Zero address is not allowed',
	)

/** Positive token amount with an upper cap to prevent accidental whole-portfolio swaps. */
const tokenAmountSchema = z
	.string()
	.min(1, 'amount is required')
	.refine((v) => {
		const n = parseFloat(v)
		return !isNaN(n) && n > 0
	}, 'amount must be a positive number')
	.refine(
		(v) => parseFloat(v) <= MAX_SWAP_AMOUNT,
		`amount must not exceed ${MAX_SWAP_AMOUNT.toLocaleString()} units`,
	)

// ---------------------------------------------------------------------------
// Exported schemas
// ---------------------------------------------------------------------------

export const RegisterAgentSchema = z.object({
	name: z
		.string()
		.min(3, 'Name must be at least 3 characters')
		.max(50, 'Name must be at most 50 characters')
		.regex(/^[a-zA-Z0-9_-]+$/, 'Name must be alphanumeric with underscores and hyphens only'),
	description: z.string().max(500).optional(),
	callback_url: callbackUrlSchema.optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
})

export const QuoteRequestSchema = z.object({
	from_token: z.string().min(1, 'from_token is required'),
	to_token: z.string().min(1, 'to_token is required'),
	amount: tokenAmountSchema,
	chain: z.string().optional(),
	from_chain: z.string().optional(),
	to_chain: z.string().optional(),
	wallet_address: evmAddressSchema.optional(),
	slippage: z.number().min(0).max(0.5).optional(),
})

export const SwapRequestSchema = z.object({
	quote_id: z.string().optional(),
	from_token: z.string().optional(),
	to_token: z.string().optional(),
	amount: z.string().optional(),
	chain: z.string().optional(),
	wallet_address: z.string().min(1, 'wallet_address is required'),
	slippage: z.number().min(0).max(1).optional(),
})

export const ExecuteCommandSchema = z.object({
	command: z.string().min(1, 'command is required').max(500),
	wallet_address: z.string().optional(),
})

export const UpdateAgentSchema = z
	.object({
		description: z.string().max(500).optional(),
		callback_url: callbackUrlSchema.nullish(),
		metadata: z.record(z.string(), z.unknown()).optional(),
	})
	.refine(
		(data) =>
			data.description !== undefined ||
			data.callback_url !== undefined ||
			data.metadata !== undefined,
		'At least one field must be provided',
	)

export const CreatePolicySchema = z.object({
	type: z.enum(['spending_limit', 'whitelist']),
	params: z.object({
		maxAmountWei: z
			.string()
			.regex(/^\d+$/, 'maxAmountWei must be a decimal integer string')
			.optional(),
		timeWindowSeconds: z.number().optional(),
		allowedAddresses: z
			.array(z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Must be a valid EVM address'))
			.optional(),
	}),
})

/** Format Zod errors into a flat field map */
export const ExecuteSwapSchema = z.object({
	quote_id: z.string().min(1, 'quote_id is required'),
})

export const SwapStatusQuerySchema = z.object({
	status: z.string().optional(),
	limit: z.coerce.number().min(1).max(100).default(20),
	offset: z.coerce.number().min(0).default(0),
})

export const WebhookEventsQuerySchema = z.object({
	status: z.string().optional(),
	event_type: z.string().optional(),
	limit: z.coerce.number().min(1).max(100).default(20),
	offset: z.coerce.number().min(0).default(0),
})

export const PlaceOrderSchema = z.object({
	tokenId: z.string().min(1, 'tokenId is required'),
	price: z
		.string()
		.min(1, 'price is required')
		.refine((v) => {
			const n = parseFloat(v)
			return !isNaN(n) && n > 0 && n <= 1
		}, 'price must be between 0 and 1'),
	size: z
		.string()
		.min(1, 'size is required')
		.refine((v) => {
			const n = parseFloat(v)
			return !isNaN(n) && n > 0
		}, 'size must be a positive number'),
	side: z.enum(['BUY', 'SELL']),
	expiration: z.number().optional(),
	feeRateBps: z.number().min(0).max(500).optional(),
})

export const CancelOrderSchema = z.object({
	orderId: z.string().min(1, 'orderId is required'),
})

/**
 * Top-up credits from a verified on-chain USDC payment.
 * `amount` accepts a string or number and is coerced to a number at runtime.
 */
export const TopupSchema = z.object({
	txHash: z.string().min(10).max(128),
	chain: z.string().min(1).max(32).default('base'),
	amount: z.union([z.string(), z.number()]).transform((v) => Number(v)),
})

/** Perp position quote request (Hyperliquid). */
export const PerpsQuoteSchema = z.object({
	market: z.string(),
	side: z.enum(['long', 'short']),
	size: z.number().positive(),
	leverage: z.number().min(1).max(20),
})

/** Numeric string (for DB numeric columns) — accepts string or number, stored as string. */
const numericString = z
	.union([z.string(), z.number()])
	.transform((v) => String(v))
	.refine((v) => v.trim() !== '' && !Number.isNaN(Number(v)) && Number(v) >= 0, {
		message: 'Must be a non-negative number',
	})

/** Create a native P2P offer (webapp). */
export const CreateP2POfferSchema = z
	.object({
		offerType: z.enum(['sell_crypto', 'buy_crypto']),
		fiatCurrency: z.string().length(3).toUpperCase(),
		cryptoAsset: z.string().min(1).max(20),
		cryptoChain: z.string().min(1).max(32).default('base'),
		pricePerUnit: numericString,
		minFiatAmount: numericString,
		maxFiatAmount: numericString,
		availableCrypto: z.string().max(78).optional(),
		paymentMethods: z.array(z.string().min(1).max(64)).min(1).max(20),
		region: z.string().max(8).optional(),
		terms: z.string().max(2000).optional(),
		paymentWindowMinutes: z.number().int().min(5).max(1440).default(30),
		makerWalletId: z.number().int().positive().optional(),
	})
	.refine((d) => Number(d.maxFiatAmount) >= Number(d.minFiatAmount), {
		message: 'maxFiatAmount must be >= minFiatAmount',
		path: ['maxFiatAmount'],
	})

export function formatZodErrors(error: z.ZodError): Record<string, string> {
	const fields: Record<string, string> = {}
	for (const issue of error.issues) {
		const path = issue.path.join('.') || '_root'
		fields[path] = issue.message
	}
	return fields
}
