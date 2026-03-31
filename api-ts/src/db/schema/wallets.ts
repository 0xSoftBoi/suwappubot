import { boolean, integer, pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core'
import { users } from './users'

export const wallets = pgTable('wallets', {
	id: serial('id').primaryKey(),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id),

	// Wallet details
	name: varchar('name', { length: 100 }).default('Default Wallet'),
	address: varchar('address', { length: 255 }).notNull(),
	encryptedPrivateKey: text('encrypted_private_key'),

	// Envelope encryption metadata (KMS + AES-GCM)
	encryptionScheme: varchar('encryption_scheme', { length: 50 }).default('legacy_fernet_v1'),
	kmsWrappedDek: text('kms_wrapped_dek'),
	aesgcmNonce: varchar('aesgcm_nonce', { length: 32 }),
	kmsKeyId: varchar('kms_key_id', { length: 255 }),
	keyVersion: integer('key_version').default(1),

	// Turnkey wallet infrastructure
	walletProvider: varchar('wallet_provider', { length: 20 }).default('local'),
	turnkeySubOrgId: varchar('turnkey_sub_org_id', { length: 100 }),
	turnkeyWalletId: varchar('turnkey_wallet_id', { length: 100 }),
	turnkeyAccountId: varchar('turnkey_account_id', { length: 100 }),

	// Chain type: "evm" or "solana"
	chainType: varchar('chain_type', { length: 20 }).notNull(),

	// Status
	isActive: boolean('is_active').default(true),
	isDefault: boolean('is_default').default(false),

	// Timestamps
	createdAt: timestamp('created_at').defaultNow(),
})

export type Wallet = typeof wallets.$inferSelect
export type NewWallet = typeof wallets.$inferInsert
