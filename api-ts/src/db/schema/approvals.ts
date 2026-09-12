import {
	bigint,
	bigserial,
	index,
	integer,
	jsonb,
	pgTable,
	timestamp,
	unique,
	uuid,
	varchar,
} from 'drizzle-orm/pg-core'
import { organizations } from './organizations'
import { users } from './users'

/**
 * Human-in-the-loop approval requests — the maker-checker half of the
 * institutional policy engine. When PolicyService.evaluate() returns
 * 'require_approval', the agent execute path writes one row here instead of
 * returning a signable transaction. The owning org's human operator then
 * approves or denies via the owner-facing (JWT) endpoints; the agent polls
 * GET /v1/agent/approvals/:id and, once approved, RE-SUBMITS the identical
 * execute call with `approval_id` so the execute path can validate + consume
 * it (single-use, payload-hash-checked) before building the transaction.
 *
 * This table intentionally does NOT execute anything itself — approval is a
 * gate, not a trigger. See agent.ts's swap execute path for the consumption
 * logic and PolicyService.ts for the verdict that creates these rows.
 */
export const approvalRequests = pgTable(
	'approval_requests',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		// Agent that originated the request (agents.uuid, matches agent auth context).
		agentId: varchar('agent_id', { length: 64 }).notNull(),
		organizationId: uuid('organization_id').references(() => organizations.id, {
			onDelete: 'cascade',
		}),
		// Owning human (org owner at creation time) — denormalized for fast
		// "my pending approvals" queries without a join through organizations.
		userId: integer('user_id').references(() => users.id),
		// e.g. 'swap_execute'
		actionType: varchar('action_type', { length: 40 }).notNull(),
		// Exact params of the deferred execute call (canonical JSON), re-validated
		// by hash against the agent's resubmission at consumption time.
		payload: jsonb('payload').notNull(),
		// sha256 hex of the canonical JSON payload — avoids re-serializing +
		// comparing the full JSON blob on every consumption check.
		payloadHash: varchar('payload_hash', { length: 64 }).notNull(),
		// Link back to the append-only policy decision that triggered this request.
		policyDecisionId: bigint('policy_decision_id', { mode: 'number' }),
		reason: varchar('reason', { length: 300 }),
		// Approval threshold is snapshotted when this request is created so a
		// later policy edit cannot lower the threshold of an in-flight action.
		requiredApprovals: integer('required_approvals').default(1).notNull(),
		// 'pending' | 'approved' | 'denied' | 'expired' | 'consumed'
		status: varchar('status', { length: 20 }).default('pending').notNull(),
		expiresAt: timestamp('expires_at').notNull(),
		decidedBy: integer('decided_by').references(() => users.id),
		decidedAt: timestamp('decided_at'),
		consumedAt: timestamp('consumed_at'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(t) => ({
		agentIdx: index('approval_requests_agent_idx').on(t.agentId, t.status),
		orgStatusIdx: index('approval_requests_org_status_idx').on(
			t.organizationId,
			t.status,
			t.createdAt,
		),
		userIdx: index('approval_requests_user_idx').on(t.userId, t.status),
	}),
)

export type ApprovalRequest = typeof approvalRequests.$inferSelect
export type NewApprovalRequest = typeof approvalRequests.$inferInsert


/**
 * Append-only quorum votes for approval requests.
 *
 * A unique (approval_request_id, user_id) pair means one human can count at
 * most once toward a quorum even under retries/concurrency. Deny is terminal;
 * approve becomes terminal only after the snapshotted requiredApprovals count
 * is reached.
 */
export const approvalVotes = pgTable(
	'approval_votes',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		approvalRequestId: uuid('approval_request_id')
			.references(() => approvalRequests.id, { onDelete: 'cascade' })
			.notNull(),
		userId: integer('user_id')
			.references(() => users.id)
			.notNull(),
		decision: varchar('decision', { length: 10 }).notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(t) => ({
		approvalIdx: index('approval_votes_approval_idx').on(t.approvalRequestId, t.createdAt),
		uniqueVoter: unique().on(t.approvalRequestId, t.userId),
	}),
)

export type ApprovalVote = typeof approvalVotes.$inferSelect
export type NewApprovalVote = typeof approvalVotes.$inferInsert
