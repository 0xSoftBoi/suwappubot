import { boolean, integer, pgTable, real, serial, timestamp, varchar } from 'drizzle-orm/pg-core'
import { users } from './users'

export const priceAlerts = pgTable('price_alerts', {
	id: serial('id').primaryKey(),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id),

	// Token info
	tokenAddress: varchar('token_address', { length: 42 }).notNull(),
	tokenSymbol: varchar('token_symbol', { length: 20 }).notNull(),
	chain: varchar('chain', { length: 50 }).notNull(),

	// Alert conditions
	targetPrice: real('target_price').notNull(),
	condition: varchar('condition', { length: 10 }).notNull(), // 'above' or 'below'

	// Status tracking
	isActive: boolean('is_active').default(true),
	isTriggered: boolean('is_triggered').default(false),
	triggeredAt: timestamp('triggered_at'),

	// Timestamps
	createdAt: timestamp('created_at').defaultNow(),
	updatedAt: timestamp('updated_at').defaultNow(),
})

export type PriceAlert = typeof priceAlerts.$inferSelect
export type NewPriceAlert = typeof priceAlerts.$inferInsert
