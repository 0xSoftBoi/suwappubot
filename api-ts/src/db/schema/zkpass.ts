import { boolean, index, integer, pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core'

/**
 * zkPass (zkpass.org) TransGate identity/data verification results.
 *
 * Stores the server-verified RESULT of a client-side zkPass TransGate proof.
 * This is informational/profile-level only — it is deliberately NOT wired to
 * gate any money-path feature (swap, withdrawal, fees, subscriptions). See
 * services/ZkPassService.ts for the verification logic and its documented
 * ambiguity around exact ABI encoding (best-effort against zkPass's docs,
 * not yet confirmed against a real TransGate test proof).
 */
export const zkpassVerifications = pgTable(
	'zkpass_verifications',
	{
		id: serial('id').primaryKey(),
		userId: integer('user_id').notNull(),
		schemaId: varchar('schema_id', { length: 255 }).notNull(),
		// UNIQUE: a given TransGate task/proof must not be replayable to let a
		// second (different) user claim the same underlying proof result.
		taskId: varchar('task_id', { length: 255 }).notNull().unique(),
		uHash: varchar('u_hash', { length: 255 }),
		publicFieldsHash: varchar('public_fields_hash', { length: 255 }),
		// JSON.stringify'd publicFields object from the proof result.
		publicFields: text('public_fields'),
		validatorAddress: varchar('validator_address', { length: 255 }),
		recipient: varchar('recipient', { length: 255 }),
		isValid: boolean('is_valid').notNull().default(false),
		verifiedAt: timestamp('verified_at').defaultNow(),
		createdAt: timestamp('created_at').defaultNow(),
	},
	(t) => ({
		userIdx: index('zkpass_verifications_user_idx').on(t.userId),
	}),
)

export type ZkpassVerification = typeof zkpassVerifications.$inferSelect
export type NewZkpassVerification = typeof zkpassVerifications.$inferInsert
