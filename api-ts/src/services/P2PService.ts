/**
 * P2P Service
 *
 * Read/discovery + native offer CRUD for the peer-to-peer fiat<>crypto
 * marketplace. The Python service owns escrow execution and the external
 * (NoOnes / P2P.me) offer-book aggregation; api-ts owns native offer reads,
 * native offer creation, and the trade records the webapp consumes.
 *
 * `listAggregatedOffers` races the native book against external sources so the
 * webapp shows the SAME three-source view as the Telegram bot:
 *   - native — rows in the Python-owned `p2p_offers` table
 *   - noones — the no-auth public market feed (https://noones.com/data/average),
 *     turned into a real reference-priced indicative offer + handoff link
 *   - p2p_me — an on-chain SDK-executable quote (USDC on Base); the webapp's
 *     P2P.me panel reads the live on-chain price and places the order with the
 *     user's wallet via @p2pdotme/sdk, so the listing price is left 0.
 *
 * NOTE on user ids: `maker_user_id` / `taker_user_id` are Telegram user ids
 * (bigint), matching the Python side — NOT the internal `users.id`.
 */

import { and, desc, eq, gte, lte, type SQL } from 'drizzle-orm'
import { Context, Effect, Layer, Option } from 'effect'
import {
	type DrizzleService,
	type NewP2POffer,
	type P2POffer,
	type P2PTrade,
	p2pOffers,
	p2pTrades,
	requireDb,
	requireRow,
} from '../db'
import { DatabaseError } from '../errors'

// ============================================================================
// Types
// ============================================================================

export interface ListOffersParams {
	fiatCurrency: string
	cryptoAsset: string
	offerType: 'sell_crypto' | 'buy_crypto'
	fiatAmount?: number | undefined
	region?: string | undefined
}

/** Normalized cross-source offer (matches the webapp `P2POffer` shape). */
export interface P2POfferQuote {
	source: 'native' | 'noones' | 'p2p_me'
	offerId: string
	offerType: 'sell_crypto' | 'buy_crypto'
	fiatCurrency: string
	cryptoAsset: string
	cryptoChain: string
	/** 0 means "live rate at checkout" (P2P.me reads it on-chain). */
	pricePerUnit: number
	minFiatAmount: number
	maxFiatAmount: number
	paymentMethods: string[]
	region: string
	makerHandle: string
	completionRate: number
	tradeCount: number
	/** When set, the trade completes off-platform (NoOnes web). */
	executionUrl: string | null
}

// NoOnes public, no-auth market feed (verified live). Keyed like `BTC_USD`.
const NOONES_AVERAGE_URL = 'https://noones.com/data/average'
// P2P.me settles USDC on Base for these fiat currencies (from @p2pdotme/sdk).
const P2PME_CURRENCIES = new Set([
	'INR',
	'IDR',
	'BRL',
	'ARS',
	'MXN',
	'VES',
	'EUR',
	'NGN',
	'USD',
	'COP',
])
const P2PME_RAILS: Record<string, string[]> = {
	INR: ['upi'],
	IDR: ['qris'],
	BRL: ['pix'],
	ARS: ['mercadopago'],
	MXN: ['mercadopago'],
	VES: ['pago_movil'],
}

export interface CreateOfferParams {
	makerUserId: number
	makerWalletId?: number | undefined
	offerType: 'sell_crypto' | 'buy_crypto'
	fiatCurrency: string
	cryptoAsset: string
	cryptoChain?: string | undefined
	pricePerUnit: string
	minFiatAmount: string
	maxFiatAmount: string
	availableCrypto?: string | undefined
	paymentMethods: string[]
	region?: string | undefined
	terms?: string | undefined
	paymentWindowMinutes?: number | undefined
}

// ============================================================================
// Service Interface
// ============================================================================

export interface P2PServiceInterface {
	readonly listOffers: (
		params: ListOffersParams
	) => Effect.Effect<P2POffer[], DatabaseError, DrizzleService>

	/** Native + NoOnes + P2P.me, normalized and ranked (matches the bot view). */
	readonly listAggregatedOffers: (
		params: ListOffersParams
	) => Effect.Effect<P2POfferQuote[], DatabaseError, DrizzleService>

	readonly createOffer: (
		params: CreateOfferParams
	) => Effect.Effect<P2POffer, DatabaseError, DrizzleService>

	readonly getUserOffers: (
		makerUserId: number
	) => Effect.Effect<P2POffer[], DatabaseError, DrizzleService>

	readonly getUserTrades: (
		userId: number
	) => Effect.Effect<P2PTrade[], DatabaseError, DrizzleService>

	readonly getTrade: (
		id: number
	) => Effect.Effect<Option.Option<P2PTrade>, DatabaseError, DrizzleService>
}

// ============================================================================
// Service Tag
// ============================================================================

export class P2PService extends Context.Tag('P2PService')<
	P2PService,
	P2PServiceInterface
>() {}

// ============================================================================
// Aggregation helpers
// ============================================================================

function nativeOfferToQuote(o: P2POffer): P2POfferQuote {
	let methods: string[] = []
	try {
		methods = JSON.parse(o.paymentMethods ?? '[]')
	} catch {
		methods = []
	}
	return {
		source: 'native',
		offerId: String(o.id),
		offerType: o.offerType as 'sell_crypto' | 'buy_crypto',
		fiatCurrency: o.fiatCurrency,
		cryptoAsset: o.cryptoAsset,
		cryptoChain: o.cryptoChain ?? 'base',
		pricePerUnit: Number(o.pricePerUnit ?? 0),
		minFiatAmount: Number(o.minFiatAmount ?? 0),
		maxFiatAmount: Number(o.maxFiatAmount ?? 0),
		paymentMethods: methods,
		region: o.region ?? '',
		makerHandle: `user:${o.makerUserId}`,
		completionRate: Number(o.completionRate ?? 1),
		tradeCount: Number(o.tradeCount ?? 0),
		executionUrl: null,
	}
}

/** Real reference-priced NoOnes offer from the no-auth public market feed. */
function fetchNoOnesIndicative(
	params: ListOffersParams,
): Effect.Effect<P2POfferQuote[], DatabaseError> {
	return Effect.tryPromise({
		try: async () => {
			const res = await fetch(NOONES_AVERAGE_URL, { signal: AbortSignal.timeout(8000) })
			if (!res.ok) return [] as P2POfferQuote[]
			const stats = (await res.json()) as Record<string, Record<string, number>>
			const pair = `${params.cryptoAsset.toUpperCase()}_${params.fiatCurrency.toUpperCase()}`
			const row = stats[pair]
			if (!row) return [] as P2POfferQuote[]
			// avg_24h/last are the reliable fields; lowestAsk/highestBid are legacy junk.
			const ref = Number(row.avg_24h || row.last || 0)
			if (ref <= 0) return [] as P2POfferQuote[]
			const buying = params.offerType === 'sell_crypto'
			const price = Math.round(ref * (buying ? 1.01 : 0.99) * 100) / 100
			return [
				{
					source: 'noones',
					offerId: `noones-${pair.toLowerCase()}-${buying ? 'buy' : 'sell'}`,
					offerType: params.offerType,
					fiatCurrency: params.fiatCurrency.toUpperCase(),
					cryptoAsset: params.cryptoAsset.toUpperCase(),
					cryptoChain: 'noones',
					pricePerUnit: price,
					minFiatAmount: 0,
					maxFiatAmount: Number(row.highest_24h || 0),
					paymentMethods: ['bank_transfer', 'gift_cards', 'online_wallets'],
					region: '',
					makerHandle: 'NoOnes marketplace',
					completionRate: 1,
					tradeCount: Math.round(Number(row.base_volume || 0)),
					executionUrl: 'https://noones.com/buy-crypto',
				},
			] satisfies P2POfferQuote[]
		},
		catch: (e) => new DatabaseError({ message: `NoOnes feed error: ${e}` }),
	})
}

/** On-chain P2P.me quote (USDC on Base). The webapp panel reads the live price. */
function buildP2PMeQuote(params: ListOffersParams): P2POfferQuote[] {
	if (params.cryptoAsset.toUpperCase() !== 'USDC') return []
	const fiat = params.fiatCurrency.toUpperCase()
	if (!P2PME_CURRENCIES.has(fiat)) return []
	const action = params.offerType === 'sell_crypto' ? 'buy' : 'sell'
	return [
		{
			source: 'p2p_me',
			offerId: `p2pme-${action}-${fiat.toLowerCase()}`,
			offerType: params.offerType,
			fiatCurrency: fiat,
			cryptoAsset: 'USDC',
			cryptoChain: 'base',
			pricePerUnit: 0, // read on-chain at checkout via @p2pdotme/sdk
			minFiatAmount: 0,
			maxFiatAmount: 0,
			paymentMethods: P2PME_RAILS[fiat] ?? ['bank_transfer'],
			region: params.region ?? '',
			makerHandle: 'P2P.me LP network',
			completionRate: 0.9999,
			tradeCount: 0,
			executionUrl: null, // webapp renders the on-chain SDK panel for p2p_me
		},
	]
}

/** Priced offers first; then best price for the taker's side; then reputation. */
function rankQuotes(
	quotes: P2POfferQuote[],
	offerType: 'sell_crypto' | 'buy_crypto',
): P2POfferQuote[] {
	const buying = offerType === 'sell_crypto'
	return [...quotes].sort((a, b) => {
		const aPriced = a.pricePerUnit > 0 ? 0 : 1
		const bPriced = b.pricePerUnit > 0 ? 0 : 1
		if (aPriced !== bPriced) return aPriced - bPriced
		if (a.pricePerUnit !== b.pricePerUnit) {
			return buying ? a.pricePerUnit - b.pricePerUnit : b.pricePerUnit - a.pricePerUnit
		}
		if (a.completionRate !== b.completionRate) return b.completionRate - a.completionRate
		return b.tradeCount - a.tradeCount
	})
}

// ============================================================================
// Service Implementation
// ============================================================================

export const P2PServiceLive = Layer.succeed(
	P2PService,
	P2PService.of({
		listOffers: (params) =>
			Effect.gen(function* () {
				const db = yield* requireDb

				const conditions: SQL[] = [
					eq(p2pOffers.status, 'active'),
					eq(p2pOffers.source, 'native'),
					eq(p2pOffers.fiatCurrency, params.fiatCurrency),
					eq(p2pOffers.cryptoAsset, params.cryptoAsset),
					eq(p2pOffers.offerType, params.offerType),
				]

				if (params.region) {
					conditions.push(eq(p2pOffers.region, params.region))
				}

				// When a desired fiat amount is supplied, only return offers whose
				// [min, max] window can fill it.
				if (params.fiatAmount !== undefined && !Number.isNaN(params.fiatAmount)) {
					const amt = String(params.fiatAmount)
					conditions.push(lte(p2pOffers.minFiatAmount, amt))
					conditions.push(gte(p2pOffers.maxFiatAmount, amt))
				}

				const offers = yield* Effect.tryPromise({
					try: () =>
						db
							.select()
							.from(p2pOffers)
							.where(and(...conditions))
							.orderBy(desc(p2pOffers.completionRate), desc(p2pOffers.tradeCount))
							.limit(100),
					catch: (e) => new DatabaseError({ message: `Failed to list P2P offers: ${e}` }),
				})

				return offers
			}),

		listAggregatedOffers: (params) =>
			Effect.gen(function* () {
				const db = yield* requireDb

				// 1. Native offers from the DB.
				const conditions: SQL[] = [
					eq(p2pOffers.status, 'active'),
					eq(p2pOffers.source, 'native'),
					eq(p2pOffers.fiatCurrency, params.fiatCurrency),
					eq(p2pOffers.cryptoAsset, params.cryptoAsset),
					eq(p2pOffers.offerType, params.offerType),
				]
				if (params.region) conditions.push(eq(p2pOffers.region, params.region))
				if (params.fiatAmount !== undefined && !Number.isNaN(params.fiatAmount)) {
					const amt = String(params.fiatAmount)
					conditions.push(lte(p2pOffers.minFiatAmount, amt))
					conditions.push(gte(p2pOffers.maxFiatAmount, amt))
				}
				const nativeRows = yield* Effect.tryPromise({
					try: () =>
						db
							.select()
							.from(p2pOffers)
							.where(and(...conditions))
							.limit(100),
					catch: (e) =>
						new DatabaseError({ message: `Failed to list native P2P offers: ${e}` }),
				})
				const native = nativeRows.map(nativeOfferToQuote)

				// 2. External sources — never fail the request if they error.
				const noones = yield* fetchNoOnesIndicative(params).pipe(
					Effect.catchAll(() => Effect.succeed([] as P2POfferQuote[])),
				)
				const p2pme = buildP2PMeQuote(params)

				return rankQuotes([...native, ...noones, ...p2pme], params.offerType)
			}),

		createOffer: (params) =>
			Effect.gen(function* () {
				const db = yield* requireDb

				const values: NewP2POffer = {
					makerUserId: params.makerUserId,
					makerWalletId: params.makerWalletId ?? null,
					source: 'native',
					offerType: params.offerType,
					status: 'active',
					fiatCurrency: params.fiatCurrency,
					cryptoAsset: params.cryptoAsset,
					cryptoChain: params.cryptoChain ?? 'base',
					pricePerUnit: params.pricePerUnit,
					minFiatAmount: params.minFiatAmount,
					maxFiatAmount: params.maxFiatAmount,
					availableCrypto: params.availableCrypto ?? null,
					paymentMethods: JSON.stringify(params.paymentMethods),
					region: params.region ?? null,
					terms: params.terms ?? null,
					paymentWindowMinutes: params.paymentWindowMinutes ?? 30,
				}

				const rows = yield* Effect.tryPromise({
					try: () => db.insert(p2pOffers).values(values).returning(),
					catch: (e) => new DatabaseError({ message: `Failed to create P2P offer: ${e}` }),
				})

				return yield* requireRow(rows, 'Failed to create P2P offer: no row returned')
			}),

		getUserOffers: (makerUserId) =>
			Effect.gen(function* () {
				const db = yield* requireDb

				return yield* Effect.tryPromise({
					try: () =>
						db
							.select()
							.from(p2pOffers)
							.where(eq(p2pOffers.makerUserId, makerUserId))
							.orderBy(desc(p2pOffers.createdAt))
							.limit(100),
					catch: (e) => new DatabaseError({ message: `Failed to get user offers: ${e}` }),
				})
			}),

		getUserTrades: (userId) =>
			Effect.gen(function* () {
				const db = yield* requireDb

				// A user can appear as either the taker or the maker of a trade.
				return yield* Effect.tryPromise({
					try: () =>
						db
							.select()
							.from(p2pTrades)
							.where(eq(p2pTrades.takerUserId, userId))
							.orderBy(desc(p2pTrades.createdAt))
							.limit(100),
					catch: (e) => new DatabaseError({ message: `Failed to get user trades: ${e}` }),
				})
			}),

		getTrade: (id) =>
			Effect.gen(function* () {
				const db = yield* requireDb

				const rows = yield* Effect.tryPromise({
					try: () => db.select().from(p2pTrades).where(eq(p2pTrades.id, id)).limit(1),
					catch: (e) => new DatabaseError({ message: `Failed to get trade: ${e}` }),
				})

				return Option.fromNullable(rows[0])
			}),
	}),
)
