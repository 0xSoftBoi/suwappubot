import { Effect } from 'effect'
import { websocket } from 'hono/bun'
import { createApp } from './app'
import { EnvService } from './config/EnvService'
import { flushDataUsage, stopDataUsageFlusher } from './lib/dataUsage'
import { logger } from './lib/logger'
import { initOtel, shutdownOtel } from './lib/otel'
import { initSentry } from './lib/sentry'
import { stopA2aCleanup } from './routes/a2a'
import { stopAgentCleanup } from './routes/agent'
import { stopDataLiveTicker } from './routes/data'
import { runEffect, shutdownRuntime } from './runtime'
import { runAutopilotBootstrap } from './services/autopilot/bootstrap'
import { startAutopilotScheduler, stopAutopilotScheduler } from './services/autopilot/scheduler'

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

	// Start server. `websocket` (from hono/bun) wires the Bun-native WS upgrade
	// handler used by GET /v1/data/live (routes/data.ts's upgradeWebSocket()) —
	// without it Bun.serve has no `websocket` handler to hand upgraded
	// connections off to and hono's upgradeWebSocket() would throw at request time.
	const server = Bun.serve({
		port: env.PORT,
		fetch: app.fetch,
		websocket,
	})

	logger.info(`Suwappu API (TypeScript) running at http://localhost:${server.port}`)
	logger.info(`Environment: ${env.NODE_ENV}`)
	logger.info(`Database: ${env.DATABASE_URL ? 'configured' : 'not configured'}`)

	// Seed the paper agent this environment declares, if it is missing. Paper
	// only, and never modifies an agent that already exists. If the schema is not
	// up yet (dual-owned tables — see ADR 0003), the scheduler retries it.
	const seeded = await runAutopilotBootstrap(env.AUTOPILOT_BOOTSTRAP)

	// Autopilot — periodic autonomous trading cycles. Disabled unless
	// AUTOPILOT_CYCLE_MINUTES is set, and each agent still has to be `active`
	// and (for real money) explicitly in live mode.
	startAutopilotScheduler(env.AUTOPILOT_CYCLE_MINUTES, seeded ? undefined : env.AUTOPILOT_BOOTSTRAP)

	// Graceful shutdown
	const shutdown = async () => {
		logger.info('Shutting down...')
		stopA2aCleanup()
		stopAgentCleanup()
		stopDataLiveTicker()
		stopAutopilotScheduler()
		// Drain the write-behind usage buffer before stopping the flush timer —
		// otherwise any unflushed /v1/data/* request counts from the last <30s
		// are silently dropped on every deploy/restart.
		await flushDataUsage()
		stopDataUsageFlusher()
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
