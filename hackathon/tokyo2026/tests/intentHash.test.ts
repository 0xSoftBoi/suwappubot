import { describe, expect, test } from 'bun:test'
import { hashIntent, MemoryNullifierStore, normalizeNullifier } from '../src/world-id/guardianGate.ts'

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
	test('first consume succeeds, replay rejected', async () => {
		const store = new MemoryNullifierStore()
		await expect(store.consume('suwappu-trade-approval', '0x12345')).resolves.toBe(true)
		await expect(store.consume('suwappu-trade-approval', '0x12345')).resolves.toBe(false)
	})
	test('different actions are independent', async () => {
		const store = new MemoryNullifierStore()
		await expect(store.consume('action-a', '0x12345')).resolves.toBe(true)
		await expect(store.consume('action-b', '0x12345')).resolves.toBe(true)
	})
	test('nullifier matching is case-insensitive', async () => {
		const store = new MemoryNullifierStore()
		await expect(store.consume('a', '0xABC')).resolves.toBe(true)
		await expect(store.consume('a', '0xabc')).resolves.toBe(false)
	})
	test('leading zeros and casing collapse to the same nullifier', async () => {
		const store = new MemoryNullifierStore()
		await expect(store.consume('a', '0x00ABC')).resolves.toBe(true)
		await expect(store.consume('a', '0xabc')).resolves.toBe(false)
	})
	test('malformed nullifier throws (fail closed)', async () => {
		const store = new MemoryNullifierStore()
		await expect(store.consume('a', 'not-hex')).rejects.toThrow('malformed nullifier')
		await expect(store.consume('a', '0x' + 'ff'.repeat(33))).rejects.toThrow('exceeds 256 bits')
	})
})

describe('normalizeNullifier', () => {
	test('hex → canonical decimal', () => {
		expect(normalizeNullifier('0xABC')).toBe('2748')
		expect(normalizeNullifier('0xabc')).toBe('2748')
		expect(normalizeNullifier('0x00abc')).toBe('2748')
		expect(normalizeNullifier('0x0')).toBe('0')
	})
	test('full 256-bit range fits (NUMERIC(78,0) holds 2^256-1)', () => {
		const max = '0x' + 'f'.repeat(64)
		expect(normalizeNullifier(max)).toBe((2n ** 256n - 1n).toString(10))
	})
	test('rejects malformed input', () => {
		expect(() => normalizeNullifier('')).toThrow('malformed nullifier')
		expect(() => normalizeNullifier('12345')).toThrow('malformed nullifier')
		expect(() => normalizeNullifier('0xZZZ')).toThrow('malformed nullifier')
		expect(() => normalizeNullifier('0x' + 'f'.repeat(65))).toThrow('exceeds 256 bits')
	})
})
