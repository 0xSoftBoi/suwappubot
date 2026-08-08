import { describe, expect, test } from 'bun:test'
import type { ClobOrderData } from '../lib/polymarket-eip712'
import { buildClobOrderBody, type SignedClobOrder } from '../services/PolymarketService'

// Guards that the CLOB POST /order body serializes the SAME order that was
// EIP-712 signed. The classic CLOB bug is posting a freeform {tokenID,price,
// size,side} body that doesn't match the signed digest amounts/side, so the
// CLOB recovers a different order hash and rejects the signature.

// BUY 100 shares @ 0.42 pUSD/share:
//   makerAmount = 100 * 0.42 * 1e6 = 42_000_000 (pUSD given)
//   takerAmount = 100 * 1e6        = 100_000_000 (shares received)
const buyOrder: ClobOrderData = {
	salt: '12345',
	maker: '0x1111111111111111111111111111111111111111',
	signer: '0x1111111111111111111111111111111111111111',
	tokenId: '7100000000000000000000000000000000000000000000000000000000000000',
	makerAmount: '42000000',
	takerAmount: '100000000',
	side: 0,
	signatureType: 0,
	timestamp: '1718000000000',
	metadata: '0x0000000000000000000000000000000000000000000000000000000000000000',
	builder: '0x0000000000000000000000000000000000000000000000000000000000000000',
}

// SELL 100 shares @ 0.42 pUSD/share (maker/taker flipped):
//   makerAmount = 100 * 1e6        = 100_000_000 (shares given)
//   takerAmount = 100 * 0.42 * 1e6 = 42_000_000 (pUSD received)
const sellOrder: ClobOrderData = {
	...buyOrder,
	makerAmount: '100000000',
	takerAmount: '42000000',
	side: 1,
}

const OWNER = 'api-key-id-abc'

describe('buildClobOrderBody', () => {
	test('BUY: REST body carries the exact signed amounts, side enum, and signatureType', () => {
		const signed: SignedClobOrder = { order: buyOrder, signature: '0xdeadbeef', orderType: 'GTC' }
		const body = buildClobOrderBody(signed, OWNER)

		// Same amounts as the signed struct, serialized as decimal strings.
		expect(body.order.makerAmount).toBe(buyOrder.makerAmount)
		expect(body.order.takerAmount).toBe(buyOrder.takerAmount)
		expect(typeof body.order.makerAmount).toBe('string')
		expect(typeof body.order.takerAmount).toBe('string')

		// side 0 -> "BUY" enum string in the POST body.
		expect(body.order.side).toBe('BUY')

		// signatureType passes through unchanged.
		expect(body.order.signatureType).toBe(0)

		// Signed identity fields carried verbatim.
		expect(body.order.salt).toBe(buyOrder.salt)
		expect(body.order.maker).toBe(buyOrder.maker)
		expect(body.order.signer).toBe(buyOrder.signer)
		expect(body.order.tokenId).toBe(buyOrder.tokenId)
		expect(body.order.signature).toBe('0xdeadbeef')

		// v2 fields are part of the SIGNED digest, so they must appear in the body.
		expect(body.order.timestamp).toBe(buyOrder.timestamp)
		expect(body.order.metadata).toBe(buyOrder.metadata)
		expect(body.order.builder).toBe(buyOrder.builder)

		// The v1 fields CLOB V2 dropped must NOT be sent — including them makes the
		// serialized body diverge from the struct that was signed.
		expect(body.order).not.toHaveProperty('taker')
		expect(body.order).not.toHaveProperty('expiration')
		expect(body.order).not.toHaveProperty('nonce')
		expect(body.order).not.toHaveProperty('feeRateBps')

		// The body's order keys must be exactly the signed struct + signature.
		expect(Object.keys(body.order).sort()).toEqual(
			[
				'builder',
				'maker',
				'makerAmount',
				'metadata',
				'salt',
				'side',
				'signature',
				'signatureType',
				'signer',
				'takerAmount',
				'timestamp',
				'tokenId',
			].sort(),
		)

		// Envelope.
		expect(body.owner).toBe(OWNER)
		expect(body.orderType).toBe('GTC')
	})

	test('SELL: maker/taker amounts are the flipped legs, side enum is "SELL"', () => {
		const signed: SignedClobOrder = { order: sellOrder, signature: '0xfeed', orderType: 'GTC' }
		const body = buildClobOrderBody(signed, OWNER)

		expect(body.order.makerAmount).toBe('100000000') // shares given
		expect(body.order.takerAmount).toBe('42000000') // pUSD received
		expect(body.order.side).toBe('SELL')
		expect(body.order.signatureType).toBe(0)
		expect(body.order.signature).toBe('0xfeed')
	})

	test('body is JSON-serializable with no bigints or undefined', () => {
		const signed: SignedClobOrder = { order: buyOrder, signature: '0x00', orderType: 'FOK' }
		const json = JSON.stringify(buildClobOrderBody(signed, OWNER))
		const round = JSON.parse(json)
		expect(round.order.makerAmount).toBe('42000000')
		expect(round.orderType).toBe('FOK')
	})
})
