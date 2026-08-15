/**
 * P2P marketplace routes (webapp).
 *
 * Mounted at `/webapp/p2p`. Serves the native (Suwappu-owned) offer book and
 * trade records for the Telegram Mini App. External offers (NoOnes / P2P.me)
 * are aggregated by the Python service and surfaced through the bot; this API
 * returns native offers plus a `note` so the client knows external liquidity is
 * merged elsewhere.
 *
 * Native trade *execution* (on-chain escrow lock/release) is owned by the Python
 * service and is not yet enabled from the webapp — `POST /trades` returns a clear
 * "not yet enabled" response rather than half-creating an unescrowed trade.
 *
 * NOTE: maker/taker ids are Telegram user ids (bigint), matching the Python side.
 */

import { Effect, Either, Option } from 'effect'
import { Hono } from 'hono'
import type { P2POffer, P2PTrade } from '../db'
import { mapErrorToResponse, NotFoundError, ValidationError } from '../errors'
import { telegramAuth } from '../middleware'
import { ipRateLimit } from '../middleware/ipRateLimit'
import { runEffectEither } from '../runtime'
import { P2PService } from '../services'
import type { TelegramUser } from '../services/TelegramAuthService'
import { CreateP2POfferSchema, formatZodErrors } from './validators'

const p2pRoutes = new Hono()

// ── Response mappers (DB row → webapp shape) ────────────────────────────────

function offerToResponse(o: P2POffer) {
	let methods: string[] = []
	try {
		methods = JSON.parse(o.paymentMethods ?? '[]')
	} catch {
		methods = []
	}
	return {
		source: (o.source ?? 'native') as 'native' | 'noones' | 'p2p_me',
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
		executionUrl: null as string | null, // native = executable in-app
	}
}

function tradeToResponse(t: P2PTrade) {
	return {
		tradeId: String(t.id),
		offerId: String(t.offerId ?? t.externalOfferId ?? ''),
		source: (t.source ?? 'native') as 'native' | 'noones' | 'p2p_me',
		offerType: t.offerType as 'sell_crypto' | 'buy_crypto',
		fiatCurrency: t.fiatCurrency,
		cryptoAsset: t.cryptoAsset,
		cryptoChain: t.cryptoChain ?? 'base',
		fiatAmount: Number(t.fiatAmount ?? 0),
		cryptoAmount: Number(t.cryptoAmount ?? 0),
		pricePerUnit: Number(t.pricePerUnit ?? 0),
		paymentMethod: t.paymentMethod,
		counterpartyHandle: t.counterpartyHandle ?? '',
		status: t.status ?? 'initiated',
		createdAt: (t.createdAt ?? new Date()).toISOString(),
	}
}

// ── GET /offers — list native offers for a pair ─────────────────────────────
// Public browse (no auth), matching the swap token/quote browse convention.
p2pRoutes.get('/offers', ipRateLimit(60), async (c) => {
	const fiatCurrency = c.req.query('fiatCurrency')
	const cryptoAsset = c.req.query('cryptoAsset')
	const offerType = c.req.query('offerType')
	const fiatAmountRaw = c.req.query('fiatAmount')
	const region = c.req.query('region')

	if (!fiatCurrency || !cryptoAsset) {
		return c.json(
			{ error: 'Validation Error', message: 'fiatCurrency and cryptoAsset are required' },
			400,
		)
	}
	if (offerType && offerType !== 'sell_crypto' && offerType !== 'buy_crypto') {
		return c.json(
			{ error: 'Validation Error', message: 'offerType must be sell_crypto or buy_crypto' },
			400,
		)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const p2p = yield* P2PService
			return yield* p2p.listAggregatedOffers({
				fiatCurrency: fiatCurrency.toUpperCase(),
				cryptoAsset: cryptoAsset.toUpperCase(),
				offerType: (offerType as 'sell_crypto' | 'buy_crypto') ?? 'sell_crypto',
				fiatAmount: fiatAmountRaw ? Number(fiatAmountRaw) : undefined,
				region: region ?? undefined,
			})
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status)
	}

	// Quotes are already in the webapp P2POffer shape (native + NoOnes + P2P.me).
	return c.json({ offers: result.right })
})

// ── POST /offers — create a native offer ────────────────────────────────────
p2pRoutes.post('/offers', ipRateLimit(20), telegramAuth(), async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser
	const body = await c.req.json().catch(() => ({}))

	const parsed = CreateP2POfferSchema.safeParse(body)
	if (!parsed.success) {
		return c.json(
			{ error: 'Validation Error', fields: formatZodErrors(parsed.error) },
			400,
		)
	}
	const d = parsed.data

	const result = await runEffectEither(
		Effect.gen(function* () {
			const p2p = yield* P2PService
			return yield* p2p.createOffer({
				makerUserId: telegramUser.id,
				makerWalletId: d.makerWalletId,
				offerType: d.offerType,
				fiatCurrency: d.fiatCurrency,
				cryptoAsset: d.cryptoAsset,
				cryptoChain: d.cryptoChain,
				pricePerUnit: d.pricePerUnit,
				minFiatAmount: d.minFiatAmount,
				maxFiatAmount: d.maxFiatAmount,
				availableCrypto: d.availableCrypto,
				paymentMethods: d.paymentMethods,
				region: d.region,
				terms: d.terms,
				paymentWindowMinutes: d.paymentWindowMinutes,
			})
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status)
	}

	return c.json({ offerId: String(result.right.id), status: result.right.status ?? 'active' })
})

// ── GET /offers/mine — current user's offers ────────────────────────────────
p2pRoutes.get('/offers/mine', telegramAuth(), async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser

	const result = await runEffectEither(
		Effect.gen(function* () {
			const p2p = yield* P2PService
			return yield* p2p.getUserOffers(telegramUser.id)
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status)
	}

	return c.json({ offers: result.right.map(offerToResponse) })
})

// ── GET /trades — current user's trades ─────────────────────────────────────
p2pRoutes.get('/trades', telegramAuth(), async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser

	const result = await runEffectEither(
		Effect.gen(function* () {
			const p2p = yield* P2PService
			return yield* p2p.getUserTrades(telegramUser.id)
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status)
	}

	return c.json({ trades: result.right.map(tradeToResponse) })
})

// ── GET /trades/:id — single trade (owner only) ─────────────────────────────
p2pRoutes.get('/trades/:id', telegramAuth(), async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser
	const id = parseInt(c.req.param('id') ?? '', 10)
	if (Number.isNaN(id)) {
		return c.json({ error: 'Validation Error', message: 'Invalid trade id' }, 400)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const p2p = yield* P2PService
			const tradeOpt = yield* p2p.getTrade(id)
			if (Option.isNone(tradeOpt)) {
				return yield* Effect.fail(
					new NotFoundError({ message: 'Trade not found', resource: 'p2p_trade' }),
				)
			}
			const trade = tradeOpt.value
			if (trade.takerUserId !== telegramUser.id && trade.makerUserId !== telegramUser.id) {
				return yield* Effect.fail(
					new NotFoundError({ message: 'Trade not found', resource: 'p2p_trade' }),
				)
			}
			return trade
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status)
	}

	return c.json({ trade: tradeToResponse(result.right) })
})

// ── POST /trades — start a trade ────────────────────────────────────────────
// Native escrow execution is owned by the Python service and not yet enabled
// from the webapp. Be explicit rather than create an unescrowed trade record.
p2pRoutes.post('/trades', telegramAuth(), async (c) => {
	const { status, body } = mapErrorToResponse(
		new ValidationError({
			message:
				'Native P2P escrow trades are not yet enabled in the webapp. Use the Telegram bot (/p2p), or pick a NoOnes / P2P.me offer to complete the trade with the provider.',
		}),
	)
	return c.json({ ...body, code: 'P2P_NATIVE_ESCROW_PENDING' }, status)
})

export { p2pRoutes }
