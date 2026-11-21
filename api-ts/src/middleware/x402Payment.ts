import { decodePaymentSignatureHeader, encodePaymentRequiredHeader } from '@x402/core/http'
import type {
	PaymentRequired as X402PaymentRequired,
	PaymentRequirements as X402PaymentRequirements,
} from '@x402/core/types'
import { eq, sql } from 'drizzle-orm'
import { Effect, Either } from 'effect'
import type { Context, Next } from 'hono'
import { EnvService } from '../config/EnvService'
import { requireDb } from '../db/DrizzleService'
import { agentCredits, agents } from '../db/schema'
import { InterceptaUnavailableError, quickScan } from '../lib/intercepta'
import { logger } from '../lib/logger'
import { runEffectEither } from '../runtime'
import { isFacilitatorEnabled } from '../services/FacilitatorService'
import {
	buildPaymentRequired,
	decodePayment,
	resourceUrl,
	staticRequirements,
	verifyAndSettle,
	X402_VERSION,
	type X402ServiceEnv,
} from '../services/X402ResourceService'

/**
 * Agent pay-per-call metering (x402 prepaid credits + on-chain micropayments).
 *
 * Layered monetization model (free → per-call → credits → subscription):
 *   1. Bypass tier (active subscription / 'agent'/'pro') → free, no charge.
 *   2. Prepaid credit balance → deducted atomically per call (lowest latency).
 *   3. Insufficient credits → x402 HTTP 402 challenge so the caller can either
 *      top up credits OR settle the single call on-chain via a facilitator.
 *
 * Gated by AGENT_METERING_ENABLED (default 'false') so it is safe to merge/deploy
 * without blocking existing free agents.
 *
 * Credit unit: 1 credit ≈ $0.001 USD.
 */

export const CREDIT_USD_VALUE = 0.001

/**
 * Per-endpoint cost in credits for the REST agent surface (/v1/agent/*).
 * Keyed by a logical endpoint name passed to meteredPayment(). Tune sensibly:
 * reads are cheap, swap execution is dear.
 */
export const COST_WEIGHTS: Record<string, number> = {
	quote: 1,
	swap: 5,
	execute: 5,
	'swap/execute': 5,
	// Read-only dry run (no signing/broadcast) — priced like /quote, not /swap.
	'swap/simulate': 1,
	portfolio: 1,
	prices: 1,
	// Read-only discovery endpoints are free — matches MCP's list_tokens/list_chains
	// (both 0 in MCP_TOOL_COSTS below) so a fresh 0-credit agent can still browse.
	tokens: 0,
	chains: 0,
}

/**
 * Per-tool cost in credits for the MCP surface (/mcp tools/call). Read-only
 * discovery/quote tools are cheap; anything that prepares an executable
 * transaction is dear. Tools not listed default to 1 credit.
 */
export const MCP_TOOL_COSTS: Record<string, number> = {
	// Reads / discovery — 1 credit (~$0.001)
	get_prices: 1,
	list_chains: 0,
	list_tokens: 0,
	get_tempo_tokens: 0,
	browse_mpp_directory: 0,
	get_portfolio: 1,
	predict_markets: 1,
	predict_market: 1,
	predict_market_detail: 1,
	perps_markets: 1,
	perps_positions: 1,
	lend_markets: 1,
	lend_market: 1,
	// Quotes — modest compute + upstream cost
	get_quote: 1,
	perps_quote: 1,
	// Read-only dry run (no signing/broadcast) — priced like get_quote
	simulate_swap: 1,
	// Executable transaction preparation — dear
	execute_swap: 5,
	// Read-only account/status lookups — priced like get_portfolio/get_prices
	get_swap_status: 1,
	get_swap_history: 1,
	list_wallet_policies: 1,
	// Pure NEAR asset helpers — no upstream call, no agent state
	near_resolve_asset: 0,
	near_convert_amount: 0,
	// Prediction market order book / price / trades — same tier as predict_markets
	predict_book: 1,
	predict_price: 1,
	predict_trades: 1,
}

/**
 * Rate-limit tiers that bypass metering entirely (treated as "paid / active
 * subscription"). Agents have no human subscription row, so the paid signal is
 * the agent's own rateLimitTier. Free agents are metered; 'agent'/'pro' are not.
 *
 * Crypto-native agent subscriptions (see routes/agent.ts billing/subscribe)
 * promote an agent's effective tier into this set for the subscription window.
 */
export const BYPASS_TIERS = new Set(['agent', 'pro', 'premium', 'enterprise'])

/**
 * Resources eligible for the demo-agent quote exemption (see DEMO_UNMETERED_AGENT_IDS
 * below). Matched EXACTLY against `resource` as populated by the two charge call
 * sites: meteredPayment() passes `c.req.path` (REST) and the MCP tools/call handler
 * passes `mcp://tools/${name}` (MCP). Intentionally a tiny, explicit allowlist —
 * anything not listed here (swap prep, execute, portfolio, etc.) stays metered.
 */
const DEMO_UNMETERED_RESOURCES = new Set(['/v1/agent/quote', 'mcp://tools/get_quote'])

/**
 * Parse DEMO_UNMETERED_AGENT_IDS into a case-insensitive set of trimmed UUIDs.
 * Only the string-splitting happens per-request: the env value itself is frozen
 * at boot (EnvServiceLive decodes process.env once and the ManagedRuntime
 * memoizes it), so adding or REVOKING an exempt agent requires a redeploy —
 * clearing the Railway var alone does nothing until the service restarts.
 */
/**
 * First-hit-per-boot log for demo-exempt calls (per uuid×resource), so the
 * exemption's activity is visible in service logs without per-request noise.
 */
const demoExemptSeen = new Set<string>()
export function noteDemoExemptHit(agentUuid: string, resource: string): void {
	const key = `${agentUuid}|${resource}`
	if (demoExemptSeen.has(key)) return
	demoExemptSeen.add(key)
	// eslint-disable-next-line no-console
	console.warn(`[x402Payment] demo metering exemption active: agent ${agentUuid} on ${resource}`)
}

function parseDemoUnmeteredAgentIds(raw: string | undefined): Set<string> {
	if (!raw) return new Set()
	return new Set(
		raw
			.split(',')
			.map((s) => s.trim().toLowerCase())
			.filter(Boolean),
	)
}

/**
 * Pure decision function: does this (agent, resource) pair qualify for the
 * demo quote-only metering exemption? Exported (rather than inlined into
 * chargeAgentForCall) so it's directly unit-testable without needing the
 * live EnvService/DB runtime — mirrors costForTool/costForEndpoint's
 * pure-and-exported pattern in this file.
 *
 * Deliberately NOT a tier bypass: this is a server-side showcase proxy key
 * exemption, scoped to a read-only resource allowlist (DEMO_UNMETERED_RESOURCES).
 * Anything else for the same agent (swap prep, execute, portfolio, etc.)
 * returns false here and falls through to normal metering.
 */
export function isDemoUnmeteredCall(params: {
	agentUuid?: string
	resource: string
	demoUnmeteredAgentIds?: string
}): boolean {
	const { agentUuid, resource, demoUnmeteredAgentIds } = params
	if (!agentUuid) return false
	if (!DEMO_UNMETERED_RESOURCES.has(resource)) return false
	const demoIds = parseDemoUnmeteredAgentIds(demoUnmeteredAgentIds)
	return demoIds.has(agentUuid.trim().toLowerCase())
}

function costForEndpoint(endpoint: string): number {
	return COST_WEIGHTS[endpoint] ?? 1
}

/** Per-tool MCP cost in credits (0 = free read). Unknown tools default to 1. */
export function costForTool(toolName: string): number {
	return MCP_TOOL_COSTS[toolName] ?? 1
}

/** Convert a credit cost to USDC base units (6 decimals) as a decimal string. */
export function creditsToUsdcBaseUnits(credits: number): string {
	const usd = credits * CREDIT_USD_VALUE
	return BigInt(Math.round(usd * 1_000_000)).toString()
}

/**
 * Build an x402 **v2** payment challenge body (PaymentRequired).
 *
 * v2 wire shape: `{ x402Version: 2, resource: {url, description, mimeType},
 * accepts: [{scheme, network: CAIP-2, amount, asset, payTo, maxTimeoutSeconds,
 * extra}], extensions }`. The same object is base64'd into the
 * `PAYMENT-REQUIRED` header (v2 moves payment data to headers); it is also the
 * JSON body so agents that read the body keep working, alongside our stable
 * legacy fields (error_code / cost_credits / topup / subscribe).
 *
 * This sync builder is the static baseline (exact on every network + one
 * batch-settlement entry per batch network). chargeAgentForCall upgrades
 * `accepts` through the SDK (services/X402ResourceService.buildPaymentRequired)
 * so batch entries carry receiverAuthorizer / withdrawDelay / minDeposit.
 */
export type X402EnvLike = {
	AGENT_METERING_COLLECTOR_ADDRESS?: string
	FEE_WALLET_EVM: string
	AGENT_METERING_NETWORK: string
	AGENT_METERING_USDC_ADDRESS: string
	/** Comma-separated extra x402 payment networks (e.g. "robinhood"). Opt-in. */
	X402_EXTRA_NETWORKS?: string
	X402_FACILITATOR_ENABLED?: string
	X402_BATCH_SETTLEMENT_ENABLED?: string
	X402_BATCH_NETWORKS?: string
	X402_PUBLIC_ORIGIN?: string
}

export function buildX402Challenge(
	env: X402EnvLike,
	opts: { cost: number; resource: string; description: string; error?: string },
) {
	const amount = creditsToUsdcBaseUnits(opts.cost)
	const svcEnv = env as unknown as X402ServiceEnv
	const accepts: X402PaymentRequirements[] = staticRequirements(svcEnv, amount)

	return {
		x402Version: X402_VERSION,
		error: opts.error ?? 'insufficient_credits',
		resource: {
			url: resourceUrl(svcEnv, opts.resource),
			description: opts.description,
			mimeType: 'application/json',
		},
		accepts,
		extensions: undefined as Record<string, unknown> | undefined,
		// Stable 17-code contract (see lib/agentError.ts) — keep `error` for
		// back-compat with existing SDK/agent consumers reading the old field.
		error_code: 'INSUFFICIENT_CREDITS' as const,
		cost_credits: opts.cost,
		credit_usd_value: CREDIT_USD_VALUE,
		topup: 'POST /v1/agent/billing/topup with {txHash, chain, amount}',
		subscribe: 'POST /v1/agent/billing/subscribe with {txHash, chain, amount, tier}',
		pay_per_call:
			'Retry with a PAYMENT-SIGNATURE header (x402 v2). Prefer scheme "batch-settlement" for high-frequency calls: deposit once, then each call is an off-chain voucher.',
	}
}

/** Set the x402 v2 advertisement headers for a 402 response. */
export function setX402Headers(
	c: Context,
	env: X402EnvLike,
	challenge: ReturnType<typeof buildX402Challenge>,
) {
	const collector = env.AGENT_METERING_COLLECTOR_ADDRESS || env.FEE_WALLET_EVM
	const paymentRequired: X402PaymentRequired = {
		x402Version: challenge.x402Version,
		error: challenge.error,
		resource: challenge.resource,
		accepts: challenge.accepts,
		...(challenge.extensions ? { extensions: challenge.extensions } : {}),
	}
	const encoded = encodePaymentRequiredHeader(paymentRequired)
	c.header('PAYMENT-REQUIRED', encoded)
	// Legacy alias for clients written against our pre-v2 header.
	c.header('X-Payment-Required', encoded)
	c.header('Cache-Control', 'private, no-store')
	c.header(
		'Accept-Payment',
		`x402 v=2 schemes=${[...new Set(challenge.accepts.map((a) => a.scheme))].join(',')} networks=${[
			...new Set(challenge.accepts.map((a) => a.network)),
		].join(',')} payTo=${collector}`,
	)
}

/**
 * Atomically deduct `cost` credits from an agent's balance.
 * Returns the new balance on success, or null if there were insufficient
 * credits (no row updated). Also bumps lifetimeUsed.
 */
function deductCredits(agentId: number, cost: number) {
	return Effect.gen(function* () {
		const db = yield* requireDb
		const rows = yield* Effect.tryPromise({
			try: () =>
				db
					.update(agentCredits)
					.set({
						balance: sql`${agentCredits.balance} - ${cost}`,
						lifetimeUsed: sql`${agentCredits.lifetimeUsed} + ${cost}`,
						updatedAt: new Date(),
					})
					.where(sql`${agentCredits.agentId} = ${agentId} AND ${agentCredits.balance} >= ${cost}`)
					.returning({ balance: agentCredits.balance }),
			catch: (e) => new Error(`Database error during credit deduction: ${e}`),
		})
		return rows.length > 0 ? (rows[0]?.balance ?? null) : null
	})
}

/**
 * Result of attempting to charge an agent for a single metered call.
 *  - 'skip'         metering off, no agent, or bypass tier — proceed free.
 *  - 'ok'           credits deducted; `balance` is the new balance.
 *  - 'insufficient' no credits; `challenge` is the x402 402 body to return.
 *  - 'blocked'      Intercepta risk screening rejected the counterparty
 *                    (or screening itself was unavailable — fail-closed);
 *                    the on-chain settlement was never attempted.
 */
export type ChargeResult =
	| { kind: 'skip'; reason: 'disabled' | 'no_agent' | 'bypass' | 'free' | 'demo'; tier?: string }
	| { kind: 'ok'; balance: number; cost: number; tier: string }
	| {
			kind: 'settled'
			cost: number
			txHash?: string
			network?: string
			scheme?: string
			payer?: string
			/** base64 x402 v2 SettlementResponse for the PAYMENT-RESPONSE header. */
			paymentResponse?: string
	  }
	| { kind: 'insufficient'; cost: number; challenge: ReturnType<typeof buildX402Challenge> }
	| { kind: 'blocked'; cost: number; reason: string; traits?: string[] }

/**
 * Best-effort, defensive extraction of the on-chain payer address from a
 * decoded x402 PaymentPayload. The `payload.payload` field is scheme-defined
 * (Record<string, unknown>) — for the EIP-3009 "exact" scheme used by the
 * facilitator here it carries `authorization.from`, but we tolerate other
 * shapes (`from`, `sender`) defensively and return undefined rather than
 * throwing if nothing matches. Undefined is treated as "cannot screen" by the
 * caller, which fails closed (rejects), not as "clean".
 */
/**
 * Clean-payer screening cache. batch-settlement exists to make each call a
 * local signature check; re-running an Intercepta HTTP scan on every voucher
 * would put a network round-trip back on the hot path. A payer that scanned
 * CLEAN is trusted for SCREEN_TTL_MS; blocked/failed scans are never cached
 * (fail-closed stays fail-closed).
 */
const SCREEN_TTL_MS = 10 * 60 * 1000
const cleanPayers = new Map<string, number>()
function recentlyCleared(addr: string): boolean {
	const k = addr.toLowerCase()
	const t = cleanPayers.get(k)
	if (t && Date.now() - t < SCREEN_TTL_MS) return true
	if (t) cleanPayers.delete(k)
	return false
}
function markCleared(addr: string) {
	if (cleanPayers.size > 10_000) cleanPayers.clear()
	cleanPayers.set(addr.toLowerCase(), Date.now())
}

function extractPayerAddress(payload: {
	payload: Record<string, unknown>
	accepted?: { scheme?: string }
}): string | undefined {
	const inner = payload.payload
	const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
	// SECURITY: pick the field by the SIGNED scheme. On `exact`, channelConfig is
	// an unsigned extra a client could set to a clean address while signing the
	// transfer from a toxic one. On batch-settlement, channelConfig.payer is the
	// payer committed into the channel id. verifyAndSettle additionally requires
	// the verified payer to equal whatever we screen here.
	if (payload.accepted?.scheme === 'batch-settlement') {
		const channelConfig = inner?.channelConfig as Record<string, unknown> | undefined
		return str(channelConfig?.payer)
	}
	const authorization = inner?.authorization as Record<string, unknown> | undefined
	return str(authorization?.from) ?? str(inner?.from) ?? str(inner?.sender)
}

/**
 * Intercepta screening result persisted onto agents.metadata as a running
 * "risk passport" per agent (Phase 2 of the hackathon plan). Read-merge-write
 * on the JSON column: we read current metadata, splice in the new scan under
 * `intercepta.lastScan`, and append to `intercepta.history` capped at the
 * last 20 entries so the column can't grow unbounded. Recording BOTH allowed
 * and blocked scans (not just blocks) so the history is an honest record of
 * everything that was screened, not just the incidents.
 *
 * Never throws — a persistence failure must not affect the payment decision
 * that already happened; it only logs.
 */
async function persistInterceptaScan(
	agentId: number,
	entry: {
		address: string
		toxicScore: number
		traits: string[]
		blocked: boolean
	},
): Promise<void> {
	const scannedAt = new Date().toISOString()
	const historyEntry = { ...entry, scannedAt }

	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb
			const rows = yield* Effect.tryPromise({
				try: () =>
					db.select({ metadata: agents.metadata }).from(agents).where(eq(agents.id, agentId)),
				catch: (e) => new Error(`Failed to read agent metadata for intercepta persist: ${e}`),
			})
			const existing = (rows[0]?.metadata as Record<string, unknown> | undefined) || {}
			const existingIntercepta = (existing.intercepta as Record<string, unknown> | undefined) || {}
			const existingHistory = Array.isArray(existingIntercepta.history)
				? (existingIntercepta.history as unknown[])
				: []
			const nextHistory = [...existingHistory, historyEntry].slice(-20)

			const nextMetadata = {
				...existing,
				intercepta: {
					lastScan: historyEntry,
					history: nextHistory,
				},
			}

			yield* Effect.tryPromise({
				try: () =>
					db
						.update(agents)
						.set({ metadata: nextMetadata, updatedAt: new Date() })
						.where(eq(agents.id, agentId)),
				catch: (e) => new Error(`Failed to persist intercepta scan: ${e}`),
			})
		}),
	)

	if (Either.isLeft(result)) {
		logger.error(
			{ agentId, err: result.left },
			'[intercepta] failed to persist scan to agent metadata (payment decision unaffected)',
		)
	}
}

/**
 * Reusable charge primitive shared by the REST middleware and the MCP handler.
 * Resolves env + DB internally and never throws — fails open on config/DB
 * errors so metering can never take the API down.
 */
export async function chargeAgentForCall(params: {
	/**
	 * `uuid` is the agent's stable PUBLIC identifier (agents.uuid) — the only
	 * form of "agent identity" that's safe to put in an operator-facing env var
	 * (the numeric `id` is an internal serial PK, not something an operator can
	 * look up). Optional because not every call site has it in scope; when
	 * absent, the demo exemption below simply never matches.
	 */
	agent?: { id: number; rateLimitTier?: string; uuid?: string }
	cost: number
	resource: string
	description: string
	/** base64 X-PAYMENT header for direct on-chain settlement (facilitator path). */
	paymentHeader?: string
}): Promise<ChargeResult> {
	const { agent, cost, resource, description, paymentHeader } = params

	const env = await runEffectEither(
		Effect.gen(function* () {
			return yield* EnvService
		}),
	)
	if (Either.isLeft(env)) return { kind: 'skip', reason: 'disabled' }

	if (env.right.AGENT_METERING_ENABLED !== 'true') return { kind: 'skip', reason: 'disabled' }
	if (!agent) return { kind: 'skip', reason: 'no_agent' }

	const tier = agent.rateLimitTier || 'free'
	if (BYPASS_TIERS.has(tier)) return { kind: 'skip', reason: 'bypass', tier }

	// Demo exemption: explicitly-named demo agents (e.g. the showcase homepage's
	// server-side live-quote-widget proxy key) get FREE reads on the quote
	// endpoint/tool ONLY — never a tier bypass. This exists purely to stop the
	// showcase's flagship live-data demo from going dark when its prepaid
	// credits run dry; every other resource (swap prep, execute, portfolio,
	// etc.) for the same agent stays fully metered below. Checked by UUID
	// (agents.uuid), not the internal numeric id, since that's the only stable
	// identifier an operator can actually put in DEMO_UNMETERED_AGENT_IDS.
	if (
		isDemoUnmeteredCall({
			agentUuid: agent.uuid,
			resource,
			demoUnmeteredAgentIds: env.right.DEMO_UNMETERED_AGENT_IDS,
		})
	) {
		return { kind: 'skip', reason: 'demo', tier }
	}

	// Free tools (cost 0) are always allowed even for metered tiers.
	if (cost <= 0) return { kind: 'skip', reason: 'free', tier }

	const deductResult = await runEffectEither(deductCredits(agent.id, cost))
	// On a DB error, fail open rather than block a paying agent.
	if (Either.isLeft(deductResult)) return { kind: 'skip', reason: 'disabled', tier }

	const newBalance = deductResult.right
	if (newBalance === null) {
		const challenge = buildX402Challenge(env.right, { cost, resource, description })
		const svcEnv = env.right as unknown as X402ServiceEnv
		const decodedPayment = paymentHeader ? decodePayment(paymentHeader) : null

		// Upgrade the static accepts[] through the SDK so batch-settlement entries
		// carry receiverAuthorizer / withdrawDelay / minDeposit (and, on a voucher
		// cumulative mismatch, the corrective channel state). Never blocks the 402.
		if (isFacilitatorEnabled(env.right)) {
			const enriched = await buildPaymentRequired(svcEnv, {
				amount: creditsToUsdcBaseUnits(cost),
				resource,
				description,
				error: challenge.error,
				paymentPayload: decodedPayment ?? undefined,
			})
			challenge.accepts = enriched.accepts
			challenge.resource = { ...challenge.resource, ...enriched.resource }
			challenge.extensions = enriched.extensions
		}

		// No prepaid credits — if the client supplied an X-PAYMENT header and the
		// facilitator is enabled, settle this single call directly on-chain.
		if (paymentHeader && isFacilitatorEnabled(env.right)) {
			// Intercepta risk screening (ETHGlobal Tokyo 2026 Phase 2): screen the
			// counterparty BEFORE settling. Fail-closed — if we can't decode a payer
			// address, or the scan itself fails (no API key, network error,
			// malformed response), reject rather than charge. Only a successful scan
			// under the configured threshold clears the way to settle.
			// Batch-settlement vouchers on an already-screened channel skip the
			// rescan only if we can't find a payer; deposit payloads carry
			// `authorization.from` / channelConfig.payer like exact does.
			let payerAddress: string | undefined
			try {
				const decoded = decodedPayment ?? decodePaymentSignatureHeader(paymentHeader)
				payerAddress = extractPayerAddress(
					decoded as unknown as Parameters<typeof extractPayerAddress>[0],
				)
			} catch {
				payerAddress = undefined
			}

			if (!payerAddress) {
				logger.error(
					{ agentId: agent.id, resource },
					'[intercepta] could not extract payer address from payment header — failing closed',
				)
				return {
					kind: 'blocked',
					cost,
					reason: 'risk screening unavailable: could not resolve payer address',
				}
			}

			const threshold = Number(env.right.INTERCEPTA_TOXIC_SCORE_THRESHOLD)
			if (!recentlyCleared(payerAddress))
				try {
					const scan = await quickScan(payerAddress, { apiKey: env.right.INTERCEPTA_API_KEY })
					const blocked = scan.toxicScore > threshold
					await persistInterceptaScan(agent.id, {
						address: scan.address,
						toxicScore: scan.toxicScore,
						traits: scan.traits,
						blocked,
					})
					if (blocked) {
						logger.warn(
							{
								agentId: agent.id,
								address: scan.address,
								toxicScore: scan.toxicScore,
								traits: scan.traits,
							},
							'[intercepta] blocked metered payment: counterparty exceeds toxic score threshold',
						)
						return {
							kind: 'blocked',
							cost,
							reason: `counterparty flagged as high risk (score ${scan.toxicScore} > ${threshold}): ${scan.traits.join(', ') || 'no traits reported'}`,
							traits: scan.traits,
						}
					}
					markCleared(payerAddress)
				} catch (e) {
					const reason = e instanceof InterceptaUnavailableError ? e.reason : 'unknown_error'
					logger.error(
						{ agentId: agent.id, address: payerAddress, reason },
						'[intercepta] risk screening unavailable — failing closed, rejecting payment',
					)
					return {
						kind: 'blocked',
						cost,
						reason: 'risk screening unavailable — payment rejected (fail-closed)',
					}
				}

			const settle = await verifyAndSettle(svcEnv, paymentHeader, challenge.accepts, {
				expectedPayer: payerAddress,
			})
			if (settle.ok) {
				return {
					kind: 'settled',
					cost,
					txHash: settle.txHash,
					network: settle.network,
					scheme: settle.scheme,
					payer: settle.payer,
					paymentResponse: settle.responseHeader,
				}
			}
			challenge.error = settle.error
			// Don't silently discard a failed on-chain settle — surface why, so a
			// misconfigured facilitator (bad CDP creds, wrong URL, etc.) shows up in
			// logs instead of just looking like "client never paid". Facilitator/
			// cdp-sdk error strings are short reason codes (e.g. "insufficient_funds",
			// "invalid_signature") and never carry key material.
			console.error(`[x402Payment] facilitator settle failed for ${resource}: ${settle.error}`)
		}

		return { kind: 'insufficient', cost, challenge }
	}

	return { kind: 'ok', balance: newBalance, cost, tier }
}

/**
 * Atomically credit back `cost` credits to an agent's balance after a charged
 * call turned out to fail (handler threw, or returned isError:true). Mirrors
 * deductCredits but in reverse; never throws — logs and fails open so a refund
 * bug can never itself take the API down (worst case: the agent is out `cost`
 * credits for a call that didn't succeed, which is the pre-existing behavior
 * this refund path is fixing).
 */
function creditBack(agentId: number, cost: number) {
	return Effect.gen(function* () {
		const db = yield* requireDb
		const rows = yield* Effect.tryPromise({
			try: () =>
				db
					.update(agentCredits)
					.set({
						balance: sql`${agentCredits.balance} + ${cost}`,
						lifetimeUsed: sql`GREATEST(${agentCredits.lifetimeUsed} - ${cost}, 0)`,
						updatedAt: new Date(),
					})
					.where(sql`${agentCredits.agentId} = ${agentId}`)
					.returning({ balance: agentCredits.balance }),
			catch: (e) => new Error(`Database error during credit refund: ${e}`),
		})
		return rows.length > 0 ? (rows[0]?.balance ?? null) : null
	})
}

/**
 * Refund credits charged via chargeAgentForCall for a tool/endpoint call that
 * subsequently failed (threw, or returned isError:true). Only meaningful when
 * the charge actually deducted prepaid credits (`charge.kind === 'ok'`) — 'skip'
 * (free/bypass/disabled) and 'settled'/'insufficient' (on-chain or unpaid) never
 * reach here from call sites, but the guard is kept defensive. Never throws.
 */
export async function refundChargedCall(params: {
	agentId: number
	cost: number
	reason: string
}): Promise<void> {
	const { agentId, cost, reason } = params
	if (cost <= 0) return
	const result = await runEffectEither(creditBack(agentId, cost))
	if (Either.isLeft(result)) {
		// eslint-disable-next-line no-console
		console.error(
			`[x402Payment] refund FAILED for agent ${agentId} (${cost} credits, reason: ${reason}):`,
			result.left,
		)
		return
	}
	// eslint-disable-next-line no-console
	console.warn(
		`[x402Payment] refunded ${cost} credits to agent ${agentId} (reason: ${reason}); new balance=${result.right}`,
	)
}

/**
 * meteredPayment(endpoint) — Hono middleware factory for pay-per-call metering
 * on the REST agent surface. Must run AFTER auth + rateLimit.
 */
export function meteredPayment(endpoint: string) {
	const cost = costForEndpoint(endpoint)

	return async (c: Context, next: Next) => {
		const agent = c.get('agent') as
			| { id: number; rateLimitTier?: string; uuid?: string }
			| undefined
		const result = await chargeAgentForCall({
			agent,
			cost,
			resource: c.req.path,
			description: `Suwappu agent API call: ${endpoint} (${cost} credit${cost === 1 ? '' : 's'})`,
			// v2 header first; X-PAYMENT kept so pre-v2 clients get a clean v2 402.
			paymentHeader: c.req.header('PAYMENT-SIGNATURE') ?? c.req.header('X-PAYMENT'),
		})

		if (result.kind === 'skip') {
			if (result.reason === 'bypass' && result.tier) {
				c.header('X-Metering-Tier', result.tier)
				c.header('X-Metering-Bypass', 'true')
			}
			if (result.reason === 'demo') {
				// Make the demo exemption observable: without this there is no header,
				// log, or counter — a mispasted uuid silently never fires, and a paying
				// customer's uuid pasted here would be silently free forever.
				c.header('X-Metering-Exempt', 'demo')
				noteDemoExemptHit(agent?.uuid ?? 'unknown', c.req.path)
			}
			// Expose the charge outcome so route handlers can decide to refund on a
			// non-execution failure path (mirrors the MCP tool-dispatch refund guard).
			c.set('meterCharge', result)
			await next()
			return
		}

		if (result.kind === 'insufficient') {
			const env = await runEffectEither(
				Effect.gen(function* () {
					return yield* EnvService
				}),
			)
			if (Either.isRight(env)) setX402Headers(c, env.right, result.challenge)
			return c.json(result.challenge, 402)
		}

		if (result.kind === 'settled') {
			c.header('X-Metering-Cost', String(result.cost))
			if (result.paymentResponse) c.header('PAYMENT-RESPONSE', result.paymentResponse)
			if (result.txHash) c.header('X-Payment-Response', result.txHash)
			if (result.scheme) c.header('X-Payment-Scheme', result.scheme)
			// 'settled' is a facilitator on-chain payment — NEVER refund it here (same
			// guard as MCP's refundChargedCall call sites, which only fire on 'ok').
			c.set('meterCharge', result)
			await next()
			return
		}

		if (result.kind === 'blocked') {
			// Intercepta rejected the counterparty (or screening was unavailable) —
			// fail-closed: no charge happens, no route handler runs.
			return c.json(
				{ error: 'payment_rejected', reason: result.reason, traits: result.traits },
				402,
			)
		}

		c.header('X-Metering-Cost', String(result.cost))
		c.header('X-Metering-Balance', String(result.balance))
		c.set('meterCharge', result)
		await next()
	}
}
