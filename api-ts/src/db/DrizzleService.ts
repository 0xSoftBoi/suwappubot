import { Context, Effect, Layer, Option, Scope } from 'effect'
import { EnvService } from '../config/EnvService'
import { DatabaseError } from '../errors'
import { logger } from '../lib/logger'
import { createDbClient, type DbClient } from './client'

// Optional database client - None when DATABASE_URL is not configured
export type OptionalDbClient = Option.Option<DbClient>

export class DrizzleService extends Context.Tag('DrizzleService')<
	DrizzleService,
	OptionalDbClient
>() {}

export const DrizzleServiceLive = Layer.scoped(
	DrizzleService,
	Effect.gen(function* () {
		const env = yield* EnvService
		const scope = yield* Effect.scope

		if (!env.DATABASE_URL) {
			logger.info('[DrizzleService] DATABASE_URL not configured, running without database')
			return Option.none<DbClient>()
		}

		const db = createDbClient(env.DATABASE_URL)

		// Register cleanup finalizer
		yield* Scope.addFinalizer(
			scope,
			Effect.sync(() => {
				logger.info('[DrizzleService] Shutting down database connections')
			}),
		)

		return Option.some(db)
	}),
)

// Helper to get the database or fail with a clear error
export const requireDb = Effect.gen(function* () {
	const dbOption = yield* DrizzleService
	if (Option.isNone(dbOption)) {
		return yield* Effect.fail(
			new DatabaseError({ message: 'Database not configured. Set DATABASE_URL environment variable.' }),
		)
	}
	return dbOption.value
})
