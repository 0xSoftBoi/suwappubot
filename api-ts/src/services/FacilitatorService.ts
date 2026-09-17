/**
 * x402 facilitator client — direct on-chain settlement of a single API/MCP call.
 *
 * This is the "native x402" path: instead of pre-funding credits, an x402 client
 * (@x402/fetch / @x402/axios) signs an EIP-3009 USDC authorization, encodes it
 * into the payment header, and retries. We hand that payload to a facilitator
 * which verifies the signature and settles the transfer on-chain, so we never
 * run chain infra ourselves.
 *
 * Uses the OFFICIAL maintained `@x402/core` client (`HTTPFacilitatorClient`) for
 * verify+settle rather than a hand-rolled HTTP contract. Our challenge and
 * payment payload are x402 v1-shaped; the client posts the versioned payload and
 * canonical requirements separately. The default URL is the testnet facilitator;
 * point X402_FACILITATOR_URL at CDP's hosted facilitator
 * (https://api.cdp.coinbase.com/platform/v2/x402) for mainnet.
 *
 * Gated by X402_FACILITATOR_ENABLED. CDP's hosted facilitator covers
 * Base/Polygon/Arbitrum/World/Solana; our own chains (e.g. Tempo) are not
 * facilitated and must use prepaid credits / the internal verifier instead.
 *
 * SECURITY: a v1 x402 client sends its chosen scheme/network at the top level and
 * an EIP-3009 authorization under `payload`. We select exactly one matching member
 * of the server-owned `accepts[]`, bind the signed authorization recipient/value
 * to it, and pass that canonical server member to the facilitator. The client can
 * never supply or rewrite the requirements used for verification/settlement.
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
	decodePaymentSignatureHeader,
	type FacilitatorConfig,
	HTTPFacilitatorClient,
} from '@x402/core/http'
import { isPaymentPayloadV1 } from '@x402/core/schemas'
import type { PaymentPayloadV1 } from '@x402/core/types/v1'

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

type V1FacilitatorClient = {
	verify(
		paymentPayload: PaymentPayloadV1,
		paymentRequirements: PaymentRequirements,
	): Promise<{ isValid: boolean; invalidReason?: string }>
	settle(
		paymentPayload: PaymentPayloadV1,
		paymentRequirements: PaymentRequirements,
	): Promise<{
		success: boolean
		errorReason?: string
		transaction?: string
		network?: string
		payer?: string
	}>
}

type V1FacilitatorClientFactory = (config: FacilitatorConfig) => V1FacilitatorClient

const createV1FacilitatorClient: V1FacilitatorClientFactory = (config) => {
	// @x402/core ships v1 payload/requirements types and its HTTP runtime forwards
	// both objects without reshaping. Its current HTTP method declarations expose
	// only the v2 aliases, so isolate that declaration mismatch at this boundary.
	return new HTTPFacilitatorClient(config) as unknown as V1FacilitatorClient
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
 * SECURITY: validate a v1 payment payload against one canonical advertised
 * requirement. Top-level version/scheme/network identify the server member;
 * signed EIP-3009 authorization.to/value bind its recipient and minimum amount.
 * The asset is intentionally not read from the client: it comes only from the
 * canonical server requirement later passed to facilitator verify and settle.
 *
 * Exported as a pure function so it is unit-testable without a live facilitator.
 */
export function crossCheckSignedRequirements(
	paymentPayload: {
		x402Version?: unknown
		scheme?: unknown
		network?: unknown
		payload?: unknown
	},
	requirements: Pick<PaymentRequirements, 'scheme' | 'network' | 'payTo' | 'maxAmountRequired'>,
): { ok: true } | { ok: false; error: string } {
	if (paymentPayload.x402Version !== 1) {
		return { ok: false, error: 'version_mismatch' }
	}
	if (String(paymentPayload.scheme) !== requirements.scheme) {
		return { ok: false, error: 'scheme_mismatch' }
	}
	if (String(paymentPayload.network) !== requirements.network) {
		return { ok: false, error: 'network_mismatch' }
	}

	const body = paymentPayload.payload
	if (!body || typeof body !== 'object') {
		return { ok: false, error: 'authorization_missing' }
	}
	const authorization = (body as Record<string, unknown>).authorization
	if (!authorization || typeof authorization !== 'object') {
		return { ok: false, error: 'authorization_missing' }
	}
	const { to, value } = authorization as Record<string, unknown>
	if (typeof to !== 'string' || to.toLowerCase() !== requirements.payTo.toLowerCase()) {
		return { ok: false, error: 'payTo_mismatch' }
	}
	try {
		if (typeof value !== 'string' || BigInt(value) < BigInt(requirements.maxAmountRequired)) {
			return { ok: false, error: 'amount_too_low' }
		}
	} catch {
		return { ok: false, error: 'amount_unparseable' }
	}
	return { ok: true }
}

function decodeV1PaymentHeader(paymentHeader: string): PaymentPayloadV1 | undefined {
	let decoded: unknown
	try {
		decoded = decodePaymentSignatureHeader(paymentHeader) as unknown
	} catch {
		return undefined
	}
	return isPaymentPayloadV1(decoded) ? (decoded as PaymentPayloadV1) : undefined
}

/**
 * Pick which advertised PaymentRequirements a payment was made against.
 *
 * The 402 challenge can advertise several networks (see config/x402Networks.ts),
 * and the payer picks ONE. Handing the facilitator the wrong entry makes
 * crossCheckSignedRequirements fail with asset_mismatch, so a payment on any
 * network other than the first would never settle.
 *
 * V1 identifies the chosen requirement by the top-level scheme/network pair.
 * That pair must select exactly one advertised member; duplicates are ambiguous
 * and fail closed. The signed authorization recipient/value must then validate
 * against that canonical member. There is no first-entry or asset fallback.
 */
export function selectRequirementsForPayment(
	paymentHeader: string,
	accepts: PaymentRequirements[],
): PaymentRequirements | undefined {
	const paymentPayload = decodeV1PaymentHeader(paymentHeader)
	if (!paymentPayload) return undefined

	const matches = accepts.filter(
		(requirements) =>
			requirements.scheme === paymentPayload.scheme &&
			requirements.network === paymentPayload.network,
	)
	if (matches.length !== 1) return undefined

	const requirements = matches[0]
	return requirements && crossCheckSignedRequirements(paymentPayload, requirements).ok
		? requirements
		: undefined
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
	clientFactory: V1FacilitatorClientFactory = createV1FacilitatorClient,
): Promise<SettleResult> {
	if (!isFacilitatorEnabled(env)) return { ok: false, error: 'facilitator_disabled' }

	const payload = decodeV1PaymentHeader(paymentHeader)
	if (!payload) return { ok: false, error: 'invalid_payment_header' }

	// Defense in depth: even though the caller selected this canonical server
	// requirement, validate the v1 payload against it again before any HTTP call.
	const check = crossCheckSignedRequirements(payload, requirements)
	if (!check.ok) return check

	try {
		const client = clientFactory(resolveFacilitatorConfig(env))

		const v = await client.verify(payload, requirements)
		if (!v.isValid) return { ok: false, error: v.invalidReason || 'payment_invalid' }

		const s = await client.settle(payload, requirements)
		if (!s.success) return { ok: false, error: s.errorReason || 'settle_failed' }

		return { ok: true, txHash: s.transaction, network: String(s.network), payer: s.payer }
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) }
	}
}
