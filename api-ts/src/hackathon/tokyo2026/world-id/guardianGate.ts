/**
 * Guardian gate: a human proves unique personhood (World ID) to authorize one
 * specific agent trade intent. Server-driven vanilla idkit-core flow — the
 * client (Telegram bot / terminal) only displays `connectorURI` as a QR.
 *
 * Security properties:
 * - `signal` binds the proof to the exact trade intent (chain, pair, amount,
 *   agent, nonce). A proof verified for trade A cannot authorize trade B.
 * - The proof JSON is forwarded to the verifier byte-identical — never mutate,
 *   re-encode, or trim it.
 * - `(action, nullifier)` is stored with a UNIQUE constraint (NUMERIC(78,0));
 *   replays are rejected by the database, not just app logic.
 */
import { IDKit, hashSignal, proofOfHuman } from '@worldcoin/idkit-core'
import { createHash } from 'node:crypto'
import { makeRpContext } from './rpSignature.ts'
import type { WorldIdConfig } from './config.ts'

/** The trade the human is being asked to approve. */
export interface TradeIntent {
	agentId: string
	chain: string
	fromToken: string
	toToken: string
	amountIn: string
	/** Human-readable summary shown next to the QR, e.g. "Swap 1.5 ETH → USDC on Base". */
	summary: string
	nonce: string
}

/** Deterministic binding of a proof to one intent. */
export function hashIntent(intent: Omit<TradeIntent, 'summary'>): string {
	const canonical = [
		intent.agentId,
		intent.chain.toLowerCase(),
		intent.fromToken.toLowerCase(),
		intent.toToken.toLowerCase(),
		intent.amountIn,
		intent.nonce,
	].join('|')
	return '0x' + createHash('sha256').update(canonical).digest('hex')
}

/**
 * Canonicalize a World ID nullifier for storage.
 *
 * The verifier returns nullifiers as 0x-prefixed hex strings representing
 * 256-bit integers (uint256 onchain — WorldIDIdentityManager.verifyProof
 * takes `uint256 nullifierHash`). We store NUMERIC(78,0) decimals, per the
 * official Worldcoin integration guide: text storage invites parsing/casing
 * bugs that become replay vulnerabilities. Throws on malformed input — the
 * caller must fail closed.
 */
export function normalizeNullifier(nullifier: string): string {
	if (typeof nullifier !== 'string' || !/^0x[0-9a-fA-F]+$/.test(nullifier)) {
		throw new Error('malformed nullifier: expected 0x-prefixed hex')
	}
	const hex = nullifier.slice(2)
	if (hex.length > 64) {
		throw new Error('malformed nullifier: exceeds 256 bits')
	}
	return BigInt(`0x${hex}`).toString(10)
}

/**
 * Nullifier store contract. `consume` records (action, nullifier) and returns
 * true on first use, false when already consumed. `nullifier` is the raw hex
 * string from the verifier; stores canonicalize via `normalizeNullifier`
 * before persisting. Malformed nullifiers throw (fail closed upstream) —
 * false means strictly "already consumed". The check-and-insert MUST be
 * atomic — concurrent consumes of the same proof must let exactly one win.
 * `MemoryNullifierStore` is single-process/demo-only; production uses a
 * durable store with a UNIQUE (nullifier, action) constraint over
 * NUMERIC(78,0) (see api-ts/src/hackathon/worldIdNullifiers.ts).
 */
export interface NullifierStore {
	consume(action: string, nullifier: string): Promise<boolean>
}

/**
 * Minimal nullifier store. In-memory version for the demo/tests only — it
 * enforces the same uniqueness contract within one process. Async to match
 * the NullifierStore interface; the Set operations are still atomic within
 * a single Node/Bun process (no awaits between check and insert).
 */
export class MemoryNullifierStore implements NullifierStore {
	private seen = new Set<string>()
	/** Returns false when this (action, nullifier) was already consumed. */
	async consume(action: string, nullifier: string): Promise<boolean> {
		const key = `${action}:${normalizeNullifier(nullifier)}`
		if (this.seen.has(key)) return false
		this.seen.add(key)
		return true
	}
}

export interface PendingVerification {
	requestId: string
	/** Render as QR for the human to scan with World App. */
	connectorURI: string
	intent: TradeIntent
	signal: string
	startedAt: Date
	/**
	 * The live IDKit request. Poll it with `pollForCompletion`, then pass the
	 * completed proof to `verifyTradeProof`. Kept opaque here so the polling
	 * loop stays in one place.
	 */
	_poll: () => Promise<unknown>
}

function buildRequest(cfg: WorldIdConfig, signal: string, action: string) {
	return IDKit.request({
		app_id: cfg.appId,
		action,
		rp_context: makeRpContext({
			rpId: cfg.rpId,
			signingKeyHex: cfg.signingKeyHex,
			action,
		}),
		allow_legacy_proofs: true,
		environment: cfg.environment,
	}).preset(proofOfHuman({ signal }))
}

/**
 * Step 1 — create the verification request; display `connectorURI` to the human.
 * `action` defaults to cfg.action (the guardian gate); pass cfg.stepUpAction
 * for step-up re-verifications — same human + same action yields the same
 * nullifier, so reusing the gate action would replay-reject the fresh proof.
 */
export async function startTradeVerification(
	cfg: WorldIdConfig,
	intent: TradeIntent,
	action: string = cfg.action,
): Promise<PendingVerification> {
	const signal = hashIntent(intent)
	const request = await buildRequest(cfg, signal, action)
	return {
		requestId: request.requestId,
		connectorURI: request.connectorURI,
		intent,
		signal,
		startedAt: new Date(),
		_poll: async () => {
			const completed = await request.pollUntilCompletion({
				pollInterval: 2000,
				timeout: 5 * 60 * 1000,
			})
			return completed
		},
	}
}

export interface VerifyResult {
	ok: boolean
	nullifier?: string
	reason?: string
}

/**
 * Step 2 — wait for the human, then verify server-side.
 * Returns ok:false (never throws) on: user decline / expiry / cancellation /
 * invalid proof / replay / signal mismatch. Callers map these to
 * "trade blocked" with the reason shown to the user.
 * `action` must be the same action passed to startTradeVerification —
 * the verifier checks the proof is bound to it and the nullifier is
 * consumed under it.
 */
export async function awaitAndVerifyTradeApproval(
	cfg: WorldIdConfig,
	pending: PendingVerification,
	store: NullifierStore,
	action: string = cfg.action,
): Promise<VerifyResult> {
	let completed: unknown
	try {
		completed = await pending._poll()
	} catch (e) {
		return { ok: false, reason: `verification not completed: ${(e as Error).message}` }
	}
	// pollUntilCompletion() never throws: it resolves to a discriminated
	// envelope `{success:true, result}` | `{success:false, error}`. The
	// verifier wants the bare v4 result (`protocol_version`, `nonce`, `action`,
	// `responses`, ...) — posting the envelope yields
	// `400 validation_error: action is required for uniqueness proofs`.
	const env = completed as { success?: boolean; result?: unknown; error?: string } | null
	if (!env || typeof env !== 'object') {
		return { ok: false, reason: 'verification not completed: empty IDKit result' }
	}
	if (env.success !== true || !env.result) {
		return { ok: false, reason: `verification not completed: ${env.error ?? 'unknown_error'}` }
	}
	return verifyTradeProof(cfg, env.result, pending.signal, action, store)
}

/**
 * Step 2b — verify a completed proof against World's verifier, backend-side.
 * `proof` must be the exact object IDKit produced.
 */
export async function verifyTradeProof(
	cfg: WorldIdConfig,
	proof: unknown,
	expectedSignal: string,
	expectedAction: string,
	store: NullifierStore,
): Promise<VerifyResult> {
	// Accept either the bare v4 result or (defensively) the IDKit completion
	// envelope, so HTTP callers that forward `pollUntilCompletion()` verbatim
	// still verify.
	const bare =
		proof && typeof proof === 'object' && 'result' in (proof as Record<string, unknown>)
			? (proof as { result: unknown }).result
			: proof
	const p = bare as { responses?: Array<{ signal_hash?: string }> } | null
	if (!p || typeof p !== 'object' || !Array.isArray(p.responses) || p.responses.length === 0) {
		return { ok: false, reason: 'proof malformed: no credential responses' }
	}
	// World's verify response carries no `signal`; the binding lives in each
	// response item's `signal_hash`. Check it here, before spending a verifier
	// call, against the hash IDKit derives from the signal we issued.
	const expectedHash = hashSignal(expectedSignal).toLowerCase()
	if (!p.responses.every((r) => (r.signal_hash ?? '').toLowerCase() === expectedHash)) {
		return { ok: false, reason: 'proof signal does not match this trade intent' }
	}
	let res: Response
	try {
		const headers: Record<string, string> = { 'Content-Type': 'application/json' }
		// Staging proofs are refused (403 environment_not_allowed) without the
		// token from the app's open staging window. Production never sends it.
		if (cfg.environment === 'staging' && cfg.stagingVerificationToken) {
			headers['x-staging-verification-token'] = cfg.stagingVerificationToken
		}
		res = await fetch(`https://developer.world.org/api/v4/verify/${cfg.rpId}`, {
			method: 'POST',
			headers,
			body: JSON.stringify(bare),
		})
	} catch (e) {
		return { ok: false, reason: `verifier unreachable: ${(e as Error).message}` }
	}
	if (!res.ok) {
		// World returns the rejection reason in the body (e.g. invalid_proof,
		// invalid_merkle_root, max_verifications_reached). Keep a bounded excerpt
		// so operators can see *why* instead of a bare status code.
		const detail = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300)
		return {
			ok: false,
			reason: `verifier rejected proof (http ${res.status})${detail ? `: ${detail}` : ''}`,
		}
	}
	const data = (await res.json()) as {
		success?: boolean
		nullifier?: string
		signal?: string
		action?: string
		code?: string
		detail?: string
	}
	if (!data.success) {
		return { ok: false, reason: `proof invalid: ${data.code ?? 'unknown'} ${data.detail ?? ''}`.trim() }
	}
	if (data.action !== expectedAction) {
		return { ok: false, reason: 'proof bound to a different action' }
	}
	if (!data.nullifier) {
		return { ok: false, reason: 'verifier returned no nullifier' }
	}
	// Malformed nullifiers throw out of consume (fail closed); false is
	// strictly "already consumed". Distinguish the two for the user.
	let consumed: boolean
	try {
		consumed = await store.consume(expectedAction, data.nullifier)
	} catch (e) {
		return { ok: false, reason: `nullifier rejected: ${(e as Error).message}` }
	}
	if (!consumed) {
		return { ok: false, reason: 'proof already used (replay rejected)' }
	}
	return { ok: true, nullifier: data.nullifier }
}
