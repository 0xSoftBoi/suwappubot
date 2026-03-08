import { Effect } from 'effect'
import { createApp } from './app'
import { EnvService } from './config/EnvService'
import { runEffect, shutdownRuntime } from './runtime'

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
	})

	// Start server
	const server = Bun.serve({
		port: env.PORT,
		fetch: app.fetch,
	})

	console.log(`🚀 Suwappu API (TypeScript) running at http://localhost:${server.port}`)
	console.log(`   Environment: ${env.NODE_ENV}`)
	console.log(`   Database: ${env.DATABASE_URL ? 'configured' : 'not configured'}`)

	// Graceful shutdown
	const shutdown = async () => {
		console.log('\n🛑 Shutting down...')
		server.stop()
		await shutdownRuntime()
		process.exit(0)
	}

	process.on('SIGINT', shutdown)
	process.on('SIGTERM', shutdown)
}

main().catch((err) => {
	console.error('Failed to start server:', err)
	process.exit(1)
})
