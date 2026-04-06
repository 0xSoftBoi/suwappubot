import { Effect } from 'effect'
import { createApp } from './app'
import { EnvService } from './config/EnvService'
import { logger } from './lib/logger'
import { stopA2aCleanup } from './routes/a2a'
import { stopAgentCleanup } from './routes/agent'
import { runEffect, shutdownRuntime } from './runtime'
import { startDcaMonitor, stopDcaMonitor } from './workers/dcaMonitor'
import { startLimitOrderMonitor, stopLimitOrderMonitor } from './workers/limitOrderMonitor'
import { startPriceAlertMonitor, stopPriceAlertMonitor } from './workers/priceAlertMonitor'

async function main() {
	// Get environment config
	const env = await runEffect(
		Effect.gen(function* () {
			return yield* EnvService
		}),
	)

	// Create app with config
	const app = createApp({
		allowedOrigins: env.ALLOWED_ORIGINS,
		adminApiKey: env.ADMIN_API_KEY,
		internalApiKey: env.INTERNAL_API_KEY,
	})

	// Start server
	const server = Bun.serve({
		port: env.PORT,
		fetch: app.fetch,
	})

	logger.info(`Suwappu API (TypeScript) running at http://localhost:${server.port}`)
	logger.info(`Environment: ${env.NODE_ENV}`)
	logger.info(`Database: ${env.DATABASE_URL ? 'configured' : 'not configured'}`)
	startLimitOrderMonitor()
	startDcaMonitor()
	startPriceAlertMonitor()

	// Graceful shutdown
	const shutdown = async () => {
		logger.info('Shutting down...')
		stopA2aCleanup()
		stopAgentCleanup()
		await stopPriceAlertMonitor()
		await stopDcaMonitor()
		await stopLimitOrderMonitor()
		server.stop()
		await shutdownRuntime()
		process.exit(0)
	}

	process.on('SIGINT', shutdown)
	process.on('SIGTERM', shutdown)
}

main().catch((err) => {
	logger.error({ err }, 'Failed to start server')
	process.exit(1)
})
