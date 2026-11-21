import { Effect, Either } from 'effect'
import { Hono } from 'hono'
import { EnvService } from '../config/EnvService'
import {
	COST_WEIGHTS,
	CREDIT_USD_VALUE,
	creditsToUsdcBaseUnits,
	MCP_TOOL_COSTS,
} from '../middleware/x402Payment'
import { runEffectEither } from '../runtime'
import {
	resourceUrl,
	staticRequirements,
	type X402ServiceEnv,
	x402Status,
} from '../services/X402ResourceService'

/**
 * GET /.well-known/x402 — x402 v2 discovery manifest.
 *
 * Lists every paid resource on the agent surface with its v2 `accepts[]`
 * (exact + batch-settlement), so an agent can pick a rail and open a payment
 * channel BEFORE its first call instead of discovering prices one 402 at a time.
 * Public, cacheable, no secrets (payTo is already in every 402).
 */
export const x402DiscoveryRoutes = new Hono()

x402DiscoveryRoutes.get('/', async (c) => {
	const env = await runEffectEither(
		Effect.gen(function* () {
			return yield* EnvService
		}),
	)
	if (Either.isLeft(env)) return c.json({ error: 'config_unavailable' }, 503)
	const svc = env.right as unknown as X402ServiceEnv
	const status = await x402Status(svc)

	const rest = Object.entries(COST_WEIGHTS)
		.filter(([, cost]) => cost > 0)
		.map(([endpoint, cost]) => ({
			resource: resourceUrl(svc, `/v1/agent/${endpoint}`),
			type: 'http',
			credits: cost,
			usd: +(cost * CREDIT_USD_VALUE).toFixed(6),
			accepts: staticRequirements(svc, creditsToUsdcBaseUnits(cost)),
		}))
	const mcp = Object.entries(MCP_TOOL_COSTS)
		.filter(([, cost]) => cost > 0)
		.map(([tool, cost]) => ({
			resource: resourceUrl(svc, `/mcp#${tool}`),
			type: 'mcp-tool',
			tool,
			credits: cost,
			usd: +(cost * CREDIT_USD_VALUE).toFixed(6),
			accepts: staticRequirements(svc, creditsToUsdcBaseUnits(cost)),
		}))

	c.header('Cache-Control', 'public, max-age=300')
	return c.json({
		...status,
		metering: env.right.AGENT_METERING_ENABLED === 'true',
		guidance: {
			batchSettlement:
				'High-frequency agents: use scheme "batch-settlement". One on-chain deposit opens a channel; every call after is an off-chain signed cumulative voucher (no gas, no chain round-trip). Unused escrow is cooperatively refunded when idle.',
			exact: 'Occasional calls: scheme "exact" settles a single EIP-3009 transfer per call.',
			credits: 'Or prepay credits: POST /v1/agent/billing/topup.',
			clients:
				'@x402/fetch wrapFetchWithPayment + @x402/evm (ExactEvmScheme, BatchSettlementEvmScheme) client schemes.',
		},
		resources: [...rest, ...mcp],
	})
})
