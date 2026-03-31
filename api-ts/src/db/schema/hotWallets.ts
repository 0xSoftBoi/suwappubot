import {
	boolean,
	integer,
	pgTable,
	serial,
	text,
	timestamp,
	varchar,
} from 'drizzle-orm/pg-core'

export const hotWallets = pgTable('hot_wallets', {
	id: serial('id').primaryKey(),
	name: varchar('name', { length: 100 }).notNull(),
	chainType: varchar('chain_type', { length: 20 }).notNull(),
	address: varchar('address', { length: 100 }).notNull().unique(),
	encryptedPrivateKey: text('encrypted_private_key'),
	encryptionScheme: varchar('encryption_scheme', { length: 50 }).default('legacy_fernet_v1'),
	kmsWrappedDek: text('kms_wrapped_dek'),
	aesgcmNonce: varchar('aesgcm_nonce', { length: 32 }),
	kmsKeyId: varchar('kms_key_id', { length: 255 }),
	keyVersion: integer('key_version').default(1),
	walletProvider: varchar('wallet_provider', { length: 20 }).default('local'),
	turnkeyWalletId: varchar('turnkey_wallet_id', { length: 100 }),
	turnkeyAccountId: varchar('turnkey_account_id', { length: 100 }),
	isDepositWallet: boolean('is_deposit_wallet').default(true),
	isGasPayer: boolean('is_gas_payer').default(false),
	nativeBalance: varchar('native_balance', { length: 78 }).default('0'),
	lastBalanceCheck: timestamp('last_balance_check'),
	minNativeBalance: varchar('min_native_balance', { length: 78 }).default('0.1'),
	isActive: boolean('is_active').default(true),
	createdAt: timestamp('created_at').defaultNow(),
	updatedAt: timestamp('updated_at').defaultNow(),
})

export type HotWallet = typeof hotWallets.$inferSelect
export type NewHotWallet = typeof hotWallets.$inferInsert
