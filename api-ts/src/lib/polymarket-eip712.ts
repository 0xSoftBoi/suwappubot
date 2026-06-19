import { keccak_256 } from '@noble/hashes/sha3'

// Polymarket CTF Exchange v2 EIP712 domain (Polygon mainnet).
// Verified on-chain 2026-06-18 against the live pUSD-collateral exchange
// CTFExchange @ 0xE111180000d2663C0091e4f400237545B87B996B (src/exchange/mixins/Hashing.sol):
//   DOMAIN_NAME = "Polymarket CTF Exchange", DOMAIN_VERSION = "2".
// The previous values (name "ClobExchange", version "1", the deprecated USDC.e
// exchange 0x4bFb…982E) produced signatures the CLOB rejects — Polymarket migrated
// to pUSD collateral + a new exchange in April 2026.
//
// Neg-risk markets are matched by a separate exchange (NegRiskCtfExchange
// 0xC5d563A36AE78145C45a50134d48A1215220f80a) with the same domain name/version but
// a different verifyingContract; pass `verifyingContract` through buildOrderTypedData
// when adding neg-risk support.
const EIP712_DOMAIN = {
	name: 'Polymarket CTF Exchange',
	version: '2',
	chainId: 137,
	verifyingContract: '0xE111180000d2663C0091e4f400237545B87B996B' as const,
}

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

function encodeBytes32(value: string): Buffer {
	const clean = value.toLowerCase().replace('0x', '').padStart(64, '0').slice(-64)
	return Buffer.from(clean, 'hex')
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

function hashDomain(): Buffer {
	const domainTypeHash = keccak256(
		Buffer.from('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')
	)
	return keccak256(
		Buffer.concat([
			domainTypeHash,
			keccak256(Buffer.from(EIP712_DOMAIN.name)),
			keccak256(Buffer.from(EIP712_DOMAIN.version)),
			encodeUint256(String(EIP712_DOMAIN.chainId)),
			encodeAddress(EIP712_DOMAIN.verifyingContract),
		])
	)
}

export function buildOrderTypedData(order: ClobOrderData): EIP712TypedData {
	return {
		types: ORDER_TYPES,
		primaryType: 'Order',
		domain: EIP712_DOMAIN,
		message: order,
	}
}

export function hashEip712Order(typedData: EIP712TypedData): string {
	const domainSeparator = hashDomain()
	const structHash = hashStruct(typedData.primaryType, typedData.message, typedData.types)
	const prefix = Buffer.from('1901', 'hex')
	const digest = keccak256(Buffer.concat([prefix, domainSeparator, structHash]))
	return '0x' + Buffer.from(digest).toString('hex')
}

export function buildClobAuthMessage(timestamp: number): string {
	return `I want to create a CLOB API key. Timestamp: ${timestamp}`
}

export { EIP712_DOMAIN, ORDER_TYPES, ZERO_BYTES32 }
