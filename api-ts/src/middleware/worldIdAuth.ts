import { verifyMessage, isAddress, getAddress } from 'viem'
import type { Context, Next } from 'hono'
import type { Agent } from '../db/schema'

/**
 * AgentKit `agentkit` header verification (ETHGlobal Tokyo 2026 "Agent Swap
 * Passport" Phase 1, step 3 — see
 * docs/plans/ethglobal-tokyo2026-agent-passport.md). Sits as a gate ahead of
 * `middleware/x402Payment.ts`'s `meteredPayment` on the protected/metered
 * action, giving the "request -> completion -> validation -> protected action"
 * shape the AgentKit bounty wants.
 *
 * Confirmed header schema (pre-base64 JSON):
 *   { domain, uri, version, nonce, issuedAt (ISO8601), statement,
 *     expirationTime?, notBefore?, requestId?, resources: string[],
 *     address (EIP-55 checksummed), chainId (CAIP-2 e.g. "eip155:8453"),
 *     type: "eip191" | "eip1271", signature }
 *
 * Flow: server returns HTTP 402 with an `agentkit` extension in the x402 body
 * (info, supportedChains, mode) -> client builds an EIP-4361 (SIWE) message
 * from the challenge -> signs via personal_sign (eip191) or a wallet SDK
 * (eip1271) -> base64-encodes the full JSON into the `agentkit` header ->
 * resends the request -> we validate the signature/nonce here and either let
 * the request through to the protected action, or fall back to the standard
 * x402 payment path (the `x402` header) if AgentKit verification isn't
 * present/valid.
 *
 * This middleware never blocks the request on its own when the `agentkit`
 * header is absent — it just annotates `c.set('agentKitVerified', false)` so
 * `meteredPayment` (or a route) can fall back to standard x402 charging. It
 * only rejects when the header IS present but fails verification, since a
 * caller presenting a broken/forged AgentKit claim should not silently fall
 * through to being charged as an anonymous agent.
 */

export interface AgentKitPayload {
	domain: string
	uri: string
	version: string
	nonce: string
	issuedAt: string
	statement: string
	expirationTime?: string
	notBefore?: string
	requestId?: string
	resources: string[]
	address: string
	chainId: string
	type: 'eip191' | 'eip1271'
	signature: string
}

export interface AgentKitVerifyResult {
	verified: boolean
	payload?: AgentKitPayload
	error?: string
}

/**
 * Extra server-side context `verifyAgentKitHeader` checks the SIWE claim
 * against, beyond the signature itself.
 */
export interface AgentKitVerifyContext {
	/** Expected `domain` (host), e.g. "api.suwappu.bot". */
	expectedDomain: string
	/** CAIP-2 chain ids we accept (Base mainnet by default). */
	allowedChainIds: string[]
	/** The request path being authorized — must appear in `resources`. */
	requestPath: string
}

// --- Replay protection: server-issued, single-use nonces ---------------
//
// HACKATHON NOTE: this is a process-local in-memory Map. It is NOT safe for
// multi-instance/multi-replica deployments (a nonce issued on instance A can
// be replayed against instance B) and is lost on restart. Production needs a
// shared store (Redis/DB) keyed by nonce with TTL + atomic delete-on-consume
// (e.g. Redis `GETDEL` or a `DELETE ... RETURNING` in Postgres). Acceptable
// for the Tokyo 2026 hackathon build (single instance) only.
const NONCE_TTL_MS = 5 * 60 * 1000
const issuedNonces = new Map<string, number>() // nonce -> expiryTimestampMs

function cleanupExpiredNonces(now: number) {
	for (const [nonce, expiry] of issuedNonces) {
		if (expiry <= now) issuedNonces.delete(nonce)
	}
}

/**
 * Issue a fresh single-use nonce for an AgentKit SIWE challenge. Intended to
 * be called wherever the 402 challenge body is constructed so the nonce a
 * client signs is one the server actually tracks. Not currently wired into a
 * challenge-issuance endpoint (none exists yet) — exported so that endpoint
 * can call it when built; until then, `verifyAgentKitHeader` will reject any
 * nonce that was never issued (fail closed, not fail open).
 */
export function issueAgentKitNonce(): string {
	const now = Date.now()
	if (issuedNonces.size > 10_000) cleanupExpiredNonces(now)
	const nonce = crypto.randomUUID().replace(/-/g, '')
	issuedNonces.set(nonce, now + NONCE_TTL_MS)
	return nonce
}

/**
 * Atomically consume a nonce: returns true iff it was known and unexpired,
 * and deletes it either way so it can never be replayed.
 */
function consumeNonce(nonce: string): boolean {
	const now = Date.now()
	const expiry = issuedNonces.get(nonce)
	issuedNonces.delete(nonce)
	cleanupExpiredNonces(now)
	if (expiry === undefined) return false
	return expiry > now
}

/** Rebuild the EIP-4361 (SIWE) message the client must have signed. */
function buildSiweMessage(p: AgentKitPayload): string {
	const chainRef = p.chainId.startsWith('eip155:') ? p.chainId.split(':')[1] : p.chainId
	const lines = [
		`${p.domain} wants you to sign in with your Ethereum account:`,
		p.address,
		'',
		p.statement,
		'',
		`URI: ${p.uri}`,
		`Version: ${p.version}`,
		`Chain ID: ${chainRef}`,
		`Nonce: ${p.nonce}`,
		`Issued At: ${p.issuedAt}`,
	]
	if (p.expirationTime) lines.push(`Expiration Time: ${p.expirationTime}`)
	if (p.notBefore) lines.push(`Not Before: ${p.notBefore}`)
	if (p.requestId) lines.push(`Request ID: ${p.requestId}`)
	if (p.resources?.length) {
		lines.push('Resources:')
		for (const r of p.resources) lines.push(`- ${r}`)
	}
	return lines.join('\n')
}

/**
 * Decode + verify an `agentkit` header value. Never throws.
 */
export async function verifyAgentKitHeader(
	headerValue: string,
	ctx: AgentKitVerifyContext,
): Promise<AgentKitVerifyResult> {
	let payload: AgentKitPayload
	try {
		const json = Buffer.from(headerValue, 'base64').toString('utf8')
		payload = JSON.parse(json)
	} catch {
		return { verified: false, error: 'agentkit_header_malformed' }
	}

	const required = ['domain', 'uri', 'version', 'nonce', 'issuedAt', 'statement', 'resources', 'address', 'chainId', 'type', 'signature']
	for (const key of required) {
		if (!(key in payload)) return { verified: false, error: `agentkit_missing_field_${key}` }
	}
	// expirationTime is required (not optional) so every claim has a bounded
	// validity window — see replay-protection notes above.
	if (!payload.expirationTime) {
		return { verified: false, error: 'agentkit_missing_field_expirationTime' }
	}

	if (!isAddress(payload.address)) {
		return { verified: false, error: 'agentkit_invalid_address' }
	}
	if (getAddress(payload.address) !== payload.address) {
		return { verified: false, error: 'agentkit_address_not_checksummed' }
	}

	const now = Date.now()
	const issuedAtMs = new Date(payload.issuedAt).getTime()
	if (!Number.isFinite(issuedAtMs)) {
		return { verified: false, error: 'agentkit_invalid_issued_at' }
	}
	if (now - issuedAtMs > NONCE_TTL_MS) {
		return { verified: false, error: 'agentkit_issued_at_too_old' }
	}
	const expirationMs = new Date(payload.expirationTime).getTime()
	if (!Number.isFinite(expirationMs) || expirationMs < now) {
		return { verified: false, error: 'agentkit_expired' }
	}
	if (payload.notBefore && new Date(payload.notBefore).getTime() > now) {
		return { verified: false, error: 'agentkit_not_yet_valid' }
	}

	// Domain / chain / resource binding — a signature alone only proves key
	// control, not that it was scoped to THIS API and THIS request.
	if (payload.domain !== ctx.expectedDomain) {
		return { verified: false, error: 'agentkit_domain_mismatch' }
	}
	if (!ctx.allowedChainIds.includes(payload.chainId)) {
		return { verified: false, error: 'agentkit_chain_not_allowed' }
	}
	if (!Array.isArray(payload.resources) || !payload.resources.includes(ctx.requestPath)) {
		return { verified: false, error: 'agentkit_resource_mismatch' }
	}

	// Replay protection: nonce must be a live, server-issued, not-yet-used
	// value. consumeNonce() deletes it regardless of outcome so it can never
	// be presented twice.
	if (!consumeNonce(payload.nonce)) {
		return { verified: false, error: 'agentkit_nonce_invalid_or_reused' }
	}

	const message = buildSiweMessage(payload)

	try {
		if (payload.type === 'eip191') {
			const ok = await verifyMessage({
				address: payload.address as `0x${string}`,
				message,
				signature: payload.signature as `0x${string}`,
			})
			if (!ok) return { verified: false, error: 'agentkit_signature_invalid' }
			return { verified: true, payload }
		}

		if (payload.type === 'eip1271') {
			// EIP-1271 (smart-contract wallets) requires an on-chain isValidSignature
			// call scoped to the account's chain. viem's verifyTypedData/verifyMessage
			// support this transparently when given a `client`, but wiring a
			// per-chainId viem client is out of scope for the hackathon Phase 1
			// build — flagged as a follow-up rather than silently accepting.
			return { verified: false, error: 'agentkit_eip1271_not_implemented' }
		}

		return { verified: false, error: 'agentkit_unknown_type' }
	} catch (e) {
		return {
			verified: false,
			error: e instanceof Error ? `agentkit_verify_error: ${e.message}` : 'agentkit_verify_error',
		}
	}
}

/**
 * Hono middleware: verifies the `agentkit` header if present and stamps
 * `c.set('agentKitVerified', boolean)` + `c.set('agentKitAddress', address?)`
 * for downstream middleware (meteredPayment) or route handlers to consume.
 * Must run BEFORE `meteredPayment` so the payment gate can honor an
 * AgentKit-verified request (discount/bypass mode) or fall back to standard
 * x402 (`X-PAYMENT` / `x402` header) charging.
 *
 * Does NOT reject requests with no `agentkit` header — that's the expected
 * fallback path. DOES reject (400) when the header is present but invalid,
 * since that indicates a forged/broken claim rather than "not using AgentKit".
 */
/** CAIP-2 chains this deployment accepts AgentKit SIWE claims for (Base mainnet). */
const ALLOWED_CHAIN_IDS = ['eip155:8453']

export function worldIdAuth() {
	return async (c: Context, next: Next) => {
		const header = c.req.header('agentkit')
		if (!header) {
			c.set('agentKitVerified', false)
			await next()
			return
		}

		const { EnvService } = await import('../config/EnvService')
		const { runEffectEither } = await import('../runtime')
		const { Effect } = await import('effect')
		const env = await runEffectEither(Effect.gen(function* () { return yield* EnvService }))
		const expectedDomain = env._tag === 'Right' ? env.right.API_DOMAIN : undefined
		if (!expectedDomain) {
			return c.json(
				{ success: false, error: 'AgentKit header verification failed', reason: 'agentkit_domain_not_configured' },
				400,
			)
		}

		const result = await verifyAgentKitHeader(header, {
			expectedDomain,
			allowedChainIds: ALLOWED_CHAIN_IDS,
			requestPath: new URL(c.req.url).pathname,
		})
		c.set('agentKitVerified', false)
		if (!result.verified || !result.payload) {
			return c.json(
				{
					success: false,
					error: 'AgentKit header verification failed',
					reason: result.error,
				},
				400,
			)
		}

		// Address-to-agent binding: a valid SIWE signature only proves control of
		// `address`'s key — it says nothing about which *agent* is calling. Tie
		// it to the authenticated agent's on-record managed-wallet address using
		// the same convention as checkEvmWalletOwnership() (agent.ts). If the
		// agent has no wallet on record, or it doesn't match, this claim is
		// simply not trusted for AgentKit purposes — fall through to standard
		// x402 rather than 400, since older agents predate wallet registration.
		const agent = c.get('agent') as Agent | undefined
		const agentWallet = ((agent?.metadata || {}) as Record<string, unknown>).wallet_address
		const bound =
			!!agent &&
			typeof agentWallet === 'string' &&
			isAddress(agentWallet) &&
			agentWallet.toLowerCase() === result.payload.address.toLowerCase()

		if (bound) {
			c.set('agentKitVerified', true)
			c.set('agentKitAddress', result.payload.address)
			c.set('agentKitPayload', result.payload)
		}
		await next()
	}
}
