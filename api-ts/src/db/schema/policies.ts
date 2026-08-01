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
		// Nullable so a policy can be scoped to a bare agent (plain agent-token
		// auth, no org) as well as to an org. organizationId null + agentId set =
		// a per-agent grant that applies with no org context at all.
		organizationId: uuid('organization_id').references(() => organizations.id, {
			onDelete: 'cascade',
		}),
		// When set, this policy only applies to the named agent (agent spend
		// profile). When null (and organizationId set), it applies org-wide to
		// every member/agent.
		agentId: varchar('agent_id', { length: 64 }),
		// Grant semantics for the maker-checker escalation below:
		//   'always_ask'  — every matched, non-blocked tx requires approval.
		//   'above_limit' — (default) escalate only above requireApprovalAboveUsd.
		//   'autonomous'  — never escalate (caps/blocks still apply).
		approvalMode: varchar('approval_mode', { length: 20 }).default('above_limit').notNull(),
		// Grant expiry — an expired policy is skipped entirely during evaluation.
		expiresAt: timestamp('expires_at'),
		// Contract/router allowlist (lowercased). When set, any intent whose
		// contractAddress isn't in this list is blocked.
		allowedContracts: text('allowed_contracts').array(),
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
		// Org-less per-agent policy lookups (plain agent-token auth, no org key).
		agentOnlyIdx: index('policies_agent_only_idx').on(t.agentId),
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
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(t) => ({
		orgCreatedIdx: index('policy_decisions_org_created_idx').on(t.organizationId, t.createdAt),
		agentCreatedIdx: index('policy_decisions_agent_created_idx').on(t.agentId, t.createdAt),
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
