import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { Either } from 'effect'

// Exercises the ACTUAL handleExecuteSwap (mcp.ts) quote single-use consumption
// fix end-to-end: a successful unsigned-tx preparation must delete the cached
// quote (so a repeat execute_swap call 400s as "expired or not found"), while
// a failed preparation — or a gate block BEFORE preparation ever starts —
// must leave it untouched for a retry within its TTL. Also exercises the
// Solana cap-scoped pricing fix: an unpriceable Solana quote only 400-blocks
// when a USD cap is actually configured (queued via hasUsdDenominatedControl's Either).
//
// Same process-wide mock.module() caveat as swapExecuteRoute.test.ts: capture
// and restore the real '../runtime' module in afterAll so later test files in
// the same `bun test` run aren't left with these canned Either values.
const REAL_RUNTIME = { ...(await import('../runtime')) }

afterAll(() => {
	mock.module('../runtime', () => REAL_RUNTIME)
})

// Queue of canned runEffectEither results, consumed in call order. Each test
// pushes exactly the sequence its scenario needs (hasUsdDenominatedControl, then evaluate,
// then — Solana only — the Jupiter getSwapTransaction call), avoiding a
// fragile global call-counter that has to be kept in sync with the gate's
// internal call shape.
let queue: Array<Either.Either<unknown, unknown>> = []
mock.module('../runtime', () => ({
	runEffect: async () => ({}), // writeAuditLog fire-and-forget path — never queued/asserted here
	runEffectEither: async () => {
		const next = queue.shift()
		if (!next) throw new Error('runEffectEither called more times than this test queued for')
		return next
	},
	shutdownRuntime: async () => {},
}))

let handleExecuteSwap: any
let cacheAgentQuote: any
let getCachedQuote: any

beforeAll(async () => {
	;({ handleExecuteSwap } = await import('../routes/mcp'))
	;({ cacheAgentQuote, getCachedQuote } = await import('../lib/quoteCache'))
})

afterEach(() => {
	queue = []
})

const TEST_AGENT = { id: 777, uuid: 'test-agent-consume', organizationId: null } as any

function fakeContext(): any {
	return {
		json: (body: unknown, status?: number) => new Response(JSON.stringify(body), { status: status ?? 200 }),
	}
}

const SOLANA_QUOTE = {
	inputMint: 'mint-in',
	outputMint: 'mint-out',
	inAmount: '1',
	outAmount: '1',
	otherAmountThreshold: '1',
	priceImpactPct: '0',
	slippageBps: 50,
}

describe('handleExecuteSwap quote consumption (mcp.ts, MONEY-PATH)', () => {
	it('consumes the quote on a successful Solana unsigned-tx preparation', async () => {
		const quoteId = `sol-success-${Date.now()}`
		cacheAgentQuote(quoteId, SOLANA_QUOTE, TEST_AGENT.id, true)
		queue = [
			Either.right(false), // hasUsdDenominatedControl: no cap configured for this agent/org
			Either.right({ decision: 'allow' }), // PolicyService.evaluate
			Either.right({ swapTransaction: 'BASE64TX', lastValidBlockHeight: 123 }), // JupiterService.getSwapTransaction
		]

		const result = await handleExecuteSwap(
			{ quote_id: quoteId, wallet_address: 'WalletAddr111' },
			TEST_AGENT,
			fakeContext(),
		)

		expect(result.isError).toBeUndefined()
		expect(JSON.parse(result.content[0].text).status).toBe('ready')
		expect(getCachedQuote(quoteId)).toBeNull() // consumed
	})

	it('retains the quote when the Solana unsigned-tx preparation fails', async () => {
		const quoteId = `sol-fail-${Date.now()}`
		cacheAgentQuote(quoteId, SOLANA_QUOTE, TEST_AGENT.id, true)
		queue = [
			Either.right(false),
			Either.right({ decision: 'allow' }),
			Either.left(new Error('Jupiter transiently erroring')),
		]

		const result = await handleExecuteSwap(
			{ quote_id: quoteId, wallet_address: 'WalletAddr111' },
			TEST_AGENT,
			fakeContext(),
		)

		expect(result.isError).toBe(true)
		expect(getCachedQuote(quoteId)).not.toBeNull() // retained for retry
	})

	it('never prices (or 400-blocks) an unpriceable Solana quote when no USD cap is configured — and never consumes it either way when blocked', async () => {
		const quoteId = `sol-no-cap-unpriced-${Date.now()}`
		cacheAgentQuote(quoteId, SOLANA_QUOTE, TEST_AGENT.id, true)
		queue = [
			Either.right(false), // hasUsdDenominatedControl: no cap — pricing (and the possible 400) is skipped entirely
			Either.right({ decision: 'allow' }),
			Either.right({ swapTransaction: 'BASE64TX', lastValidBlockHeight: 123 }),
		]

		const result = await handleExecuteSwap(
			{ quote_id: quoteId, wallet_address: 'WalletAddr111' },
			TEST_AGENT,
			fakeContext(),
		)

		// Only 3 queued responses were needed (no extra call for pricing) and the
		// trade proceeds normally — proves the no-cap-configured case is
		// unaffected by the Solana pricing fix, matching pre-fix behavior.
		expect(result.isError).toBeUndefined()
		expect(getCachedQuote(quoteId)).toBeNull()
	})

	it('400-blocks and retains an unpriceable Solana quote when a USD cap IS configured', async () => {
		const quoteId = `sol-cap-unpriced-block-${Date.now()}`
		// inputMint isn't a real SOLANA_TOKENS registry address, so
		// solanaMintUsdValue resolves 'unknown_mint' without any network call.
		cacheAgentQuote(quoteId, { ...SOLANA_QUOTE, inputMint: 'not-a-registry-mint' }, TEST_AGENT.id, true)
		queue = [
			Either.right(true), // hasUsdDenominatedControl: a cap IS configured, so pricing is required
		]

		const result = await handleExecuteSwap(
			{ quote_id: quoteId, wallet_address: 'WalletAddr111' },
			TEST_AGENT,
			fakeContext(),
		)

		expect(result.isError).toBe(true)
		const body = JSON.parse(result.content[0].text)
		expect(body.status).toBe('block')
		expect(body.reason).toBe('unknown_mint')
		expect(getCachedQuote(quoteId)).not.toBeNull() // never consumed — blocked before preparation
	})

	it('consumes the quote on a successful EVM unsigned-tx preparation', async () => {
		const quoteId = `evm-success-${Date.now()}`
		cacheAgentQuote(
			quoteId,
			{
				fromChain: 1,
				toChain: 1,
				fromAmountUsd: '10.00',
				transactionRequest: { to: '0xrouter', value: '0x0', data: '0x', chainId: 1, gasLimit: '21000' },
			},
			TEST_AGENT.id,
			false,
		)
		queue = [Either.right({ decision: 'allow' })] // EVM branch: single evaluate() call, no hasUsdDenominatedControl

		const result = await handleExecuteSwap(
			{ quote_id: quoteId, wallet_address: '0xwallet' },
			TEST_AGENT,
			fakeContext(),
		)

		expect(result.isError).toBeUndefined()
		expect(getCachedQuote(quoteId)).toBeNull()
	})

	it('does not consume an EVM quote missing transactionRequest (guarded before the delete)', async () => {
		const quoteId = `evm-malformed-${Date.now()}`
		cacheAgentQuote(quoteId, { fromChain: 1, toChain: 1, fromAmountUsd: '10.00' }, TEST_AGENT.id, false)
		queue = [Either.right({ decision: 'allow' })]

		const result = await handleExecuteSwap(
			{ quote_id: quoteId, wallet_address: '0xwallet' },
			TEST_AGENT,
			fakeContext(),
		)

		expect(result.isError).toBe(true)
		expect(getCachedQuote(quoteId)).not.toBeNull()
	})
})
