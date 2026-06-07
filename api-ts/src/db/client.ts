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
