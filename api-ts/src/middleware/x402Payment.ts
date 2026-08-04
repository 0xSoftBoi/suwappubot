import { sql } from 'drizzle-orm'
import { Effect, Either } from 'effect'
import type { Context, Next } from 'hono'
import { EnvService } from '../config/EnvService'
import { resolveX402Networks } from '../config/x402Networks'
import { requireDb } from '../db/DrizzleService'
import { agentCredits } from '../db/schema'
import { runEffectEither } from '../runtime'
import {
	facilitatorVerifyAndSettle,
	isFacilitatorEnabled,
	type PaymentRequirements,
} from '../services/FacilitatorService'

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
 * Build a spec-compliant x402 payment challenge body. Off-the-shelf x402
 * clients (x402-axios / x402-fetch) parse the `accepts[]` PaymentRequirements
 * and auto-construct an X-PAYMENT payload, so this must stay close to the spec.
 *
 * `x402Version` is the payload schema version (1) — distinct from the "x402 V2"
 * product/facilitator capabilities, which do not bump this integer.
 */
export type X402EnvLike = {
	AGENT_METERING_COLLECTOR_ADDRESS?: string
	FEE_WALLET_EVM: string
	AGENT_METERING_NETWORK: string
	AGENT_METERING_USDC_ADDRESS: string
	/** Comma-separated extra x402 payment networks (e.g. "robinhood"). Opt-in. */
	X402_EXTRA_NETWORKS?: string
}

export function buildX402Challenge(
	env: X402EnvLike,
	opts: { cost: number; resource: string; description: string; error?: string },
) {
	const collector = env.AGENT_METERING_COLLECTOR_ADDRESS || env.FEE_WALLET_EVM
	const maxAmountRequired = creditsToUsdcBaseUnits(opts.cost)

	// One accepts[] entry per enabled payment network. accepts[0] stays the
	// env-configured network so existing clients that ignore the rest are
	// unaffected. Each entry carries its OWN EIP-712 domain — the domain used to
	// be hardcoded to USDC's, which is wrong for any non-USDC asset (e.g. USDG on
	// Robinhood Chain, where it would produce an unsignable/invalid payload).
	const networks = resolveX402Networks(
		env.AGENT_METERING_NETWORK,
		env.AGENT_METERING_USDC_ADDRESS,
		env.X402_EXTRA_NETWORKS,
	)

	return {
		x402Version: 1,
		accepts: networks.map((n) => ({
			scheme: 'exact' as const,
			network: n.network,
			maxAmountRequired,
			resource: opts.resource,
			description: opts.description,
			mimeType: 'application/json',
			payTo: collector,
			maxTimeoutSeconds: 120,
			asset: n.asset,
			// EIP-712 domain hints for EIP-3009 transferWithAuthorization.
			extra: n.eip712,
		})),
		error: opts.error ?? 'insufficient_credits',
		// Stable 17-code contract (see lib/agentError.ts) — keep `error` for
		// back-compat with existing SDK/agent consumers reading the old field.
		error_code: 'INSUFFICIENT_CREDITS' as const,
		cost_credits: opts.cost,
		credit_usd_value: CREDIT_USD_VALUE,
		topup: 'POST /v1/agent/billing/topup with {txHash, chain, amount}',
		subscribe: 'POST /v1/agent/billing/subscribe with {txHash, chain, amount, tier}',
	}
}

/** Set the x402 advertisement headers for a 402 response. */
export function setX402Headers(c: Context, env: X402EnvLike, challenge: ReturnType<typeof buildX402Challenge>) {
	const collector = env.AGENT_METERING_COLLECTOR_ADDRESS || env.FEE_WALLET_EVM
	c.header('X-Payment-Required', Buffer.from(JSON.stringify(challenge)).toString('base64'))
	c.header(
		'Accept-Payment',
		`x402 network=${env.AGENT_METERING_NETWORK} asset=${env.AGENT_METERING_USDC_ADDRESS} payTo=${collector}`,
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
 */
export type ChargeResult =
	| { kind: 'skip'; reason: 'disabled' | 'no_agent' | 'bypass' | 'free'; tier?: string }
	| { kind: 'ok'; balance: number; cost: number; tier: string }
	| { kind: 'settled'; cost: number; txHash?: string; network?: string }
	| { kind: 'insufficient'; cost: number; challenge: ReturnType<typeof buildX402Challenge> }

/**
 * Reusable charge primitive shared by the REST middleware and the MCP handler.
 * Resolves env + DB internally and never throws — fails open on config/DB
 * errors so metering can never take the API down.
 */
export async function chargeAgentForCall(params: {
	agent?: { id: number; rateLimitTier?: string }
	cost: number
	resource: string
	description: string
	/** base64 X-PAYMENT header for direct on-chain settlement (facilitator path). */
	paymentHeader?: string
}): Promise<ChargeResult> {
	const { agent, cost, resource, description, paymentHeader } = params

	const env = await runEffectEither(Effect.gen(function* () { return yield* EnvService }))
	if (Either.isLeft(env)) return { kind: 'skip', reason: 'disabled' }

	if (env.right.AGENT_METERING_ENABLED !== 'true') return { kind: 'skip', reason: 'disabled' }
	if (!agent) return { kind: 'skip', reason: 'no_agent' }

	const tier = agent.rateLimitTier || 'free'
	if (BYPASS_TIERS.has(tier)) return { kind: 'skip', reason: 'bypass', tier }

	// Free tools (cost 0) are always allowed even for metered tiers.
	if (cost <= 0) return { kind: 'skip', reason: 'free', tier }

	const deductResult = await runEffectEither(deductCredits(agent.id, cost))
	// On a DB error, fail open rather than block a paying agent.
	if (Either.isLeft(deductResult)) return { kind: 'skip', reason: 'disabled', tier }

	const newBalance = deductResult.right
	if (newBalance === null) {
		const challenge = buildX402Challenge(env.right, { cost, resource, description })

		// No prepaid credits — if the client supplied an X-PAYMENT header and the
		// facilitator is enabled, settle this single call directly on-chain.
		if (paymentHeader && isFacilitatorEnabled(env.right)) {
			const requirements = challenge.accepts[0] as PaymentRequirements
			const settle = await facilitatorVerifyAndSettle(env.right, paymentHeader, requirements)
			if (settle.ok) {
				return { kind: 'settled', cost, txHash: settle.txHash, network: settle.network }
			}
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
		console.error(`[x402Payment] refund FAILED for agent ${agentId} (${cost} credits, reason: ${reason}):`, result.left)
		return
	}
	// eslint-disable-next-line no-console
	console.warn(`[x402Payment] refunded ${cost} credits to agent ${agentId} (reason: ${reason}); new balance=${result.right}`)
}

/**
 * meteredPayment(endpoint) — Hono middleware factory for pay-per-call metering
 * on the REST agent surface. Must run AFTER auth + rateLimit.
 */
export function meteredPayment(endpoint: string) {
	const cost = costForEndpoint(endpoint)

	return async (c: Context, next: Next) => {
		const agent = c.get('agent') as { id: number; rateLimitTier?: string } | undefined
		const result = await chargeAgentForCall({
			agent,
			cost,
			resource: c.req.path,
			description: `Suwappu agent API call: ${endpoint} (${cost} credit${cost === 1 ? '' : 's'})`,
			paymentHeader: c.req.header('X-PAYMENT') ?? c.req.header('PAYMENT-SIGNATURE'),
		})

		if (result.kind === 'skip') {
			if (result.reason === 'bypass' && result.tier) {
				c.header('X-Metering-Tier', result.tier)
				c.header('X-Metering-Bypass', 'true')
			}
			// Expose the charge outcome so route handlers can decide to refund on a
			// non-execution failure path (mirrors the MCP tool-dispatch refund guard).
			c.set('meterCharge', result)
			await next()
			return
		}

		if (result.kind === 'insufficient') {
			const env = await runEffectEither(Effect.gen(function* () { return yield* EnvService }))
			if (Either.isRight(env)) setX402Headers(c, env.right, result.challenge)
			return c.json(result.challenge, 402)
		}

		if (result.kind === 'settled') {
			c.header('X-Metering-Cost', String(result.cost))
			if (result.txHash) c.header('X-Payment-Response', result.txHash)
			// 'settled' is a facilitator on-chain payment — NEVER refund it here (same
			// guard as MCP's refundChargedCall call sites, which only fire on 'ok').
			c.set('meterCharge', result)
			await next()
			return
		}

		c.header('X-Metering-Cost', String(result.cost))
		c.header('X-Metering-Balance', String(result.balance))
		c.set('meterCharge', result)
		await next()
	}
}
