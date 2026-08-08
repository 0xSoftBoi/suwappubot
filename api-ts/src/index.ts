import { Effect } from 'effect'
import { createApp } from './app'
import { EnvService } from './config/EnvService'
import { logger } from './lib/logger'
import { initOtel, shutdownOtel } from './lib/otel'
import { initSentry } from './lib/sentry'
import { stopA2aCleanup } from './routes/a2a'
import { stopAgentCleanup } from './routes/agent'
import { runEffect, shutdownRuntime } from './runtime'

async function main() {
	// Get environment config
	const env = await runEffect(
		Effect.gen(function* () {
			return yield* EnvService
		}),
	)

	// Initialize Sentry as early as possible — before app/route construction,
	// so any error during startup or the first request is captured. No-op
	// when SENTRY_DSN is unset; never throws (see src/lib/sentry.ts).
	initSentry(env.SENTRY_DSN, env.NODE_ENV)

	// Initialize OpenTelemetry tracing — no-op unless OTEL_ENABLED='true'.
	// Awaited so the dynamic SDK imports (when enabled) complete before the
	// app/middleware stack is built; never throws (see src/lib/otel.ts).
	await initOtel({
		enabled: env.OTEL_ENABLED,
		serviceName: env.OTEL_SERVICE_NAME,
		endpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
	})

	// Create app with config
	const app = createApp({
		allowedOrigins: env.ALLOWED_ORIGINS,
		adminApiKey: env.ADMIN_API_KEY,
		internalApiKey: env.INTERNAL_API_KEY,
		internalApiUrl: env.INTERNAL_API_URL,
		otelEnabled: env.OTEL_ENABLED,
	})

	// Start server
	const server = Bun.serve({
		port: env.PORT,
		fetch: app.fetch,
	})

	logger.info(`Suwappu API (TypeScript) running at http://localhost:${server.port}`)
	logger.info(`Environment: ${env.NODE_ENV}`)
	logger.info(`Database: ${env.DATABASE_URL ? 'configured' : 'not configured'}`)

	// Graceful shutdown
	const shutdown = async () => {
		logger.info('Shutting down...')
		stopA2aCleanup()
		stopAgentCleanup()
		server.stop()
		await shutdownOtel()
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
