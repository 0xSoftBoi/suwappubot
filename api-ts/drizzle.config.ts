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
	// drizzle-kit schema sync/introspection (push/pull) to ONLY the tables api-ts
	// exclusively owns, so it never
	// alters or drops python-owned tables/columns (e.g. wallets.turnkey_sub_org_id). Runtime
	// Drizzle queries are unaffected. Committed migrations still execute their SQL
	// verbatim; tablesFilter only scopes commands that support schema filtering.
	//
	// MAINTENANCE RULE: every NEW api-ts-exclusive pgTable (one with no SQLAlchemy
	// __tablename__ in bot/models and no CREATE in database/db.py) MUST be added here.
	// Omitting one makes `drizzle-kit push` re-emit CREATE TABLE for it every boot →
	// "relation … already exists" (start.sh swallows it, but it's noise that masks real
	// failures). The x402 billing tables below were missing, which caused exactly that.
	// (user_quests is intentionally NOT here — python owns it via database/db.py.)
	//
	// NOTE: not every table below is api-ts-EXCLUSIVE. daily_quests, jackpot_pools,
	// agent_credits, agent_credit_topups, agent_subscriptions are ALSO created by the
	// Python stack's _ensure_schema() (CREATE TABLE IF NOT EXISTS, database/db.py:1759+)
	// with matching DDL — they are co-managed, which is safe because both sides are
	// idempotent. tablesFilter simply bounds what drizzle-kit will touch; it does not
	// assert sole ownership.
	tablesFilter: [
		'daily_quests',
		'jackpot_pools',
		'polymarket_accounts',
		// api-ts-exclusive passkey credential registry (passkeyCredentials.ts).
		'passkey_credentials',
		// x402 native-billing tables (payments.ts) — co-created by python _ensure_schema.
		'agent_credits',
		'agent_credit_topups',
		'agent_subscriptions',
		// SHARED consumed-payments ledger (payments.ts) — global (chain,txHash)
		// replay/double-redeem guard. api-ts-exclusive (no python owner).
		'consumed_payments',
		// api-ts-exclusive copy-trading stats (traderStats.ts) — python computes stats
		// in-memory (copy_service.get_trader_stats) but defines no trader_stats table.
		'trader_stats',
		// api-ts-exclusive institutional policy layer (policies.ts) — no python owner.
		// (audit_logs columns are NOT here: audit_logs is python-owned, so its new
		// org_id/agent_id columns are added via database/db.py _ensure_schema.)
		'policies',
		'policy_decisions',
		'policy_kill_switches',
		// api-ts-exclusive org policy engine (policies.ts, `policy-schema` node of
		// the enterprise dashboard parity plan) — no python owner. Schema only,
		// enforcement not yet wired.
		'org_policies',
		'org_allowlist_addresses',
		'policy_approval_requests',
		'policy_approvals',
		// api-ts-exclusive human-in-the-loop approval queue (approvals.ts) — no
		// python owner.
		'approval_requests',
		// api-ts-exclusive anti-farm guard for the starter-credit grant
		// (payments.ts) — no python owner.
		'agent_registration_grants',
		// api-ts-exclusive anonymous web-checkout tracking (webCheckouts.ts) — no
		// python owner; records Stripe sessions started by showcase visitors with
		// no Suwappu account.
		'web_checkouts',
		// api-ts-exclusive per-agent AEGIS trust record (agentTrust.ts, Phase 2.3
		// analogue) — no python owner. Separate concern from python's
		// aegis_user_trust (keyed on (platform, user_id), bot end-user trust);
		// this one is keyed on agents.id (registered-agent A2A/MCP surface).
		'agent_trust',
		// api-ts-exclusive agent->owner link codes (agentLinkCodes.ts) — no
		// python owner; redeemed via /claim <code> in the Telegram bot.
		'agent_link_codes',
		// api-ts-exclusive step-up re-confirmation nonces for owner approve
		// decisions (approvalStepUpChallenges.ts) — no python owner.
		'approval_step_up_challenges',
	],
})
