import { Hono } from 'hono'
import { serveStatic } from 'hono/bun'
import { HTTPException } from 'hono/http-exception'
import { logger as honoLogger } from 'hono/logger'
import { logger } from './lib/logger'
import agentCard from '../agent-card.json'
import aiCatalog from '../ai-catalog.json'
import { adminKeyAuth, createCorsMiddleware } from './middleware'
import { internalAuth } from './middleware/internalAuth'
import {
	a2aRoutes,
	adminRoutes,
	agentRoutes,
	billingRoutes,
	enterpriseRoutes,
	healthRoutes,
	internalRoutes,
	lendRoutes,
	mcpRoutes,
	p2pRoutes,
	perpsRoutes,
	rewardsRoutes,
	predictRoutes,
	publicSwapRoutes,
	smartAccountRoutes,
	stakingRoutes,
	swapRoutes,
	tokenRoutes,
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

	// On-chain fee-cashback rewards (read API + wallet-claim payloads)
	app.route('/webapp/rewards', rewardsRoutes)

	// Token search/price routes - public, no Telegram auth required
	app.route('/webapp/tokens', tokenRoutes)

	// Webapp routes - Telegram auth
	app.route('/webapp', webappRoutes)

	// Staking routes - SUWP token staking dashboard
	app.route('/staking', stakingRoutes)

	// ERC-4337 smart-account routes - address prediction + capability descriptor
	app.route('/v1/smart-account', smartAccountRoutes)

	// Billing routes - Stripe subscription management
	app.route('/billing', billingRoutes)

	// Enterprise org management + API key control plane
	app.route('/enterprise', enterpriseRoutes)

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

	// Agentic Resource Discovery (ARD v0.9 draft) catalog — a single manifest
	// listing all agent-facing discovery surfaces (A2A card, MCP server, OpenAPI,
	// llms.txt) so ARD-aware crawlers don't have to guess well-known paths.
	app.get('/.well-known/ai-catalog.json', (c) => c.json(aiCatalog))

	// security.txt — RFC 9116 responsible-disclosure contact (procurement/security
	// teams check for this during vendor evaluation). Refresh `Expires` annually.
	app.get('/.well-known/security.txt', (c) => {
		c.header('Content-Type', 'text/plain; charset=utf-8')
		return c.body(
			[
				'# Suwappu security disclosure policy — https://suwappu.bot/.well-known/security.txt',
				'Contact: mailto:security@suwappu.bot',
				'Contact: https://suwappu.bot/security',
				'Expires: 2027-06-01T00:00:00.000Z',
				'Canonical: https://suwappu.bot/.well-known/security.txt',
				'Policy: https://suwappu.bot/security',
				'Preferred-Languages: en',
				'Hiring: https://suwappu.bot/careers',
				'',
			].join('\n'),
		)
	})

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
- MCP: POST https://api.suwappu.bot/mcp (JSON-RPC 2.0; tools: get_quote, execute_swap, get_portfolio, get_prices, list_chains, list_tokens, get_tempo_tokens, browse_mpp_directory, predict_markets, predict_market, perps_markets, perps_quote, perps_positions, lend_markets, lend_market; resources + prompts supported)
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
npm: @suwappu/sdk | PyPI: suwappu | OpenClaw skill: @suwappu/openclaw
MCP Server: hosted at POST https://api.suwappu.bot/mcp (no install — point your MCP client at the URL with a Bearer key)
Full endpoint list: GET https://api.suwappu.bot/llms-full.txt

## Docs
https://suwappu.bot/docs
- Quick Start: https://suwappu.bot/docs/quick-start/overview
- Authentication & Rate Limits: https://suwappu.bot/docs/authentication/overview
- API Reference: https://suwappu.bot/docs/api-reference/overview
- Protocols (REST/MCP/A2A): https://suwappu.bot/docs/protocols/overview
- MCP Client Setup: https://suwappu.bot/docs/quick-start/mcp-clients
- Billing & Pricing: https://suwappu.bot/docs/billing/pricing
- Agentic Payments (x402): https://suwappu.bot/docs/billing/agentic-payments
`)
	})

	// llms-full.txt — exhaustive machine-readable endpoint list (llms.txt convention
	// "full" variant). One line per REST route across the whole agent-facing surface,
	// for agents that want the complete map without following links.
	app.get('/llms-full.txt', (c) => {
		return c.text(`# Suwappu API — Full Reference

> Every REST endpoint on the Suwappu agent surface, one line each. See /llms.txt for the short version, GET /v1/agent/openapi for the full OpenAPI 3.1 spec, and https://suwappu.bot/docs for prose docs.

## Auth
Bearer token via \`Authorization: Bearer suwappu_sk_...\`. Get one from POST /v1/agent/register (public, no auth).

## Agent Account (/v1/agent)
- POST /v1/agent/register — Register agent, get API key (public, IP rate-limited 5/min)
- GET /v1/agent/chains — List supported chains (public)
- GET /v1/agent/me — Get agent profile
- PATCH /v1/agent/me — Update agent profile (name, callback_url, etc.)
- DELETE /v1/agent/me — Permanently delete agent
- POST /v1/agent/me/deactivate — Deactivate agent (reversible)
- POST /v1/agent/reactivate — Reactivate a deactivated agent
- POST /v1/agent/keys/rotate — Rotate API key (old key invalidated immediately)
- GET /v1/agent/openapi — OpenAPI 3.1 spec (public)
- GET /v1/agent/postman — Postman collection generated from the OpenAPI spec (public)

## Tokens, Prices, Portfolio
- GET /v1/agent/tokens?chain= — List tokens on a chain
- GET /v1/agent/prices?symbols= — USD prices + 24h change for up to 20 symbols
- GET /v1/agent/portfolio?wallet_address= — Wallet balances across chains (own managed wallet only)

## Swaps
- POST /v1/agent/quote — Get a swap quote (returns quote_id, valid 60s)
- POST /v1/agent/swap — Build an unsigned transaction from a quote (self-custody signing)
- POST /v1/agent/swap/execute — Execute a quoted swap via managed wallet (server-signed)
- GET /v1/agent/swap/status/:swapId — Poll swap status
- GET /v1/agent/swaps — List past swaps (paginated, filterable by status)
- POST /v1/agent/execute — Natural-language trade command (e.g. "swap 0.5 ETH to USDC on Base")

## Managed Wallets
- GET /v1/agent/wallets — List managed (Turnkey) wallets
- POST /v1/agent/wallets — Create a managed wallet
- POST /v1/agent/wallet/policy — Attach a spending-limit / address-whitelist policy
- GET /v1/agent/wallet/policies — List wallet policies
- DELETE /v1/agent/wallet/policy/:policyId — Remove a wallet policy

## Webhooks
- GET /v1/agent/webhooks — List webhook delivery events
- POST /v1/agent/webhooks/test — Send a test webhook to callback_url

## Billing (x402 + credits + subscriptions)
- GET /v1/agent/billing — Credit balance, tier, cost weights, subscription status
- POST /v1/agent/billing/topup — Credit balance from an on-chain USDC payment {txHash, chain, amount}
- POST /v1/agent/billing/subscribe — Prepaid 30-day access window {txHash, chain, amount, tier}
- POST /v1/agent/billing/recurring — Register a Base Spend Permission for true auto-renew {tier, signature, permission}
- GET /billing/stripe/checkout?tier= — Stripe checkout session (human users, Telegram-authed)
- POST /billing/crypto — Crypto-native subscription for human users (Telegram-authed)

## Perpetual Futures — HyperLiquid (/v1/agent/perps)
- GET /v1/agent/perps/markets — List perp markets (mark price, funding, max leverage)
- POST /v1/agent/perps/quote — Quote a leveraged long/short position
- GET /v1/agent/perps/positions?address= — Open positions for a wallet

## Prediction Markets — Polymarket (/v1/agent/predict)
- GET /v1/agent/predict/markets — Search prediction markets
- GET /v1/agent/predict/events — Browse market events/categories
- GET /v1/agent/predict/market/:id — Market detail with live CLOB prices
- GET /v1/agent/predict/market/:id/book — Order book for a market
- GET /v1/agent/predict/market/:id/price — Live midpoint price
- GET /v1/agent/predict/market/:id/trades — Recent trades
- POST /v1/agent/predict/order — Place a CLOB order
- DELETE /v1/agent/predict/order/:id — Cancel an order
- GET /v1/agent/predict/positions — Positions with PnL
- GET /v1/agent/predict/orders — Open orders

## Lending — Morpho (/v1/agent/lend)
- GET /v1/agent/lend/markets?chainId= — List lending markets (APY, LLTV, TVL)
- GET /v1/agent/lend/market/:id — Market detail

## Protocols
- MCP: POST https://api.suwappu.bot/mcp — JSON-RPC 2.0, 15 tools: get_quote, execute_swap, get_portfolio, get_prices, list_chains, list_tokens, get_tempo_tokens, browse_mpp_directory, predict_markets, predict_market, perps_markets, perps_quote, perps_positions, lend_markets, lend_market
- A2A: POST https://api.suwappu.bot/a2a — JSON-RPC 2.0, methods: message/send, tasks/get, tasks/cancel
- Agent Card: GET https://api.suwappu.bot/.well-known/agent.json (also /.well-known/agent-card.json)
- OpenAPI: GET https://api.suwappu.bot/v1/agent/openapi

## SDKs
npm: @suwappu/sdk | PyPI: suwappu | OpenClaw skill: @suwappu/openclaw

## Docs
https://suwappu.bot/docs
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
