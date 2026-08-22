import { Hono } from 'hono'
import { serveStatic } from 'hono/bun'
import { HTTPException } from 'hono/http-exception'
import { logger as honoLogger } from 'hono/logger'
import { logger } from './lib/logger'
import type { AgentErrorCode } from './lib/agentError'
import { captureServerError } from './lib/sentry'
import agentCard from '../agent-card.json'
import aiCatalog from '../ai-catalog.json'
import { adminKeyAuth, createCorsMiddleware, createMcpOriginGuard, otelRequestTracing } from './middleware'
import { internalAuth } from './middleware/internalAuth'
import { ipRateLimit } from './middleware/ipRateLimit'
import {
	a2aRoutes,
	adminRoutes,
	agentRoutes,
	billingRoutes,
	dataRoutes,
	enterpriseRoutes,
	healthRoutes,
	internalRoutes,
	lendRoutes,
	mcpRoutes,
	p2pRoutes,
	perpsRoutes,
	rewardsRoutes,
	predictRoutes,
	createPythonProxyRoutes,
	createTerminalSwapProxyRoutes,
	publicSwapRoutes,
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
				else if (err.status === 401) body.hint = 'Register at POST /v1/agent/register to get an API key'
			}

			return c.json(body, err.status)
		}

		logger.error({ err, requestId }, 'Unhandled error')
		captureServerError(err, { path: c.req.path, method: c.req.method, requestId })
		return c.json({ error: 'Internal Server Error', requestId, timestamp }, 500)
	})

	// Public routes, including generated machine contracts (`/llms.txt`,
	// `/llms-full.txt`, OpenAPI, lifecycle and retry registries). Keep these
	// centralized in health/apiContractRoutes so app.ts never owns a second
	// hand-maintained endpoint inventory.
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
	// generated llms.txt) so ARD-aware crawlers don't have to guess well-known paths.
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
			description_for_human: 'Discover and route token swaps across supported blockchain networks',
			description_for_model:
				"Use Suwappu to discover supported chains at GET /v1/agent/chains, quote swaps, prepare unsigned self-custody transactions, or use explicit managed execution only when authorized. Do not assume a static chain list or infer authority from a method name.",
			auth: {
				type: 'service_http',
				authorization_type: 'bearer',
			},
			api: {
				type: 'openapi',
				url: 'https://api.suwappu.bot/v1/agent/openapi',
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
