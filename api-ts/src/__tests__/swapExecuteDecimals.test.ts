import { afterAll, describe, expect, it } from 'bun:test'
import { resolveSwapExecuteDecimals, stopAgentCleanup } from '../routes/agent'
import { TEMPO_TOKEN_DECIMALS, COMMON_TOKENS } from '../services'

// Importing agent.ts starts a background cache-cleanup interval; stop it so the
// test process exits cleanly (same pattern as agentWalletOwnership.test.ts).
afterAll(() => stopAgentCleanup())

describe('resolveSwapExecuteDecimals (MONEY-PATH: quote_data.from_amount_human)', () => {
	it('uses cached decimals for a 6-decimal token (USDC) — the original bug case', () => {
		// 1000 USDC quoted in, at 6 decimals: raw amount is 1_000_000_000 (1e9 base units).
		const cached = {
			quote: { fromAmount: '1000000000', fromToken: {}, toToken: {} },
			isSolana: false,
			fromDecimals: 6,
			toDecimals: 6,
		}
		const { fromDecimals, toDecimals } = resolveSwapExecuteDecimals(cached)
		expect(fromDecimals).toBe(6)
		expect(toDecimals).toBe(6)
		const fromAmountHuman = parseFloat(cached.quote.fromAmount) / 10 ** (fromDecimals as number)
		// The old hardcoded `/ 1e18` would have produced 1e-9 instead of 1000 —
		// exactly the bug that let an insufficient-balance swap through.
		expect(fromAmountHuman).toBe(1000)
	})

	it('still resolves correctly for an 18-decimal token (e.g. ETH/DAI) via cached decimals', () => {
		const cached = {
			quote: { fromAmount: '500000000000000000', fromToken: {}, toToken: {} },
			isSolana: false,
			fromDecimals: 18,
			toDecimals: 18,
		}
		const { fromDecimals } = resolveSwapExecuteDecimals(cached)
		const fromAmountHuman = parseFloat(cached.quote.fromAmount) / 10 ** (fromDecimals as number)
		expect(fromAmountHuman).toBe(0.5)
	})

	it('falls back to decimals carried on the raw Li.Fi quote when the cache has none', () => {
		const cached = {
			quote: {
				fromAmount: '1000000',
				fromToken: { decimals: 6 },
				toToken: { decimals: 18 },
			},
			isSolana: false,
			// fromDecimals/toDecimals intentionally omitted — simulates an older
			// cache entry written before this fix shipped.
		}
		const { fromDecimals, toDecimals } = resolveSwapExecuteDecimals(cached)
		expect(fromDecimals).toBe(6)
		expect(toDecimals).toBe(18)
	})

	it('is unresolvable for a Solana quote with no cached decimals — must be rejected, not guessed', () => {
		// Jupiter's raw quote only ever carries mint addresses, never decimals,
		// so the raw-quote fallback can never save this case.
		const cached = {
			quote: { inAmount: '1000000000', inputMint: 'So111...', outputMint: 'EPjF...' },
			isSolana: true,
			// no fromDecimals/toDecimals cached
		}
		const { fromDecimals } = resolveSwapExecuteDecimals(cached)
		expect(fromDecimals).toBeUndefined()
		// The route handler must turn this into a 422 QUOTE_NOT_FOUND rather than
		// falling back to a guessed constant (e.g. 1e9) — verified structurally
		// here since resolveSwapExecuteDecimals is the single source of truth the
		// route branches on.
	})

	it('is unresolvable for an EVM quote missing both cached and raw decimals', () => {
		const cached = {
			quote: { fromAmount: '1000000', fromToken: {}, toToken: {} },
			isSolana: false,
		}
		const { fromDecimals } = resolveSwapExecuteDecimals(cached)
		expect(fromDecimals).toBeUndefined()
	})

	// TEMPO_TOKEN_DECIMALS carries the on-chain 6dp for Tempo TIP-20 pathUSD
	// (decimals() on chain 4217). It previously said 18 — a 10^12 scaling error.
	// NOTE: mcp.ts deliberately does NOT pass these at quote-cache time, so Tempo
	// quotes still 422 at /swap/execute (no Python tempo quote_data branch). This
	// asserts the decimals VALUE is right and would resolve, not that the Tempo path
	// is currently executable.
	it('supplies the on-chain 6dp for Tempo pathUSD when provided at cache time', () => {
		expect(Object.keys(COMMON_TOKENS[4217] || {})).toEqual(['pathUSD'])
		const cached = {
			quote: { amount_out: '999500' },
			isSolana: false,
			fromDecimals: TEMPO_TOKEN_DECIMALS.pathUSD,
			toDecimals: TEMPO_TOKEN_DECIMALS.pathUSD,
		}
		const { fromDecimals, toDecimals } = resolveSwapExecuteDecimals(cached)
		expect(fromDecimals).toBe(6)
		expect(toDecimals).toBe(6)
		// Resolvable, so IF the Tempo cache site ever populates these (see note above,
		// blocked on the Python endpoint + a tempo quote_data branch), it would clear
		// the 422 gate, which only fires when fromDecimals is undefined.
		expect(fromDecimals).not.toBeUndefined()
	})
})
