import { index, integer, pgTable, serial, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core'
import { approvalRequests } from './approvals'
import { users } from './users'

/**
 * Server-issued, single-use, short-TTL re-confirmation nonce required before
 * an owner's POST /approvals/:id/approve is honored when
 * APPROVAL_STEP_UP_REQUIRED='true'. This is NOT WebAuthn/passkey
 * user-presence proof — there is no passkey library in this repo. It only
 * proves the same authenticated session round-tripped a server-issued value
 * within a short window (defense against a stolen/replayed bare approve
 * request, e.g. a CSRF'd or leaked JWT firing a decision without the
 * legitimate owner seeing a fresh confirmation prompt).
 *
 * Upgrading this to real user-presence/possession proof would require:
 *  - adding @simplewebauthn/server (or similar) as a dependency
 *  - a per-user table of registered credential public keys
 *  - replacing the `usedAt IS NULL` consumption check below with verification
 *    of a signed WebAuthn assertion against the stored public key
 */
export const approvalStepUpChallenges = pgTable(
	'approval_step_up_challenges',
	{
		id: serial('id').primaryKey(),
		userId: integer('user_id')
			.references(() => users.id)
			.notNull(),
		approvalId: uuid('approval_id')
			.references(() => approvalRequests.id)
			.notNull(),
		challenge: varchar('challenge', { length: 128 }).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		usedAt: timestamp('used_at', { withTimezone: true }),
	},
	(table) => ({
		approvalIdIdx: index('ix_approval_step_up_challenges_approval_id').on(table.approvalId),
		// Challenge values are server-generated random nonces meant to be
		// single-use; a non-unique column left room for a duplicate-generation
		// collision (or a bug) to let one challenge value satisfy two rows.
		challengeUniqueIdx: uniqueIndex('ux_approval_step_up_challenges_challenge').on(
			table.challenge,
		),
	}),
)

export type ApprovalStepUpChallenge = typeof approvalStepUpChallenges.$inferSelect
export type NewApprovalStepUpChallenge = typeof approvalStepUpChallenges.$inferInsert
