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
})
