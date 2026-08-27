import { describe, expect, it } from 'bun:test'
import { fromBaseUnits, toBaseUnits } from '../routes/publicSwap'

/**
 * MONEY-PATH: Li.Fi prices in base units, and the public preview endpoint takes
 * amounts the way a person says them. Every quote the Agent Desk shows passes
 * through this conversion, so a rounding slip here misprices what a human is
 * asked to approve.
 *
 * This exists because production caught it the honest way: the endpoint shipped
 * passing "0.05" straight to Li.Fi, which rejected it as not big-number-ish.
 */
describe('toBaseUnits', () => {
	it('converts whole and fractional amounts at 18 decimals', () => {
		expect(toBaseUnits('1', 18)).toBe('1000000000000000000')
		expect(toBaseUnits('0.05', 18)).toBe('50000000000000000')
		expect(toBaseUnits('.5', 18)).toBe('500000000000000000')
	})

	it('honours per-token decimals rather than assuming 18', () => {
		// USDC is 6 on Base. Assuming 18 would overstate the trade by 10^12.
		expect(toBaseUnits('1000', 6)).toBe('1000000000')
		expect(toBaseUnits('1.5', 6)).toBe('1500000')
		expect(toBaseUnits('0.000001', 6)).toBe('1')
	})

	it('stays exact where float math would not', () => {
		// 0.1 is not representable in binary floating point; integer string math is.
		expect(toBaseUnits('0.1', 18)).toBe('100000000000000000')
		expect(toBaseUnits('123.456789', 6)).toBe('123456789')
	})

	it('refuses to silently truncate precision the caller asked for', () => {
		expect(() => toBaseUnits('0.0000001', 6)).toThrow(/more than 6 decimal places/)
	})

	it('rejects anything that is not a plain decimal amount', () => {
		expect(() => toBaseUnits('abc', 18)).toThrow(/Invalid amount/)
		expect(() => toBaseUnits('1.2.3', 18)).toThrow(/Invalid amount/)
		expect(() => toBaseUnits('-1', 18)).toThrow(/Invalid amount/)
	})
})

describe('fromBaseUnits', () => {
	it('renders base units the way a person would write them', () => {
		// The live bug: 122966842 USDC (6dp) is 122.966842, not 122 million.
		expect(fromBaseUnits('122966842', 6)).toBe('122.966842')
		expect(fromBaseUnits('50000000000000000', 18)).toBe('0.05')
		expect(fromBaseUnits('1000000000000000000', 18)).toBe('1')
	})

	it('trims trailing zeros but keeps significant ones', () => {
		expect(fromBaseUnits('1500000', 6)).toBe('1.5')
		expect(fromBaseUnits('1000000', 6)).toBe('1')
		expect(fromBaseUnits('1', 6)).toBe('0.000001')
		expect(fromBaseUnits('100', 6)).toBe('0.0001')
	})

	it('round-trips with toBaseUnits', () => {
		for (const [amount, decimals] of [
			['0.05', 18],
			['1000', 6],
			['123.456789', 6],
			['0.000001', 6],
		] as const) {
			expect(fromBaseUnits(toBaseUnits(amount, decimals), decimals)).toBe(
				// toBaseUnits keeps ".5" as written; fromBaseUnits normalises to "0.5"
				amount.startsWith('.') ? `0${amount}` : String(Number(amount)),
			)
		}
	})

	it('passes through anything that is not integer base units', () => {
		expect(fromBaseUnits('not-a-number', 6)).toBe('not-a-number')
		expect(fromBaseUnits('12', 0)).toBe('12')
	})
})
