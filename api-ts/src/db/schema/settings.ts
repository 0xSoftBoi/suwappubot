import {
	boolean,
	integer,
	jsonb,
	pgTable,
	serial,
	timestamp,
	varchar,
} from 'drizzle-orm/pg-core'
import { users } from './users'

/**
 * User settings table for extended preferences.
 * Basic settings (slippage, notifications) are on users table,
 * this table handles granular notification preferences and other extended settings.
 */
export const userSettings = pgTable('user_settings', {
	id: serial('id').primaryKey(),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' })
		.unique(),

	// Slippage settings (stored as basis points, e.g., 50 = 0.5%)
	slippageBps: integer('slippage_bps').default(50).notNull(),

	// Granular notification preferences
	priceAlertsEnabled: boolean('price_alerts_enabled').default(true).notNull(),
	txUpdatesEnabled: boolean('tx_updates_enabled').default(true).notNull(),
	promotionsEnabled: boolean('promotions_enabled').default(false).notNull(),

	// Language preference
	language: varchar('language', { length: 10 }).default('en').notNull(),

	// Theme preference
	theme: varchar('theme', { length: 20 }).default('light').notNull(),

	// Additional settings stored as JSON for flexibility
	customSettings: jsonb('custom_settings').default({}).$type<Record<string, unknown>>(),

	// Timestamps
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export type UserSettings = typeof userSettings.$inferSelect
export type NewUserSettings = typeof userSettings.$inferInsert

// API response shape
export interface UserSettingsResponse {
	slippage: number // As percentage (e.g., 0.5)
	priceAlerts: boolean
	txUpdates: boolean
	promotions: boolean
	language: string
	theme: string
}

// API request shape for updates
export interface UpdateUserSettingsRequest {
	slippage?: number // As percentage (e.g., 0.5)
	priceAlerts?: boolean
	txUpdates?: boolean
	promotions?: boolean
	language?: string
	theme?: string
}
