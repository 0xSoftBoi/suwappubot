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

/**
 * GET /.well-known/x402/bazaar?q=&type=http|mcp&limit= — buyer-side discovery.
 *
 * Proxies the CDP Bazaar (the x402 ecosystem catalog) so Suwappu agents — and
 * anyone using our MCP/REST surface — can find OTHER paid x402 services
 * (data, signals, inference) with one call. Public catalog data only; cached
 * 60s; upstream failures return 502, never our internals.
 */
const BAZAAR_BASE = 'https://api.cdp.coinbase.com/platform/v2/x402'
const bazaarCache = new Map<string, { at: number; body: unknown }>()

x402DiscoveryRoutes.get('/bazaar', async (c) => {
	const q = (c.req.query('q') ?? '').trim().slice(0, 200)
	const type = c.req.query('type')
	const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 20) || 20, 1), 50)
	if (type && type !== 'http' && type !== 'mcp')
		return c.json({ error: 'type must be http or mcp' }, 400)

	const params = new URLSearchParams({ limit: String(limit) })
	if (type) params.set('type', type)
	const url = q
		? `${BAZAAR_BASE}/discovery/search?${new URLSearchParams({ ...Object.fromEntries(params), query: q })}`
		: `${BAZAAR_BASE}/discovery/resources?${params}`

	const hit = bazaarCache.get(url)
	if (hit && Date.now() - hit.at < 60_000) return c.json(hit.body)
	try {
		const r = await fetch(url, {
			signal: AbortSignal.timeout(10_000),
			headers: { accept: 'application/json' },
		})
		if (!r.ok) return c.json({ error: 'bazaar_unavailable', status: r.status }, 502)
		const raw = (await r.json()) as {
			items?: unknown[]
			resources?: unknown[]
			partialResults?: boolean
		}
		const items = (raw.items ?? raw.resources ?? []) as Array<Record<string, unknown>>
		const body = {
			source: 'cdp-bazaar',
			query: q || null,
			count: items.length,
			partial: raw.partialResults ?? false,
			resources: items.map((it) => {
				const accepts = (it.accepts as Array<Record<string, unknown>> | undefined) ?? []
				return {
					resource: it.resource ?? accepts[0]?.resource ?? null,
					type: it.type ?? null,
					description: it.description ?? accepts[0]?.description ?? null,
					accepts: accepts.map((a) => ({
						scheme: a.scheme,
						network: a.network,
						amount: a.amount ?? a.maxAmountRequired,
						asset: a.asset,
						payTo: a.payTo,
					})),
				}
			}),
			howToPay: '@x402/fetch wrapFetchWithPayment(fetch, x402Client) — pays the 402 automatically.',
		}
		if (bazaarCache.size > 500) bazaarCache.clear()
		bazaarCache.set(url, { at: Date.now(), body })
		c.header('Cache-Control', 'public, max-age=60')
		return c.json(body)
	} catch {
		return c.json({ error: 'bazaar_unavailable' }, 502)
	}
})
