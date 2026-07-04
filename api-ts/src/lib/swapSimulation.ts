/**
 * swapSimulation.ts — Tenderly-style dry-run checks for POST /v1/agent/swap/simulate
 * (and the MCP `simulate_swap` tool, which calls the same functions).
 *
 * READ-ONLY. Nothing in this module ever signs, broadcasts, or persists a
 * transaction. Every check below is independent and MUST degrade to a 'warn'
 * with detail 'unavailable' on any failure — never throw out of this module.
 *
 * Follows the raw JSON-RPC fetch pattern already used for EVM reads elsewhere
 * in the codebase (config/chains.ts, services/BalanceService.ts,
 * routes/swap.ts's allowance check, routes/staking.ts's eth_call helper) rather
 * than introducing a viem client for these simple reads.
 */

import { getRpcUrl } from '../config/chains'
import { SOLANA_TOKENS } from '../services/JupiterService'

export interface SimulationCheck {
	name: string
	status: 'pass' | 'warn' | 'fail'
	detail: string
	/**
	 * True when this check degraded to 'warn' because it genuinely could NOT be
	 * verified (no wallet_address, RPC timeout/error) — as opposed to a 'warn'
	 * that reflects a deliberate, inapplicable-to-this-chain skip (e.g. an
	 * EVM-only check on a Solana quote). Safety-critical checks
	 * (balance_sufficient, gas_affordable) that are unverified must not be
	 * treated as a pass by computeWouldExecute — see there.
	 */
	unverified?: boolean
}

export interface SimulationReport {
	success: boolean
	would_execute: boolean
	quote_id: string
	chain_type: 'evm' | 'solana'
	expected_output: {
		token: string
		amount: string
		amount_usd: string | null
	}
	min_output_after_slippage: string
	price_impact_pct: number | null
	fees: {
		protocol: string | null
		gas_estimate: string | null
	}
	checks: SimulationCheck[]
	warnings: string[]
}

const RPC_TIMEOUT_MS = 8_000

const NATIVE_EVM_ADDRESSES = new Set([
	'0x0000000000000000000000000000000000000000',
	'0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
])

export function isNativeEvmToken(address: string | undefined | null): boolean {
	if (!address) return true
	return NATIVE_EVM_ADDRESSES.has(address.toLowerCase())
}

// Reverse lookup: mint address -> {symbol, decimals, name} for the common Solana
// tokens we already know about (SOLANA_TOKENS is keyed by symbol).
// Built with SOL inserted first so its address wins over the WSOL alias, which
// shares the same mint address in SOLANA_TOKENS (`set` only on first-seen key).
const SOLANA_MINT_TO_INFO = new Map<string, { symbol: string; decimals: number; name: string }>()
for (const [symbol, info] of Object.entries(SOLANA_TOKENS)) {
	if (!SOLANA_MINT_TO_INFO.has(info.address)) {
		SOLANA_MINT_TO_INFO.set(info.address, { symbol, decimals: info.decimals, name: info.name })
	}
}

export function resolveSolanaMint(mint: string): { symbol: string; decimals: number; name: string } | null {
	return SOLANA_MINT_TO_INFO.get(mint) ?? null
}

// ---------------------------------------------------------------------------
// Raw JSON-RPC helpers (EVM). Every helper resolves — it never rejects — so
// callers can always attach the result to a graceful-degradation check.
// ---------------------------------------------------------------------------

interface RpcResult<T> {
	ok: boolean
	result?: T
	error?: string
}

/**
 * Normalizes a caught RPC/fetch exception into a fixed, non-sensitive string.
 * RPC URLs embed provider API keys (e.g. Alchemy) — never let a raw exception
 * message (which some fetch implementations embed the request URL into) reach
 * a check's `detail`, since that flows straight into the API response.
 */
function classifyRpcError(e: unknown): string {
	if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
		return 'RPC timeout'
	}
	if (e instanceof Error) {
		return `RPC error (${e.constructor.name})`
	}
	return 'RPC error (unknown)'
}

async function rpcCall<T = unknown>(
	rpcUrl: string,
	method: string,
	params: unknown[],
): Promise<RpcResult<T>> {
	try {
		const res = await fetch(rpcUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
			signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
		})
		const data = (await res.json()) as {
			result?: T
			error?: { message: string; data?: string }
		}
		if (data.error) {
			// Surface embedded revert data (if present) alongside the message so
			// eth_call_revert_check can decode it.
			const dataPart = data.error.data ? ` (data: ${data.error.data})` : ''
			return { ok: false, error: `${data.error.message}${dataPart}` }
		}
		return { ok: true, result: data.result }
	} catch (e) {
		return { ok: false, error: classifyRpcError(e) }
	}
}

function padAddress(addr: string): string {
	return addr.toLowerCase().replace(/^0x/, '').padStart(64, '0')
}

/** Best-effort decode of a revert reason from eth_call error data / return data. */
function decodeRevertReason(hexData: string | undefined): string | null {
	if (!hexData || !hexData.startsWith('0x') || hexData.length < 10) return null
	const selector = hexData.slice(0, 10)
	// Error(string) — standard require()/revert("msg")
	if (selector === '0x08c379a0') {
		try {
			const payload = hexData.slice(10)
			// offset(32) + length(32) + string data, ABI-encoded
			const lengthHex = payload.slice(64, 128)
			const length = parseInt(lengthHex, 16)
			const strHex = payload.slice(128, 128 + length * 2)
			const bytes = Buffer.from(strHex, 'hex')
			return bytes.toString('utf8')
		} catch {
			return null
		}
	}
	// Panic(uint256) — arithmetic/assert failures
	if (selector === '0x4e487b71') {
		try {
			const code = parseInt(hexData.slice(10, 74), 16)
			return `Panic(0x${code.toString(16)})`
		} catch {
			return null
		}
	}
	return null
}

// ---------------------------------------------------------------------------
// EVM checks
// ---------------------------------------------------------------------------

export interface EvmCheckInput {
	chainId: number
	fromAddress?: string | undefined
	fromTokenAddress: string
	fromAmount: string // base units (wei)
	spender?: string | undefined // Li.Fi estimate.approvalAddress
	tx?:
		| {
				to: string
				data: string
				value: string
				from: string
		  }
		| undefined
	priceImpactPct: number | null
	toAmount: string
	toAmountMin: string
}

/** 0x + 40 hex chars — used to detect a wallet_address that doesn't match this (EVM) chain_type. */
const EVM_ADDRESS_SHAPE_RE = /^0x[0-9a-fA-F]{40}$/

/** Runs checks 2-5 (balance, allowance, gas, eth_call) for an EVM quote. Never throws. */
export async function runEvmChecks(input: EvmCheckInput): Promise<SimulationCheck[]> {
	const rpcUrl = getRpcUrl(input.chainId)
	const isNative = isNativeEvmToken(input.fromTokenAddress)
	const checks: SimulationCheck[] = []

	if (!rpcUrl) {
		const unavailable = (name: string, unverified: boolean): SimulationCheck => ({
			name,
			status: 'warn',
			unverified,
			detail: `unavailable: no RPC endpoint configured for chain ${input.chainId}`,
		})
		return [
			unavailable('balance_sufficient', true),
			unavailable('allowance_sufficient', false),
			unavailable('gas_affordable', true),
			unavailable('eth_call_revert_check', false),
		]
	}

	// A wallet_address that doesn't look like an EVM address (e.g. a Solana
	// base58 address supplied for what turned out to be an EVM quote) can't be
	// used for any of these reads — fail fast with a clear reason instead of
	// sending a malformed address to the RPC and surfacing a confusing RPC error.
	if (input.fromAddress && !EVM_ADDRESS_SHAPE_RE.test(input.fromAddress)) {
		const mismatch = (name: string, unverified: boolean): SimulationCheck => ({
			name,
			status: 'warn',
			unverified,
			detail: 'unverified: wallet_address is not a valid EVM address for this chain',
		})
		return [
			mismatch('balance_sufficient', true),
			mismatch('allowance_sufficient', false),
			mismatch('gas_affordable', true),
			mismatch('eth_call_revert_check', false),
		]
	}

	// --- balance_sufficient ---
	checks.push(await checkEvmBalanceSufficient(rpcUrl, input, isNative))

	// --- allowance_sufficient ---
	checks.push(await checkEvmAllowanceSufficient(rpcUrl, input, isNative))

	// --- gas_affordable ---
	checks.push(await checkEvmGasAffordable(rpcUrl, input, isNative))

	// --- eth_call_revert_check ---
	checks.push(await checkEvmEthCallRevert(rpcUrl, input))

	return checks
}

async function checkEvmBalanceSufficient(
	rpcUrl: string,
	input: EvmCheckInput,
	isNative: boolean,
): Promise<SimulationCheck> {
	if (!input.fromAddress) {
		return {
			name: 'balance_sufficient',
			status: 'warn',
			unverified: true,
			detail: 'unverified: no wallet_address provided — balance not checked; provide wallet_address for a definitive result',
		}
	}
	try {
		const required = BigInt(input.fromAmount)
		if (isNative) {
			const bal = await rpcCall<string>(rpcUrl, 'eth_getBalance', [input.fromAddress, 'latest'])
			if (!bal.ok || bal.result === undefined) {
				return { name: 'balance_sufficient', status: 'warn', unverified: true, detail: `unavailable: ${bal.error ?? 'no result'}` }
			}
			const balance = BigInt(bal.result)
			return balance >= required
				? { name: 'balance_sufficient', status: 'pass', detail: `Native balance ${balance.toString()} >= required ${required.toString()}` }
				: { name: 'balance_sufficient', status: 'fail', detail: `Insufficient native balance: have ${balance.toString()}, need ${required.toString()}` }
		}
		// ERC-20 balanceOf(address)
		const data = `0x70a08231${padAddress(input.fromAddress)}`
		const res = await rpcCall<string>(rpcUrl, 'eth_call', [{ to: input.fromTokenAddress, data }, 'latest'])
		if (!res.ok || res.result === undefined) {
			return { name: 'balance_sufficient', status: 'warn', unverified: true, detail: `unavailable: ${res.error ?? 'no result'}` }
		}
		const balance = BigInt(res.result)
		return balance >= required
			? { name: 'balance_sufficient', status: 'pass', detail: `Token balance ${balance.toString()} >= required ${required.toString()}` }
			: { name: 'balance_sufficient', status: 'fail', detail: `Insufficient token balance: have ${balance.toString()}, need ${required.toString()}` }
	} catch (e) {
		return { name: 'balance_sufficient', status: 'warn', unverified: true, detail: `unavailable: ${classifyRpcError(e)}` }
	}
}

async function checkEvmAllowanceSufficient(
	rpcUrl: string,
	input: EvmCheckInput,
	isNative: boolean,
): Promise<SimulationCheck> {
	if (isNative) {
		return { name: 'allowance_sufficient', status: 'pass', detail: 'Native token — no ERC-20 allowance required' }
	}
	if (!input.fromAddress) {
		return { name: 'allowance_sufficient', status: 'warn', detail: 'unavailable: no fromAddress provided, skipping allowance check' }
	}
	if (!input.spender) {
		return { name: 'allowance_sufficient', status: 'warn', detail: 'unavailable: quote did not include a spender/router address' }
	}
	try {
		const data = `0xdd62ed3e${padAddress(input.fromAddress)}${padAddress(input.spender)}`
		const res = await rpcCall<string>(rpcUrl, 'eth_call', [{ to: input.fromTokenAddress, data }, 'latest'])
		if (!res.ok || res.result === undefined) {
			return { name: 'allowance_sufficient', status: 'warn', detail: `unavailable: ${res.error ?? 'no result'} (spender: ${input.spender})` }
		}
		const allowance = BigInt(res.result)
		const required = BigInt(input.fromAmount)
		return allowance >= required
			? { name: 'allowance_sufficient', status: 'pass', detail: `Allowance ${allowance.toString()} >= required ${required.toString()} (spender: ${input.spender})` }
			: { name: 'allowance_sufficient', status: 'warn', detail: `Allowance ${allowance.toString()} < required ${required.toString()} — an approval tx will be needed before swap (spender: ${input.spender})` }
	} catch (e) {
		return { name: 'allowance_sufficient', status: 'warn', detail: `unavailable: ${classifyRpcError(e)} (spender: ${input.spender})` }
	}
}

async function checkEvmGasAffordable(
	rpcUrl: string,
	input: EvmCheckInput,
	isNative: boolean,
): Promise<SimulationCheck> {
	if (!input.fromAddress) {
		return {
			name: 'gas_affordable',
			status: 'warn',
			unverified: true,
			detail: 'unverified: no wallet_address provided — gas affordability not checked; provide wallet_address for a definitive result',
		}
	}
	try {
		const [balRes, gasPriceRes] = await Promise.all([
			rpcCall<string>(rpcUrl, 'eth_getBalance', [input.fromAddress, 'latest']),
			rpcCall<string>(rpcUrl, 'eth_gasPrice', []),
		])
		if (!balRes.ok || balRes.result === undefined) {
			return { name: 'gas_affordable', status: 'warn', unverified: true, detail: `unavailable: ${balRes.error ?? 'no result'}` }
		}
		if (!gasPriceRes.ok || gasPriceRes.result === undefined) {
			return { name: 'gas_affordable', status: 'warn', unverified: true, detail: `unavailable: could not fetch gas price (${gasPriceRes.error ?? 'no result'})` }
		}
		const balance = BigInt(balRes.result)
		const gasPrice = BigInt(gasPriceRes.result)
		// Fixed generic gas-limit estimate for a swap tx (routers commonly run
		// 150k-300k gas); this is intentionally conservative and independent of
		// the eth_call_revert_check, which is the authoritative execution check.
		const assumedGasLimit = 300_000n
		const gasCost = gasPrice * assumedGasLimit
		const requiredTotal = isNative ? gasCost + BigInt(input.fromAmount) : gasCost
		return balance >= requiredTotal
			? {
					name: 'gas_affordable',
					status: 'pass',
					detail: `Native balance ${balance.toString()} covers estimated gas cost ${gasCost.toString()} wei${isNative ? ' + swap amount' : ''}`,
				}
			: {
					name: 'gas_affordable',
					status: 'fail',
					detail: `Native balance ${balance.toString()} is below estimated required ${requiredTotal.toString()} wei (gas${isNative ? ' + swap amount' : ''})`,
				}
	} catch (e) {
		return { name: 'gas_affordable', status: 'warn', unverified: true, detail: `unavailable: ${classifyRpcError(e)}` }
	}
}

async function checkEvmEthCallRevert(rpcUrl: string, input: EvmCheckInput): Promise<SimulationCheck> {
	if (!input.tx || !input.fromAddress) {
		return {
			name: 'eth_call_revert_check',
			status: 'warn',
			detail: 'skipped: no executable transaction data or fromAddress available for this quote',
		}
	}
	try {
		const res = await rpcCall<string>(rpcUrl, 'eth_call', [
			{
				from: input.tx.from,
				to: input.tx.to,
				data: input.tx.data,
				value: input.tx.value,
			},
			'latest',
		])
		if (res.ok) {
			return { name: 'eth_call_revert_check', status: 'pass', detail: 'eth_call simulation did not revert' }
		}
		// Try to pull a decoded reason out of the error message/data.
		const hexMatch = res.error?.match(/0x[0-9a-fA-F]+/)
		const reason = hexMatch ? decodeRevertReason(hexMatch[0]) : null
		const detail = reason
			? `Transaction would revert: ${reason}`
			: `Transaction would revert: ${res.error ?? 'unknown error'}`
		return { name: 'eth_call_revert_check', status: 'fail', detail }
	} catch (e) {
		return { name: 'eth_call_revert_check', status: 'warn', detail: `unavailable: ${classifyRpcError(e)}` }
	}
}

/** Shared across EVM and Solana — warns above 5% price impact or a large minOut deviation. */
export function checkSlippageSane(priceImpactPct: number | null, toAmount: string, toAmountMin: string): SimulationCheck {
	if (priceImpactPct === null) {
		return { name: 'slippage_sane', status: 'warn', detail: 'unavailable: price impact not reported by the quote' }
	}
	try {
		const out = Number(toAmount)
		const outMin = Number(toAmountMin)
		const deviationPct = out > 0 ? ((out - outMin) / out) * 100 : 0
		const issues: string[] = []
		if (priceImpactPct > 5) issues.push(`price impact ${priceImpactPct.toFixed(2)}% exceeds 5%`)
		if (deviationPct > 15) issues.push(`min output is ${deviationPct.toFixed(2)}% below expected output`)
		if (issues.length > 0) {
			return { name: 'slippage_sane', status: 'warn', detail: issues.join('; ') }
		}
		return {
			name: 'slippage_sane',
			status: 'pass',
			detail: `Price impact ${priceImpactPct.toFixed(2)}%, min-output deviation ${deviationPct.toFixed(2)}%`,
		}
	} catch (e) {
		return { name: 'slippage_sane', status: 'warn', detail: `unavailable: ${e instanceof Error ? e.message : String(e)}` }
	}
}

/** Solana equivalent of the EVM-only allowance/eth_call checks — marked N/A. */
export function evmOnlyCheck(name: string): SimulationCheck {
	return { name, status: 'warn', detail: 'not applicable: EVM-only check, this quote is on Solana' }
}

export interface SolanaCheckInput {
	fromAddress?: string | undefined
	inputMint: string
	fromAmount: string // lamports/base units
}

/** base58, 32-44 chars — used to detect a wallet_address that doesn't match this (Solana) chain_type. */
const SOLANA_ADDRESS_SHAPE_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

/** Runs checks 2 and 4 (balance, gas/fee affordability) for a Solana quote. Never throws. */
export async function runSolanaChecks(input: SolanaCheckInput): Promise<{ balance: SimulationCheck; gas: SimulationCheck }> {
	// Solana isn't in CHAIN_ID_TO_KEY (that map is EVM-only), so resolve its RPC directly.
	const solanaRpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'

	if (!input.fromAddress) {
		return {
			balance: {
				name: 'balance_sufficient',
				status: 'warn',
				unverified: true,
				detail: 'unverified: no wallet_address provided — balance not checked; provide wallet_address for a definitive result',
			},
			gas: {
				name: 'gas_affordable',
				status: 'warn',
				unverified: true,
				detail: 'unverified: no wallet_address provided — gas affordability not checked; provide wallet_address for a definitive result',
			},
		}
	}

	// A wallet_address that doesn't look like a Solana address (e.g. an EVM 0x
	// address supplied for what turned out to be a Solana quote) can't be used
	// for this RPC read — fail fast with a clear reason.
	if (!SOLANA_ADDRESS_SHAPE_RE.test(input.fromAddress)) {
		return {
			balance: {
				name: 'balance_sufficient',
				status: 'warn',
				unverified: true,
				detail: 'unverified: wallet_address is not a valid Solana address for this chain',
			},
			gas: {
				name: 'gas_affordable',
				status: 'warn',
				unverified: true,
				detail: 'unverified: wallet_address is not a valid Solana address for this chain',
			},
		}
	}

	const mintInfo = resolveSolanaMint(input.inputMint)
	const isNativeSol = !mintInfo || mintInfo.symbol === 'SOL' || mintInfo.symbol === 'WSOL'

	try {
		const res = await fetch(solanaRpcUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [input.fromAddress] }),
			signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
		})
		const data = (await res.json()) as { result?: { value?: number }; error?: { message: string } }
		if (data.error || data.result?.value === undefined) {
			const detail = `unavailable: ${data.error?.message ?? 'no result'}`
			return {
				balance: { name: 'balance_sufficient', status: 'warn', unverified: true, detail },
				gas: { name: 'gas_affordable', status: 'warn', unverified: true, detail },
			}
		}
		const lamports = BigInt(data.result.value)
		// Typical Solana tx fee is ~5000 lamports per signature; use a conservative estimate.
		const estimatedFeeLamports = 10_000n

		const balanceCheck: SimulationCheck = isNativeSol
			? lamports >= BigInt(input.fromAmount)
				? { name: 'balance_sufficient', status: 'pass', detail: `SOL balance ${lamports.toString()} lamports >= required ${input.fromAmount}` }
				: { name: 'balance_sufficient', status: 'fail', detail: `Insufficient SOL balance: have ${lamports.toString()}, need ${input.fromAmount}` }
			: {
					name: 'balance_sufficient',
					status: 'warn',
					unverified: true,
					detail: 'unverified: SPL token balance check requires an associated-token-account lookup, not yet implemented — verify balance manually',
				}

		// Gas/fee affordability is always based on the native SOL balance (fees
		// are paid in SOL regardless of the input token), so it's verifiable even
		// when the balance_sufficient check above is unverified for an SPL token.
		const gasCheck: SimulationCheck =
			lamports >= estimatedFeeLamports
				? { name: 'gas_affordable', status: 'pass', detail: `SOL balance covers estimated network fee (~${estimatedFeeLamports.toString()} lamports)` }
				: { name: 'gas_affordable', status: 'fail', detail: `SOL balance ${lamports.toString()} is below the estimated network fee (~${estimatedFeeLamports.toString()} lamports)` }

		return { balance: balanceCheck, gas: gasCheck }
	} catch (e) {
		const detail = `unavailable: ${classifyRpcError(e)}`
		return {
			balance: { name: 'balance_sufficient', status: 'warn', unverified: true, detail },
			gas: { name: 'gas_affordable', status: 'warn', unverified: true, detail },
		}
	}
}

/**
 * would_execute is true only if every check that ran either passed, or
 * degraded to a 'warn' that is NOT a safety-critical unverified result.
 *
 * balance_sufficient and gas_affordable are safety-critical: a 'warn' there
 * because the check couldn't actually run (no wallet_address, RPC
 * timeout/error, format mismatch) is an unverified result, not a verified
 * pass — so it must not let would_execute report true. Any other 'warn'
 * (inapplicable-to-this-chain checks, non-critical checks like
 * allowance_sufficient/slippage_sane) is graceful degradation and does not
 * block would_execute, matching the original design.
 */
export function computeWouldExecute(checks: SimulationCheck[]): boolean {
	return checks.every((c) => {
		if (c.status === 'fail') return false
		if (c.unverified && (c.name === 'balance_sufficient' || c.name === 'gas_affordable')) return false
		return true
	})
}

// ---------------------------------------------------------------------------
// Top-level report builders — the single entry points used by both
// POST /v1/agent/swap/simulate (routes/agent.ts) and the MCP `simulate_swap`
// tool (routes/mcp.ts), so the two surfaces can never drift.
// ---------------------------------------------------------------------------

export interface BuildEvmReportParams {
	quoteId: string
	fromAddress?: string | undefined
	fromTokenSymbol: string
	fromTokenAddress: string
	toTokenSymbol: string
	chainId: number
	fromAmount: string
	toAmount: string
	toAmountMin: string
	toAmountUsd?: string | undefined
	priceImpactPct: number | null
	approvalAddress?: string | undefined
	gasEstimateUsd?: string | undefined
	bridgeFeeUsd?: string | undefined
	tx?: { to: string; data: string; value: string; from: string } | undefined
}

export async function buildEvmSimulationReport(params: BuildEvmReportParams): Promise<SimulationReport> {
	const checks: SimulationCheck[] = [
		{ name: 'route_available', status: 'pass', detail: `Route found via Li.Fi for ${params.fromTokenSymbol} -> ${params.toTokenSymbol} on chain ${params.chainId}` },
	]

	const evmChecks = await runEvmChecks({
		chainId: params.chainId,
		fromAddress: params.fromAddress,
		fromTokenAddress: params.fromTokenAddress,
		fromAmount: params.fromAmount,
		spender: params.approvalAddress,
		tx: params.tx,
		priceImpactPct: params.priceImpactPct,
		toAmount: params.toAmount,
		toAmountMin: params.toAmountMin,
	})
	checks.push(...evmChecks)
	checks.push(checkSlippageSane(params.priceImpactPct, params.toAmount, params.toAmountMin))

	const warnings = checks.filter((c) => c.status === 'warn').map((c) => `${c.name}: ${c.detail}`)

	return {
		success: true,
		would_execute: computeWouldExecute(checks),
		quote_id: params.quoteId,
		chain_type: 'evm',
		expected_output: {
			token: params.toTokenSymbol,
			amount: params.toAmount,
			amount_usd: params.toAmountUsd ?? null,
		},
		min_output_after_slippage: params.toAmountMin,
		price_impact_pct: params.priceImpactPct,
		fees: {
			protocol: params.bridgeFeeUsd ? `$${params.bridgeFeeUsd}` : null,
			gas_estimate: params.gasEstimateUsd ? `$${params.gasEstimateUsd}` : null,
		},
		checks,
		warnings,
	}
}

export interface BuildSolanaReportParams {
	quoteId: string
	fromAddress?: string | undefined
	inputMint: string
	outputMint: string
	fromAmount: string
	toAmount: string
	toAmountMin: string
	priceImpactPct: number | null
	platformFeeAmount?: string | undefined
}

export async function buildSolanaSimulationReport(params: BuildSolanaReportParams): Promise<SimulationReport> {
	const outInfo = resolveSolanaMint(params.outputMint)
	const outSymbol = outInfo?.symbol ?? params.outputMint
	const outDecimals = outInfo?.decimals

	const checks: SimulationCheck[] = [
		{ name: 'route_available', status: 'pass', detail: `Route found via Jupiter for ${params.inputMint} -> ${params.outputMint}` },
	]

	const solChecks = await runSolanaChecks({
		fromAddress: params.fromAddress,
		inputMint: params.inputMint,
		fromAmount: params.fromAmount,
	})
	checks.push(solChecks.balance)
	checks.push(evmOnlyCheck('allowance_sufficient'))
	checks.push(solChecks.gas)
	checks.push(evmOnlyCheck('eth_call_revert_check'))
	checks.push(checkSlippageSane(params.priceImpactPct, params.toAmount, params.toAmountMin))

	const warnings = checks.filter((c) => c.status === 'warn').map((c) => `${c.name}: ${c.detail}`)

	const amountHuman = outDecimals !== undefined ? (Number(params.toAmount) / 10 ** outDecimals).toString() : params.toAmount
	const amountMinHuman = outDecimals !== undefined ? (Number(params.toAmountMin) / 10 ** outDecimals).toString() : params.toAmountMin

	return {
		success: true,
		would_execute: computeWouldExecute(checks),
		quote_id: params.quoteId,
		chain_type: 'solana',
		expected_output: {
			token: outSymbol,
			amount: amountHuman,
			amount_usd: null,
		},
		min_output_after_slippage: amountMinHuman,
		price_impact_pct: params.priceImpactPct,
		fees: {
			protocol: params.platformFeeAmount ? `${params.platformFeeAmount} (base units)` : null,
			gas_estimate: null,
		},
		checks,
		warnings,
	}
}
