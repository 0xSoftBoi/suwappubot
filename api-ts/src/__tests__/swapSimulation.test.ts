/**
 * Shape/unit tests for POST /v1/agent/swap/simulate support code.
 *
 * Covers:
 * - SimulateSwapSchema validation (quote_id OR from/to/amount required; EVM OR
 *   Solana wallet_address)
 * - computeWouldExecute / checkSlippageSane / isNativeEvmToken / resolveSolanaMint
 *   graceful-degradation helpers from lib/swapSimulation.ts
 * - The unverified-vs-skipped distinction on balance_sufficient/gas_affordable:
 *   a check that could not actually run (no wallet_address) must not let
 *   would_execute report true.
 *
 * Does NOT hit real RPC endpoints. runEvmChecks/runSolanaChecks are exercised
 * here ONLY via their no-wallet_address early-return path, which resolves
 * synchronously without any network I/O (see lib/swapSimulation.ts — every
 * check function checks for a missing fromAddress before touching the
 * network). Full RPC-backed checks are exercised indirectly via other routes'
 * integration tests.
 */

import { describe, expect, it } from 'bun:test'

import {
	checkSlippageSane,
	computeWouldExecute,
	evmOnlyCheck,
	isNativeEvmToken,
	resolveSolanaMint,
	runEvmChecks,
	runSolanaChecks,
	type SimulationCheck,
} from '../lib/swapSimulation'
import { SimulateSwapSchema } from '../routes/validators'

// ---------------------------------------------------------------------------
// SimulateSwapSchema
// ---------------------------------------------------------------------------

describe('SimulateSwapSchema', () => {
	it('accepts a quote_id-only request', () => {
		const result = SimulateSwapSchema.safeParse({ quote_id: 'lifi_0x8453_abc' })
		expect(result.success).toBe(true)
	})

	it('accepts a full from_token/to_token/amount request', () => {
		const result = SimulateSwapSchema.safeParse({
			from_token: 'ETH',
			to_token: 'USDC',
			amount: '0.5',
			chain: 'base',
			wallet_address: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
		})
		expect(result.success).toBe(true)
	})

	it('rejects a request with neither quote_id nor from/to/amount', () => {
		const result = SimulateSwapSchema.safeParse({ chain: 'base' })
		expect(result.success).toBe(false)
	})

	it('rejects a partial from/to/amount request missing amount', () => {
		const result = SimulateSwapSchema.safeParse({ from_token: 'ETH', to_token: 'USDC' })
		expect(result.success).toBe(false)
	})

	it('rejects the zero address for wallet_address', () => {
		const result = SimulateSwapSchema.safeParse({
			quote_id: 'lifi_0x8453_abc',
			wallet_address: '0x0000000000000000000000000000000000000000',
		})
		expect(result.success).toBe(false)
	})

	it('accepts a base58 Solana wallet_address', () => {
		const result = SimulateSwapSchema.safeParse({
			quote_id: 'jupiter_abc',
			wallet_address: 'DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK',
		})
		expect(result.success).toBe(true)
	})

	it('rejects a malformed wallet_address that is neither EVM nor Solana shaped', () => {
		const result = SimulateSwapSchema.safeParse({
			quote_id: 'lifi_0x8453_abc',
			wallet_address: 'not-a-wallet-address',
		})
		expect(result.success).toBe(false)
	})
})

// ---------------------------------------------------------------------------
// isNativeEvmToken
// ---------------------------------------------------------------------------

describe('isNativeEvmToken', () => {
	it('treats the zero address as native', () => {
		expect(isNativeEvmToken('0x0000000000000000000000000000000000000000')).toBe(true)
	})
	it('treats the 0xeee... sentinel as native', () => {
		expect(isNativeEvmToken('0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE')).toBe(true)
	})
	it('treats a real ERC-20 address as non-native', () => {
		expect(isNativeEvmToken('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913')).toBe(false)
	})
	it('treats undefined as native (defensive default)', () => {
		expect(isNativeEvmToken(undefined)).toBe(true)
	})
})

// ---------------------------------------------------------------------------
// resolveSolanaMint
// ---------------------------------------------------------------------------

describe('resolveSolanaMint', () => {
	it('resolves a known SOL mint to its symbol/decimals', () => {
		const info = resolveSolanaMint('So11111111111111111111111111111111111111112')
		expect(info?.symbol).toBe('SOL')
		expect(info?.decimals).toBe(9)
	})
	it('returns null for an unknown mint', () => {
		expect(resolveSolanaMint('unknownMintAddress1111111111111111111111')).toBeNull()
	})
})

// ---------------------------------------------------------------------------
// checkSlippageSane — never throws, warns above thresholds
// ---------------------------------------------------------------------------

describe('checkSlippageSane', () => {
	it('passes for low price impact and small min-output deviation', () => {
		const check = checkSlippageSane(0.5, '1000', '970')
		expect(check.status).toBe('pass')
	})

	it('warns when price impact exceeds 5%', () => {
		const check = checkSlippageSane(7.2, '1000', '970')
		expect(check.status).toBe('warn')
		expect(check.detail).toContain('5%')
	})

	it('warns when min output deviates far below expected output', () => {
		const check = checkSlippageSane(0.1, '1000', '700')
		expect(check.status).toBe('warn')
		expect(check.detail).toContain('below expected output')
	})

	it('degrades to warn/unavailable when price impact is not reported (never throws)', () => {
		const check = checkSlippageSane(null, '1000', '970')
		expect(check.status).toBe('warn')
		expect(check.detail).toContain('unavailable')
	})
})

// ---------------------------------------------------------------------------
// evmOnlyCheck — Solana N/A marker for EVM-only checks
// ---------------------------------------------------------------------------

describe('evmOnlyCheck', () => {
	it('marks an EVM-only check as warn/not-applicable', () => {
		const check = evmOnlyCheck('allowance_sufficient')
		expect(check.name).toBe('allowance_sufficient')
		expect(check.status).toBe('warn')
		expect(check.detail).toContain('not applicable')
	})
})

// ---------------------------------------------------------------------------
// computeWouldExecute
// ---------------------------------------------------------------------------

describe('computeWouldExecute', () => {
	it('is true when every check passes (including balance_sufficient/gas_affordable verified)', () => {
		const checks: SimulationCheck[] = [
			{ name: 'route_available', status: 'pass', detail: 'ok' },
			{ name: 'balance_sufficient', status: 'pass', detail: 'ok' },
			{ name: 'allowance_sufficient', status: 'pass', detail: 'ok' },
			{ name: 'gas_affordable', status: 'pass', detail: 'ok' },
			{ name: 'eth_call_revert_check', status: 'pass', detail: 'ok' },
			{ name: 'slippage_sane', status: 'pass', detail: 'ok' },
		]
		expect(computeWouldExecute(checks)).toBe(true)
	})

	it('is true when a non-safety-critical check warns (graceful degradation, not a hard block)', () => {
		const checks: SimulationCheck[] = [
			{ name: 'route_available', status: 'pass', detail: 'ok' },
			{ name: 'balance_sufficient', status: 'pass', detail: 'ok' },
			{ name: 'gas_affordable', status: 'pass', detail: 'ok' },
			{ name: 'allowance_sufficient', status: 'warn', detail: 'unavailable: quote did not include a spender/router address' },
		]
		expect(computeWouldExecute(checks)).toBe(true)
	})

	it('is false when balance_sufficient warns as unverified (no wallet_address)', () => {
		const checks: SimulationCheck[] = [
			{ name: 'route_available', status: 'pass', detail: 'ok' },
			{
				name: 'balance_sufficient',
				status: 'warn',
				unverified: true,
				detail: 'unverified: no wallet_address provided — balance not checked; provide wallet_address for a definitive result',
			},
			{ name: 'gas_affordable', status: 'pass', detail: 'ok' },
		]
		expect(computeWouldExecute(checks)).toBe(false)
	})

	it('is false when gas_affordable warns as unverified (RPC timeout)', () => {
		const checks: SimulationCheck[] = [
			{ name: 'route_available', status: 'pass', detail: 'ok' },
			{ name: 'balance_sufficient', status: 'pass', detail: 'ok' },
			{ name: 'gas_affordable', status: 'warn', unverified: true, detail: 'unavailable: RPC timeout' },
		]
		expect(computeWouldExecute(checks)).toBe(false)
	})

	it('is true when balance_sufficient/gas_affordable are warn but explicitly NOT unverified (defensive)', () => {
		// Guards against a future check accidentally warning on balance_sufficient
		// / gas_affordable without setting `unverified` — computeWouldExecute only
		// forces false when the flag is actually set, since that's the signal a
		// check couldn't run at all (as opposed to some other non-blocking warn).
		const checks: SimulationCheck[] = [
			{ name: 'balance_sufficient', status: 'warn', detail: 'some non-safety warn' },
			{ name: 'gas_affordable', status: 'pass', detail: 'ok' },
		]
		expect(computeWouldExecute(checks)).toBe(true)
	})

	it('is false when any check fails', () => {
		const checks: SimulationCheck[] = [
			{ name: 'route_available', status: 'pass', detail: 'ok' },
			{ name: 'balance_sufficient', status: 'fail', detail: 'insufficient balance' },
		]
		expect(computeWouldExecute(checks)).toBe(false)
	})
})

// ---------------------------------------------------------------------------
// runEvmChecks / runSolanaChecks — unverified flag on the no-wallet_address
// path. This path returns synchronously without any RPC call (every check
// function bails out on a missing fromAddress before touching the network),
// so it's safe to exercise directly here.
// ---------------------------------------------------------------------------

describe('runEvmChecks — no wallet_address', () => {
	it('marks balance_sufficient and gas_affordable as unverified, and would_execute is false', async () => {
		const checks = await runEvmChecks({
			chainId: 1, // ethereum — always has a fallback public RPC URL configured, no env dependency
			fromAddress: undefined,
			fromTokenAddress: '0x0000000000000000000000000000000000000000', // native ETH
			fromAmount: '1000000000000000000',
			priceImpactPct: 0.5,
			toAmount: '1000',
			toAmountMin: '970',
		})

		const balance = checks.find((c) => c.name === 'balance_sufficient')
		const gas = checks.find((c) => c.name === 'gas_affordable')
		expect(balance?.status).toBe('warn')
		expect(balance?.unverified).toBe(true)
		expect(balance?.detail).toContain('wallet_address')
		expect(gas?.status).toBe('warn')
		expect(gas?.unverified).toBe(true)

		expect(computeWouldExecute(checks)).toBe(false)
	})
})

describe('runSolanaChecks — no wallet_address', () => {
	it('marks balance_sufficient and gas_affordable as unverified, and would_execute is false', async () => {
		const { balance, gas } = await runSolanaChecks({
			fromAddress: undefined,
			inputMint: 'So11111111111111111111111111111111111111112',
			fromAmount: '1000000000',
		})

		expect(balance.status).toBe('warn')
		expect(balance.unverified).toBe(true)
		expect(balance.detail).toContain('wallet_address')
		expect(gas.status).toBe('warn')
		expect(gas.unverified).toBe(true)

		expect(computeWouldExecute([balance, gas])).toBe(false)
	})

	it('marks both checks as unverified when wallet_address is not Solana-shaped (e.g. an EVM address)', async () => {
		const { balance, gas } = await runSolanaChecks({
			fromAddress: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
			inputMint: 'So11111111111111111111111111111111111111112',
			fromAmount: '1000000000',
		})

		expect(balance.status).toBe('warn')
		expect(balance.unverified).toBe(true)
		expect(gas.status).toBe('warn')
		expect(gas.unverified).toBe(true)
	})
})
