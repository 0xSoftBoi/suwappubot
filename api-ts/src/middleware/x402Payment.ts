import { eq, sql } from 'drizzle-orm'
import { Effect, Either } from 'effect'
import type { Context, Next } from 'hono'
import { EnvService } from '../config/EnvService'
import { requireDb } from '../db/DrizzleService'
import { agentCredits } from '../db/schema'
import { runEffectEither } from '../runtime'

/**
 * Agent pay-per-call metering (x402 prepaid credits).
 *
 * Each metered endpoint costs a number of CREDITS (see COST_WEIGHTS). Balance is
 * deducted atomically before the handler runs. If the agent lacks credits and is
 * not on a bypassing tier, the request is rejected with an x402-style HTTP 402.
 *
 * Gated by AGENT_METERING_ENABLED (default 'false') so it is safe to merge/deploy
 * without blocking existing free agents.
 *
 * Credit unit: 1 credit ≈ $0.001 USD.
 */

export const CREDIT_USD_VALUE = 0.001

/**
 * Per-endpoint cost in credits. Keyed by a logical endpoint name passed to
 * meteredPayment(). Tune sensibly: reads are cheap, swap execution is dear.
 */
export const COST_WEIGHTS: Record<string, number> = {
	quote: 1,
	swap: 5,
	execute: 5,
	'swap/execute': 5,
	portfolio: 1,
	prices: 1,
	tokens: 1,
	chains: 1,
}

/**
 * Rate-limit tiers that bypass metering entirely (treated as "paid / active
 * subscription"). Agents have no human subscription row, so the paid signal is
 * the agent's own rateLimitTier. Free agents are metered; 'agent'/'pro' are not.
 */
const BYPASS_TIERS = new Set(['agent', 'pro'])

function costForEndpoint(endpoint: string): number {
	return COST_WEIGHTS[endpoint] ?? 1
}

/** Convert a credit cost to USDC base units (6 decimals) as a decimal string. */
export function creditsToUsdcBaseUnits(credits: number): string {
	const usd = credits * CREDIT_USD_VALUE
	return BigInt(Math.round(usd * 1_000_000)).toString()
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
 * meteredPayment(endpoint) — Hono middleware factory for pay-per-call metering.
 *
 * Must run AFTER auth + rateLimit. Behavior:
 *  - AGENT_METERING_ENABLED !== 'true' → no-op (default off).
 *  - No agent in context (e.g. an MPP payer who already paid) → no-op.
 *  - Bypass tier (agent/pro) → no-op (treated as paid).
 *  - Otherwise: atomically deduct cost; on success call next(); on insufficient
 *    credits return an x402-style HTTP 402 challenge.
 */
export function meteredPayment(endpoint: string) {
	const cost = costForEndpoint(endpoint)

	return async (c: Context, next: Next) => {
		const env = await runEffectEither(Effect.gen(function* () { return yield* EnvService }))
		if (Either.isLeft(env)) {
			// Fail open — metering must never take down the API on a config error.
			await next()
			return
		}

		if (env.right.AGENT_METERING_ENABLED !== 'true') {
			await next()
			return
		}

		const agent = c.get('agent') as { id: number; rateLimitTier?: string } | undefined
		if (!agent) {
			// No authenticated agent (public route or MPP-paid request) — skip.
			await next()
			return
		}

		const tier = agent.rateLimitTier || 'free'
		if (BYPASS_TIERS.has(tier)) {
			c.header('X-Metering-Tier', tier)
			c.header('X-Metering-Bypass', 'true')
			await next()
			return
		}

		const deductResult = await runEffectEither(deductCredits(agent.id, cost))

		// On a DB error, fail open rather than block a paying agent.
		if (Either.isLeft(deductResult)) {
			await next()
			return
		}

		const newBalance = deductResult.right
		if (newBalance === null) {
			// Insufficient credits → x402 Payment Required.
			const collector =
				env.right.AGENT_METERING_COLLECTOR_ADDRESS || env.right.FEE_WALLET_EVM
			const network = env.right.AGENT_METERING_NETWORK
			const asset = env.right.AGENT_METERING_USDC_ADDRESS
			const maxAmountRequired = creditsToUsdcBaseUnits(cost)
			const resource = c.req.path

			const challenge = {
				x402Version: 1,
				accepts: [
					{
						scheme: 'exact',
						network,
						asset,
						maxAmountRequired,
						payTo: collector,
						resource,
						description: `Suwappu agent API call: ${endpoint} (${cost} credit${cost === 1 ? '' : 's'})`,
						mimeType: 'application/json',
					},
				],
				error: 'insufficient_credits',
				cost_credits: cost,
				credit_usd_value: CREDIT_USD_VALUE,
				topup: 'POST /v1/agent/billing/topup with {txHash, chain, amount}',
			}

			c.header('X-Payment-Required', Buffer.from(JSON.stringify(challenge)).toString('base64'))
			c.header('Accept-Payment', `x402 network=${network} asset=${asset} payTo=${collector}`)
			return c.json(challenge, 402)
		}

		c.header('X-Metering-Cost', String(cost))
		c.header('X-Metering-Balance', String(newBalance))
		await next()
	}
}
