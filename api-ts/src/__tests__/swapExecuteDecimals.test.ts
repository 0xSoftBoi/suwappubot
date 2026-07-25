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

	// MONEY-PATH regression: mcp.ts's Tempo branch used to cache a quote with NO
	// fromDecimals/toDecimals (COMMON_TOKENS[4217] was address-only, and the Python
	// tempo/quote dict has no decimals field), which made /swap/execute reject every
	// Tempo swap with 422. TEMPO_TOKEN_DECIMALS (TokenService) now supplies the
	// authoritative decimals (18, per bot/config/tokens.py) at quote-cache time.
	it('resolves for a Tempo (pathUSD -> AlphaUSD) quote once TEMPO_TOKEN_DECIMALS is used at cache time', () => {
		expect(Object.keys(COMMON_TOKENS[4217] || {})).toEqual(
			expect.arrayContaining(['pathUSD', 'AlphaUSD', 'BetaUSD', 'ThetaUSD']),
		)
		const cached = {
			quote: { amount_out: '999500000000000000000' },
			isSolana: false,
			fromDecimals: TEMPO_TOKEN_DECIMALS.pathUSD,
			toDecimals: TEMPO_TOKEN_DECIMALS.AlphaUSD,
		}
		const { fromDecimals, toDecimals } = resolveSwapExecuteDecimals(cached)
		expect(fromDecimals).toBe(18)
		expect(toDecimals).toBe(18)
		// Would NOT hit the 422 QUOTE_NOT_FOUND branch in /swap/execute, which only
		// fires when fromDecimals is undefined.
		expect(fromDecimals).not.toBeUndefined()
	})
})
