/**
 * x402 facilitator client — direct on-chain settlement of a single API/MCP call.
 *
 * This is the "native x402" path: instead of pre-funding credits, an x402 client
 * (@x402/fetch / @x402/axios) signs an EIP-3009 USDC authorization, encodes it
 * into the payment header, and retries. We hand that payload to a facilitator
 * which verifies the signature and settles the transfer on-chain, so we never
 * run chain infra ourselves.
 *
 * Uses the OFFICIAL maintained `@x402/core` v2 client (`HTTPFacilitatorClient`)
 * for verify+settle rather than a hand-rolled HTTP contract — the request/
 * response schema and version negotiation track the spec. The default URL is the
 * testnet facilitator; point X402_FACILITATOR_URL at CDP's hosted facilitator
 * (https://api.cdp.coinbase.com/platform/v2/x402) for mainnet.
 *
 * Gated by X402_FACILITATOR_ENABLED. CDP's hosted facilitator covers
 * Base/Polygon/Arbitrum/World/Solana; our own chains (e.g. Tempo) are not
 * facilitated and must use prepaid credits / the internal verifier instead.
 *
 * SECURITY: an x402 client signs against the PaymentRequirements *it* sends back
 * (payload.accepted). We MUST cross-check those against what we advertised
 * (payTo / asset / amount) before settling, so a client can't redirect funds to
 * itself or underpay. That check is the core of this module.
 *
 * NOTE: code-complete but NOT yet exercised against a live facilitator with a
 * real signed payment, and CDP mainnet auth (JWT via @coinbase/x402) is a
 * follow-up — see the monetization rollout notes. Keep it gated off until a live
 * end-to-end settle has been confirmed on testnet.
 */

import { HTTPFacilitatorClient, decodePaymentSignatureHeader } from '@x402/core/http'

/**
 * The payment requirements WE advertised in the 402 challenge (v1-shaped — see
 * buildX402Challenge). Only the security-critical fields are read here.
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
	/** Optional bearer token for facilitators that accept it. CDP mainnet needs
	 *  JWT auth via @coinbase/x402 instead — wire that as a follow-up. */
	X402_FACILITATOR_API_KEY?: string
}

export function isFacilitatorEnabled(env: FacilitatorEnv): boolean {
	return env.X402_FACILITATOR_ENABLED === 'true'
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

	// Decode the payment header into a v2 PaymentPayload (carries `accepted`, the
	// PaymentRequirements the client actually signed against).
	let payload: ReturnType<typeof decodePaymentSignatureHeader>
	try {
		payload = decodePaymentSignatureHeader(paymentHeader)
	} catch {
		return { ok: false, error: 'invalid_payment_header' }
	}

	const accepted = payload?.accepted
	if (!accepted) return { ok: false, error: 'missing_accepted_requirements' }

	// SECURITY cross-check: the client-signed requirements must match what we
	// advertised, or settling would send money somewhere we didn't intend.
	if (String(accepted.payTo).toLowerCase() !== requirements.payTo.toLowerCase()) {
		return { ok: false, error: 'payTo_mismatch' }
	}
	if (String(accepted.asset).toLowerCase() !== requirements.asset.toLowerCase()) {
		return { ok: false, error: 'asset_mismatch' }
	}
	try {
		if (BigInt(accepted.amount) < BigInt(requirements.maxAmountRequired)) {
			return { ok: false, error: 'amount_too_low' }
		}
	} catch {
		return { ok: false, error: 'amount_unparseable' }
	}

	const createAuthHeaders = env.X402_FACILITATOR_API_KEY
		? async () => {
				const h = { Authorization: `Bearer ${env.X402_FACILITATOR_API_KEY}` }
				return { verify: h, settle: h, supported: h }
			}
		: undefined

	const client = new HTTPFacilitatorClient({ url: env.X402_FACILITATOR_URL, createAuthHeaders })

	try {
		const v = await client.verify(payload, accepted)
		if (!v.isValid) return { ok: false, error: v.invalidReason || 'payment_invalid' }

		const s = await client.settle(payload, accepted)
		if (!s.success) return { ok: false, error: s.errorReason || 'settle_failed' }

		return { ok: true, txHash: s.transaction, network: String(s.network), payer: s.payer }
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) }
	}
}
