import { describe, expect, test } from 'bun:test'
import { usdAmountFromQuote } from '../routes/swap'

// Guards the USD-amount computation in src/routes/swap.ts. The swap record
// stores `fromAmountUsd` as a real (USD currency) value. A prior implementation
// fell back to the token amount (in wei) when the USD amount was falsy, which
// stored a wei quantity in a USD column — a data-integrity bug. These tests
// import the real helper so reintroducing the wei fallback fails the suite.

describe('usdAmountFromQuote (swap.ts)', () => {
	test('valid USD parses correctly', () => {
		expect(usdAmountFromQuote({ fromAmountUsd: '3500.25' })).toBe(3500.25)
	})

	test('zero USD coerces to null via || (unchanged pre-existing behavior)', () => {
		expect(usdAmountFromQuote({ fromAmountUsd: '0.00' })).toBeNull()
	})

	test('empty USD string returns null', () => {
		expect(usdAmountFromQuote({ fromAmountUsd: '' })).toBeNull()
	})

	test('missing USD does NOT fall back to a wei token amount', () => {
		// With the old buggy expression `parseFloat(fromAmountUsd || fromAmount)`,
		// an empty USD field caused the wei amount to be parsed as USD (1e18).
		// The helper must never read fromAmount, so the result is null.
		const weiAmount = '1000000000000000000' // 1 token in wei, NOT a USD value
		expect(usdAmountFromQuote({ fromAmountUsd: '' })).toBeNull()
		expect(usdAmountFromQuote({ fromAmountUsd: '' })).not.toBe(parseFloat(weiAmount))
	})

	test('integration: SwapQuote-shaped object with falsy USD stores null, not wei', () => {
		const quote = {
			fromAmount: '1000000000000000000', // wei
			fromAmountUsd: '', // unavailable from provider
		}
		const stored = usdAmountFromQuote(quote)
		expect(stored).toBeNull()
		expect(stored).not.toBe(parseFloat(quote.fromAmount))
	})

	test('integration: SwapQuote-shaped object with valid USD stores the USD value', () => {
		const quote = {
			fromAmount: '1000000000000000000',
			fromAmountUsd: '3500.25',
		}
		expect(usdAmountFromQuote(quote)).toBe(3500.25)
	})
})
