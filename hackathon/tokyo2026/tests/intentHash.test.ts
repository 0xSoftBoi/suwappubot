import { describe, expect, test } from 'bun:test'
import { hashIntent, MemoryNullifierStore } from '../src/world-id/guardianGate.ts'

const intent = {
	agentId: 'demo-agent',
	chain: 'Base',
	fromToken: '0xETH',
	toToken: '0xUSDC',
	amountIn: '1500000000000000000',
	nonce: 'abc123',
}

describe('hashIntent', () => {
	test('is deterministic', () => {
		expect(hashIntent(intent)).toBe(hashIntent(intent))
	})
	test('binds every field — changing one changes the signal', () => {
		const base = hashIntent(intent)
		expect(hashIntent({ ...intent, amountIn: '999' })).not.toBe(base)
		expect(hashIntent({ ...intent, toToken: '0xOTHER' })).not.toBe(base)
		expect(hashIntent({ ...intent, nonce: 'different' })).not.toBe(base)
		expect(hashIntent({ ...intent, agentId: 'other-agent' })).not.toBe(base)
	})
	test('is case-insensitive on chain/tokens', () => {
		expect(hashIntent({ ...intent, chain: 'base' })).toBe(hashIntent(intent))
	})
	test('returns 0x-prefixed 32-byte hex', () => {
		expect(hashIntent(intent)).toMatch(/^0x[0-9a-f]{64}$/)
	})
})

describe('MemoryNullifierStore', () => {
	test('first consume succeeds, replay rejected', () => {
		const store = new MemoryNullifierStore()
		expect(store.consume('suwappu-trade-approval', '12345')).toBe(true)
		expect(store.consume('suwappu-trade-approval', '12345')).toBe(false)
	})
	test('different actions are independent', () => {
		const store = new MemoryNullifierStore()
		expect(store.consume('action-a', '12345')).toBe(true)
		expect(store.consume('action-b', '12345')).toBe(true)
	})
	test('nullifier matching is case-insensitive', () => {
		const store = new MemoryNullifierStore()
		expect(store.consume('a', '0xABC')).toBe(true)
		expect(store.consume('a', '0xabc')).toBe(false)
	})
})
