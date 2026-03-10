import {
	boolean,
	integer,
	pgTable,
	serial,
	text,
	timestamp,
	uniqueIndex,
	varchar,
} from 'drizzle-orm/pg-core'

export const oauthIdentities = pgTable(
	'oauth_identities',
	{
		id: serial('id').primaryKey(),
		userId: integer('user_id').notNull(),
		provider: varchar('provider', { length: 50 }).notNull(),
		providerUserId: varchar('provider_user_id', { length: 255 }).notNull(),
		email: varchar('email', { length: 255 }),
		name: varchar('name', { length: 255 }),
		profileImage: text('profile_image'),
		turnkeyAuthenticatorId: varchar('turnkey_authenticator_id', { length: 255 }),
		isPrimary: boolean('is_primary').default(false),
		isVerified: boolean('is_verified').default(true),
		createdAt: timestamp('created_at').defaultNow(),
		updatedAt: timestamp('updated_at').defaultNow(),
		lastLoginAt: timestamp('last_login_at'),
	},
	(table) => [uniqueIndex('ix_oauth_provider_user').on(table.provider, table.providerUserId)],
)

export const oauthTokens = pgTable('oauth_tokens', {
	id: serial('id').primaryKey(),
	identityId: integer('identity_id').notNull(),
	accessTokenEncrypted: text('access_token_encrypted').notNull(),
	refreshTokenEncrypted: text('refresh_token_encrypted'),
	tokenType: varchar('token_type', { length: 50 }).default('Bearer'),
	scope: text('scope'),
	expiresAt: timestamp('expires_at'),
	refreshExpiresAt: timestamp('refresh_expires_at'),
	encryptionScheme: varchar('encryption_scheme', { length: 50 }).default('kms_aesgcm_v2'),
	kmsWrappedDek: text('kms_wrapped_dek'),
	aesgcmNonce: varchar('aesgcm_nonce', { length: 32 }),
	createdAt: timestamp('created_at').defaultNow(),
	updatedAt: timestamp('updated_at').defaultNow(),
})

export const oauthStates = pgTable('oauth_states', {
	id: serial('id').primaryKey(),
	state: varchar('state', { length: 64 }).notNull().unique(),
	provider: varchar('provider', { length: 50 }).notNull(),
	redirectUri: text('redirect_uri'),
	codeVerifier: varchar('code_verifier', { length: 128 }),
	userId: integer('user_id'),
	action: varchar('action', { length: 50 }).default('login'),
	expiresAt: timestamp('expires_at').notNull(),
	createdAt: timestamp('created_at').defaultNow(),
})

export type OAuthIdentity = typeof oauthIdentities.$inferSelect
export type NewOAuthIdentity = typeof oauthIdentities.$inferInsert
export type OAuthToken = typeof oauthTokens.$inferSelect
export type NewOAuthToken = typeof oauthTokens.$inferInsert
export type OAuthState = typeof oauthStates.$inferSelect
export type NewOAuthState = typeof oauthStates.$inferInsert
