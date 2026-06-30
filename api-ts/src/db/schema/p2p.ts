/**
 * P2P (peer-to-peer fiat<>crypto marketplace) schema.
 *
 * These tables are OWNED by the Python service, which creates them via runtime
 * migration (`_ensure_schema()`). Drizzle only MAPS them here for type-safe
 * reads/writes from api-ts. Do NOT run `db:push` / generate a migration from
 * these defs — they exist solely to mirror the Python-created columns exactly.
 *
 * Mirrors the same convention as `perps` / `predictions` (Python-owned tables
 * mapped into Drizzle).
 */

import {
	bigint,
	doublePrecision,
	integer,
	numeric,
	pgTable,
	serial,
	text,
	timestamp,
	varchar,
} from 'drizzle-orm/pg-core'

export const p2pOffers = pgTable('p2p_offers', {
	id: serial('id').primaryKey(),
	makerUserId: bigint('maker_user_id', { mode: 'number' }).notNull(),
	makerWalletId: integer('maker_wallet_id'),
	source: varchar('source', { length: 16 }).default('native'),
	offerType: varchar('offer_type', { length: 16 }).notNull(),
	status: varchar('status', { length: 16 }).default('active'),
	fiatCurrency: varchar('fiat_currency', { length: 3 }).notNull(),
	cryptoAsset: varchar('crypto_asset', { length: 20 }).notNull(),
	cryptoChain: varchar('crypto_chain', { length: 32 }).default('base'),
	pricePerUnit: numeric('price_per_unit', { precision: 20, scale: 6 }).notNull(),
	minFiatAmount: numeric('min_fiat_amount', { precision: 20, scale: 2 }).notNull(),
	maxFiatAmount: numeric('max_fiat_amount', { precision: 20, scale: 2 }).notNull(),
	availableCrypto: varchar('available_crypto', { length: 78 }),
	paymentMethods: text('payment_methods'),
	region: varchar('region', { length: 8 }),
	terms: text('terms'),
	paymentWindowMinutes: integer('payment_window_minutes').default(30),
	completionRate: doublePrecision('completion_rate').default(1.0),
	tradeCount: integer('trade_count').default(0),
	createdAt: timestamp('created_at').defaultNow(),
	updatedAt: timestamp('updated_at').defaultNow(),
})

export const p2pTrades = pgTable('p2p_trades', {
	id: serial('id').primaryKey(),
	source: varchar('source', { length: 16 }).default('native'),
	offerId: integer('offer_id'),
	externalOfferId: varchar('external_offer_id', { length: 255 }),
	externalTradeId: varchar('external_trade_id', { length: 255 }),
	takerUserId: bigint('taker_user_id', { mode: 'number' }).notNull(),
	makerUserId: bigint('maker_user_id', { mode: 'number' }),
	counterpartyHandle: varchar('counterparty_handle', { length: 255 }),
	status: varchar('status', { length: 20 }).default('initiated'),
	offerType: varchar('offer_type', { length: 16 }).notNull(),
	fiatCurrency: varchar('fiat_currency', { length: 3 }).notNull(),
	cryptoAsset: varchar('crypto_asset', { length: 20 }).notNull(),
	cryptoChain: varchar('crypto_chain', { length: 32 }).default('base'),
	fiatAmount: numeric('fiat_amount', { precision: 20, scale: 2 }).notNull(),
	cryptoAmount: varchar('crypto_amount', { length: 78 }).notNull(),
	pricePerUnit: numeric('price_per_unit', { precision: 20, scale: 6 }).notNull(),
	paymentMethod: varchar('payment_method', { length: 64 }).notNull(),
	escrowAddress: varchar('escrow_address', { length: 255 }),
	escrowLockTx: varchar('escrow_lock_tx', { length: 255 }),
	escrowReleaseTx: varchar('escrow_release_tx', { length: 255 }),
	// Resolved payout addresses captured at trade creation (native escrow settlement).
	buyerAddress: varchar('buyer_address', { length: 255 }),
	sellerAddress: varchar('seller_address', { length: 255 }),
	fiatPaymentRef: varchar('fiat_payment_ref', { length: 255 }),
	disputeReason: text('dispute_reason'),
	disputedAt: timestamp('disputed_at'),
	errorMessage: text('error_message'),
	expiresAt: timestamp('expires_at'),
	createdAt: timestamp('created_at').defaultNow(),
	updatedAt: timestamp('updated_at').defaultNow(),
	completedAt: timestamp('completed_at'),
})

export type P2POffer = typeof p2pOffers.$inferSelect
export type NewP2POffer = typeof p2pOffers.$inferInsert
export type P2PTrade = typeof p2pTrades.$inferSelect
export type NewP2PTrade = typeof p2pTrades.$inferInsert
