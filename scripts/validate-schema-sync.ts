#!/usr/bin/env bun
/**
 * Schema Sync Validator
 *
 * Compares Python SQLAlchemy models (via database introspection) with
 * Drizzle ORM schema definitions to detect drift between the two systems.
 *
 * Usage:
 *   cd api-ts && bun run ../scripts/validate-schema-sync.ts
 *
 * Or with a database URL:
 *   DATABASE_URL=postgresql://... bun run scripts/validate-schema-sync.ts
 */

import * as schema from '../api-ts/src/db/schema'

// Extract table names from Drizzle schema
const drizzleTables = new Set<string>()

for (const [exportName, value] of Object.entries(schema)) {
	if (value && typeof value === 'object') {
		// Drizzle pgTable objects store the SQL table name in a Symbol('drizzle:Name')
		const symbols = Object.getOwnPropertySymbols(value)
		for (const sym of symbols) {
			const desc = sym.description || sym.toString()
			if (desc === 'drizzle:BaseName') {
				const tableName = (value as any)[sym]
				if (typeof tableName === 'string') {
					drizzleTables.add(tableName)
				}
			}
		}
	}
}

// Known Python-only tables (defined in bot/models/ but not yet in Drizzle)
// All tables have been migrated to Drizzle schemas
const PYTHON_ONLY_TABLES: string[] = []

// All expected tables (Python + Drizzle)
const ALL_EXPECTED_TABLES = [
	// Core
	'users',
	'wallets',
	'swap_transactions',
	'agents',
	// Advanced orders
	'limit_orders',
	'dca_orders',
	'dca_executions',
	'swap_templates',
	'rug_monitors',
	// Referrals
	'referrals',
	'referral_codes',
	'referral_rewards',
	'referral_payouts',
	// Points & Gamification
	'user_points',
	'point_transactions',
	'point_redemptions',
	'points_tiers',
	'milestones',
	'user_milestones',
	'rewards',
	'daily_quests',
	'user_quests',
	'jackpot_pools',
	// Copy trading
	'trader_profiles',
	'copy_follows',
	'copy_trades',
	'trader_trades',
	'copy_notifications',
	// Webhooks
	'webhook_events',
	// Price alerts
	'price_alerts',
	// Trader stats
	'trader_stats',
	// Perps
	'perp_positions',
	'perp_orders',
	'hyperliquid_accounts',
	// Subscriptions & Payments
	'subscriptions',
	'x402_payments',
	'api_credits',
	// Snipe
	'snipe_orders',
	'snipe_configs',
	'snipe_history',
	'watched_tokens',
	'auto_snipe_rules',
	// Fees
	'fee_config',
	'fee_transactions',
	'fee_discounts',
	'fee_summaries',
	// Security
	'audit_logs',
	'backup_codes',
	'withdrawal_whitelist',
	// OAuth
	'oauth_identities',
	'oauth_tokens',
	'oauth_states',
	// Custodial
	'hot_wallets',
	// PnL
	'token_positions',
]

// ─── Validation ─────────────────────────────────────────────

console.log('╔══════════════════════════════════════════════════════╗')
console.log('║           Schema Sync Validator                     ║')
console.log('╚══════════════════════════════════════════════════════╝')
console.log()

console.log(`Drizzle tables found: ${drizzleTables.size}`)
console.log(`Python-only tables (not in Drizzle): ${PYTHON_ONLY_TABLES.length}`)
console.log(`Total expected tables: ${ALL_EXPECTED_TABLES.length}`)
console.log()

// Check which expected tables are in Drizzle
const coveredByDrizzle: string[] = []
const missingFromDrizzle: string[] = []
const pythonOnly: string[] = []

for (const table of ALL_EXPECTED_TABLES) {
	if (drizzleTables.has(table)) {
		coveredByDrizzle.push(table)
	} else if (PYTHON_ONLY_TABLES.includes(table)) {
		pythonOnly.push(table)
	} else {
		missingFromDrizzle.push(table)
	}
}

// Check for extra Drizzle tables not in expected list
const extraDrizzle: string[] = []
for (const table of drizzleTables) {
	if (!ALL_EXPECTED_TABLES.includes(table)) {
		extraDrizzle.push(table)
	}
}

// Report
console.log('── Covered by Drizzle ──────────────────────────────')
for (const t of coveredByDrizzle.sort()) {
	console.log(`  ✓ ${t}`)
}

if (missingFromDrizzle.length > 0) {
	console.log()
	console.log('── Missing from Drizzle (should be added) ─────────')
	for (const t of missingFromDrizzle.sort()) {
		console.log(`  ✗ ${t}`)
	}
}

console.log()
console.log('── Python-only (low priority) ─────────────────────')
for (const t of pythonOnly.sort()) {
	console.log(`  ○ ${t}`)
}

if (extraDrizzle.length > 0) {
	console.log()
	console.log('── Extra Drizzle tables (not in Python) ────────────')
	for (const t of extraDrizzle.sort()) {
		console.log(`  ? ${t}`)
	}
}

// Coverage
const coverage = (coveredByDrizzle.length / ALL_EXPECTED_TABLES.length) * 100
console.log()
console.log(`Coverage: ${coveredByDrizzle.length}/${ALL_EXPECTED_TABLES.length} tables (${coverage.toFixed(1)}%)`)

if (missingFromDrizzle.length > 0) {
	console.log()
	console.log(`⚠  ${missingFromDrizzle.length} table(s) need Drizzle schemas`)
	process.exit(1)
} else {
	console.log()
	console.log('✓ All critical tables have Drizzle schemas')
}
