import { keccak_256 } from '@noble/hashes/sha3'

// Polymarket CTF Exchange v2 EIP712 domain (Polygon mainnet).
// Verified on-chain 2026-06-18 against the live pUSD-collateral exchange
// CTFExchange @ 0xE111180000d2663C0091e4f400237545B87B996B (src/exchange/mixins/Hashing.sol):
//   DOMAIN_NAME = "Polymarket CTF Exchange", DOMAIN_VERSION = "2".
// The previous values (name "ClobExchange", version "1", the deprecated USDC.e
// exchange 0x4bFb…982E) produced signatures the CLOB rejects — Polymarket migrated
// to pUSD collateral + a new exchange in April 2026.
//
// Neg-risk (multi-outcome) markets are matched by a SEPARATE deployment of the
// same contract code — only verifyingContract differs, name/version are
// identical. Value copied verbatim from
// bot/services/polymarket_v2_order.py's NEG_RISK_CTF_EXCHANGE (ground truth,
// verified 2026-07-26 first-party) — the two MUST stay byte-identical, pinned
// by a test in __tests__/polymarketEip712.test.ts.
export const CTF_EXCHANGE = '0xE111180000d2663C0091e4f400237545B87B996B'
export const NEG_RISK_CTF_EXCHANGE = '0xe2222d279d744050d28e00520010520000310F59'

function domainFor(negRisk: boolean) {
	return {
		name: 'Polymarket CTF Exchange',
		version: '2',
		chainId: 137,
		verifyingContract: (negRisk ? NEG_RISK_CTF_EXCHANGE : CTF_EXCHANGE) as string,
	}
}

const EIP712_DOMAIN = domainFor(false)

// v2 Order struct, verified against the on-chain ORDER_TYPEHASH
// (0xbb86318a…818589) in src/exchange/libraries/Structs.sol. Note the v2 schema
// dropped `taker`/`expiration`/`nonce`/`feeRateBps` and added `timestamp` (ms),
// `metadata` and `builder` (the builder-program monetization hook).
const ORDER_TYPES = {
	Order: [
		{ name: 'salt', type: 'uint256' },
		{ name: 'maker', type: 'address' },
		{ name: 'signer', type: 'address' },
		{ name: 'tokenId', type: 'uint256' },
		{ name: 'makerAmount', type: 'uint256' },
		{ name: 'takerAmount', type: 'uint256' },
		{ name: 'side', type: 'uint8' },
		{ name: 'signatureType', type: 'uint8' },
		{ name: 'timestamp', type: 'uint256' },
		{ name: 'metadata', type: 'bytes32' },
		{ name: 'builder', type: 'bytes32' },
	],
}

const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000'

export interface ClobOrderData {
	salt: string
	maker: string
	signer: string
	tokenId: string
	makerAmount: string
	takerAmount: string
	side: number   // 0 = BUY, 1 = SELL
	signatureType: number // 0 = EOA, 1 = POLY_PROXY, 2 = POLY_GNOSIS_SAFE, 3 = POLY_1271
	timestamp: string // unix ms at which the order was created
	metadata: string // bytes32 (hashed order metadata); ZERO_BYTES32 when unused
	builder: string  // bytes32 builder code; ZERO_BYTES32 = no builder
}

export interface EIP712TypedData {
	types: typeof ORDER_TYPES
	primaryType: 'Order'
	domain: typeof EIP712_DOMAIN
	message: ClobOrderData
}

function keccak256(data: Uint8Array): Buffer {
	return Buffer.from(keccak_256(data))
}

function encodeType(primaryType: string, types: Record<string, { name: string; type: string }[]>): string {
	const fields = types[primaryType]
	if (!fields) throw new Error(`Unknown type: ${primaryType}`)
	return `${primaryType}(${fields.map((f) => `${f.type} ${f.name}`).join(',')})`
}

function typeHash(primaryType: string, types: Record<string, { name: string; type: string }[]>): Buffer {
	return keccak256(Buffer.from(encodeType(primaryType, types)))
}

function encodeUint256(value: string): Buffer {
	const hex = BigInt(value).toString(16).padStart(64, '0')
	return Buffer.from(hex, 'hex')
}

function encodeAddress(value: string): Buffer {
	const clean = value.toLowerCase().replace('0x', '').padStart(64, '0')
	return Buffer.from(clean, 'hex')
}

function encodeUint8(value: number): Buffer {
	return encodeUint256(String(value))
}

// Matches bot/services/polymarket_v2_order.py's builder-code validation
// pattern (32-byte hex). Exported so callers can validate a user/env-supplied
// bytes32 field (e.g. POLYMARKET_BUILDER_CODE) before it ever reaches
// encodeBytes32, and fall back to ZERO_BYTES32 on a mismatch.
export const BUILDER_CODE_RE = /^0x[0-9a-fA-F]{64}$/

/**
 * Resolve a caller-supplied bytes32 hex value against BUILDER_CODE_RE,
 * falling back to ZERO_BYTES32 (mirrors the Python side's
 * `_BUILDER_CODE_RE` fallback in polymarket_api.py). A malformed value
 * (wrong length, non-hex, missing 0x) silently signing garbage into the
 * order's `builder` field is worse than just treating it as "no builder".
 */
export function resolveBuilderCode(raw: string | undefined | null): string {
	if (raw && BUILDER_CODE_RE.test(raw)) return raw
	return ZERO_BYTES32
}

function encodeBytes32(value: string): Buffer {
	const hasPrefix = value.toLowerCase().startsWith('0x')
	const clean = (hasPrefix ? value.slice(2) : value).toLowerCase()
	// Previously this silently truncated an over-length value via
	// `.slice(-64)` — a mistakenly-longer input would sign a DIFFERENT
	// bytes32 than the caller intended, with no error. Reject instead:
	// only accept 1-64 valid hex chars, left-padded to 32 bytes.
	if (clean.length === 0 || clean.length > 64 || !/^[0-9a-f]+$/.test(clean)) {
		throw new Error(
			`encodeBytes32: expected a 0x-prefixed hex string of at most 32 bytes, got ${JSON.stringify(value)}`,
		)
	}
	return Buffer.from(clean.padStart(64, '0'), 'hex')
}

function hashStruct(primaryType: string, data: ClobOrderData, types: Record<string, { name: string; type: string }[]>): Buffer {
	const tHash = typeHash(primaryType, types)
	const fields = types[primaryType]
	if (!fields) throw new Error(`Unknown type: ${primaryType}`)

	const encodedValues: Buffer[] = [tHash]

	for (const field of fields) {
		const value = (data as unknown as Record<string, unknown>)[field.name]
		if (field.type === 'address') {
			encodedValues.push(encodeAddress(value as string))
		} else if (field.type === 'uint256') {
			encodedValues.push(encodeUint256(value as string))
		} else if (field.type === 'uint8') {
			encodedValues.push(encodeUint8(value as number))
		} else if (field.type === 'bytes32') {
			encodedValues.push(encodeBytes32(value as string))
		}
	}

	return keccak256(Buffer.concat(encodedValues))
}

function hashDomain(domain: typeof EIP712_DOMAIN): Buffer {
	const domainTypeHash = keccak256(
		Buffer.from('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')
	)
	return keccak256(
		Buffer.concat([
			domainTypeHash,
			keccak256(Buffer.from(domain.name)),
			keccak256(Buffer.from(domain.version)),
			encodeUint256(String(domain.chainId)),
			encodeAddress(domain.verifyingContract),
		])
	)
}

/**
 * Build the full EIP-712 payload for an order.
 *
 * `negRisk` MUST reflect the market (CLOB `GET /neg-risk?token_id=`) — it
 * selects which exchange's domain (verifyingContract) the order is bound to.
 * Getting it wrong produces a valid-looking signature the CLOB still rejects,
 * because it recovers against the wrong contract. Mirrors
 * bot/services/polymarket_v2_order.py's `domain_for`/`sign_order`.
 */
export function buildOrderTypedData(order: ClobOrderData, negRisk: boolean): EIP712TypedData {
	return {
		types: ORDER_TYPES,
		primaryType: 'Order',
		domain: domainFor(negRisk),
		message: order,
	}
}

export function hashEip712Order(typedData: EIP712TypedData): string {
	// Hash the domain that was ACTUALLY passed in typedData, not a fixed
	// module-level constant — this used to always hash the non-neg-risk domain
	// regardless of what buildOrderTypedData produced, silently signing
	// neg-risk orders against the wrong exchange.
	const domainSeparator = hashDomain(typedData.domain)
	const structHash = hashStruct(typedData.primaryType, typedData.message, typedData.types)
	const prefix = Buffer.from('1901', 'hex')
	const digest = keccak256(Buffer.concat([prefix, domainSeparator, structHash]))
	return '0x' + Buffer.from(digest).toString('hex')
}

export function buildClobAuthMessage(timestamp: number): string {
	return `I want to create a CLOB API key. Timestamp: ${timestamp}`
}

export { EIP712_DOMAIN, ORDER_TYPES, ZERO_BYTES32 }
