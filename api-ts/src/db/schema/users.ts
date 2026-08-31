import {
	bigint,
	boolean,
	integer,
	pgTable,
	real,
	serial,
	text,
	timestamp,
	uuid,
	varchar,
} from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
	id: serial('id').primaryKey(),
	// Telegram user IDs exceed 2^31 as of 2024-2026; must be BIGINT to match
	// the Postgres schema. 'number' mode is safe because Telegram IDs fit
	// well within Number.MAX_SAFE_INTEGER (2^53 - 1).
	telegramId: bigint('telegram_id', { mode: 'number' }).unique(),
	whatsappId: varchar('whatsapp_id', { length: 255 }).unique(),
	username: varchar('username', { length: 255 }),
	firstName: varchar('first_name', { length: 255 }),
	lastName: varchar('last_name', { length: 255 }),

	// Settings
	defaultSlippage: integer('default_slippage').default(50),
	notificationsEnabled: boolean('notifications_enabled').default(true),
	gasMode: varchar('gas_mode', { length: 10 }).default('auto'),
	languagePreference: text('language_preference').default('en'),

	// Terms of Service
	tosAccepted: boolean('tos_accepted').default(false),
	tosAcceptedAt: timestamp('tos_accepted_at'),

	// Referral tracking
	referredByUserId: integer('referred_by_user_id'),
	totalReferralRewards: real('total_referral_rewards').default(0.0),
	referralCount: integer('referral_count').default(0),

	// 2FA
	twoFaEnabled: boolean('two_fa_enabled').default(false),
	totpSecret: varchar('totp_secret', { length: 64 }),
	twoFaThreshold: integer('two_fa_threshold').default(1000),

	// Enterprise org membership
	organizationId: uuid('organization_id'),

	// Region-gated features (derivatives/prediction-market compliance). ISO-3166
	// alpha-2 (e.g. 'US'), sticky once observed so a VPN can't unblock a user
	// already flagged restricted. Column added by Python's
	// _add_user_region_column() (database/db.py) — declared here only, no
	// migration to run (shared DB, ADR 0003).
	region: varchar('region', { length: 8 }),

	// Account recovery (passkey recovery flow). unique() so two accounts can
	// never claim the same recovery email — without it, an attacker who sets
	// their own recovery_email to a victim's address could receive the
	// victim's recovery token once email delivery is wired.
	recoveryEmail: text('recovery_email').unique(),
	recoveryEmailSetAt: timestamp('recovery_email_set_at'),

	// Timestamps
	createdAt: timestamp('created_at').defaultNow(),
	updatedAt: timestamp('updated_at').defaultNow(),
	lastActiveAt: timestamp('last_active_at').defaultNow(),
})

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
