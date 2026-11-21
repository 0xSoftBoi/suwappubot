import { index, integer, jsonb, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core'

/**
 * x402 v2 `batch-settlement` channel store.
 *
 * One row per payment channel. `data` is the @x402/evm `Channel` record: the
 * latest signed cumulative voucher, charged/claimed totals, escrow balance and
 * withdrawal state. MONEY-PATH — a lost row is a lost right to claim the
 * vouchers it holds, so this is durable storage, never a cache.
 *
 * `version` is the optimistic-concurrency counter used by
 * lib/x402ChannelStorage.ts to give `updateChannel` the cross-instance atomic
 * compare-and-write the ChannelStorage contract requires.
 *
 * Mirrors database/db.py `_create_x402_channels_table` (ADR 0003).
 */
export const x402Channels = pgTable(
	'x402_channels',
	{
		channelId: varchar('channel_id', { length: 80 }).primaryKey(),
		network: varchar('network', { length: 64 }),
		payer: varchar('payer', { length: 64 }),
		data: jsonb('data').notNull(),
		version: integer('version').notNull().default(0),
		createdAt: timestamp('created_at').defaultNow(),
		updatedAt: timestamp('updated_at').defaultNow(),
	},
	(t) => [index('ix_x402_channels_network').on(t.network)],
)

/**
 * x402 v2 `payment-identifier` idempotency ledger. A client payment id maps to
 * the request fingerprint and the settlement it produced, so a retry (lost
 * response, timeout) returns the original settlement instead of paying twice
 * or failing on an already-used nonce. Mirrors database/db.py
 * `_create_x402_payment_ids_table`. MONEY-PATH.
 */
export const x402PaymentIds = pgTable('x402_payment_ids', {
	paymentId: varchar('payment_id', { length: 160 }).primaryKey(),
	fingerprint: varchar('fingerprint', { length: 64 }).notNull(),
	payer: varchar('payer', { length: 64 }),
	settle: jsonb('settle').notNull(),
	uses: integer('uses').notNull().default(1),
	createdAt: timestamp('created_at').defaultNow(),
})
