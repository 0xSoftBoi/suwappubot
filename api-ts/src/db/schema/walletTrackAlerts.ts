import { boolean, integer, pgTable, real, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core'
import { users } from './users'

/**
 * Wallet tracking alerts — users subscribe to a wallet address and receive
 * notifications when it makes a trade above a minimum USD threshold.
 *
 * The actual monitoring is performed by an off-chain service (e.g. a WebSocket
 * listener on DexScreener / Helius / Zerion streams). When that service detects
 * a qualifying trade it should POST to /internal/wallet-track/trigger with the
 * walletTrackAlertId so the notification fan-out can run.
 */
export const walletTrackAlerts = pgTable('wallet_track_alerts', {
	id: serial('id').primaryKey(),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id),

	// The wallet being tracked (EVM 0x… or Solana base58 address)
	walletAddress: varchar('wallet_address', { length: 100 }).notNull(),

	// Optional human-readable label e.g. "Ansem", "Lookonchain"
	label: varchar('label', { length: 100 }),

	// Only fire the alert when the trade value exceeds this threshold (USD)
	minUsd: real('min_usd').default(10000).notNull(),

	// JSON array of chain slugs to watch, null = all chains
	chains: text('chains'), // stored as JSON string

	// Status
	isActive: boolean('is_active').default(true).notNull(),

	// Timestamps
	createdAt: timestamp('created_at').defaultNow(),
	updatedAt: timestamp('updated_at').defaultNow(),
})

export type WalletTrackAlert = typeof walletTrackAlerts.$inferSelect
export type NewWalletTrackAlert = typeof walletTrackAlerts.$inferInsert
