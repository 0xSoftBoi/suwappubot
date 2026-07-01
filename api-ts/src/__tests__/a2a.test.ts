import { afterAll, describe, expect, it } from 'bun:test'
import type { Agent } from '../db'
import {
	isQuoteOwnedByAgent,
	isTaskOwnedByAgent,
	resolveAgentEvmAddress,
	stopA2aCleanup,
} from '../routes/a2a'

const PLACEHOLDER = '0x0000000000000000000000000000000000000001'

afterAll(() => {
	// Release the module-level cleanup interval so the test process can exit.
	stopA2aCleanup()
})

// Minimal Agent stub helper; only fields touched by the code under test matter.
function makeAgent(id: number, metadata?: Record<string, unknown>): Agent {
	return { id, metadata: metadata ?? null } as unknown as Agent
}

describe('a2a quote ownership', () => {
	it('accepts a cached quote created by the same agent', () => {
		expect(isQuoteOwnedByAgent({ agentId: 42 }, 42)).toBe(true)
	})

	it('rejects a cached quote created by a different agent (cross-agent hijack)', () => {
		expect(isQuoteOwnedByAgent({ agentId: 42 }, 99)).toBe(false)
	})

	it('rejects a missing/expired cached quote', () => {
		expect(isQuoteOwnedByAgent(null, 42)).toBe(false)
		expect(isQuoteOwnedByAgent(undefined, 42)).toBe(false)
	})

	it('rejects a webapp quote with no agentId', () => {
		expect(isQuoteOwnedByAgent({}, 42)).toBe(false)
	})
})

describe('a2a task ownership (tasks/get + tasks/cancel)', () => {
	// Only the agentId field is read by the gate; cast the stub through unknown.
	const task = (agentId: number) => ({ agentId }) as unknown as Parameters<typeof isTaskOwnedByAgent>[0]

	it('lets the creating agent read/cancel its own task', () => {
		expect(isTaskOwnedByAgent(task(42), 42)).toBe(true)
	})

	it('treats another agent\'s task as not-found (no cross-agent read/cancel)', () => {
		expect(isTaskOwnedByAgent(task(42), 99)).toBe(false)
	})

	it('rejects a missing/expired task', () => {
		expect(isTaskOwnedByAgent(null, 42)).toBe(false)
		expect(isTaskOwnedByAgent(undefined, 42)).toBe(false)
	})
})

describe('a2a EVM address resolution', () => {
	it('prices a quote against the agent\'s own valid EVM wallet', () => {
		const wallet = '0x1234567890abcdef1234567890abcdef12345678'
		expect(resolveAgentEvmAddress(makeAgent(2, { wallet_address: wallet }))).toBe(wallet)
	})

	it('falls back to the non-executable placeholder when no wallet is recorded', () => {
		expect(resolveAgentEvmAddress(makeAgent(1))).toBe(PLACEHOLDER)
		expect(resolveAgentEvmAddress(makeAgent(1, {}))).toBe(PLACEHOLDER)
	})

	it('rejects a Solana / non-EVM wallet so it never reaches the EVM quote API', () => {
		const solana = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'
		expect(resolveAgentEvmAddress(makeAgent(3, { wallet_address: solana }))).toBe(PLACEHOLDER)
	})

	it('rejects malformed or non-string wallet metadata', () => {
		expect(resolveAgentEvmAddress(makeAgent(4, { wallet_address: '0xnothex' }))).toBe(PLACEHOLDER)
		expect(resolveAgentEvmAddress(makeAgent(5, { wallet_address: '0x1234' }))).toBe(PLACEHOLDER)
		expect(resolveAgentEvmAddress(makeAgent(6, { wallet_address: 12345 }))).toBe(PLACEHOLDER)
	})
})
