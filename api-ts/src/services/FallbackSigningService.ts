/**
 * Fallback signing service for TypeScript API.
 *
 * Wraps Turnkey signing calls — on failure, delegates to the Python internal
 * signing endpoint which has access to KMS-encrypted backup keys.
 */

import { logger } from '../lib/logger'
import { fetchWithRetry } from '../lib/retry'

const PYTHON_API_URL = process.env.PYTHON_API_URL || 'http://localhost:8000'
// SECURITY: ONLY the dedicated internal secret unlocks Python /internal signing.
// The AGENT_API_KEY fallback was removed — that key is shared with external AI
// agents and the Python endpoint now rejects it outright. If INTERNAL_API_KEY is
// unset we fail closed at call time (see signViaFallback) rather than sending ''.
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || ''

interface FallbackSignResult {
	signedTransaction: string
	usedFallback: boolean
}

/**
 * Sign a transaction via the Python internal endpoint (KMS backup keys).
 *
 * @param walletId - DB wallet ID (wallets.id) whose backup key signs the tx
 * @param userId - DB users.id that owns the wallet. The Python endpoint 403s if
 *   wallets.user_id != this value, so it MUST be the same DB user id used to
 *   resolve the wallet (never a Telegram id).
 */
async function signViaFallback(
	walletId: number,
	userId: number,
	unsignedTransaction: Record<string, unknown>,
	chainType: string = 'evm',
): Promise<string> {
	logger.info(
		{ walletId, userId, chainType },
		'[FallbackSigning] Delegating to Python signing endpoint',
	)

	if (!INTERNAL_API_KEY) {
		logger.error(
			{ walletId, userId },
			'[FallbackSigning] INTERNAL_API_KEY is not set — cannot authenticate to the Python internal signing endpoint. Refusing to call with an empty key.',
		)
		throw new Error(
			'Fallback signing unavailable: INTERNAL_API_KEY is not configured for the TS API',
		)
	}

	const res = await fetchWithRetry(`${PYTHON_API_URL}/internal/sign-transaction`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			// FastAPI param `x_internal_key: str = Header(None, alias="X-Internal-Key")`
			// reads the `X-Internal-Key` header — must match exactly.
			'X-Internal-Key': INTERNAL_API_KEY,
		},
		body: JSON.stringify({
			wallet_id: walletId,
			user_id: userId,
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
		{ walletId, userId, usedFallback: data.used_fallback },
		'[FallbackSigning] Signed via Python fallback',
	)
	return data.signed_transaction
}

/**
 * Wrap a Turnkey signing call with fallback to Python internal endpoint.
 *
 * @param turnkeySign - Async function that performs Turnkey signing
 * @param walletId - DB wallet ID (wallets.id) for fallback
 * @param userId - DB users.id that owns the wallet. MUST match wallets.user_id
 *   on the Python side or the endpoint returns 403. Pass the same DB user id the
 *   wallet was resolved from (e.g. user.id / authUser.userId), never a Telegram id.
 * @param unsignedTransaction - Raw transaction to sign (for fallback)
 * @param chainType - "evm" or "solana"
 */
export async function withSigningFallback(
	turnkeySign: () => Promise<string>,
	walletId: number,
	userId: number,
	unsignedTransaction: Record<string, unknown>,
	chainType: string = 'evm',
): Promise<FallbackSignResult> {
	try {
		const signedTransaction = await turnkeySign()
		return { signedTransaction, usedFallback: false }
	} catch (error) {
		logger.warn(
			{ err: error, walletId, userId },
			'[FallbackSigning] Turnkey signing failed, falling back to Python endpoint',
		)

		const signedTransaction = await signViaFallback(
			walletId,
			userId,
			unsignedTransaction,
			chainType,
		)
		return { signedTransaction, usedFallback: true }
	}
}
