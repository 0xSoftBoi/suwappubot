import { describe, expect, it } from 'bun:test'
import {
	SPEND_PERMISSION_MANAGER_BASE,
	type SpendPermission,
	buildSpendPermissionTypedData,
	validateSpendPermission,
} from '../lib/spendPermission'

const OPERATOR = '0x1111111111111111111111111111111111111111' as const
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const

function perm(over: Partial<SpendPermission> = {}): SpendPermission {
	return {
		account: '0xAccount000000000000000000000000000000abcd',
		spender: OPERATOR,
		token: USDC,
		allowance: 9_990_000n, // $9.99 in 6dp USDC
		period: 2_592_000, // 30 days
		start: 1_900_000_000,
		end: 2_000_000_000,
		salt: 42n,
		extraData: '0x',
		...over,
	}
}

describe('SpendPermission EIP-712 typed data', () => {
	it('uses the SpendPermissionManager domain + Base verifying contract', () => {
		const td = buildSpendPermissionTypedData(perm(), 8453)
		expect(td.domain.name).toBe('Spend Permission Manager')
		expect(td.domain.version).toBe('1')
		expect(td.domain.chainId).toBe(8453)
		expect(td.domain.verifyingContract).toBe(SPEND_PERMISSION_MANAGER_BASE)
		expect(td.primaryType).toBe('SpendPermission')
	})

	it('declares the 9 struct fields in consensus order with correct types', () => {
		const td = buildSpendPermissionTypedData(perm(), 8453)
		const names = td.types.SpendPermission.map((f) => f.name)
		expect(names).toEqual([
			'account',
			'spender',
			'token',
			'allowance',
			'period',
			'start',
			'end',
			'salt',
			'extraData',
		])
		const byName = Object.fromEntries(td.types.SpendPermission.map((f) => [f.name, f.type]))
		expect(byName.allowance).toBe('uint160')
		expect(byName.period).toBe('uint48')
		expect(byName.salt).toBe('uint256')
		expect(byName.extraData).toBe('bytes')
	})
})

describe('validateSpendPermission (server-side security gate)', () => {
	const expected = { spender: OPERATOR, token: USDC, nowSec: 1_900_000_001, maxAllowance: 99_900_000n }

	it('accepts a well-formed permission to our operator for USDC', () => {
		expect(validateSpendPermission(perm(), expected)).toEqual({ ok: true })
	})

	it('rejects a permission whose spender is not our operator', () => {
		const r = validateSpendPermission(perm({ spender: '0xdead000000000000000000000000000000000000' }), expected)
		expect(r).toEqual({ ok: false, error: 'spender_mismatch' })
	})

	it('rejects a non-USDC token', () => {
		const r = validateSpendPermission(perm({ token: '0xbad0000000000000000000000000000000000000' }), expected)
		expect(r).toEqual({ ok: false, error: 'token_mismatch' })
	})

	it('rejects zero or over-cap allowance', () => {
		expect(validateSpendPermission(perm({ allowance: 0n }), expected).ok).toBe(false)
		expect(validateSpendPermission(perm({ allowance: 100_000_000n }), expected)).toEqual({
			ok: false,
			error: 'allowance_out_of_bounds',
		})
	})

	it('rejects a non-positive period', () => {
		expect(validateSpendPermission(perm({ period: 0 }), expected)).toEqual({
			ok: false,
			error: 'invalid_period',
		})
	})

	it('rejects an already-expired permission', () => {
		const r = validateSpendPermission(perm({ end: 1_000 }), expected)
		expect(r).toEqual({ ok: false, error: 'already_expired' })
	})

	it('rejects start after end', () => {
		const r = validateSpendPermission(perm({ start: 2_100_000_000 }), expected)
		expect(r).toEqual({ ok: false, error: 'start_after_end' })
	})
})
