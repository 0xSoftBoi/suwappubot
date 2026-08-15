import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

export function createDbClient(databaseUrl: string) {
	const queryClient = postgres(databaseUrl, {
		max: 20,
		idle_timeout: 60,
		connect_timeout: 10,
		ssl: 'require',
		connection: { statement_timeout: 30000 },
	})

	return drizzle(queryClient, { schema })
}

export type DbClient = ReturnType<typeof createDbClient>

// The `tx` handle passed into `db.transaction(async (tx) => {...})`. Supports
// the same query-builder surface as DbClient but not `.transaction()` itself
// (nested transactions use savepoints, not this type). Used by helpers that
// must run their writes inside a caller-provided transaction rather than
// opening their own connection.
export type DbTransaction = Parameters<DbClient['transaction']>[0] extends (
	tx: infer T,
) => unknown
	? T
	: never
