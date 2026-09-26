import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, test } from 'bun:test'
import { keccak_256 } from '@noble/hashes/sha3'
import {
	buildOrderTypedData,
	CTF_EXCHANGE,
	EIP712_DOMAIN,
	hashEip712Order,
	NEG_RISK_CTF_EXCHANGE,
	ORDER_TYPES,
	resolveBuilderCode,
	ZERO_BYTES32,
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

const pythonSignerPath = join(import.meta.dir, '../../../bot/services/polymarket_v2_order.py')
// Railway builds api-ts from an intentionally isolated service context, so the
// sibling Python tree does not exist inside that image. Keep this parity test
// mandatory in a full repository checkout (GitHub/local) and skip only when the
// external fixture is physically unavailable. All TypeScript signer/vector tests
// below still run in the deploy image.
const crossLanguageTest = existsSync(pythonSignerPath) ? test : test.skip

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
		const typed = buildOrderTypedData(order, false)
		expect(typed.primaryType).toBe('Order')
		expect(typed.domain).toEqual(EIP712_DOMAIN)
		expect(typed.message).toEqual(order)
		// v1 fields must be gone.
		expect(Object.keys(typed.message)).not.toContain('expiration')
		expect(Object.keys(typed.message)).not.toContain('feeRateBps')
	})

	test('negRisk selects the NegRiskCtfExchange as verifyingContract', () => {
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
		const standard = buildOrderTypedData(order, false)
		const negRisk = buildOrderTypedData(order, true)
		expect(standard.domain.verifyingContract).toBe(CTF_EXCHANGE)
		expect(negRisk.domain.verifyingContract).toBe(NEG_RISK_CTF_EXCHANGE)
		expect(standard.domain.name).toBe(negRisk.domain.name)
		expect(standard.domain.version).toBe(negRisk.domain.version)
		expect(standard.domain.chainId).toBe(negRisk.domain.chainId)
		// The two domains actually hash to different digests — this is the bug
		// class being guarded against: hashEip712Order used to ignore
		// typedData.domain entirely and always hash the fixed EIP712_DOMAIN
		// constant, so a neg-risk order would silently sign against the
		// standard exchange despite buildOrderTypedData choosing the right one.
		expect(hashEip712Order(standard)).not.toBe(hashEip712Order(negRisk))
	})

	crossLanguageTest('NEG_RISK_CTF_EXCHANGE byte-matches bot/services/polymarket_v2_order.py', () => {
		// The Python and TypeScript order signers MUST bind to the exact same
		// contract address or one side's signatures are rejected by the CLOB.
		// Read the constant out of the Python source directly rather than
		// hardcoding a second copy that could drift silently.
		const pySource = readFileSync(pythonSignerPath, 'utf-8')
		const ctfMatch = pySource.match(/^CTF_EXCHANGE = "(0x[0-9a-fA-F]{40})"/m)
		const negRiskMatch = pySource.match(/^NEG_RISK_CTF_EXCHANGE = "(0x[0-9a-fA-F]{40})"/m)
		expect(ctfMatch).not.toBeNull()
		expect(negRiskMatch).not.toBeNull()
		expect(CTF_EXCHANGE).toBe(ctfMatch![1])
		expect(NEG_RISK_CTF_EXCHANGE).toBe(negRiskMatch![1])
	})
})

describe('resolveBuilderCode', () => {
	// Mirrors bot/services/polymarket_api.py's _BUILDER_CODE_RE fallback:
	// a malformed POLYMARKET_BUILDER_CODE must fall back to ZERO_BYTES32
	// rather than sign garbage into the order's `builder` field.
	const VALID = '0x' + 'ab'.repeat(32)

	test('accepts a well-formed 32-byte hex value', () => {
		expect(resolveBuilderCode(VALID)).toBe(VALID)
	})

	test('falls back to ZERO_BYTES32 when unset', () => {
		expect(resolveBuilderCode(undefined)).toBe(ZERO_BYTES32)
		expect(resolveBuilderCode(null)).toBe(ZERO_BYTES32)
		expect(resolveBuilderCode('')).toBe(ZERO_BYTES32)
	})

	test('falls back to ZERO_BYTES32 for the wrong length', () => {
		expect(resolveBuilderCode('0x' + 'ab'.repeat(31))).toBe(ZERO_BYTES32)
		expect(resolveBuilderCode('0x' + 'ab'.repeat(33))).toBe(ZERO_BYTES32)
	})

	test('falls back to ZERO_BYTES32 for non-hex characters', () => {
		expect(resolveBuilderCode('0x' + 'zz'.repeat(32))).toBe(ZERO_BYTES32)
	})

	test('falls back to ZERO_BYTES32 when missing the 0x prefix', () => {
		expect(resolveBuilderCode('ab'.repeat(32))).toBe(ZERO_BYTES32)
	})
})

describe('encodeBytes32 (via hashEip712Order)', () => {
	// encodeBytes32 is not exported directly; exercise it through
	// hashEip712Order's `builder`/`metadata` bytes32 fields, which is exactly
	// the path a malformed value would reach production through.
	function orderWith(builder: string) {
		return {
			salt: '1',
			maker: '0x000000000000000000000000000000000000dEaD',
			signer: '0x000000000000000000000000000000000000dEaD',
			tokenId: '42',
			makerAmount: '1000000',
			takerAmount: '2000000',
			side: 0,
			signatureType: 0,
			timestamp: '1718000000000',
			metadata: ZERO_BYTES32,
			builder,
		}
	}

	test('a well-formed 32-byte value hashes without error', () => {
		const typed = buildOrderTypedData(orderWith('0x' + 'ab'.repeat(32)), false)
		expect(() => hashEip712Order(typed)).not.toThrow()
	})

	test('throws instead of silently truncating an over-length value', () => {
		// Previously `.slice(-64)` silently kept only the LAST 32 bytes of an
		// over-length input, signing a different bytes32 than intended with no
		// error at all.
		const tooLong = '0x' + 'ab'.repeat(40)
		const typed = buildOrderTypedData(orderWith(tooLong), false)
		expect(() => hashEip712Order(typed)).toThrow()
	})

	test('throws on non-hex characters instead of silently mis-encoding', () => {
		const notHex = '0x' + 'zz'.repeat(32)
		const typed = buildOrderTypedData(orderWith(notHex), false)
		expect(() => hashEip712Order(typed)).toThrow()
	})
})
