import { integer, pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core'
import { users } from './users'

/**
 * Passkey credentials table for WebAuthn authentication
 */
export const passkeyCredentials = pgTable('passkey_credentials', {
	id: serial('id').primaryKey(),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id),

	// WebAuthn credential data
	credentialId: text('credential_id').notNull().unique(),
	publicKey: text('public_key').notNull(),
	counter: integer('counter').notNull().default(0),

	// Authenticator info
	transports: text('transports'), // JSON array of transports
	aaguid: varchar('aaguid', { length: 64 }),
	deviceType: varchar('device_type', { length: 50 }),

	// Turnkey sub-organization (created per user for wallet isolation)
	turnkeySubOrgId: varchar('turnkey_sub_org_id', { length: 100 }),

	// Metadata
	name: varchar('name', { length: 100 }).default('My Passkey'),
	lastUsedAt: timestamp('last_used_at'),
	createdAt: timestamp('created_at').defaultNow(),
})

export type PasskeyCredential = typeof passkeyCredentials.$inferSelect
export type NewPasskeyCredential = typeof passkeyCredentials.$inferInsert

/**
 * Passkey challenges table for temporary challenge storage
 */
export const passkeyChallenges = pgTable('passkey_challenges', {
	id: serial('id').primaryKey(),
	challenge: text('challenge').notNull().unique(),
	userId: integer('user_id').references(() => users.id),
	type: varchar('type', { length: 20 }).notNull(), // 'registration' or 'authentication'
	expiresAt: timestamp('expires_at').notNull(),
	createdAt: timestamp('created_at').defaultNow(),
})

export type PasskeyChallenge = typeof passkeyChallenges.$inferSelect
export type NewPasskeyChallenge = typeof passkeyChallenges.$inferInsert
