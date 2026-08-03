import { describe, expect, test } from 'bun:test'
import { CREDIT_PACKS, getCreditPack } from '../config/constants'

/**
 * Guards the denomination of prepaid API credit packs.
 *
 * `api_credits.balance` is USD — the python x402 path
 * (bot/services/x402_service.py `_add_api_credits`) credits `payment.amount`,
 * a USD figure, into the same column, and `use_credits` debits USD. An earlier
 * draft of the Stripe top-up expressed packs in 0.001-credit units (the
 * `agent_credits` denomination), which would have granted 1000x the intended
 * balance. These tests exist to keep the two stacks in agreement.
 */
describe('CREDIT_PACKS denomination', () => {
	test('pack ids are unique', () => {
		const ids = CREDIT_PACKS.map((p) => p.id)
		expect(new Set(ids).size).toBe(ids.length)
	})

	test('every pack is USD-scaled, not credit-unit-scaled', () => {
		for (const pack of CREDIT_PACKS) {
			expect(pack.chargeUsd).toBeGreaterThan(0)
			// A USD balance is never more than a small multiple of the charge.
			// A 1000x unit mix-up trips this immediately.
			expect(pack.balanceUsd).toBeGreaterThanOrEqual(pack.chargeUsd)
			expect(pack.balanceUsd).toBeLessThanOrEqual(pack.chargeUsd * 2)
		}
	})

	test('bonusPct matches the charge-to-balance ratio', () => {
		for (const pack of CREDIT_PACKS) {
			const actualBonus = ((pack.balanceUsd - pack.chargeUsd) / pack.chargeUsd) * 100
			expect(actualBonus).toBeCloseTo(pack.bonusPct, 6)
		}
	})

	test('getCreditPack resolves known ids and rejects unknown ones', () => {
		for (const pack of CREDIT_PACKS) {
			expect(getCreditPack(pack.id)).toEqual(pack)
		}
		// Client-supplied pack ids must never fall through to a default.
		expect(getCreditPack('does-not-exist')).toBeNull()
		expect(getCreditPack('')).toBeNull()
		expect(getCreditPack('__proto__')).toBeNull()
	})
})
