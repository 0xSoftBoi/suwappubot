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
	unique,
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
		// approval_id (see migration 0011_silly_black_queen for the rationale).
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

/**
 * ---------------------------------------------------------------------------
 * Enterprise dashboard parity — `policy-schema` node (org policy engine).
 * ---------------------------------------------------------------------------
 * SCHEMA ONLY — no enforcement wiring yet. This is a second, dashboard-facing
 * policy surface distinct from the `policies` table above: `policies` is the
 * server-side agent/swap enforcement engine (evaluated at the swap /build
 * step). `orgPolicies` below is the human-authored, org-admin-configured
 * rule set for the enterprise dashboard (Fireblocks/Safe-style tx limits,
 * velocity, allowlist-only, tiered spending) with quorum approval workflows.
 * A later node (`policy-api`) wires evaluation; do not assume these tables
 * gate anything yet.
 */

/**
 * Org-admin-configured policy rule. `policyType` selects which fields of
 * `params` are read (see PARAMS SHAPE below) — kept as free-form jsonb rather
 * than a rigid column-per-type layout since spending-tier policies (Safe-style
 * tiered limits) and velocity policies need different shapes.
 *
 * PARAMS SHAPE (by policyType, all fields optional/nullable within the JSON):
 *   tx_limit:       { thresholdUsd }
 *   daily_limit:    { thresholdUsd }
 *   velocity:       { windowHours, maxTxPerWindow }
 *   allowlist_only: {} (evaluated against orgAllowlistAddresses)
 *   spending_tier:  { tierUpperUsd, thresholdUsd }
 */
export const orgPolicies = pgTable(
	'org_policies',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		orgId: uuid('org_id')
			.references(() => organizations.id, { onDelete: 'cascade' })
			.notNull(),
		name: varchar('name', { length: 120 }).notNull(),
		// 'tx_limit' | 'daily_limit' | 'velocity' | 'allowlist_only' | 'spending_tier'
		policyType: varchar('policy_type', { length: 30 }).notNull(),
		// See PARAMS SHAPE above. e.g. { thresholdUsd, windowHours, maxTxPerWindow, tierUpperUsd }
		params: jsonb('params').notNull().default({}),
		// Quorum: number of distinct approver votes required for a tx/request this
		// policy catches. 0/1 = single-approver (no quorum) gate.
		requiredApprovals: integer('required_approvals').default(1).notNull(),
		enabled: boolean('enabled').default(true).notNull(),
		createdBy: integer('created_by').references(() => users.id),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull(),
	},
	(t) => ({
		orgIdx: index('org_policies_org_idx').on(t.orgId),
		orgEnabledIdx: index('org_policies_org_enabled_idx').on(t.orgId, t.enabled),
	}),
)

/**
 * Per-org allowlisted destination addresses (Safe/Fireblocks-style address
 * book). Consulted by `allowlist_only` org policies and, later, by
 * `allowlist_add` / `allowlist_remove` approval requests below.
 */
export const orgAllowlistAddresses = pgTable(
	'org_allowlist_addresses',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		orgId: uuid('org_id')
			.references(() => organizations.id, { onDelete: 'cascade' })
			.notNull(),
		chain: varchar('chain', { length: 50 }).notNull(),
		address: varchar('address', { length: 255 }).notNull(),
		label: varchar('label', { length: 100 }),
		addedBy: integer('added_by').references(() => users.id),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(t) => ({
		orgIdx: index('org_allowlist_addresses_org_idx').on(t.orgId),
		orgChainAddressUnique: unique().on(t.orgId, t.chain, t.address),
	}),
)

/**
 * Quorum approval request — the maker-checker gate for `orgPolicies`. Distinct
 * from `approvalRequests` (approvals.ts, the agent swap-execute HITL queue):
 * this table supports multi-approver quorum (see `policyApprovals` below) and
 * non-transaction request types (policy changes, allowlist edits), matching
 * the Fireblocks/Copper "quorum approval workflow" table-stakes gap.
 */
export const policyApprovalRequests = pgTable(
	'policy_approval_requests',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		orgId: uuid('org_id')
			.references(() => organizations.id, { onDelete: 'cascade' })
			.notNull(),
		// Nullable: an 'other'/adhoc request may not be tied to a specific policy,
		// and the policy that produced the request may later be deleted.
		policyId: uuid('policy_id').references(() => orgPolicies.id, { onDelete: 'set null' }),
		requestedBy: integer('requested_by').references(() => users.id),
		// 'transaction' | 'policy_change' | 'allowlist_add' | 'allowlist_remove' | 'other'
		requestType: varchar('request_type', { length: 30 }).notNull(),
		// What is being approved — tx details for 'transaction', the proposed diff
		// for 'policy_change'/'allowlist_*'.
		payload: jsonb('payload').notNull(),
		// 'pending' | 'approved' | 'rejected' | 'expired'
		status: varchar('status', { length: 20 }).default('pending').notNull(),
		requiredApprovals: integer('required_approvals').default(1).notNull(),
		expiresAt: timestamp('expires_at'),
		resolvedAt: timestamp('resolved_at'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(t) => ({
		orgStatusIdx: index('policy_approval_requests_org_status_idx').on(t.orgId, t.status),
		policyIdx: index('policy_approval_requests_policy_idx').on(t.policyId),
	}),
)

/**
 * One approver's vote on a `policyApprovalRequests` row. A request resolves
 * once distinct 'approve' votes reach `requiredApprovals` (or a single
 * 'reject' short-circuits it — enforcement TBD in `policy-api`).
 */
export const policyApprovals = pgTable(
	'policy_approvals',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		requestId: uuid('request_id')
			.references(() => policyApprovalRequests.id, { onDelete: 'cascade' })
			.notNull(),
		approverUserId: integer('approver_user_id')
			.references(() => users.id)
			.notNull(),
		// 'approve' | 'reject'
		decision: varchar('decision', { length: 10 }).notNull(),
		comment: varchar('comment', { length: 500 }),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(t) => ({
		requestIdx: index('policy_approvals_request_idx').on(t.requestId),
		// One vote per approver per request.
		requestApproverUnique: unique().on(t.requestId, t.approverUserId),
	}),
)

export type OrgPolicy = typeof orgPolicies.$inferSelect
export type NewOrgPolicy = typeof orgPolicies.$inferInsert
export type OrgAllowlistAddress = typeof orgAllowlistAddresses.$inferSelect
export type NewOrgAllowlistAddress = typeof orgAllowlistAddresses.$inferInsert
export type PolicyApprovalRequest = typeof policyApprovalRequests.$inferSelect
export type NewPolicyApprovalRequest = typeof policyApprovalRequests.$inferInsert
export type PolicyApproval = typeof policyApprovals.$inferSelect
export type NewPolicyApproval = typeof policyApprovals.$inferInsert
