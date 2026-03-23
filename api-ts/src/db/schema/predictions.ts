import {
	boolean,
	pgTable,
	serial,
	text,
	timestamp,
} from 'drizzle-orm/pg-core'

export const polymarketAccounts = pgTable('polymarket_accounts', {
	id: serial('id').primaryKey(),
	agentId: text('agent_id').unique(),
	walletAddress: text('wallet_address').notNull(),
	apiKeyEncrypted: text('api_key_encrypted').notNull(),
	apiSecretEncrypted: text('api_secret_encrypted').notNull(),
	passphraseEncrypted: text('passphrase_encrypted').notNull(),
	encryptionScheme: text('encryption_scheme').notNull().default('aes-256-gcm'),
	kmsWrappedDek: text('kms_wrapped_dek'),
	aesgcmNonce: text('aesgcm_nonce'),
	isActive: boolean('is_active').default(true),
	createdAt: timestamp('created_at').defaultNow(),
	updatedAt: timestamp('updated_at').defaultNow(),
})

export type PolymarketAccount = typeof polymarketAccounts.$inferSelect
export type NewPolymarketAccount = typeof polymarketAccounts.$inferInsert
