import { sql } from 'drizzle-orm'
import {
	bigserial,
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	real,
	text,
	timestamp,
	uniqueIndex,
	uuid,
	varchar,
} from 'drizzle-orm/pg-core'
import { organizations } from './organizations'
import { users } from './users'

/**
 * Unified policy layer — the institutional control plane's center of gravity.
 *
 * ONE rule schema serves BOTH the enterprise transaction-policy engine and the
 * agent spend-control profile (per the institutional build plan). A policy is
 * scoped to an org and, optionally, narrowed to a single agent (agentId set) so
 * the same table expresses "org-wide rule" and "this agent's spend caps."
 *
 * ENFORCEMENT TRUTH (do not oversell): evaluation happens server-side at the
 * swap /build step. That is HARD enforcement for the KMS-custodial path and for
 * agents using a Suwappu-issued API key/session (we hold the key/credential).
 * For a self-signing EOA user it is ADVISORY — they can bypass our API. The
 * trustless tier (opt-in EIP-7702 + Safe Allowance Module on EVM, Solana Spend
 * Permissions) is a separate, later mechanism. See PolicyService for the gate.
 */
export const policies = pgTable(
	'policies',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		organizationId: uuid('organization_id')
			.references(() => organizations.id, { onDelete: 'cascade' })
			.notNull(),
		// When set, this policy only applies to the named agent (agent spend
		// profile). When null, it applies org-wide to every member/agent.
		agentId: varchar('agent_id', { length: 64 }),
		name: varchar('name', { length: 120 }).notNull(),
		enabled: boolean('enabled').default(true).notNull(),
		// Lower priority number wins first; the first matching BLOCK/REQUIRE_APPROVAL
		// short-circuits. Lets specific deny rules sit above broad allow rules.
		priority: integer('priority').default(100).notNull(),

		// --- Per-transaction limits (stateless — evaluated from the intent alone) ---
		maxTxUsd: real('max_tx_usd'),
		maxSlippageBps: integer('max_slippage_bps'),
		maxGasUsd: real('max_gas_usd'),

		// --- Velocity / cumulative caps (stateful — evaluated against the decision log) ---
		dailyCapUsd: real('daily_cap_usd'),
		sessionCapUsd: real('session_cap_usd'),
		maxTxPerHour: integer('max_tx_per_hour'),

		// --- Allow / block lists (text[] of lowercased values) ---
		allowedChains: text('allowed_chains').array(),
		blockedChains: text('blocked_chains').array(),
		// Token contract allowlist/blocklist (selector-level controls live here too).
		allowedTokens: text('allowed_tokens').array(),
		blockedTokens: text('blocked_tokens').array(),
		// Destination/counterparty address allowlist (whitelist-only when set).
		destinationAllowlist: text('destination_allowlist').array(),

		// Any tx above this USD value escalates to REQUIRE_APPROVAL (maker-checker).
		requireApprovalAboveUsd: real('require_approval_above_usd'),

		createdBy: integer('created_by').references(() => users.id),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull(),
	},
	(t) => ({
		orgIdx: index('policies_org_idx').on(t.organizationId),
		orgAgentIdx: index('policies_org_agent_idx').on(t.organizationId, t.agentId),
	}),
)

/**
 * Append-only decision log — the auditor-ready trail required by the
 * institutional best-ex / compliance gates (and the MiFID II/RTS 6 analogue).
 * Every policy evaluation writes exactly one row: the intent snapshot, the
 * verdict, the matched rule, and the reason.
 */
export const policyDecisions = pgTable(
	'policy_decisions',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		organizationId: uuid('organization_id'),
		agentId: varchar('agent_id', { length: 64 }),
		// 'allow' | 'block' | 'require_approval'
		decision: varchar('decision', { length: 20 }).notNull(),
		reason: varchar('reason', { length: 300 }),
		matchedPolicyId: uuid('matched_policy_id'),
		// Snapshot of the evaluated transaction intent (chain, tokens, amounts, usd…).
		intent: jsonb('intent'),
		valueUsd: real('value_usd'),
		// Set when this decision row exists to make an approved human-in-the-loop
		// trade count toward daily/session/velocity caps (see ApprovalService +
		// the agent.ts swap-execute resubmit path). Nullable — most rows are a
		// normal PolicyService.evaluate() call with no associated approval.
		approvalId: uuid('approval_id'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(t) => ({
		orgCreatedIdx: index('policy_decisions_org_created_idx').on(t.organizationId, t.createdAt),
		agentCreatedIdx: index('policy_decisions_agent_created_idx').on(t.agentId, t.createdAt),
		// DB-level idempotency for the cap-accounting 'allow' override insert in
		// agent.ts's approval-resubmit path — at most one decision row per
		// approval_id (see migration 0008 for the rationale).
		approvalIdUniqueIdx: uniqueIndex('policy_decisions_approval_id_unique_idx')
			.on(t.approvalId)
			.where(sql`${t.approvalId} IS NOT NULL`),
	}),
)

/**
 * Multi-scope kill switch (global / org / agent) — maps to the RTS 6 mandatory
 * kill-switch requirement. An active row at any matching scope BLOCKS all
 * execution for that scope until deactivated.
 */
export const policyKillSwitches = pgTable(
	'policy_kill_switches',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		// 'global' | 'org' | 'agent'
		scope: varchar('scope', { length: 10 }).notNull(),
		// null for global; org uuid or agent id otherwise.
		scopeId: varchar('scope_id', { length: 64 }),
		active: boolean('active').default(true).notNull(),
		reason: varchar('reason', { length: 300 }),
		activatedBy: integer('activated_by').references(() => users.id),
		activatedAt: timestamp('activated_at').defaultNow().notNull(),
		deactivatedAt: timestamp('deactivated_at'),
	},
	(t) => ({
		scopeIdx: index('policy_kill_switches_scope_idx').on(t.scope, t.scopeId, t.active),
	}),
)

export type Policy = typeof policies.$inferSelect
export type NewPolicy = typeof policies.$inferInsert
export type PolicyDecision = typeof policyDecisions.$inferSelect
export type NewPolicyDecision = typeof policyDecisions.$inferInsert
export type PolicyKillSwitch = typeof policyKillSwitches.$inferSelect
export type NewPolicyKillSwitch = typeof policyKillSwitches.$inferInsert
