/**
 * Thin client for World ID proof verification (World ID 4.0 / managed RP flow).
 *
 * Hackathon build note (ETHGlobal Tokyo 2026 "Agent Swap Passport", see
 * docs/plans/ethglobal-tokyo2026-agent-passport.md Phase 1): we're on a managed
 * RP (World ID 4.0), not the older app-only IDKit flow, so verification is
 * scoped by `rp_id` rather than `app_id`:
 *
 *   POST https://developer.world.org/api/v4/verify/{rp_id}
 *
 * Confirmed live against a real staging proof (generated via the World ID
 * simulator + `@worldcoin/idkit-core`'s `IDKit.request()`, protocol_version
 * "3.0"/legacy-shaped credential) on 2026-09-26 — the real request body shape
 * is NOT the flat `{proof, merkle_root, nullifier_hash, verification_level}`
 * envelope an earlier pass assumed. It is:
 *
 *   {
 *     action, signal, environment, protocol_version, nonce,
 *     responses: [{ identifier, merkle_root, nullifier, proof, signal_hash }],
 *     rp_context: { rp_id, nonce, created_at, expires_at, signature },
 *   }
 *
 * `rp_context` is an RP-signed attestation (EIP-191 signature over
 * nonce+created_at+expires_at+action) proving the verify call comes from an
 * authorized RP. It does NOT need to be the same rp_context used when the
 * client originally built the IDKit request — a freshly server-generated one
 * (fresh nonce, signed now) verifies exactly the same live proof, confirmed
 * empirically. So this client is self-contained: no separate challenge/nonce
 * issuance endpoint is needed, `verifyWorldIdProof` mints its own rp_context
 * per call via `signRequest()`.
 *
 * The response shape is also different from the earlier assumption:
 *   { success, action, nullifier, environment, protocol_version,
 *     results: [{ identifier, success, nullifier }], message }
 * — not `{success, nullifier_hash, verification_level}`.
 *
 * Fails closed: any missing config, network error, or non-2xx response
 * returns `{ verified: false }` rather than throwing or defaulting to
 * "verified". Callers must never treat an exception as success.
 */

import { signRequest } from '@worldcoin/idkit-server'

export interface WorldIdConfig {
	rpId: string
	action: string
	/** RP signing key (hex, 0x-prefixed) from `configure_world_id` — signs the rp_context. */
	signingKeyHex?: string
	apiKey?: string
	baseUrl?: string
	/**
	 * Staging-only: token issued by the dev portal's temporary staging
	 * verification window (`set_world_id_staging_verification`). Required for
	 * the portal to accept staging/simulator-generated proofs; never used in
	 * production.
	 */
	stagingVerificationToken?: string
}

export interface WorldIdCredentialResponse {
	identifier: string
	merkle_root: string
	nullifier: string
	proof: string
	signal_hash?: string
}

export interface WorldIdProofInput {
	/** protocol_version reported by the client SDK, e.g. "3.0". */
	protocol_version: string
	/** One or more credential responses (orb/device/etc.) from the client. */
	responses: WorldIdCredentialResponse[]
	environment?: 'production' | 'staging' | 'sandbox'
	/**
	 * Server-computed signal (e.g. the calling agent's id). NEVER accept a
	 * caller-supplied signal — that would let a caller bind the proof to an
	 * arbitrary identity instead of the one actually presenting it.
	 */
	signal?: string
}

export interface WorldIdVerifyResult {
	verified: boolean
	nullifierHash?: string
	verificationLevel?: string
	error?: string
	/** Raw response code from World ID (e.g. "max_verifications_reached"). */
	code?: string
}

const DEFAULT_BASE_URL = 'https://developer.world.org'

/**
 * Verify a World ID proof against the configured RP. Never throws.
 */
export async function verifyWorldIdProof(
	config: WorldIdConfig,
	input: WorldIdProofInput,
	timeoutMs = 8000,
): Promise<WorldIdVerifyResult> {
	if (!config.rpId || !config.signingKeyHex) {
		return { verified: false, error: 'world_id_not_configured' }
	}
	if (!input.responses || input.responses.length === 0 || !input.protocol_version) {
		return { verified: false, error: 'missing_proof_fields' }
	}
	for (const r of input.responses) {
		if (!r.proof || !r.merkle_root || !r.nullifier || !r.identifier) {
			return { verified: false, error: 'missing_proof_fields' }
		}
	}

	let rpContext: ReturnType<typeof signRequest>
	try {
		rpContext = signRequest({ signingKeyHex: config.signingKeyHex, action: config.action, ttl: 300 })
	} catch (e) {
		return {
			verified: false,
			error: e instanceof Error ? `rp_context_sign_error: ${e.message}` : 'rp_context_sign_error',
		}
	}

	const baseUrl = config.baseUrl || DEFAULT_BASE_URL
	const url = `${baseUrl}/api/v4/verify/${config.rpId}`

	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), timeoutMs)

	try {
		const res = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
				...(config.stagingVerificationToken
					? { 'x-staging-verification-token': config.stagingVerificationToken }
					: {}),
			},
			body: JSON.stringify({
				// Always the server-configured action — never let the caller override
				// which action a proof is checked against.
				action: config.action,
				environment: input.environment || 'staging',
				protocol_version: input.protocol_version,
				nonce: rpContext.nonce,
				responses: input.responses,
				rp_context: {
					rp_id: config.rpId,
					nonce: rpContext.nonce,
					created_at: rpContext.createdAt,
					expires_at: rpContext.expiresAt,
					signature: rpContext.sig,
				},
				...(input.signal ? { signal: input.signal } : {}),
			}),
			signal: controller.signal,
		})

		const body = (await res.json().catch(() => ({}))) as {
			success?: boolean
			nullifier?: string
			protocol_version?: string
			results?: { identifier: string; success: boolean; nullifier: string }[]
			code?: string
			detail?: string
		}

		// Fail closed: require an explicit 2xx AND an explicit `success: true`
		// body. No `!== false` inversions — a missing/malformed body must be
		// treated as failure, never as success by default.
		if (!res.ok || body.success !== true) {
			return {
				verified: false,
				error: body.detail || `world_id_verify_failed_${res.status}`,
				code: body.code,
			}
		}

		// Only trust values the portal actually returned. A missing nullifier
		// from an otherwise-2xx/success response is treated as a failure rather
		// than falling back to a caller-supplied value (which would let a
		// caller assert its own nullifier/identifier).
		if (!body.nullifier) {
			return { verified: false, error: 'world_id_verify_missing_nullifier' }
		}

		return {
			verified: true,
			nullifierHash: body.nullifier,
			verificationLevel: body.results?.[0]?.identifier,
		}
	} catch (e) {
		return {
			verified: false,
			error: e instanceof Error ? `world_id_request_error: ${e.message}` : 'world_id_request_error',
		}
	} finally {
		clearTimeout(timer)
	}
}
