/**
 * Coinbase / Base Spend Permissions — typed data + contract ABI.
 *
 * True crypto-native recurring billing: a user signs an EIP-712 SpendPermission
 * authorizing our operator (the `spender`) to pull up to `allowance` of `token`
 * from their Base smart account once per `period`. The operator registers it
 * on-chain via `approveWithSignature` and then calls `spend()` each period — no
 * re-signing by the user. This is the auto-renew primitive x402 itself lacks.
 *
 * Refs: github.com/coinbase/spend-permissions ; SpendPermissionManager on Base
 * mainnet = 0xf85210B21cC50302F477BA56686d2019dC9b67Ad.
 */

import type { Address, Hex } from 'viem'

/** Canonical SpendPermissionManager deployment on Base mainnet. */
export const SPEND_PERMISSION_MANAGER_BASE = '0xf85210B21cC50302F477BA56686d2019dC9b67Ad' as const

/** The on-chain SpendPermission struct (field order is consensus-critical). */
export type SpendPermission = {
	account: Address // smart account holding the funds (the subscriber)
	spender: Address // our operator address authorized to pull
	token: Address // ERC-20 (USDC) or native sentinel
	allowance: bigint // uint160 — max per period (atomic units)
	period: number // uint48 — seconds per cycle (fits in a JS number)
	start: number // uint48 — unix seconds
	end: number // uint48 — unix seconds
	salt: bigint // uint256 — disambiguates identical permissions
	extraData: Hex // bytes — '0x' unless used
}

/** EIP-712 type definition for SpendPermission (matches the manager contract). */
export const SPEND_PERMISSION_TYPES = {
	SpendPermission: [
		{ name: 'account', type: 'address' },
		{ name: 'spender', type: 'address' },
		{ name: 'token', type: 'address' },
		{ name: 'allowance', type: 'uint160' },
		{ name: 'period', type: 'uint48' },
		{ name: 'start', type: 'uint48' },
		{ name: 'end', type: 'uint48' },
		{ name: 'salt', type: 'uint256' },
		{ name: 'extraData', type: 'bytes' },
	],
} as const

/**
 * Build the EIP-712 typed-data object the user signs (and the server verifies).
 * Domain matches SpendPermissionManager: name "Spend Permission Manager", v1.
 */
export function buildSpendPermissionTypedData(
	permission: SpendPermission,
	chainId: number,
	verifyingContract: Address = SPEND_PERMISSION_MANAGER_BASE,
) {
	return {
		domain: { name: 'Spend Permission Manager', version: '1', chainId, verifyingContract },
		types: SPEND_PERMISSION_TYPES,
		primaryType: 'SpendPermission' as const,
		message: permission,
	}
}

/** Minimal ABI for the operator's on-chain calls (register + charge). */
const SPEND_PERMISSION_STRUCT = {
	type: 'tuple',
	components: [
		{ name: 'account', type: 'address' },
		{ name: 'spender', type: 'address' },
		{ name: 'token', type: 'address' },
		{ name: 'allowance', type: 'uint160' },
		{ name: 'period', type: 'uint48' },
		{ name: 'start', type: 'uint48' },
		{ name: 'end', type: 'uint48' },
		{ name: 'salt', type: 'uint256' },
		{ name: 'extraData', type: 'bytes' },
	],
} as const

export const SPEND_PERMISSION_MANAGER_ABI = [
	{
		type: 'function',
		name: 'approveWithSignature',
		stateMutability: 'nonpayable',
		inputs: [
			{ ...SPEND_PERMISSION_STRUCT, name: 'spendPermission' },
			{ name: 'signature', type: 'bytes' },
		],
		outputs: [],
	},
	{
		type: 'function',
		name: 'spend',
		stateMutability: 'nonpayable',
		inputs: [
			{ ...SPEND_PERMISSION_STRUCT, name: 'spendPermission' },
			{ name: 'value', type: 'uint160' },
		],
		outputs: [],
	},
] as const

/**
 * Validate a permission's security-critical fields against what we require
 * before storing/charging it. Pure + unit-testable.
 *  - spender MUST be our operator (else we couldn't call spend()).
 *  - token MUST be the expected asset (USDC).
 *  - allowance/period MUST be positive and within sane bounds.
 *  - end MUST be in the future (or 0 meaning open-ended is rejected — we want a bound).
 */
export function validateSpendPermission(
	p: SpendPermission,
	expected: { spender: Address; token: Address; nowSec: number; maxAllowance: bigint },
): { ok: true } | { ok: false; error: string } {
	if (p.spender.toLowerCase() !== expected.spender.toLowerCase()) {
		return { ok: false, error: 'spender_mismatch' }
	}
	if (p.token.toLowerCase() !== expected.token.toLowerCase()) {
		return { ok: false, error: 'token_mismatch' }
	}
	if (p.allowance <= 0n || p.allowance > expected.maxAllowance) {
		return { ok: false, error: 'allowance_out_of_bounds' }
	}
	if (p.period <= 0) return { ok: false, error: 'invalid_period' }
	if (p.end <= expected.nowSec) return { ok: false, error: 'already_expired' }
	if (p.start > p.end) return { ok: false, error: 'start_after_end' }
	return { ok: true }
}
