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
	//
	// MAINTENANCE RULE: every NEW api-ts-exclusive pgTable (one with no SQLAlchemy
	// __tablename__ in bot/models and no CREATE in database/db.py) MUST be added here.
	// Omitting one makes `drizzle-kit push` re-emit CREATE TABLE for it every boot →
	// "relation … already exists" (start.sh swallows it, but it's noise that masks real
	// failures). The x402 billing tables below were missing, which caused exactly that.
	// (user_quests is intentionally NOT here — python owns it via database/db.py.)
	tablesFilter: [
		'daily_quests',
		'jackpot_pools',
		'polymarket_accounts',
		// api-ts-exclusive x402 native-billing tables (payments.ts) — no python owner.
		'agent_credits',
		'agent_credit_topups',
		'agent_subscriptions',
		// api-ts-exclusive copy-trading stats (traderStats.ts) — python computes stats
		// in-memory (copy_service.get_trader_stats) but defines no trader_stats table.
		'trader_stats',
		// api-ts-exclusive institutional policy layer (policies.ts) — no python owner.
		// (audit_logs columns are NOT here: audit_logs is python-owned, so its new
		// org_id/agent_id columns are added via database/db.py _ensure_schema.)
		'policies',
		'policy_decisions',
		'policy_kill_switches',
	],
})
