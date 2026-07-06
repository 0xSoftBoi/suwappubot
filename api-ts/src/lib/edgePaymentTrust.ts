import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Cloudflare Monetization Gateway edge-receipt trust.
 *
 * Background: Cloudflare's Monetization Gateway (blog.cloudflare.com/monetization-gateway/)
 * can do the x402 HTTP-402 handshake AT THE EDGE and settle USDC before a request
 * ever reaches our origin. Our origin (see ../middleware/x402Payment.ts) already
 * metters every call independently, so once the Gateway is charging at the edge we
 * would double-charge unless the origin can tell "this request was already paid for
 * at the edge" apart from "this request hit Railway directly and still needs metering."
 *
 * The signal is a short-lived HMAC-signed receipt header, stamped by our own
 * `cloudflare/suwappu-router.worker.js` Worker (which sits between the Gateway and
 * Railway) only on paths the Gateway is configured to charge. The origin verifies
 * the signature with a secret shared out-of-band with the Worker (never sent over
 * the wire) before trusting the receipt.
 *
 * This module is intentionally pure (no Hono/Effect deps) so it's trivially
 * unit-testable and so the exact algorithm can be mirrored in the Worker, which
 * only has Web Crypto available (see signEdgeReceipt's doc comment).
 */

/** Header the edge Worker stamps and the origin reads. Never trust this header
 * unless it verifies — see verifyEdgeReceipt. The Worker MUST strip any
 * client-supplied copy of this header before proxying (spoof prevention). */
export const EDGE_PAYMENT_HEADER = 'x-suwappu-edge-payment'

/** Current receipt format version. Bump if the signed payload shape changes. */
const RECEIPT_VERSION = 'v1'

/** Default allowed clock skew (replay window) for a receipt's timestamp, in seconds. */
const DEFAULT_MAX_SKEW_SEC = 300

/**
 * Build the exact string that gets HMAC-signed. Kept as a named helper so the
 * Worker-side Web Crypto implementation and this Node implementation can be
 * verified to construct byte-identical input.
 *
 * method is uppercased; path is the pathname only (no query string) so a
 * receipt can't be replayed across differently-priced query params encoded in
 * the resource, and can't leak query string content into the signed payload.
 */
function signingPayload(timestampSec: number, method: string, path: string): string {
	return `${RECEIPT_VERSION}:${timestampSec}:${method.toUpperCase()}:${path}`
}

/**
 * Sign an edge receipt. This mirrors exactly what the Cloudflare Worker computes
 * with `crypto.subtle.importKey('raw', ..., { name: 'HMAC', hash: 'SHA-256' }, false,
 * ['sign'])` + `crypto.subtle.sign(...)`, hex-encoded. Used directly by the Worker's
 * Node/bun-based test harness (if any) and by our unit tests; the Worker itself
 * reimplements this in Web Crypto since `node:crypto` isn't available there.
 */
export function signEdgeReceipt(
	secret: string,
	method: string,
	path: string,
	timestampSec: number,
): string {
	const sig = createHmac('sha256', secret).update(signingPayload(timestampSec, method, path)).digest('hex')
	return `${RECEIPT_VERSION}.${timestampSec}.${sig}`
}

export type EdgeReceiptResult = { trusted: true } | { trusted: false; reason: string }

/**
 * Verify an edge-payment receipt header. Never throws — any malformed input
 * (including an absent secret, an absent header, or a garbage header) resolves
 * to `{ trusted: false }` so callers can always fail closed to "meter normally."
 */
export function verifyEdgeReceipt(params: {
	secret: string
	header: string | undefined | null
	method: string
	path: string
	nowSec?: number
	maxSkewSec?: number
}): EdgeReceiptResult {
	const { secret, header, method, path } = params
	const nowSec = params.nowSec ?? Math.floor(Date.now() / 1000)
	const maxSkewSec = params.maxSkewSec ?? DEFAULT_MAX_SKEW_SEC

	if (!secret) return { trusted: false, reason: 'no_secret' }
	if (!header) return { trusted: false, reason: 'missing_header' }

	const parts = header.split('.')
	if (parts.length !== 3) return { trusted: false, reason: 'malformed' }

	const [version, tsRaw, sigHex] = parts
	if (version !== RECEIPT_VERSION) return { trusted: false, reason: 'bad_version' }
	if (!/^\d+$/.test(tsRaw)) return { trusted: false, reason: 'malformed_timestamp' }
	if (!/^[0-9a-f]+$/i.test(sigHex) || sigHex.length === 0 || sigHex.length % 2 !== 0) {
		return { trusted: false, reason: 'malformed_signature' }
	}

	const timestampSec = Number(tsRaw)
	if (!Number.isSafeInteger(timestampSec)) return { trusted: false, reason: 'malformed_timestamp' }

	if (Math.abs(nowSec - timestampSec) > maxSkewSec) return { trusted: false, reason: 'expired' }

	const expectedHex = createHmac('sha256', secret)
		.update(signingPayload(timestampSec, method, path))
		.digest('hex')

	const expected = Buffer.from(expectedHex, 'hex')
	let actual: Buffer
	try {
		actual = Buffer.from(sigHex, 'hex')
	} catch {
		return { trusted: false, reason: 'malformed_signature' }
	}

	// Length-check first — timingSafeEqual throws on mismatched lengths, and we
	// must never throw out of this function.
	if (expected.length !== actual.length) return { trusted: false, reason: 'signature_mismatch' }
	if (!timingSafeEqual(expected, actual)) return { trusted: false, reason: 'signature_mismatch' }

	return { trusted: true }
}
