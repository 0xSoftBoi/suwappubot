import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { HTTPException } from 'hono/http-exception'
import { serveStatic } from 'hono/bun'

import { createCorsMiddleware, adminKeyAuth } from './middleware'
import { healthRoutes, webappRoutes, agentRoutes, a2aRoutes, swapRoutes, publicSwapRoutes, adminRoutes, mcpRoutes, tokenRoutes } from './routes'
import agentCard from '../agent-card.json'

export interface AppConfig {
	allowedOrigins: string
	adminApiKey?: string
}

export function createApp(config: AppConfig) {
	const app = new Hono()

	// Global middleware
	app.use('*', logger())
	app.use('*', createCorsMiddleware(config.allowedOrigins))

	// Global error handler
	app.onError((err, c) => {
		if (err instanceof HTTPException) {
			return c.json({ error: err.message }, err.status)
		}

		console.error('Unhandled error:', err)
		return c.json({ error: 'Internal Server Error' }, 500)
	})

	// Public routes
	app.route('/', healthRoutes)

	// Public swap routes for showcase site
	app.route('/public/swap', publicSwapRoutes)

	// Swap routes - mounted first so public endpoints (tokens, chains) are accessible
	app.route('/webapp/swap', swapRoutes)

	// Token search and prices
	app.route('/webapp/tokens', tokenRoutes)

	// Webapp routes - Telegram auth
	app.route('/webapp', webappRoutes)

	// Agent A2A API routes (v1/agent/*) - uses Bearer token auth internally
	// Registration is public, other endpoints require Bearer token
	app.route('/v1/agent', agentRoutes)

	// A2A JSON-RPC endpoint - uses Bearer token auth internally
	app.route('/a2a', a2aRoutes)

	// MCP endpoint for OpenClaw and other MCP-compatible agents
	app.route('/mcp', mcpRoutes)

	// Agent card for A2A discovery (standard path + legacy)
	app.get('/.well-known/agent.json', (c) => c.json(agentCard))
	app.get('/agent-card.json', (c) => c.json(agentCard))

	// Admin API routes - X-Admin-Key required
	app.use('/admin/*', adminKeyAuth(config.adminApiKey))
	app.route('/admin', adminRoutes)

	// Dashboard SPA - static files
	app.use('/dashboard/*', serveStatic({
		root: './dashboard/dist',
		rewriteRequestPath: (path) => path.replace(/^\/dashboard/, ''),
	}))
	app.get('/dashboard/*', serveStatic({
		root: './dashboard/dist',
		rewriteRequestPath: () => '/index.html',
	}))
	app.get('/dashboard', (c) => c.redirect('/dashboard/'))

	// OpenAPI / AI plugin manifest
	app.get('/ai-plugin.json', (c) => {
		return c.json({
			"schema_version": "v1",
			"name_for_human": "Suwappu DEX",
			"name_for_model": "suwappu",
			"description_for_human": "Swap tokens across 7 blockchain networks via natural language",
			"description_for_model": "Use Suwappu to execute token swaps across Ethereum, BSC, Polygon, Arbitrum, Optimism, Base, and Solana. Accepts natural language commands like 'swap 0.5 ETH to USDC on Base'. Returns transaction status and explorer links.",
			"auth": {
				"type": "service_http",
				"authorization_type": "bearer"
			},
			"api": {
				"type": "openapi",
				"url": "https://api.suwappu.bot/openapi.json"
			},
			"logo_url": "https://suwappu.bot/logo.png",
			"contact_email": "support@suwappu.bot",
			"legal_info_url": "https://suwappu.bot/terms"
		})
	})

	return app
}

export type App = ReturnType<typeof createApp>
