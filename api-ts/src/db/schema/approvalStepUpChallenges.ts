import { bigint, index, pgTable, serial, timestamp, varchar } from 'drizzle-orm/pg-core'
import { agentApprovals } from './approvals'

/**
 * approval_step_up_challenges — an INTERIM re-confirmation step for
 * POST /webapp/approvals/:id/decide (decision === 'approve' only), gated by
 * APPROVAL_STEP_UP_REQUIRED.
 *
 * IMPORTANT: this is a server-issued single-use short-TTL nonce (a
 * "step-up" challenge), NOT cryptographic WebAuthn/passkey user-presence
 * proof. There is no WebAuthn library in this repo. The client fetches a
 * challenge via POST /webapp/approvals/:id/step-up/challenge and must echo
 * it back in the /decide request body; the server atomically marks it
 * consumed (used_at) so it can only gate one decide call, before its
 * expires_at (2 minutes from issuance).
 *
 * To upgrade to real passkey step-up: add @simplewebauthn/server, store
 * credential public keys per user, and replace this challenge-consumption
 * check with an assertion-signature verification against the stored
 * credential.
 */
export const approvalStepUpChallenges = pgTable(
	'approval_step_up_challenges',
	{
		id: serial('id').primaryKey(),
		userTelegramId: bigint('user_telegram_id', { mode: 'number' }).notNull(),
		approvalId: varchar('approval_id', { length: 36 })
			.references(() => agentApprovals.id)
			.notNull(),
		challenge: varchar('challenge', { length: 128 }).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		usedAt: timestamp('used_at', { withTimezone: true }),
	},
	(table) => ({
		approvalIdIdx: index('ix_approval_step_up_challenges_approval_id').on(table.approvalId),
	}),
)

export type ApprovalStepUpChallenge = typeof approvalStepUpChallenges.$inferSelect
export type NewApprovalStepUpChallenge = typeof approvalStepUpChallenges.$inferInsert
