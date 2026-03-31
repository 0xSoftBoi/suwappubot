/**
 * Fallback signing service for TypeScript API.
 *
 * Wraps Turnkey signing calls — on failure, delegates to the Python internal
 * signing endpoint which has access to KMS-encrypted backup keys.
 */

import { logger } from '../lib/logger'
import { fetchWithRetry } from '../lib/retry'

const PYTHON_API_URL = process.env.PYTHON_API_URL || 'http://localhost:8000'
const INTERNAL_API_KEY = process.env.AGENT_API_KEY || ''

interface FallbackSignResult {
	signedTransaction: string
	usedFallback: boolean
}

/**
 * Sign a transaction via the Python internal endpoint (KMS backup keys).
 */
async function signViaFallback(
	walletId: number,
	unsignedTransaction: Record<string, unknown>,
	chainType: string = 'evm',
): Promise<string> {
	logger.info({ walletId, chainType }, '[FallbackSigning] Delegating to Python signing endpoint')

	const res = await fetchWithRetry(`${PYTHON_API_URL}/internal/sign-transaction`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Internal-Api-Key': INTERNAL_API_KEY,
		},
		body: JSON.stringify({
			wallet_id: walletId,
			unsigned_transaction: unsignedTransaction,
			chain_type: chainType,
		}),
	})

	if (!res.ok) {
		const text = await res.text()
		throw new Error(`Fallback signing failed: ${res.status} ${text}`)
	}

	const data = (await res.json()) as { signed_transaction: string; used_fallback: boolean }
	logger.info(
		{ walletId, usedFallback: data.used_fallback },
		'[FallbackSigning] Signed via Python fallback',
	)
	return data.signed_transaction
}

/**
 * Wrap a Turnkey signing call with fallback to Python internal endpoint.
 *
 * @param turnkeySign - Async function that performs Turnkey signing
 * @param walletId - DB wallet ID (for fallback)
 * @param unsignedTransaction - Raw transaction to sign (for fallback)
 * @param chainType - "evm" or "solana"
 */
export async function withSigningFallback(
	turnkeySign: () => Promise<string>,
	walletId: number,
	unsignedTransaction: Record<string, unknown>,
	chainType: string = 'evm',
): Promise<FallbackSignResult> {
	try {
		const signedTransaction = await turnkeySign()
		return { signedTransaction, usedFallback: false }
	} catch (error) {
		logger.warn(
			{ err: error, walletId },
			'[FallbackSigning] Turnkey signing failed, falling back to Python endpoint',
		)

		const signedTransaction = await signViaFallback(walletId, unsignedTransaction, chainType)
		return { signedTransaction, usedFallback: true }
	}
}
