import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { HTTPException } from 'hono/http-exception'

import { createCorsMiddleware, agentKeyAuth } from './middleware'
import { healthRoutes, toolsRoutes, webappRoutes, usersRoutes, agentRoutes, pointsRoutes, swapRoutes, walletsRoutes, balancesRoutes, settingsRoutes, tokensRoutes } from './routes'

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

	// Public token routes (no auth required for price/token data)
	app.route('/tokens', tokensRoutes)

	// Webapp routes - Telegram auth (mounted before agent-protected routes)
	app.route('/webapp', webappRoutes)
	app.route('/webapp/swap', swapRoutes)
	app.route('/webapp/wallets', walletsRoutes)
	app.route('/webapp/balances', balancesRoutes)
	app.route('/webapp/settings', settingsRoutes)

	// Agent API routes - Agent API key required
	const v1 = new Hono()
	v1.use('*', agentKeyAuth(config.agentApiKey))
	v1.route('/agent', agentRoutes)
	app.route('/v1', v1)

	// Agent-protected routes - Agent API key required
	const agentProtected = new Hono()
	agentProtected.use('*', agentKeyAuth(config.agentApiKey))
	agentProtected.route('/', toolsRoutes)
	agentProtected.route('/users', usersRoutes)
	agentProtected.route('/users', pointsRoutes)
	app.route('/', agentProtected)

	return app
}

export type App = ReturnType<typeof createApp>
