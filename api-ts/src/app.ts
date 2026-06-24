import { Hono } from 'hono'
import { serveStatic } from 'hono/bun'
import { HTTPException } from 'hono/http-exception'
import { logger as honoLogger } from 'hono/logger'
import { logger } from './lib/logger'
import agentCard from '../agent-card.json'
import { adminKeyAuth, createCorsMiddleware } from './middleware'
import { internalAuth } from './middleware/internalAuth'
import {
	a2aRoutes,
	adminRoutes,
	agentRoutes,
	billingRoutes,
	healthRoutes,
	internalRoutes,
	lendRoutes,
	mcpRoutes,
	p2pRoutes,
	perpsRoutes,
	predictRoutes,
	publicSwapRoutes,
	smartAccountRoutes,
	stakingRoutes,
	swapRoutes,
	webappRoutes,
} from './routes'

export interface AppConfig {
	allowedOrigins: string
	adminApiKey?: string | undefined
	internalApiKey?: string | undefined
}

// Per-request context variables set by middleware (see request-ID middleware below).
type AppVariables = { requestId: string }

export function createApp(config: AppConfig) {
	const app = new Hono<{ Variables: AppVariables }>()

	// Global middleware
	app.use('*', honoLogger())
	app.use('*', createCorsMiddleware(config.allowedOrigins))

	// Request ID — inject a UUID per request for distributed tracing.
	// Passed through as X-Request-ID so clients and logs can correlate.
	app.use('*', async (c, next) => {
		const rid = c.req.header('X-Request-ID') ?? crypto.randomUUID()
		c.set('requestId', rid)
		await next()
		c.header('X-Request-ID', rid)
	})

	// Request timing middleware — logs slow requests (>100ms) for profiling
	app.use('*', async (c, next) => {
		const start = performance.now()
		await next()
		const ms = performance.now() - start
		c.header('X-Response-Time', `${ms.toFixed(0)}ms`)
		if (ms > 100) {
			logger.info(`${c.req.method} ${c.req.path} → ${c.res.status} in ${ms.toFixed(0)}ms`)
		}
	})

	// Global error handler — standardized error envelope with requestId + timestamp.
	app.onError((err, c) => {
		const requestId = c.get('requestId') ?? 'unknown'
		const timestamp = new Date().toISOString()

		if (err instanceof HTTPException) {
			return c.json(
				{ error: err.message, requestId, timestamp },
				err.status,
			)
		}

		logger.error({ err, requestId }, 'Unhandled error')
		return c.json({ error: 'Internal Server Error', requestId, timestamp }, 500)
	})

	// Public routes
	app.route('/', healthRoutes)

	// Public swap routes for showcase site
	app.route('/public/swap', publicSwapRoutes)

	// Swap routes - mounted first so public endpoints (tokens, chains) are accessible
	app.route('/webapp/swap', swapRoutes)

	// P2P marketplace (native offer book + trades; external aggregation via bot)
	app.route('/webapp/p2p', p2pRoutes)

	// Webapp routes - Telegram auth
	app.route('/webapp', webappRoutes)

	// Staking routes - SUWP token staking dashboard
	app.route('/staking', stakingRoutes)

	// ERC-4337 smart-account routes - address prediction + capability descriptor
	app.route('/v1/smart-account', smartAccountRoutes)

	// Billing routes - Stripe subscription management
	app.route('/billing', billingRoutes)

	// Agent A2A API routes (v1/agent/*) - uses Bearer token auth internally
	// Registration is public, other endpoints require Bearer token
	app.route('/v1/agent', agentRoutes)

	// Protocol-specific agent routes
	app.route('/v1/agent/perps', perpsRoutes)
	app.route('/v1/agent/predict', predictRoutes)
	app.route('/v1/agent/lend', lendRoutes)

	// A2A JSON-RPC endpoint - uses Bearer token auth internally
	app.route('/a2a', a2aRoutes)

	// MCP endpoint for OpenClaw and other MCP-compatible agents
	app.route('/mcp', mcpRoutes)

	// Agent card for A2A discovery (spec-compliant + legacy paths)
	app.get('/.well-known/agent-card.json', (c) => c.json(agentCard))
	app.get('/.well-known/agent.json', (c) => c.json(agentCard))
	app.get('/agent-card.json', (c) => c.json(agentCard))

	// llms.txt — machine-readable API summary for LLM/agent discovery
	app.get('/llms.txt', (c) => {
		return c.text(`# Suwappu API

> Cross-chain DEX API for AI agents. Best-price swaps, HyperLiquid perps, and gasless trades across 40+ chains.

## Base URL
https://api.suwappu.bot/v1/agent

## Auth
Bearer token via \`Authorization: Bearer suwappu_sk_...\`
Get key: POST /register (no auth needed)

## Quick Start
1. POST /register {"name":"my-agent"} → get api_key
2. POST /quote {"from_token":"ETH","to_token":"USDC","amount":"0.5","chain":"base"} → get quote_id
3. POST /swap/execute {"quote_id":"..."} → swap executed
4. GET /swap/status/{id} → check result

## Endpoints

### Public (no auth)
- POST /register — Register agent, get API key
- GET /chains — List supported chains
- GET /openapi — OpenAPI 3.1 spec

### Authenticated
- GET /me — Agent profile
- PATCH /me — Update profile
- DELETE /me — Delete agent
- POST /me/deactivate — Deactivate
- POST /reactivate — Reactivate
- POST /keys/rotate — Rotate API key
- GET /tokens?chain=base — List tokens
- GET /prices?symbols=ETH,SOL — Token prices (USD)
- GET /portfolio?wallet_address=0x... — Wallet balances
- POST /quote — Get swap quote (returns quote_id)
- POST /swap — Get unsigned tx (client signing)
- POST /swap/execute — Execute swap (server signing, managed wallets)
- GET /swap/status/{id} — Swap status
- GET /swaps — Swap history
- GET /wallets — List managed wallets
- POST /wallets — Create managed wallet
- POST /execute — Natural language command
- GET /webhooks — Webhook events
- POST /webhooks/test — Test webhook delivery

### Perps (HyperLiquid)
- GET /perps/markets — List perp markets
- POST /perps/quote — Quote a perp position
- GET /perps/positions?address= — Open positions

### Predictions (Polymarket)
- GET /predict/markets — Search prediction markets
- GET /predict/market/{id} — Market detail + live prices
- GET /predict/market/{id}/book — Order book
- POST /predict/order — Place a CLOB order
- GET /predict/positions — Positions with PnL

### Lending (Morpho)
- GET /lend/markets?chainId= — List lending markets
- GET /lend/market/{id} — Market detail

## Protocols
- REST: https://api.suwappu.bot/v1/agent/*
- MCP: POST https://api.suwappu.bot/mcp (JSON-RPC 2.0; tools: get_quote, execute_swap, get_portfolio, get_prices, list_chains, list_tokens, get_tempo_tokens, browse_mpp_directory, predict_markets, predict_market_detail; resources + prompts supported)
- A2A: POST https://api.suwappu.bot/a2a (JSON-RPC 2.0, methods: message/send, tasks/get, tasks/cancel)
- Agent Card: GET https://api.suwappu.bot/.well-known/agent.json
- OpenAPI: GET https://api.suwappu.bot/v1/agent/openapi

## Chains
Ethereum (1), Optimism (10), BSC (56), Polygon (137), Arbitrum (42161), Base (8453), Avalanche (43114), Fantom (250), Linea (59144), Mantle (5000), Gnosis (100), Scroll (534352), Solana, Sui, TON

## Response Format
{"success": true, ...data} or {"success": false, "error": "message"}

## Rate Limits
free: 30/min, agent: 100/min, pro: 500/min
Headers: X-RateLimit-Limit, X-RateLimit-Remaining, Retry-After (on 429)

## Pricing & Payments (x402)
Paid endpoints and MCP tools are metered in prepaid credits (1 credit ≈ $0.001 USD). Subscription tiers (agent/pro/premium/enterprise) bypass metering.
- On insufficient balance the API returns HTTP 402 with an x402 challenge: header X-Payment-Required (base64 JSON) + Accept-Payment, and an \`accepts[]\` body (scheme=exact, USDC on Base). Standard x402 clients (x402-axios / x402-fetch) handle this automatically.
- Pay-per-call cost weights: reads/quotes 1 credit, swap/execute 5 credits. MCP discovery tools (list_chains/list_tokens/get_tempo_tokens) are free.
- Top up credits: POST /v1/agent/billing/topup {txHash, chain, amount} (pay USDC to the collector, submit the txHash; idempotent).
- Prepaid access window (crypto, 30d, unmetered — NO auto-renew, re-pay to extend): POST /v1/agent/billing/subscribe {txHash, chain, amount, tier} — pro $9.99, premium $29.99, enterprise $99.99.
- Check balance/subscription/pricing: GET /v1/agent/billing
- Human users: Stripe checkout (GET /billing/stripe/checkout?tier=) or crypto (POST /billing/crypto).

## SDK
npm: @suwappu/sdk | PyPI: suwappu
MCP Server: hosted at POST https://api.suwappu.bot/mcp (no install — point your MCP client at the URL with a Bearer key)

## Docs
https://docs.suwappu.bot
`)
	})

	// Internal API routes - service-to-service (Python bot → api-ts)
	app.use('/internal/*', internalAuth(config.internalApiKey))
	app.route('/internal', internalRoutes)

	// Admin API routes - X-Admin-Key required
	app.use('/admin/*', adminKeyAuth(config.adminApiKey))
	app.route('/admin', adminRoutes)

	// Dashboard SPA - static files
	app.use(
		'/dashboard/*',
		serveStatic({
			root: './dashboard/dist',
			rewriteRequestPath: (path) => path.replace(/^\/dashboard/, ''),
		}),
	)
	app.get(
		'/dashboard/*',
		serveStatic({
			root: './dashboard/dist',
			rewriteRequestPath: () => '/index.html',
		}),
	)
	app.get('/dashboard', (c) => c.redirect('/dashboard/'))

	// OpenAPI / AI plugin manifest
	app.get('/ai-plugin.json', (c) => {
		return c.json({
			schema_version: 'v1',
			name_for_human: 'Suwappu DEX',
			name_for_model: 'suwappu',
			description_for_human: 'Swap tokens across 7 blockchain networks via natural language',
			description_for_model:
				"Use Suwappu to execute token swaps across Ethereum, BSC, Polygon, Arbitrum, Optimism, Base, and Solana. Accepts natural language commands like 'swap 0.5 ETH to USDC on Base'. Returns transaction status and explorer links.",
			auth: {
				type: 'service_http',
				authorization_type: 'bearer',
			},
			api: {
				type: 'openapi',
				url: 'https://api.suwappu.bot/openapi.json',
			},
			logo_url: 'https://suwappu.bot/logo.png',
			contact_email: 'support@suwappu.bot',
			legal_info_url: 'https://suwappu.bot/terms',
		})
	})

	return app
}

export type App = ReturnType<typeof createApp>
// Deploy trigger: A2A agent-card fix
