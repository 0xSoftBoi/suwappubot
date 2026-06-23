/**
 * x402 facilitator client — direct on-chain settlement of a single API/MCP call.
 *
 * This is the "native x402" path: instead of pre-funding credits, an x402 client
 * (x402-axios / x402-fetch) signs an EIP-3009 USDC authorization, base64-encodes
 * it into the `X-PAYMENT` request header, and retries. We hand that payload to a
 * facilitator which verifies the signature and settles the transfer on-chain, so
 * we never run chain infra ourselves.
 *
 * Facilitator HTTP contract (CDP / x402.org compatible):
 *   POST {url}/verify  { x402Version, paymentPayload, paymentRequirements }
 *        → { isValid: boolean, invalidReason?: string }
 *   POST {url}/settle  { x402Version, paymentPayload, paymentRequirements }
 *        → { success: boolean, transaction?: string, network?: string, payer?: string, errorReason?: string }
 *
 * Gated by X402_FACILITATOR_ENABLED. CDP's hosted facilitator covers
 * Base/Polygon/Arbitrum/World/Solana; our own chains (e.g. Tempo) are not
 * facilitated and must use prepaid credits / the internal verifier instead.
 *
 * NOTE: code-complete but NOT yet exercised against a live facilitator with a
 * real signed payment — see the monetization rollout notes. Keep it gated off
 * until a live end-to-end settle has been confirmed on testnet.
 */

export type PaymentRequirements = {
	scheme: string
	network: string
	maxAmountRequired: string
	resource: string
	description: string
	mimeType: string
	payTo: string
	maxTimeoutSeconds: number
	asset: string
	extra?: Record<string, unknown>
}

export type SettleResult =
	| { ok: true; txHash?: string; network?: string; payer?: string }
	| { ok: false; error: string }

type FacilitatorEnv = {
	X402_FACILITATOR_ENABLED?: string
	X402_FACILITATOR_URL: string
}

export function isFacilitatorEnabled(env: FacilitatorEnv): boolean {
	return env.X402_FACILITATOR_ENABLED === 'true'
}

/** Decode the base64 X-PAYMENT header into the payment payload object. */
function decodePaymentHeader(header: string): unknown | null {
	try {
		return JSON.parse(Buffer.from(header, 'base64').toString('utf8'))
	} catch {
		return null
	}
}

/**
 * Verify + settle a single call's payment via the configured facilitator.
 * Returns { ok: false } on any failure (never throws) so callers can fall
 * through to a 402 challenge.
 */
export async function facilitatorVerifyAndSettle(
	env: FacilitatorEnv,
	paymentHeader: string,
	requirements: PaymentRequirements,
): Promise<SettleResult> {
	if (!isFacilitatorEnabled(env)) return { ok: false, error: 'facilitator_disabled' }

	const paymentPayload = decodePaymentHeader(paymentHeader)
	if (!paymentPayload) return { ok: false, error: 'invalid_payment_header' }

	const base = env.X402_FACILITATOR_URL.replace(/\/$/, '')
	const reqBody = JSON.stringify({ x402Version: 1, paymentPayload, paymentRequirements: requirements })
	const headers = { 'Content-Type': 'application/json' }

	try {
		const vRes = await fetch(`${base}/verify`, {
			method: 'POST',
			headers,
			body: reqBody,
			signal: AbortSignal.timeout(15_000),
		})
		if (!vRes.ok) return { ok: false, error: `verify_http_${vRes.status}` }
		const v = (await vRes.json()) as { isValid?: boolean; invalidReason?: string }
		if (!v.isValid) return { ok: false, error: v.invalidReason || 'payment_invalid' }

		const sRes = await fetch(`${base}/settle`, {
			method: 'POST',
			headers,
			body: reqBody,
			signal: AbortSignal.timeout(30_000),
		})
		if (!sRes.ok) return { ok: false, error: `settle_http_${sRes.status}` }
		const s = (await sRes.json()) as {
			success?: boolean
			transaction?: string
			network?: string
			payer?: string
			errorReason?: string
		}
		if (!s.success) return { ok: false, error: s.errorReason || 'settle_failed' }

		return { ok: true, txHash: s.transaction, network: s.network, payer: s.payer }
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) }
	}
}
