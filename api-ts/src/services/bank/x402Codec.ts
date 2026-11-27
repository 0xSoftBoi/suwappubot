/**
 * x402 wire codec (v1 + v2), pure and side-effect free. Per docs/plans/neobank-provider-apis.md:
 * v2 headers PAYMENT-REQUIRED / PAYMENT-SIGNATURE / PAYMENT-RESPONSE (base64 JSON);
 * v1 headers X-PAYMENT / X-PAYMENT-RESPONSE and a JSON 402 body (accepts[].maxAmountRequired).
 */
import { hashTypedData, recoverAddress } from 'viem'
import { CHAIN_ID_TO_KEY } from '../../config/chains'
import { bankErr } from './errors'

export interface X402Requirement {
	version: 1 | 2
	scheme: string
	/** Raw network string from the wire (CAIP-2 `eip155:8453` in v2, name `base` in v1). */
	network: string
	chain: string | null
	chainId: number | null
	amountMinor: string
	asset: string
	payTo: string
	maxTimeoutSeconds: number
	resource: string | null
	extra: Record<string, unknown>
}

export interface X402Authorization {
	from: string
	to: string
	value: string
	validAfter: string
	validBefore: string
	nonce: string
}

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64')
const unb64 = (s: string): unknown => JSON.parse(Buffer.from(s, 'base64').toString('utf8'))

const KEY_TO_ID = Object.fromEntries(Object.entries(CHAIN_ID_TO_KEY).map(([id, k]) => [k, Number(id)])) as Record<string, number>

export function resolveNetwork(network: string): { chain: string | null; chainId: number | null } {
	const m = /^eip155:(\d+)$/.exec(network)
	if (m) {
		const id = Number(m[1])
		return { chain: CHAIN_ID_TO_KEY[id] ?? null, chainId: id }
	}
	const k = network.toLowerCase()
	return { chain: KEY_TO_ID[k] !== undefined ? k : null, chainId: KEY_TO_ID[k] ?? null }
}

const uint = (v: unknown, what: string): string => {
	const s = String(v)
	if (!/^\d{1,78}$/.test(s)) throw bankErr('VALIDATION', `x402 requirement has invalid ${what}`)
	return s
}

function normaliseAccepts(version: 1 | 2, accepts: unknown, resource: string | null): X402Requirement[] {
	if (!Array.isArray(accepts)) throw bankErr('VALIDATION', 'x402 payment requirements missing accepts[]')
	return accepts.map((a: Record<string, unknown>) => {
		const network = String(a.network ?? '')
		const r = resolveNetwork(network)
		return {
			version,
			scheme: String(a.scheme ?? ''),
			network,
			chain: r.chain,
			chainId: r.chainId,
			amountMinor: uint(version === 2 ? (a.amount ?? a.maxAmountRequired) : (a.maxAmountRequired ?? a.amount), 'amount'),
			asset: String(a.asset ?? ''),
			payTo: String(a.payTo ?? ''),
			maxTimeoutSeconds: Number(a.maxTimeoutSeconds ?? 60),
			resource: (typeof a.resource === 'string' ? a.resource : resource) ?? null,
			extra: (a.extra as Record<string, unknown>) ?? {},
		}
	})
}

/** Parse a 402 response: v2 PAYMENT-REQUIRED header, else v1 X-PAYMENT-REQUIRED header, else v1 JSON body. */
export function parsePaymentRequired(headers: Record<string, string>, body: string): X402Requirement[] {
	const h = (n: string) => headers[n.toLowerCase()]
	const v2 = h('payment-required')
	if (v2) {
		const o = unb64(v2) as { x402Version?: number; resource?: unknown; accepts?: unknown }
		const res = typeof o.resource === 'string' ? o.resource : ((o.resource as { url?: string } | undefined)?.url ?? null)
		return normaliseAccepts(o.x402Version === 1 ? 1 : 2, o.accepts, res)
	}
	const v1h = h('x-payment-required')
	if (v1h) {
		const o = unb64(v1h) as { x402Version?: number; accepts?: unknown }
		return normaliseAccepts(o.x402Version === 2 ? 2 : 1, o.accepts, null)
	}
	try {
		const o = JSON.parse(body) as { x402Version?: number; accepts?: unknown }
		if (o && Array.isArray(o.accepts)) return normaliseAccepts(o.x402Version === 2 ? 2 : 1, o.accepts, null)
	} catch {
		/* fallthrough */
	}
	throw bankErr('UPSTREAM', '402 response carried no parseable x402 payment requirements')
}

/** Build a 402 challenge (both header generations + v1-compatible body) for a priced resource. */
export function buildChallenge(req: { chainId: number; asset: string; payTo: string; amountMinor: string; resource: string; description: string; maxTimeoutSeconds: number; domain: { name: string; version: string } }) {
	const network = `eip155:${req.chainId}`
	const v2 = {
		x402Version: 2,
		resource: { url: req.resource, description: req.description, mimeType: 'application/json' },
		accepts: [{ scheme: 'exact', network, amount: req.amountMinor, asset: req.asset, payTo: req.payTo, maxTimeoutSeconds: req.maxTimeoutSeconds, extra: req.domain }],
	}
	const chainKey = CHAIN_ID_TO_KEY[req.chainId] ?? network
	const v1 = {
		x402Version: 1,
		accepts: [{ scheme: 'exact', network: chainKey, maxAmountRequired: req.amountMinor, resource: req.resource, description: req.description, mimeType: 'application/json', payTo: req.payTo, maxTimeoutSeconds: req.maxTimeoutSeconds, asset: req.asset, extra: req.domain }],
		error: 'payment_required',
	}
	return { v2, v1, headers: { 'PAYMENT-REQUIRED': b64(v2), 'X-PAYMENT-REQUIRED': b64(v1) }, body: v1 }
}

export function authorizationDigest(a: X402Authorization, domain: { name: string; version: string; chainId: number; verifyingContract: string }): `0x${string}` {
	return hashTypedData({
		domain: { name: domain.name, version: domain.version, chainId: domain.chainId, verifyingContract: domain.verifyingContract as `0x${string}` },
		types: {
			TransferWithAuthorization: [
				{ name: 'from', type: 'address' },
				{ name: 'to', type: 'address' },
				{ name: 'value', type: 'uint256' },
				{ name: 'validAfter', type: 'uint256' },
				{ name: 'validBefore', type: 'uint256' },
				{ name: 'nonce', type: 'bytes32' },
			],
		},
		primaryType: 'TransferWithAuthorization',
		message: { from: a.from as `0x${string}`, to: a.to as `0x${string}`, value: BigInt(a.value), validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore), nonce: a.nonce as `0x${string}` },
	})
}

export type PaymentValidation = { ok: true; from: string; nonce: string; signature: string; authorization: X402Authorization } | { ok: false; error: string }

/**
 * MONEY-PATH: validate a client payment header against the SERVER's own requirements (never the client's claims).
 * Recovers the EIP-3009 signer from the digest built with the server-held token domain and requires signer == from.
 * EOA (ECDSA) signatures only: no ERC-1271 verifier exists in this repo, so contract-wallet payers are rejected.
 */
export async function validatePaymentForResource(
	payment: string,
	req: { chainId: number; asset: string; payTo: string; amountMinor: string; domain: { name: string; version: string }; nowSec: number },
): Promise<PaymentValidation> {
	const fail = (error: string): PaymentValidation => ({ ok: false, error })
	let d: ReturnType<typeof decodePayment>
	try { d = decodePayment(payment) } catch { return fail('invalid_payment_header') }
	const a = d.authorization
	const ADDR = /^0x[0-9a-fA-F]{40}$/
	const DEC = /^\d{1,78}$/
	if (!a || !ADDR.test(String(a.from)) || !ADDR.test(String(a.to)) || !DEC.test(String(a.value)) || !DEC.test(String(a.validAfter)) || !DEC.test(String(a.validBefore)) || !/^0x[0-9a-fA-F]{64}$/.test(String(a.nonce))) return fail('invalid_authorization_fields')
	if (!/^0x[0-9a-fA-F]{130}$/.test(String(d.signature))) return fail('invalid_signature_format: only EOA (65-byte ECDSA) signatures are supported; ERC-1271 contract wallets are not')
	const net = d.network ?? (d.accepted?.network as string | undefined)
	if (net !== undefined && resolveNetwork(String(net)).chainId !== req.chainId) return fail('network_mismatch')
	const acc = d.accepted
	if (acc) {
		if (acc.scheme !== undefined && acc.scheme !== 'exact') return fail('scheme_mismatch')
		if (acc.asset !== undefined && String(acc.asset).toLowerCase() !== req.asset.toLowerCase()) return fail('asset_mismatch')
		if (acc.payTo !== undefined && String(acc.payTo).toLowerCase() !== req.payTo.toLowerCase()) return fail('payTo_mismatch')
	}
	if (a.to.toLowerCase() !== req.payTo.toLowerCase()) return fail('authorization_to_mismatch')
	if (BigInt(a.value) !== BigInt(req.amountMinor)) return fail('authorization_value_mismatch')
	const va = BigInt(a.validAfter), vb = BigInt(a.validBefore), now = BigInt(req.nowSec)
	if (!(va <= now && now < vb)) return fail('authorization_not_currently_valid')
	if (vb - now > 3600n) return fail('authorization_validity_window_too_long')
	let signer: string
	try { signer = await recoverAddress({ hash: authorizationDigest(a, { name: req.domain.name, version: req.domain.version, chainId: req.chainId, verifyingContract: req.asset }), signature: d.signature as `0x${string}` }) } catch { return fail('signature_unrecoverable') }
	if (signer.toLowerCase() !== a.from.toLowerCase()) return fail('signature_signer_mismatch')
	return { ok: true, from: a.from, nonce: a.nonce.toLowerCase(), signature: d.signature, authorization: a }
}

/** Encode the retry header for the requirement's generation. */
export function encodePayment(req: X402Requirement, auth: X402Authorization, signature: string): { name: string; value: string } {
	if (req.version === 2) {
		return {
			name: 'PAYMENT-SIGNATURE',
			value: b64({
				x402Version: 2,
				resource: req.resource ? { url: req.resource } : undefined,
				accepted: { scheme: req.scheme, network: req.network, amount: req.amountMinor, asset: req.asset, payTo: req.payTo, maxTimeoutSeconds: req.maxTimeoutSeconds, extra: req.extra },
				payload: { signature, authorization: auth },
			}),
		}
	}
	return { name: 'X-PAYMENT', value: b64({ x402Version: 1, scheme: req.scheme, network: req.network, payload: { signature, authorization: auth } }) }
}

export function decodePayment(value: string): { version: number; accepted?: Record<string, unknown>; network?: string; signature: string; authorization: X402Authorization } {
	const o = unb64(value) as { x402Version: number; accepted?: Record<string, unknown>; network?: string; payload: { signature: string; authorization: X402Authorization } }
	if (!o?.payload?.authorization || !o.payload.signature) throw bankErr('VALIDATION', 'Malformed x402 payment payload')
	return { version: o.x402Version, accepted: o.accepted, network: o.network, signature: o.payload.signature, authorization: o.payload.authorization }
}

export interface X402Settlement {
	success: boolean
	transaction?: string
	network?: string
	payer?: string
	errorReason?: string
}

export const encodeSettlement = (s: X402Settlement): Record<string, string> => ({ 'PAYMENT-RESPONSE': b64(s), 'X-PAYMENT-RESPONSE': b64(s) })

export function decodeSettlement(headers: Record<string, string>): X402Settlement | null {
	const v = headers['payment-response'] ?? headers['x-payment-response']
	if (!v) return null
	try {
		const o = unb64(v) as X402Settlement
		return { success: o.success === true, transaction: o.transaction, network: o.network, payer: o.payer, errorReason: o.errorReason }
	} catch {
		return null
	}
}
