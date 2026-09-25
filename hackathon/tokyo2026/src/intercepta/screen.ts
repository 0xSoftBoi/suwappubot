/**
 * Pre-sign + pre-execute screening orchestration.
 *
 * Two gates, in order:
 *  1. screenPreSign — x402 payment `payTo` (and token) BEFORE the agent signs.
 *  2. screenPreparedTx — the exact unsigned L3 transaction BEFORE /execute.
 *
 * Gate 1 failing means the agent never signs. Gate 2 failing means a signed
 * intent never hits chain. Either produces a PolicySignal the policy layer
 * already understands.
 */
import {
	loadInterceptaConfig,
	scanAddress,
	scanToken,
	scanTransaction,
	type InterceptaConfig,
	type ScanResult,
} from './client.ts'
import { scanResultToPolicySignal, type PolicySignal } from './policy.ts'

export interface PreSignScreenInput {
	payTo: string
	tokenAddress?: string
	chain: string
	amountUsd: number
}

export interface PreparedTx {
	/** Transaction initiator — required by the W3A simulation endpoint. */
	from?: string
	to: string
	data?: string
	value?: string
	chain: string
}

/** Gate 1: screen the x402 payment destination (and token) before signing. */
export async function screenPreSign(
	cfg: InterceptaConfig,
	input: PreSignScreenInput,
): Promise<{ signal: PolicySignal; scans: ScanResult[] }> {
	const scans: ScanResult[] = []
	scans.push(await scanAddress(cfg, input.payTo, input.chain))
	if (input.tokenAddress) {
		scans.push(await scanToken(cfg, input.tokenAddress, input.chain))
	}
	// Worst verdict wins.
	const worst = scans.reduce((a, b) => (b.riskScore >= a.riskScore ? b : a))
	const signal = scanResultToPolicySignal(worst, 'payment destination')
	return { signal, scans }
}

/** Gate 2: screen the exact unsigned transaction before execution. */
export async function screenPreparedTx(
	cfg: InterceptaConfig,
	tx: PreparedTx,
): Promise<{ signal: PolicySignal; scan: ScanResult }> {
	const scan = await scanTransaction(cfg, tx)
	const signal = scanResultToPolicySignal(scan, 'transaction')
	return { signal, scan }
}

/** Convenience: config from env + pre-sign screen in one call for the demo. */
export async function screenPaymentFromEnv(input: PreSignScreenInput) {
	return screenPreSign(loadInterceptaConfig(), input)
}
