import { keccak_256 } from '@noble/hashes/sha3'

// Polymarket CLOB Exchange EIP712 domain (Polygon mainnet)
const EIP712_DOMAIN = {
	name: 'ClobExchange',
	version: '1',
	chainId: 137,
	verifyingContract: '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E' as const,
}

const ORDER_TYPES = {
	Order: [
		{ name: 'salt', type: 'uint256' },
		{ name: 'maker', type: 'address' },
		{ name: 'signer', type: 'address' },
		{ name: 'taker', type: 'address' },
		{ name: 'tokenId', type: 'uint256' },
		{ name: 'makerAmount', type: 'uint256' },
		{ name: 'takerAmount', type: 'uint256' },
		{ name: 'expiration', type: 'uint256' },
		{ name: 'nonce', type: 'uint256' },
		{ name: 'feeRateBps', type: 'uint256' },
		{ name: 'side', type: 'uint8' },
		{ name: 'signatureType', type: 'uint8' },
	],
}

export interface ClobOrderData {
	salt: string
	maker: string
	signer: string
	taker: string
	tokenId: string
	makerAmount: string
	takerAmount: string
	expiration: string
	nonce: string
	feeRateBps: string
	side: number   // 0 = BUY, 1 = SELL
	signatureType: number // 0 = EOA, 1 = POLY_PROXY, 2 = POLY_GNOSIS_SAFE
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

function hashStruct(primaryType: string, data: ClobOrderData, types: Record<string, { name: string; type: string }[]>): Buffer {
	const tHash = typeHash(primaryType, types)
	const fields = types[primaryType]
	if (!fields) throw new Error(`Unknown type: ${primaryType}`)

	const encodedValues: Buffer[] = [tHash]

	for (const field of fields) {
		const value = (data as Record<string, unknown>)[field.name]
		if (field.type === 'address') {
			encodedValues.push(encodeAddress(value as string))
		} else if (field.type === 'uint256') {
			encodedValues.push(encodeUint256(value as string))
		} else if (field.type === 'uint8') {
			encodedValues.push(encodeUint8(value as number))
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

export { EIP712_DOMAIN, ORDER_TYPES }
