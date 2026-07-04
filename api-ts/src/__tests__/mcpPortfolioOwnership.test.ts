import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test'
import { Either } from 'effect'

// Mock the Effect runtime so the handlers never touch BalanceService / Hyperliquid /
// the network. Any code path that reaches runEffectEither returns an empty success —
// this isolates the ownership gate as the only thing under test.
mock.module('../runtime', () => ({
	runEffectEither: async () => Either.right({ wallet_address: 'x', total_usd: '0.00', balances: [] }),
	runEffect: async () => ({}),
	shutdownRuntime: async () => {},
}))

// Imported after the mock is registered so mcp.ts picks up the mocked runtime.
let handleGetPortfolio: any
let handlePerpsPositions: any
let stopAgentCleanup: any

beforeAll(async () => {
	;({ handleGetPortfolio, handlePerpsPositions } = await import('../routes/mcp'))
	;({ stopAgentCleanup } = await import('../routes/agent'))
})

// agent.ts starts a background cleanup interval on import; stop it so the process exits.
afterAll(() => stopAgentCleanup?.())

const MANAGED = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
const OTHER = '0x0000000000000000000000000000000000000001'
// Two valid base58 Solana addresses (32-44 chars, no 0x). Agent managed wallets are
// Turnkey EVM-only, so neither can be "owned" — both must get the explicit unsupported
// error rather than the misleading ownership rejection.
const SOL_ADDR = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
const SOL_OTHER = '7EqQdEULxWcraVx3mXKFjc84LhCkMGZCkRuDpvcMwJeK'
const agentWith = (addr?: string) =>
	({ id: 1, metadata: addr ? { wallet_address: addr } : {} }) as any

describe('MCP get_portfolio ownership gate (IDOR fix — mirrors REST H9 control)', () => {
	it('rejects a wallet_address the authed agent does not own', async () => {
		const res = await handleGetPortfolio({ wallet_address: OTHER }, agentWith(MANAGED))
		expect(res.isError).toBe(true)
		expect(res.content[0].text).toContain('not your managed wallet')
	})

	it("allows the agent's own managed wallet", async () => {
		const res = await handleGetPortfolio({ wallet_address: MANAGED }, agentWith(MANAGED))
		expect(res.isError).toBeUndefined()
		expect(res.content[0].text).toContain('total_usd')
	})

	it('rejects when the agent has no managed wallet', async () => {
		const res = await handleGetPortfolio({ wallet_address: MANAGED }, agentWith(undefined))
		expect(res.isError).toBe(true)
	})

	// Solana support: agents have no Solana managed wallet, so a Solana address gets a
	// clear "unsupported" error — NOT the misleading "not your managed wallet" ownership
	// rejection. This distinguishes "we don't support this" from "you don't own this".
	it('returns a clear unsupported error for a Solana address (not an ownership error)', async () => {
		const res = await handleGetPortfolio({ wallet_address: SOL_ADDR }, agentWith(MANAGED))
		expect(res.isError).toBe(true)
		expect(res.content[0].text).toContain('Solana wallets are not supported')
		expect(res.content[0].text).not.toContain('not your managed wallet')
	})

	it('returns the unsupported error for a different Solana address too (no disclosure)', async () => {
		const res = await handleGetPortfolio({ wallet_address: SOL_OTHER }, agentWith(MANAGED))
		expect(res.isError).toBe(true)
		expect(res.content[0].text).toContain('Solana wallets are not supported')
	})

	it('returns the unsupported error when chain=solana even for an EVM-shaped address', async () => {
		const res = await handleGetPortfolio(
			{ wallet_address: MANAGED, chain: 'solana' },
			agentWith(MANAGED),
		)
		expect(res.isError).toBe(true)
		expect(res.content[0].text).toContain('Solana wallets are not supported')
	})
})

describe('MCP perps_positions ownership gate (IDOR fix)', () => {
	it('rejects an address the authed agent does not own', async () => {
		const res = await handlePerpsPositions({ address: OTHER }, agentWith(MANAGED))
		expect(res.isError).toBe(true)
		expect(res.content[0].text).toContain('not your managed wallet')
	})

	it("allows the agent's own managed wallet", async () => {
		const res = await handlePerpsPositions({ address: MANAGED }, agentWith(MANAGED))
		expect(res.isError).toBeUndefined()
	})

	it('returns a clear unsupported error for a Solana address (not an ownership error)', async () => {
		const res = await handlePerpsPositions({ address: SOL_ADDR }, agentWith(MANAGED))
		expect(res.isError).toBe(true)
		expect(res.content[0].text).toContain('Solana wallets are not supported')
		expect(res.content[0].text).not.toContain('not your managed wallet')
	})

	it('returns the unsupported error for a different Solana address too', async () => {
		const res = await handlePerpsPositions({ address: SOL_OTHER }, agentWith(MANAGED))
		expect(res.isError).toBe(true)
		expect(res.content[0].text).toContain('Solana wallets are not supported')
	})
})
