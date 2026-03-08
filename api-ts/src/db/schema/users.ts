import {
	boolean,
	integer,
	pgTable,
	real,
	serial,
	text,
	timestamp,
	varchar,
} from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
	id: serial('id').primaryKey(),
	telegramId: integer('telegram_id').unique(),
	whatsappId: varchar('whatsapp_id', { length: 255 }).unique(),
	username: varchar('username', { length: 255 }),
	firstName: varchar('first_name', { length: 255 }),
	lastName: varchar('last_name', { length: 255 }),

	// Settings
	defaultSlippage: integer('default_slippage').default(50),
	notificationsEnabled: boolean('notifications_enabled').default(true),
	gasMode: varchar('gas_mode', { length: 10 }).default('auto'),

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

	// Timestamps
	createdAt: timestamp('created_at').defaultNow(),
	updatedAt: timestamp('updated_at').defaultNow(),
	lastActiveAt: timestamp('last_active_at').defaultNow(),
})

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
