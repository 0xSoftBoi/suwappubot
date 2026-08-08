import { describe, expect, test } from 'bun:test'
import { keccak_256 } from '@noble/hashes/sha3'
import {
	buildOrderTypedData,
	CTF_EXCHANGE,
	EIP712_DOMAIN,
	hashEip712Order,
	NEG_RISK_CTF_EXCHANGE,
	ORDER_TYPES,
} from '../lib/polymarket-eip712'

// These guard the hand-rolled Polymarket CTF Exchange v2 order signer against the
// on-chain contract. Polymarket migrated to pUSD collateral + a new exchange in
// April 2026; the prior code signed against the deprecated USDC.e exchange with the
// wrong domain name/version and the v1 order schema, so every signature was rejected.
// The values below were read on-chain (Polygon, chain 137) from the verified
// CTFExchange @ 0xE111180000d2663C0091e4f400237545B87B996B.

function encodeType(): string {
	const fields = ORDER_TYPES.Order
	return `Order(${fields.map((f) => `${f.type} ${f.name}`).join(',')})`
}

describe('Polymarket CTF Exchange v2 EIP712', () => {
	test('order type string matches the on-chain ORDER_TYPEHASH preimage', () => {
		// Exact preimage hashed into ORDER_TYPEHASH in src/exchange/libraries/Structs.sol.
		expect(encodeType()).toBe(
			'Order(uint256 salt,address maker,address signer,uint256 tokenId,uint256 makerAmount,uint256 takerAmount,uint8 side,uint8 signatureType,uint256 timestamp,bytes32 metadata,bytes32 builder)',
		)
	})

	test('ORDER_TYPEHASH equals the on-chain constant', () => {
		const hash = '0x' + Buffer.from(keccak_256(Buffer.from(encodeType()))).toString('hex')
		// ORDER_TYPEHASH constant in Structs.sol.
		expect(hash).toBe('0xbb86318a2138f5fa8ae32fbe8e659f8fcf13cc6ae4014a707893055433818589')
	})

	test('domain points at the live pUSD exchange, not the deprecated USDC.e one', () => {
		expect(EIP712_DOMAIN.name).toBe('Polymarket CTF Exchange')
		expect(EIP712_DOMAIN.version).toBe('2')
		expect(EIP712_DOMAIN.chainId).toBe(137)
		expect(EIP712_DOMAIN.verifyingContract).toBe('0xE111180000d2663C0091e4f400237545B87B996B')
		// The deprecated exchange must never reappear here.
		expect(EIP712_DOMAIN.verifyingContract).not.toBe('0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E')
	})

	test('buildOrderTypedData carries the v2 schema and message through', () => {
		const order = {
			salt: '1',
			maker: '0x000000000000000000000000000000000000dEaD',
			signer: '0x000000000000000000000000000000000000dEaD',
			tokenId: '42',
			makerAmount: '1000000',
			takerAmount: '2000000',
			side: 0,
			signatureType: 0,
			timestamp: '1718000000000',
			metadata: '0x0000000000000000000000000000000000000000000000000000000000000000',
			builder: '0x0000000000000000000000000000000000000000000000000000000000000000',
		}
		const typed = buildOrderTypedData(order)
		expect(typed.primaryType).toBe('Order')
		expect(typed.domain).toEqual(EIP712_DOMAIN)
		expect(typed.message).toEqual(order)
		// v1 fields must be gone.
		expect(Object.keys(typed.message)).not.toContain('expiration')
		expect(Object.keys(typed.message)).not.toContain('feeRateBps')
	})
})

// Neg-risk (multi-outcome) markets are matched by a SEPARATE exchange deployment.
// Signing them against the standard exchange — which this signer did unconditionally
// before 2026-07-26 — produces a digest the CLOB recovers against the wrong contract,
// so the order is rejected. Addresses verified against Polymarket's official contracts
// page (docs.polymarket.com/resources/contracts) on 2026-07-26.
describe('neg-risk exchange selection', () => {
	const order = {
		salt: '1',
		maker: '0x000000000000000000000000000000000000dEaD',
		signer: '0x000000000000000000000000000000000000dEaD',
		tokenId: '42',
		makerAmount: '1000000',
		takerAmount: '2000000',
		side: 0,
		signatureType: 0,
		timestamp: '1718000000000',
		metadata: '0x0000000000000000000000000000000000000000000000000000000000000000',
		builder: '0x0000000000000000000000000000000000000000000000000000000000000000',
	}

	test('exchange addresses match Polymarket docs, and the deprecated ones are gone', () => {
		expect(CTF_EXCHANGE).toBe('0xE111180000d2663C0091e4f400237545B87B996B')
		expect(NEG_RISK_CTF_EXCHANGE).toBe('0xe2222d279d744050d28e00520010520000310F59')
		// 0xC5d563A3… is the DEPRECATED USDC.e-era neg-risk exchange still shipped by
		// py-clob-client 0.34.6 — it must never be used for v2 signing.
		expect(NEG_RISK_CTF_EXCHANGE).not.toBe('0xC5d563A36AE78145C45a50134d48A1215220f80a')
	})

	test('negRisk selects the neg-risk exchange; default stays the standard one', () => {
		expect(buildOrderTypedData(order, { negRisk: true }).domain.verifyingContract).toBe(
			NEG_RISK_CTF_EXCHANGE,
		)
		expect(buildOrderTypedData(order, { negRisk: false }).domain.verifyingContract).toBe(CTF_EXCHANGE)
		// Omitting the option must not silently opt into neg-risk.
		expect(buildOrderTypedData(order).domain.verifyingContract).toBe(CTF_EXCHANGE)
	})

	test('the two domains produce DIFFERENT digests for an identical order', () => {
		// This is the whole point: same order bytes, different exchange binding.
		const standard = hashEip712Order(buildOrderTypedData(order, { negRisk: false }))
		const negRisk = hashEip712Order(buildOrderTypedData(order, { negRisk: true }))
		expect(standard).not.toBe(negRisk)
		expect(standard).toMatch(/^0x[0-9a-f]{64}$/)
		expect(negRisk).toMatch(/^0x[0-9a-f]{64}$/)
	})

	test('only verifyingContract differs — name/version/chainId are shared', () => {
		const a = buildOrderTypedData(order, { negRisk: false }).domain
		const b = buildOrderTypedData(order, { negRisk: true }).domain
		expect(b.name).toBe(a.name)
		expect(b.version).toBe(a.version)
		expect(b.chainId).toBe(a.chainId)
		expect(b.verifyingContract).not.toBe(a.verifyingContract)
	})
})
