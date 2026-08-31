import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { Either } from 'effect'

// MONEY-PATH: MCP_READ_ONLY kill switch (docs/plans/oss-parity.md Phase 4 item 1).
//
// Proves the fix is enforced at BOTH layers — tools/list AND tools/call dispatch —
// not just one. GitHub's read-only MCP server flag (issue #2156) shipped broken
// because it only filtered tools/list: a client with a cached catalogue, a
// hardcoded tool name, or hand-rolled JSON-RPC could still dispatch a mutating
// tool. This suite drives the actual mcpRoutes HTTP handler (not just the pure
// helpers) so the real switch/dispatch code path is what's under test.
//
// Same mock.module() pattern as swapExecuteRoute.test.ts / mcpPortfolioOwnership.test.ts:
// bypass DB-backed bearer auth and pay-per-call metering so the route can be driven
// through `mcpRoutes.request()` without a live database, while the read-only gate
// itself (real, unmocked mcp.ts code) is what's exercised.
//
// mock.module() mutates the PROCESS-WIDE module registry and is NOT undone when this
// file finishes — restore the real implementations in afterAll (same discipline as
// every other file using this pattern) so later test files aren't left with these stubs.
const REAL_MODULES = {
	'../middleware/auth': { ...(await import('../middleware/auth')) },
	'../middleware/x402Payment': { ...(await import('../middleware/x402Payment')) },
	'../runtime': { ...(await import('../runtime')) },
}

afterAll(() => {
	mock.module('../middleware/auth', () => REAL_MODULES['../middleware/auth'])
	mock.module('../middleware/x402Payment', () => REAL_MODULES['../middleware/x402Payment'])
	mock.module('../runtime', () => REAL_MODULES['../runtime'])
})

const TEST_AGENT = {
	id: 9001,
	uuid: 'test-agent-readonly',
	rateLimitTier: 'free',
	organizationId: null,
	metadata: {},
} as any

// Bypass DB-backed bearer auth: any Bearer-authed request in this suite authenticates
// as TEST_AGENT (matches swapExecuteRoute.test.ts's mocking of the same module).
mock.module('../middleware/auth', () => ({
	agentBearerAuth: () => async (c: any, next: any) => {
		c.set('agent', TEST_AGENT)
		return next()
	},
	agentBearerAuthAllowInactive: () => async (c: any, next: any) => next(),
	adminKeyAuth: () => async (c: any, next: any) => next(),
}))

// Spy on chargeAgentForCall so tests can assert metering was (or wasn't) reached —
// the core claim under test is "refused BEFORE metering, so never billed".
let chargeCallCount = 0
mock.module('../middleware/x402Payment', () => ({
	meteredPayment: () => async (c: any, next: any) => next(),
	chargeAgentForCall: async () => {
		chargeCallCount++
		return { kind: 'skip', reason: 'bypass', tier: 'free' }
	},
	setX402Headers: () => {},
	costForTool: () => 0,
	costForEndpoint: () => 0,
	refundChargedCall: async () => {},
	COST_WEIGHTS: {},
	CREDIT_USD_VALUE: 1,
	BYPASS_TIERS: new Set(['free']),
}))

// Only the "Track" incrementAgentStats() call needs a runtime stub — every scenario
// below either short-circuits before any further runEffectEither call (execute_swap
// with a nonexistent quote_id fails on the cache lookup alone) or never authenticates
// an agent at all (list_chains is a PUBLIC_READ_TOOL, so Track is skipped entirely).
mock.module('../runtime', () => ({
	runEffect: async () => ({}),
	runEffectEither: async () => Either.right(undefined),
	shutdownRuntime: async () => {},
}))

let mcpRoutes: any
let stopAgentCleanup: any

beforeAll(async () => {
	;({ mcpRoutes } = await import('../routes/mcp'))
	;({ stopAgentCleanup } = await import('../routes/agent'))
})

afterAll(() => stopAgentCleanup?.())

const AUTH_HEADERS = {
	'Content-Type': 'application/json',
	Authorization: 'Bearer suwappu_sk_test_key_00000000000000000000',
}

const ORIGINAL_MCP_READ_ONLY = process.env.MCP_READ_ONLY

afterEach(() => {
	if (ORIGINAL_MCP_READ_ONLY === undefined) delete process.env.MCP_READ_ONLY
	else process.env.MCP_READ_ONLY = ORIGINAL_MCP_READ_ONLY
	chargeCallCount = 0
})

async function toolsList(): Promise<Array<{ name: string }>> {
	const res = await mcpRoutes.request('/', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ jsonrpc: '2.0', id: 'list', method: 'tools/list', params: {} }),
	})
	const body = (await res.json()) as { result: { tools: Array<{ name: string }> } }
	return body.result.tools
}

async function callTool(name: string, args: Record<string, unknown> = {}) {
	const res = await mcpRoutes.request('/', {
		method: 'POST',
		headers: AUTH_HEADERS,
		body: JSON.stringify({ jsonrpc: '2.0', id: 'call', method: 'tools/call', params: { name, arguments: args } }),
	})
	return { status: res.status, body: (await res.json()) as any }
}

describe('MCP_READ_ONLY kill switch (MONEY-PATH — enforced at both tools/list and dispatch)', () => {
	it('default (flag absent): execute_swap is advertised and dispatch is unaffected — byte-identical to prior behavior', async () => {
		delete process.env.MCP_READ_ONLY
		const names = (await toolsList()).map((t) => t.name)
		expect(names).toContain('execute_swap')

		const { body } = await callTool('execute_swap', {
			quote_id: 'nonexistent-quote',
			wallet_address: '0xabc',
		})
		// Reaches the REAL handler (not the new read-only refusal) — a nonexistent
		// quote_id 400s with the pre-existing message, proving the gate never fired.
		expect(body.result.isError).toBe(true)
		expect(body.result.content[0].text).toContain('Quote expired or not found')
		expect(body.result.content[0].text).not.toContain('read-only mode')
		expect(chargeCallCount).toBe(1) // metering WAS reached — unaffected by the flag
	})

	it('flag=false explicitly: same unaffected behavior as unset', async () => {
		process.env.MCP_READ_ONLY = 'false'
		const names = (await toolsList()).map((t) => t.name)
		expect(names).toContain('execute_swap')

		const { body } = await callTool('execute_swap', {
			quote_id: 'nonexistent-quote',
			wallet_address: '0xabc',
		})
		expect(body.result.content[0].text).toContain('Quote expired or not found')
		expect(chargeCallCount).toBe(1)
	})

	it('flag=true: tools/list strips execute_swap (non-read-only) while keeping read-only tools', async () => {
		process.env.MCP_READ_ONLY = 'true'
		const names = (await toolsList()).map((t) => t.name)
		expect(names).not.toContain('execute_swap')
		expect(names).toContain('get_quote')
		expect(names).toContain('get_portfolio')
		expect(names).toContain('simulate_swap')
		expect(names.length).toBeGreaterThan(0)
	})

	it('flag=true: dispatch refuses execute_swap BEFORE metering — no charge', async () => {
		process.env.MCP_READ_ONLY = 'true'
		const { body } = await callTool('execute_swap', {
			quote_id: 'nonexistent-quote',
			wallet_address: '0xabc',
		})
		expect(body.result).toBeUndefined()
		expect(body.error).toBeDefined()
		expect(body.error.message).toContain('read-only mode')
		expect(body.error.data.error_code).toBe('POLICY_VIOLATION')
		expect(chargeCallCount).toBe(0) // never billed — refused before chargeAgentForCall
	})

	it('flag=true: a read-only tool (list_chains) still dispatches normally', async () => {
		process.env.MCP_READ_ONLY = 'true'
		const { body } = await callTool('list_chains', {})
		expect(body.error).toBeUndefined()
		expect(body.result.isError).toBeUndefined()
		expect(chargeCallCount).toBe(1)
	})
})

describe('mcp tool annotation coverage (Phase 4 item 2 — fail-closed classification needs full coverage)', () => {
	it('every TOOLS entry has a TOOL_ANNOTATIONS entry with a boolean readOnlyHint', async () => {
		const { TOOLS, TOOL_ANNOTATIONS } = await import('../routes/mcpTools')
		expect(TOOLS.length).toBeGreaterThan(0)
		for (const tool of TOOLS) {
			expect(TOOL_ANNOTATIONS[tool.name], `missing annotations for ${tool.name}`).toBeDefined()
			expect(typeof TOOL_ANNOTATIONS[tool.name]!.readOnlyHint).toBe('boolean')
		}
	})

	it('execute_swap is the only tool classified as non-read-only', async () => {
		const { TOOLS, TOOL_ANNOTATIONS } = await import('../routes/mcpTools')
		const nonReadOnly = TOOLS.filter((t) => TOOL_ANNOTATIONS[t.name]?.readOnlyHint !== true).map((t) => t.name)
		expect(nonReadOnly).toEqual(['execute_swap'])
	})
})
