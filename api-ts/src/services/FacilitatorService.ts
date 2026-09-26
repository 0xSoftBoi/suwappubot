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
 * CDP mainnet auth is wired: when CDP_API_KEY_ID + CDP_API_KEY_SECRET are both
 * set, we use the official `@coinbase/x402` package's `createFacilitatorConfig`
 * to generate a per-request JWT (via `@coinbase/cdp-sdk/auth` under the hood)
 * instead of a static bearer token, and default the facilitator URL to CDP's
 * hosted endpoint unless X402_FACILITATOR_URL was explicitly overridden away
 * from its default. CDP auth headers carry a JWT scoped to CDP's own API — they
 * are ONLY ever attached when the resolved URL's host is CDP's facilitator
 * host. An operator pointing X402_FACILITATOR_URL at a self-hosted or testnet
 * facilitator still works, but gets NO auth headers (that facilitator isn't
 * CDP and has no use for a CDP-scoped JWT) rather than leaking CDP credentials
 * to an arbitrary third-party host. See resolveFacilitatorConfig below.
 *
 * NOTE: code-complete but NOT yet exercised against a live facilitator with a
 * real signed payment — see the monetization rollout notes. Keep it gated off
 * until a live end-to-end settle has been confirmed on testnet (see
 * scripts/x402-e2e.ts).
 */

import { createFacilitatorConfig } from '@coinbase/x402'
import {
	type FacilitatorConfig,
	HTTPFacilitatorClient,
	decodePaymentSignatureHeader,
} from '@x402/core/http'

/** Must match EnvService's X402_FACILITATOR_URL default exactly — used to
 *  detect whether an operator explicitly overrode the facilitator URL. */
const DEFAULT_X402_FACILITATOR_URL = 'https://x402.org/facilitator'

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
	/** Optional static bearer token for facilitators that accept it. Superseded
	 *  by CDP JWT auth below when CDP_API_KEY_ID/SECRET are both set. */
	X402_FACILITATOR_API_KEY?: string
	/** CDP hosted mainnet facilitator auth (CDP Portal API key, not a wallet key). */
	CDP_API_KEY_ID?: string
	CDP_API_KEY_SECRET?: string
}

export function isFacilitatorEnabled(env: FacilitatorEnv): boolean {
	return env.X402_FACILITATOR_ENABLED === 'true'
}

/**
 * Resolve the {@link FacilitatorConfig} passed to HTTPFacilitatorClient.
 *
 * Precedence:
 *  1. CDP_API_KEY_ID + CDP_API_KEY_SECRET both set → resolve the facilitator
 *     URL (CDP's hosted endpoint by default, or an explicit non-empty
 *     X402_FACILITATOR_URL override), then attach CDP JWT auth headers
 *     (@coinbase/x402's createFacilitatorConfig) ONLY if that resolved URL's
 *     *host* actually is CDP's facilitator host. A CDP JWT is scoped to CDP's
 *     own API and must never be sent to a different host, so an operator who
 *     overrides X402_FACILITATOR_URL to a self-hosted/testnet facilitator
 *     while CDP creds happen to be set gets NO auth headers there, not a
 *     leaked credential.
 *  2. Otherwise, fall back to the existing behavior: a static bearer token
 *     from X402_FACILITATOR_API_KEY if set, or no auth at all.
 *
 * X402_FACILITATOR_URL is trimmed and an empty/whitespace-only string is
 * treated as unset (Schema.optionalWith only applies its default when the key
 * is absent, so "" would otherwise count as an "explicit override" to the
 * empty string and silently disable CDP auth while HTTPFacilitatorClient
 * falls back to x402.org).
 *
 * Never throws: `new URL()` on a malformed override is caught and treated as
 * "not CDP's host" (no auth attached, worst case is an unauthenticated call
 * that the facilitator itself will then reject).
 *
 * Exported as a pure function so the selection logic is unit-testable without
 * a live facilitator or real CDP credentials.
 */
export function resolveFacilitatorConfig(env: FacilitatorEnv): FacilitatorConfig {
	if (env.CDP_API_KEY_ID && env.CDP_API_KEY_SECRET) {
		const cdp = createFacilitatorConfig(env.CDP_API_KEY_ID, env.CDP_API_KEY_SECRET)
		const raw = env.X402_FACILITATOR_URL?.trim()
		const overridden = !!raw && raw !== DEFAULT_X402_FACILITATOR_URL
		const url = overridden ? (raw as string) : (cdp.url ?? DEFAULT_X402_FACILITATOR_URL)

		let isCdpHost = false
		try {
			isCdpHost = !!cdp.url && new URL(url).host === new URL(cdp.url).host
		} catch {
			isCdpHost = false
		}

		return isCdpHost
			? { url, createAuthHeaders: cdp.createAuthHeaders }
			: { url, createAuthHeaders: undefined }
	}

	const createAuthHeaders = env.X402_FACILITATOR_API_KEY
		? async () => {
				const h = { Authorization: `Bearer ${env.X402_FACILITATOR_API_KEY}` }
				return { verify: h, settle: h, supported: h }
			}
		: undefined

	return { url: env.X402_FACILITATOR_URL, createAuthHeaders }
}

/**
 * SECURITY: validate the client-signed requirements (payload.accepted) against
 * what we advertised before settling. An x402 client controls the requirements
 * it signs, so without this a client could redirect funds (payTo), pay the wrong
 * token (asset), or underpay (amount). payTo/asset are compared case-insensitively
 * (EVM address + token symbol/address casing varies); amount is compared as
 * atomic-unit BigInts (paid >= advertised passes; overpayment is allowed).
 *
 * Exported as a pure function so it is unit-testable without a live facilitator.
 */
export function crossCheckSignedRequirements(
	accepted: { payTo: string; asset: string; amount: string },
	requirements: Pick<PaymentRequirements, 'payTo' | 'asset' | 'maxAmountRequired'>,
): { ok: true } | { ok: false; error: string } {
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
	return { ok: true }
}

/**
 * Pick which advertised PaymentRequirements a payment was made against.
 *
 * The 402 challenge can advertise several networks (see config/x402Networks.ts),
 * and the payer picks ONE. Handing the facilitator the wrong entry makes
 * crossCheckSignedRequirements fail with asset_mismatch, so a payment on any
 * network other than the first would never settle.
 *
 * Matching is on `network` first (the payer's actual choice) and then `asset`,
 * because two networks can legitimately share a token address — Plasma reuses
 * mainnet's USDC address, for example, so asset alone is not a unique key.
 *
 * Falls back to the first entry when the header can't be decoded or nothing
 * matches: the caller's cross-check then rejects it, which is the safe outcome.
 * This never selects an entry the payer did not sign for.
 */
export function selectRequirementsForPayment(
	paymentHeader: string,
	accepts: PaymentRequirements[],
): PaymentRequirements {
	const fallback = accepts[0]
	if (accepts.length <= 1) return fallback

	let accepted: { network?: string; asset?: string } | undefined
	try {
		accepted = decodePaymentSignatureHeader(paymentHeader)?.accepted as typeof accepted
	} catch {
		return fallback
	}
	if (!accepted) return fallback

	const network = accepted.network ? String(accepted.network).toLowerCase() : undefined
	const asset = accepted.asset ? String(accepted.asset).toLowerCase() : undefined

	if (network) {
		const byNetwork = accepts.filter((a) => a.network.toLowerCase() === network)
		if (byNetwork.length === 1) return byNetwork[0]
		if (byNetwork.length > 1 && asset) {
			const exact = byNetwork.find((a) => a.asset.toLowerCase() === asset)
			if (exact) return exact
		}
		if (byNetwork.length > 1) return byNetwork[0]
	}

	if (asset) {
		const byAsset = accepts.find((a) => a.asset.toLowerCase() === asset)
		if (byAsset) return byAsset
	}

	return fallback
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
	const check = crossCheckSignedRequirements(accepted, requirements)
	if (!check.ok) return check

	try {
		const client = new HTTPFacilitatorClient(resolveFacilitatorConfig(env))

		const v = await client.verify(payload, accepted)
		if (!v.isValid) return { ok: false, error: v.invalidReason || 'payment_invalid' }

		const s = await client.settle(payload, accepted)
		if (!s.success) return { ok: false, error: s.errorReason || 'settle_failed' }

		return { ok: true, txHash: s.transaction, network: String(s.network), payer: s.payer }
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) }
	}
}
