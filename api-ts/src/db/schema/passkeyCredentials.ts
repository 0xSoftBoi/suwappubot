import { integer, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core'
import { users } from './users'

export const passkeyCredentials = pgTable('passkey_credentials', {
	id: serial('id').primaryKey(),
	credentialId: text('credential_id').notNull().unique(),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id),
	subOrgId: text('sub_org_id').notNull(),
	createdAt: timestamp('created_at').defaultNow(),
})

export type PasskeyCredential = typeof passkeyCredentials.$inferSelect
export type NewPasskeyCredential = typeof passkeyCredentials.$inferInsert
