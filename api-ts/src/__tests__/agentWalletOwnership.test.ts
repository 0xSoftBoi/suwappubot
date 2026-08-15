import { afterAll, describe, expect, it } from 'bun:test'
import { checkEvmWalletOwnership, stopAgentCleanup } from '../routes/agent'

// Importing agent.ts starts a background cache-cleanup interval; stop it so the
// test process exits cleanly.
afterAll(() => stopAgentCleanup())

const MANAGED = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
const agentWith = (addr?: string) =>
	({ id: 1, metadata: addr ? { wallet_address: addr } : {} }) as any

describe('checkEvmWalletOwnership (C16/C17)', () => {
	it('accepts the agent\'s own managed wallet, case-insensitively', () => {
		expect(checkEvmWalletOwnership(agentWith(MANAGED), MANAGED.toLowerCase())).toBe(true)
		expect(checkEvmWalletOwnership(agentWith(MANAGED.toLowerCase()), MANAGED)).toBe(true)
	})

	it('rejects a different address (the injection attempt)', () => {
		expect(
			checkEvmWalletOwnership(agentWith(MANAGED), '0x0000000000000000000000000000000000000001'),
		).toBe(false)
	})

	it('rejects when the agent has no managed wallet', () => {
		expect(checkEvmWalletOwnership(agentWith(undefined), MANAGED)).toBe(false)
	})

	it('rejects malformed / missing addresses', () => {
		expect(checkEvmWalletOwnership(agentWith(MANAGED), 'not-an-address')).toBe(false)
		expect(checkEvmWalletOwnership(agentWith(MANAGED), undefined)).toBe(false)
		expect(checkEvmWalletOwnership(agentWith(MANAGED), '0x123')).toBe(false)
	})
})
