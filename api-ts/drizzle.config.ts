import { defineConfig } from 'drizzle-kit'

export default defineConfig({
	schema: './src/db/schema/index.ts',
	out: './drizzle',
	dialect: 'postgresql',
	dbCredentials: {
		url: process.env.DATABASE_URL!,
	},
	// This database is SHARED with the python-api (SQLAlchemy), which is the authority for
	// every table both services define (users, wallets, limit_orders, agents, …). Scope
	// drizzle-kit (push/migrate) to ONLY the tables api-ts exclusively owns, so it never
	// alters or drops python-owned tables/columns (e.g. wallets.turnkey_sub_org_id). Runtime
	// Drizzle queries are unaffected — tablesFilter only scopes the migration tool.
	tablesFilter: ['daily_quests', 'jackpot_pools', 'polymarket_accounts'],
})
