import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { HTTPException } from 'hono/http-exception'

import { createCorsMiddleware, agentKeyAuth } from './middleware'
import { healthRoutes, toolsRoutes, webappRoutes, usersRoutes, agentRoutes, pointsRoutes, swapRoutes } from './routes'

export interface AppConfig {
	allowedOrigins: string
	agentApiKey?: string
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

	// Swap routes - mounted first so public endpoints (tokens, chains) are accessible
	app.route('/webapp/swap', swapRoutes)
	
	// Webapp routes - Telegram auth
	app.route('/webapp', webappRoutes)

	// Agent A2A API routes (v1/agent/*) - uses Bearer token auth internally
	// Registration is public, other endpoints require Bearer token
	app.route('/v1/agent', agentRoutes)

	// Legacy internal API routes - X-Agent-Key required
	const agentProtected = new Hono()
	agentProtected.use('*', agentKeyAuth(config.agentApiKey))
	agentProtected.route('/', toolsRoutes)
	agentProtected.route('/users', usersRoutes)
	agentProtected.route('/users', pointsRoutes)
	app.route('/', agentProtected)

	// Agent card for A2A discovery
	app.get('/agent-card.json', (c) => {
		return c.json({
			"$schema": "https://specs.a2aprotocol.ai/agent-card.json",
			"name": "Suwappu",
			"description": "Cross-chain DEX for AI agents. Swap tokens across 7 chains via natural language.",
			"version": "0.1.0",
			"url": "https://api.suwappu.bot",
			"logo": "https://suwappu.bot/logo.png",
			"capabilities": {
				"streaming": false,
				"pushNotifications": true,
				"stateTransitionHistory": false
			},
			"authentication": {
				"schemes": ["bearer"],
				"credentials": null
			},
			"defaultInputModes": ["text"],
			"defaultOutputModes": ["text"],
			"skills": [
				{
					"id": "swap",
					"name": "Token Swap",
					"description": "Swap tokens across 7 chains (ETH, BSC, Polygon, Arbitrum, Optimism, Base, Solana)",
					"tags": ["defi", "swap", "trading", "cross-chain"],
					"examples": [
						"swap 0.5 ETH to USDC on Base",
						"swap 100 USDC to SOL on Solana"
					]
				},
				{
					"id": "quote",
					"name": "Get Quote",
					"description": "Get a swap quote without executing",
					"tags": ["defi", "quote", "price"],
					"examples": [
						"quote 1 ETH to USDC",
						"price of 100 USDC in ETH"
					]
				},
				{
					"id": "portfolio",
					"name": "Portfolio Check",
					"description": "Check token balances across all chains",
					"tags": ["balance", "portfolio", "wallet"],
					"examples": [
						"check balance",
						"show portfolio"
					]
				}
			],
			"provider": {
				"organization": "Suwappu",
				"url": "https://suwappu.bot"
			}
		})
	})

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
