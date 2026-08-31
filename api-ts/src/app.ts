import { Hono } from 'hono'
import { serveStatic } from 'hono/bun'
import { HTTPException } from 'hono/http-exception'
import { logger as honoLogger } from 'hono/logger'
import agentCard from '../agent-card.json'
import aiCatalog from '../ai-catalog.json'
import type { AgentErrorCode } from './lib/agentError'
import { logger } from './lib/logger'
import { captureServerError } from './lib/sentry'
import {
	adminKeyAuth,
	createCorsMiddleware,
	createMcpOriginGuard,
	otelRequestTracing,
} from './middleware'
import { internalAuth } from './middleware/internalAuth'
import { ipRateLimit } from './middleware/ipRateLimit'
import {
	a2aRoutes,
	adminRoutes,
	agentRoutes,
	autopilotAdminRoutes,
	autopilotRoutes,
	billingRoutes,
	createPythonProxyRoutes,
	createTerminalSwapProxyRoutes,
	dataRoutes,
	enterpriseAuditRoutes,
	enterpriseComplianceRoutes,
	enterprisePoliciesRoutes,
	enterpriseRoutes,
	enterpriseTransactionsRoutes,
	enterpriseWebhooksRoutes,
	healthRoutes,
	internalRoutes,
	lendRoutes,
	MCP_TOOLS,
	mcpRoutes,
	p2pRoutes,
	perpsRoutes,
	predictRoutes,
	publicSwapRoutes,
	rewardsRoutes,
	smartAccountRoutes,
	stakingRoutes,
	swapRoutes,
	tokenRoutes,
	webappDataRoutes,
	webappRoutes,
	webappStubs,
} from './routes'

/**
 * Best-effort mapping from a thrown HTTPException (status + message) to the
 * stable 17-code contract (see lib/agentError.ts) for agent-facing surfaces
 * (/v1/agent/*, /mcp). HTTPExceptions thrown directly by middleware (e.g.
 * agentBearerAuth) don't carry a structured code, so this is deduced from
 * status + message text.
 */
function httpExceptionCode(status: number, message: string): AgentErrorCode {
	if (status === 401) {
		return /api.?key/i.test(message) ? 'INVALID_API_KEY' : 'UNAUTHORIZED'
	}
	if (status === 402) return 'PAYMENT_REQUIRED'
	if (status === 403) return 'INSUFFICIENT_SCOPE'
	if (status === 429) return 'RATE_LIMITED'
	if (status === 400) return 'VALIDATION_ERROR'
	if (status === 404) return 'NOT_FOUND'
	return 'INTERNAL'
}

export interface AppConfig {
	allowedOrigins: string
	adminApiKey?: string | undefined
	internalApiKey?: string | undefined
	internalApiUrl?: string | undefined
	// String 'true'/'false' (matches the *_ENABLED convention in EnvService).
	// Only when 'true' is the OTel request-tracing middleware registered at
	// all — see the otelRequestTracing() call below and lib/otel.ts.
	otelEnabled?: string | undefined
}

// Per-request context variables set by middleware (see request-ID middleware below).
type AppVariables = { requestId: string }

export function createApp(config: AppConfig) {
	const app = new Hono<{ Variables: AppVariables }>()

	// Global middleware
	app.use('*', honoLogger())
	app.use('*', createCorsMiddleware(config.allowedOrigins))

	// OpenTelemetry request tracing — only registered when OTEL_ENABLED='true'.
	// Gating at registration (not inside the middleware) means the disabled
	// path never allocates a span or touches the OTel API at all: zero added
	// latency, zero behavior change. See lib/otel.ts for SDK init.
	if (config.otelEnabled === 'true') {
		app.use('*', otelRequestTracing())
	}

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
			// Only report unexpected 5xx HTTPExceptions to Sentry. Expected 4xx
			// (validation, auth failures, 402 billing challenges) are normal
			// traffic, not incidents — capturing them would flood the quota.
			if (err.status >= 500) {
				captureServerError(err, {
					path: c.req.path,
					method: c.req.method,
					requestId,
					status: err.status,
				})
			}

			const isAgentSurface = c.req.path.startsWith('/v1/agent') || c.req.path.startsWith('/mcp')
			const cause = err.cause as { hint?: string } | undefined
			const body: Record<string, unknown> = { error: err.message, requestId, timestamp }

			if (isAgentSurface) {
				body.error_code = httpExceptionCode(err.status, err.message)
				if (cause?.hint) body.hint = cause.hint
				else if (err.status === 401)
					body.hint = 'Register at POST /v1/agent/register to get an API key'
			}

			return c.json(body, err.status)
		}

		logger.error({ err, requestId }, 'Unhandled error')
		captureServerError(err, { path: c.req.path, method: c.req.method, requestId })
		return c.json({ error: 'Internal Server Error', requestId, timestamp }, 500)
	})

	// Public routes
	app.route('/', healthRoutes)

	// Public swap routes for showcase site
	app.route('/public/swap', publicSwapRoutes)

	// MONEY-PATH: standalone Terminal's POST swap contract still lives in Python.
	// This exact-path gateway must be mounted before swapRoutes; requests carrying
	// Telegram init-data fall through to the existing api-ts implementation.
	app.route('/', createTerminalSwapProxyRoutes({ baseUrl: config.internalApiUrl }))

	// Native api-ts swap routes are still ahead of the general /webapp routers below.
	app.route('/webapp/swap', swapRoutes)

	// P2P marketplace (native offer book + trades; external aggregation via bot)
	app.route('/webapp/p2p', p2pRoutes)

	// On-chain fee-cashback rewards (read API + wallet-claim payloads)
	app.route('/webapp/rewards', rewardsRoutes)

	// Token search/price routes - public, no Telegram auth required
	app.route('/webapp/tokens', tokenRoutes)

	// Webapp routes - Telegram auth
	app.route('/webapp', webappRoutes)

	// Read-only market-data platform for our own front-ends (Mini App +
	// Terminal dashboard) — flexAuth() accepts either credential. Same JSON
	// shapes as /v1/data/*, no metering (see routes/webappData.ts).
	app.route('/webapp/data', webappDataRoutes)

	// Webapp feature stubs - intentional placeholders for in-development features
	app.route('/webapp', webappStubs)

	// Terminal is built with https://api.suwappu.bot as its production API origin,
	// while browser auth and a small set of read-only Terminal feeds still live in
	// Python. Bridge only that explicit allowlist; money-changing Python routes stay
	// unreachable from api-ts until they receive their own reviewed implementation.
	app.route('/', createPythonProxyRoutes({ baseUrl: config.internalApiUrl }))

	// Staking routes - SUWP token staking dashboard
	app.route('/staking', stakingRoutes)

	// ERC-4337 smart-account routes - address prediction + capability descriptor
	app.route('/v1/smart-account', smartAccountRoutes)

	// Billing routes - Stripe subscription management
	app.route('/billing', billingRoutes)

	// Enterprise org management + API key control plane
	app.route('/enterprise', enterpriseRoutes)
	// Enterprise transaction monitoring — separate router, same prefix (Hono
	// supports multiple app.route() calls at one path).
	app.route('/enterprise', enterpriseTransactionsRoutes)
	// Enterprise hash-chained audit log — separate router, same prefix.
	app.route('/enterprise', enterpriseAuditRoutes)
	// Enterprise compliance/KYT screening-events surface — separate router,
	// same prefix.
	app.route('/enterprise', enterpriseComplianceRoutes)
	// Enterprise org policy engine + quorum approvals + signed policy export —
	// separate router, same prefix.
	app.route('/enterprise', enterprisePoliciesRoutes)
	// Enterprise org webhook config + HMAC-signed SIEM alert dispatch —
	// separate router, same prefix.
	app.route('/enterprise', enterpriseWebhooksRoutes)

	// Core agent routes (v1/agent/*) enforce their own public/authenticated boundaries.
	// Protocol-specific routes mounted below define their own auth boundary as well.
	app.route('/v1/agent', agentRoutes)

	// Protocol-specific agent routes
	app.route('/v1/agent/perps', perpsRoutes)
	app.route('/v1/agent/predict', predictRoutes)
	app.route('/v1/agent/lend', lendRoutes)

	// Market data distribution layer (Databento-parity, Phase 3) — reference,
	// historical OHLCV, and live WS price ticks. Auth mirrors /v1/agent (org API
	// key or agent bearer token via agentFlexAuth), enforced inside dataRoutes.
	app.route('/v1/data', dataRoutes)

	// Autopilot — the autonomous trading agent's public transparency surface.
	// Unauthenticated by design: decisions, refusals, positions and P&L are the
	// product. Control lives on /admin/autopilot behind X-Admin-Key.
	app.route('/v1/autopilot', autopilotRoutes)

	// A2A JSON-RPC endpoint - uses Bearer token auth internally
	app.route('/a2a', a2aRoutes)

	// MCP endpoint for OpenClaw and other MCP-compatible agents
	// Generous IP rate limit — public methods (initialize, tools/list, etc.) are
	// unauthenticated, so this is the only throttle protecting them from abuse.
	// Streamable HTTP additionally requires rejecting an invalid Origin (when
	// present) to prevent DNS-rebinding attacks against MCP endpoints.
	app.use('/mcp', createMcpOriginGuard(config.allowedOrigins))
	app.use('/mcp/*', createMcpOriginGuard(config.allowedOrigins))
	app.use('/mcp', ipRateLimit(60))
	app.use('/mcp/*', ipRateLimit(60))
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
		// Generated from mcp.ts's TOOLS constant (the single source of truth for the
		// MCP surface) so this line can't silently drift out of sync when a new tool
		// is added — a hand-written list here previously went stale.
		const mcpToolNames = MCP_TOOLS.map((t) => t.name).join(', ')
		return c.text(`# Suwappu API

> Cross-chain DEX API for AI agents. Best-price swaps, HyperLiquid perps, and gasless trades across 40+ chains.

## Base URL
https://api.suwappu.bot/v1/agent

## Auth
Authenticated calls use \`Authorization: Bearer suwappu_sk_...\`.
Get a key with POST /register (no auth needed). Lending REST reads listed below are public.

## Quick Start
1. POST /register {"name":"my-agent"} → get api_key + 100 free starter credits
2. POST /quote {"from_token":"ETH","to_token":"USDC","amount":"0.5","chain":"base"} → get quote_id (1 credit)
3. POST /swap/execute {"quote_id":"..."} → swap executed (5 credits)
4. GET /swap/status/{id} — check result

## Credits & billing
New agents get 100 free credits (1 credit ≈ $0.001 USD) on registration. GET /tokens and
GET /chains are always free (0 credits). Metered calls 402 with a structured payment
challenge once your balance runs out — top up via POST /billing/topup {txHash, chain, amount}
or subscribe via POST /billing/subscribe for unmetered access.

## Endpoints

### Public (no auth)
- POST /register — Register agent, get API key
- GET /chains — List supported chains
- GET /openapi — OpenAPI 3.1 spec
- GET /lend/markets?chainId= — Current Morpho market snapshots
- GET /lend/market/:id?chainId= — Chain-scoped Morpho market detail

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
- GET /lend/markets?chainId= — Current APY, USD liquidity, listing status, and warnings
- GET /lend/market/{id}?chainId= — Chain-scoped market detail (read-only)

## Protocols
- REST: https://api.suwappu.bot/v1/agent/*
- MCP: POST https://api.suwappu.bot/mcp (JSON-RPC 2.0; tools: ${mcpToolNames}; resources + prompts supported)
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
Authenticated calls use \`Authorization: Bearer suwappu_sk_...\`. Get one from POST /v1/agent/register (public, no auth). The lending REST reads explicitly marked public below do not require it.

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
- GET /v1/agent/perps/markets — List perp markets (live mark/funding, Suwappu quote max, venue max leverage)
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
- GET /v1/agent/lend/markets?chainId= — Current APY/utilization, USD supply/borrow/liquidity, listing status, warnings (public, read-only)
- GET /v1/agent/lend/market/:id?chainId= — Chain-scoped market detail (public, read-only)

## Protocols
- MCP: POST https://api.suwappu.bot/mcp — JSON-RPC 2.0; call tools/list for the current tool catalog
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
	app.route('/admin/autopilot', autopilotAdminRoutes)

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
