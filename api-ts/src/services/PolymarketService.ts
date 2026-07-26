import crypto from 'crypto'
import { Context, Effect, Layer } from 'effect'
import type { ClobOrderData } from '../lib/polymarket-eip712'

export interface MarketToken {
	tokenId: string
	outcome: string
}

export interface Orderbook {
	market: string
	assetId: string
	bids: { price: string; size: string }[]
	asks: { price: string; size: string }[]
	midpoint: string
	lastTradePrice: string
	tickSize: string
}

export interface Trade {
	id: string
	price: string
	size: string
	side: string
	timestamp: string
}

export interface PredictionMarket {
	id: string
	// On-chain Gnosis CTF condition id (0x… bytes32). This — NOT the numeric `id`
	// — is what the CLOB resolution + on-chain redemption are keyed by, so it must
	// be carried through to anything that places or settles an order.
	conditionId: string
	question: string
	outcomes: string[]
	outcomePrices: number[]
	tokens: MarketToken[]
	volume: number
	liquidity: number
	endDate: string
	active: boolean
	category: string
}

export interface PredictionMarketDetail extends PredictionMarket {
	description: string
	createdAt: string
	resolvedOutcome: string | null
}

export interface PredictionEvent {
	id: string
	title: string
	description: string
	markets: PredictionMarket[]
}

export interface PredictionPosition {
	marketId: string
	question: string
	outcome: string
	shares: number
	avgPrice: number
	currentPrice: number
	pnl: number
}

export interface PredictionTradeResult {
	tradeId: string
	marketId: string
	outcome: string
	shares: number
	price: number
	cost: number
	status: 'filled' | 'pending' | 'failed'
}

export interface ClobApiCredentials {
	apiKey: string
	secret: string
	passphrase: string
}

export interface PlaceOrderParams {
	tokenId: string
	price: string
	size: string
	side: 'BUY' | 'SELL'
	expiration?: number | undefined
	feeRateBps?: number | undefined
}

// CLOB /order accepts a time-in-force qualifier alongside the signed order.
//   GTC = Good-Til-Cancelled, GTD = Good-Til-Date, FOK = Fill-Or-Kill,
//   FAK = Fill-And-Kill (partial fill, cancel remainder).
export type ClobOrderType = 'GTC' | 'GTD' | 'FOK' | 'FAK'

// The exact order object that was EIP-712 signed (lib/polymarket-eip712.ts
// ClobOrderData) plus the resulting signature. This is what gets serialized
// into the CLOB POST /order body — the body MUST carry the same amounts/side/
// signatureType that went into the signed digest, or the CLOB rejects it.
export interface SignedClobOrder {
	order: ClobOrderData
	signature: string
	orderType: ClobOrderType
}

export interface ClobOrder {
	id: string
	status: string
	market: string
	asset_id: string
	side: string
	original_size: string
	size_matched: string
	price: string
	created_at: string
	expiration: string
	type: string
}

export interface ClobPosition {
	asset: string
	conditionId: string
	size: string
	avgPrice: string
	currentPrice?: string
	realizedPnl?: string
	unrealizedPnl?: string
}

const GAMMA_API = 'https://gamma-api.polymarket.com'
const CLOB_API = 'https://clob.polymarket.com'

export class PolymarketService extends Context.Tag('PolymarketService')<
	PolymarketService,
	{
		getMarkets: (query?: string, limit?: number) => Effect.Effect<PredictionMarket[], Error>
		getMarket: (id: string) => Effect.Effect<PredictionMarketDetail, Error>
		getOrderbook: (tokenId: string) => Effect.Effect<Orderbook, Error>
		getMidpoint: (tokenId: string) => Effect.Effect<{ mid: string }, Error>
		/** True when the token's market is neg-risk — selects the exchange to sign against. */
		getNegRisk: (tokenId: string) => Effect.Effect<boolean, Error>
		getTrades: (tokenId: string, limit?: number) => Effect.Effect<Trade[], Error>
		getEvents: (query?: string, limit?: number) => Effect.Effect<PredictionEvent[], Error>
		createApiCredentials: (walletAddress: string, nonce: string, signature: string) => Effect.Effect<ClobApiCredentials, Error>
		placeOrder: (credentials: ClobApiCredentials, walletAddress: string, signed: SignedClobOrder) => Effect.Effect<ClobOrder, Error>
		cancelOrder: (credentials: ClobApiCredentials, walletAddress: string, orderId: string) => Effect.Effect<{ success: boolean }, Error>
		getPositions: (credentials: ClobApiCredentials, walletAddress: string) => Effect.Effect<ClobPosition[], Error>
		getOrders: (credentials: ClobApiCredentials, walletAddress: string, status?: string) => Effect.Effect<ClobOrder[], Error>
	}
>() {}

// ---------- Gamma API response type ----------
interface GammaMarketRaw {
	// Gamma API uses a numeric string `id` as the /markets/{id} detail path param;
	// `conditionId` is the on-chain 0x hash and is NOT accepted there (returns 422).
	id: string
	conditionId?: string
	question: string
	description?: string
	outcomes: string
	outcomePrices: string
	clobTokenIds?: string
	volume: string
	liquidity: string
	endDate: string
	active: boolean
	category: string
	createdAt?: string
	resolvedOutcome?: string | null
}

function parseTokens(raw: GammaMarketRaw): MarketToken[] {
	try {
		const ids = JSON.parse(raw.clobTokenIds || '[]') as string[]
		const outs = JSON.parse(raw.outcomes) as string[]
		return ids.map((id, i) => ({ tokenId: id, outcome: outs[i] ?? `Outcome ${i}` }))
	} catch {
		return []
	}
}

function parseOutcomes(raw: string): string[] {
	try { return JSON.parse(raw) } catch { return ['Yes', 'No'] }
}

function parsePrices(raw: string): number[] {
	try { return JSON.parse(raw).map(Number) } catch { return [0.5, 0.5] }
}

function mapGammaMarket(m: GammaMarketRaw): PredictionMarket {
	return {
		id: m.id ?? '',
		conditionId: m.conditionId ?? '',
		question: m.question,
		outcomes: parseOutcomes(m.outcomes),
		outcomePrices: parsePrices(m.outcomePrices),
		tokens: parseTokens(m),
		volume: parseFloat(m.volume || '0'),
		liquidity: parseFloat(m.liquidity || '0'),
		endDate: m.endDate || '',
		active: m.active ?? true,
		category: m.category || '',
	}
}

// ---------- Gamma API ----------

// Gamma's public-search endpoint does full-text search across markets/events (unlike
// /markets?tag=, which only matches an exact category tag). Falls back to a
// client-side substring filter over question/category if public-search errors or is
// unavailable, so a search query never silently degrades into unfiltered results.
async function searchMarketsImpl(query: string, limit: number): Promise<PredictionMarket[]> {
	try {
		const params = new URLSearchParams({
			q: query,
			limit_per_type: String(limit),
			events_status: 'active',
		})
		const res = await fetch(`${GAMMA_API}/public-search?${params}`, { signal: AbortSignal.timeout(15_000) })
		if (res.ok) {
			const data = (await res.json()) as {
				markets?: GammaMarketRaw[]
				events?: Array<{ markets?: GammaMarketRaw[] }>
			}
			// public-search returns markets nested under events[].markets, not a flat
			// data.markets array — flatten + dedupe by id, keeping any top-level
			// data.markets too in case the API shape varies by query.
			const seen = new Set<string>()
			const flattened: GammaMarketRaw[] = []
			for (const m of [...(data.markets ?? []), ...(data.events ?? []).flatMap((e) => e.markets ?? [])]) {
				if (!m || !m.id || seen.has(m.id)) continue
				seen.add(m.id)
				flattened.push(m)
			}
			const markets = flattened.map(mapGammaMarket).slice(0, limit)
			// public-search succeeded — trust its (possibly empty) result rather than
			// falling through to unfiltered results.
			return markets
		}
	} catch {
		// fall through to client-side filter below
	}

	// Fallback: fetch a broader active-market page and filter client-side on
	// question/category. A search query must never return unfiltered results —
	// if nothing matches, return an empty list.
	const params = new URLSearchParams({
		limit: String(Math.max(limit * 5, 100)),
		active: 'true',
		closed: 'false',
		order: 'volume',
		ascending: 'false',
	})
	const res = await fetch(`${GAMMA_API}/markets?${params}`, { signal: AbortSignal.timeout(15_000) })
	if (!res.ok) throw new Error(`Polymarket API error ${res.status}`)
	const data = (await res.json()) as GammaMarketRaw[]
	const needle = query.toLowerCase()
	return data
		.filter((m) => m.question?.toLowerCase().includes(needle) || m.category?.toLowerCase().includes(needle))
		.map(mapGammaMarket)
		.slice(0, limit)
}

async function getMarketsImpl(query?: string, limit = 20): Promise<PredictionMarket[]> {
	if (query) {
		return searchMarketsImpl(query, limit)
	}

	const params = new URLSearchParams({
		limit: String(limit),
		active: 'true',
		closed: 'false',
		order: 'volume',
		ascending: 'false',
	})

	const res = await fetch(`${GAMMA_API}/markets?${params}`, { signal: AbortSignal.timeout(15_000) })
	if (!res.ok) throw new Error(`Polymarket API error ${res.status}`)

	const data = (await res.json()) as GammaMarketRaw[]
	return data.map(mapGammaMarket)
}

async function getMarketImpl(id: string): Promise<PredictionMarketDetail> {
	const res = await fetch(`${GAMMA_API}/markets/${id}`, { signal: AbortSignal.timeout(15_000) })
	if (!res.ok) throw new Error(`Polymarket market ${id} not found (${res.status})`)

	const m = (await res.json()) as GammaMarketRaw
	return {
		...mapGammaMarket(m),
		description: m.description || '',
		createdAt: m.createdAt || '',
		resolvedOutcome: m.resolvedOutcome ?? null,
	}
}

// ---------- Events API ----------

async function getEventsImpl(query?: string, limit = 20): Promise<PredictionEvent[]> {
	const params = new URLSearchParams({
		limit: String(limit),
		active: 'true',
	})
	if (query) params.set('title', query)

	const res = await fetch(`${GAMMA_API}/events?${params}`, { signal: AbortSignal.timeout(15_000) })
	if (!res.ok) throw new Error(`Polymarket events API error ${res.status}`)

	const data = (await res.json()) as Array<{
		id: string
		title: string
		description: string
		markets: GammaMarketRaw[]
	}>

	return data.map((e) => ({
		id: e.id,
		title: e.title,
		description: e.description || '',
		markets: (e.markets || []).map(mapGammaMarket),
	}))
}

// ---------- CLOB API ----------

async function getOrderbookImpl(tokenId: string): Promise<Orderbook> {
	const [bookRes, midRes] = await Promise.all([
		fetch(`${CLOB_API}/book?token_id=${tokenId}`, { signal: AbortSignal.timeout(10_000) }),
		fetch(`${CLOB_API}/midpoint?token_id=${tokenId}`, { signal: AbortSignal.timeout(10_000) }),
	])

	if (!bookRes.ok) throw new Error(`CLOB book error ${bookRes.status}`)

	const book = (await bookRes.json()) as {
		market: string
		asset_id: string
		bids: { price: string; size: string }[]
		asks: { price: string; size: string }[]
		last_trade_price: string
		tick_size: string
	}

	let mid = '0'
	if (midRes.ok) {
		const midData = (await midRes.json()) as { mid: string }
		mid = midData.mid || '0'
	}

	return {
		market: book.market || '',
		assetId: book.asset_id || '',
		bids: book.bids || [],
		asks: book.asks || [],
		midpoint: mid,
		lastTradePrice: book.last_trade_price || '0',
		tickSize: book.tick_size || '0.01',
	}
}

async function getMidpointImpl(tokenId: string): Promise<{ mid: string }> {
	const res = await fetch(`${CLOB_API}/midpoint?token_id=${tokenId}`, {
		signal: AbortSignal.timeout(10_000),
	})
	if (!res.ok) throw new Error(`CLOB midpoint error ${res.status}`)
	const data = (await res.json()) as { mid: string }
	return { mid: data.mid || '0' }
}

/**
 * Whether a token's market is a neg-risk (multi-outcome) market.
 *
 * Public, unauthenticated CLOB endpoint — the same one Polymarket's own
 * py-clob-client uses to pick the exchange contract before signing. This MUST be
 * consulted before building an order's EIP-712 payload: neg-risk markets are
 * matched by a different exchange, and signing against the wrong one gets the
 * order rejected.
 *
 * Fails CLOSED (throws) rather than defaulting to false — silently assuming
 * "not neg-risk" is exactly the bug this lookup exists to prevent.
 */
async function getNegRiskImpl(tokenId: string): Promise<boolean> {
	const res = await fetch(`${CLOB_API}/neg-risk?token_id=${tokenId}`, {
		signal: AbortSignal.timeout(10_000),
	})
	if (!res.ok) throw new Error(`CLOB neg-risk error ${res.status}`)
	const data = (await res.json()) as { neg_risk?: boolean }
	if (typeof data.neg_risk !== 'boolean') {
		throw new Error('CLOB neg-risk response missing neg_risk flag')
	}
	return data.neg_risk
}

async function getTradesImpl(tokenId: string, limit = 20): Promise<Trade[]> {
	const res = await fetch(`${CLOB_API}/trades?token_id=${tokenId}&limit=${limit}`, {
		signal: AbortSignal.timeout(10_000),
	})
	if (!res.ok) throw new Error(`CLOB trades error ${res.status}`)
	const data = (await res.json()) as Array<{
		id: string
		price: string
		size: string
		side: string
		timestamp: string
	}>
	return (data || []).map((t) => ({
		id: t.id || '',
		price: t.price || '0',
		size: t.size || '0',
		side: t.side || '',
		timestamp: t.timestamp || '',
	}))
}

// ---------- CLOB Auth Headers ----------

function buildClobAuthHeaders(
	credentials: ClobApiCredentials,
	walletAddress: string,
	method: string,
	path: string,
	body?: string,
): Record<string, string> {
	const timestamp = Math.floor(Date.now() / 1000).toString()
	const message = timestamp + method.toUpperCase() + path + (body || '')
	const hmac = crypto.createHmac('sha256', credentials.secret)
	hmac.update(message)
	const signature = hmac.digest('base64')

	return {
		'POLY_ADDRESS': walletAddress,
		'POLY_SIGNATURE': signature,
		'POLY_TIMESTAMP': timestamp,
		'POLY_API_KEY': credentials.apiKey,
		'POLY_PASSPHRASE': credentials.passphrase,
		'Content-Type': 'application/json',
	}
}

// ---------- CLOB Authenticated API ----------

async function createApiCredentialsImpl(
	walletAddress: string,
	nonce: string,
	signature: string,
): Promise<ClobApiCredentials> {
	const body = JSON.stringify({ address: walletAddress, nonce, signature })
	const res = await fetch(`${CLOB_API}/auth/api-key`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body,
		signal: AbortSignal.timeout(15_000),
	})
	if (!res.ok) {
		const text = await res.text().catch(() => '')
		throw new Error(`CLOB auth/api-key error ${res.status}: ${text}`)
	}
	const data = (await res.json()) as { apiKey: string; secret: string; passphrase: string }
	return { apiKey: data.apiKey, secret: data.secret, passphrase: data.passphrase }
}

// Serialize the *signed* order into the exact JSON shape the CLOB POST /order
// endpoint expects (per py-clob-client / clob-client `EXCHANGE` order builder).
//
// CRITICAL: the body must describe THE SAME order that was EIP-712 signed —
// identical maker/signer/tokenId/makerAmount/takerAmount/signatureType — or the
// CLOB recovers a different digest and rejects the signature. The only encoding
// differences vs the signed struct are presentational:
//   - all integer fields are sent as decimal STRINGS (the signed struct uses
//     uint256; JSON has no bigint, so the client sends strings),
//   - `side` is sent as the "BUY" | "SELL" enum string in the POST body, even
//     though the signed struct hashed it as 0 (BUY) / 1 (SELL).
//
// The v2 schema dropped taker/expiration/nonce/feeRateBps from the signed
// struct, but the CLOB POST body is still validated against the client's order
// model which carries those legacy fields with defaults (taker = zero address,
// expiration = "0", nonce = "0", feeRateBps = "0"). They are NOT part of the
// signed digest, so they must use exactly these neutral defaults.
export function buildClobOrderBody(signed: SignedClobOrder, owner: string): {
	order: Record<string, string | number>
	owner: string
	orderType: ClobOrderType
} {
	const o = signed.order
	return {
		order: {
			salt: o.salt,
			maker: o.maker,
			signer: o.signer,
			taker: '0x0000000000000000000000000000000000000000',
			tokenId: o.tokenId,
			makerAmount: o.makerAmount,
			takerAmount: o.takerAmount,
			expiration: '0',
			nonce: '0',
			feeRateBps: '0',
			side: o.side === 0 ? 'BUY' : 'SELL',
			signatureType: o.signatureType,
			signature: signed.signature,
		},
		owner,
		orderType: signed.orderType,
	}
}

async function placeOrderImpl(
	credentials: ClobApiCredentials,
	walletAddress: string,
	signed: SignedClobOrder,
): Promise<ClobOrder> {
	const path = '/order'
	// `owner` is the CLOB API key id (L2 creds), NOT the wallet address.
	const bodyObj = buildClobOrderBody(signed, credentials.apiKey)
	const body = JSON.stringify(bodyObj)
	const headers = buildClobAuthHeaders(credentials, walletAddress, 'POST', path, body)

	const res = await fetch(`${CLOB_API}${path}`, {
		method: 'POST',
		headers,
		body,
		signal: AbortSignal.timeout(15_000),
	})
	if (!res.ok) {
		const text = await res.text().catch(() => '')
		throw new Error(`CLOB place order error ${res.status}: ${text}`)
	}
	return (await res.json()) as ClobOrder
}

async function cancelOrderImpl(
	credentials: ClobApiCredentials,
	walletAddress: string,
	orderId: string,
): Promise<{ success: boolean }> {
	const path = `/order/${orderId}`
	const headers = buildClobAuthHeaders(credentials, walletAddress, 'DELETE', path)

	const res = await fetch(`${CLOB_API}${path}`, {
		method: 'DELETE',
		headers,
		signal: AbortSignal.timeout(15_000),
	})
	if (!res.ok) {
		const text = await res.text().catch(() => '')
		throw new Error(`CLOB cancel order error ${res.status}: ${text}`)
	}
	return { success: true }
}

async function getPositionsImpl(credentials: ClobApiCredentials, walletAddress: string): Promise<ClobPosition[]> {
	const path = '/positions'
	const headers = buildClobAuthHeaders(credentials, walletAddress, 'GET', path)

	const res = await fetch(`${CLOB_API}${path}`, {
		method: 'GET',
		headers,
		signal: AbortSignal.timeout(15_000),
	})
	if (!res.ok) {
		const text = await res.text().catch(() => '')
		throw new Error(`CLOB positions error ${res.status}: ${text}`)
	}
	return (await res.json()) as ClobPosition[]
}

async function getOrdersImpl(credentials: ClobApiCredentials, walletAddress: string, status?: string): Promise<ClobOrder[]> {
	const params = new URLSearchParams()
	if (status) params.set('status', status)
	const qs = params.toString()
	const path = `/orders${qs ? `?${qs}` : ''}`
	const headers = buildClobAuthHeaders(credentials, walletAddress, 'GET', path)

	const res = await fetch(`${CLOB_API}${path}`, {
		method: 'GET',
		headers,
		signal: AbortSignal.timeout(15_000),
	})
	if (!res.ok) {
		const text = await res.text().catch(() => '')
		throw new Error(`CLOB orders error ${res.status}: ${text}`)
	}
	return (await res.json()) as ClobOrder[]
}

// ---------- Layer ----------

export const PolymarketServiceLive = Layer.succeed(PolymarketService, {
	getMarkets: (query?, limit?) =>
		Effect.tryPromise({ try: () => getMarketsImpl(query, limit), catch: (e) => e as Error }),
	getMarket: (id) =>
		Effect.tryPromise({ try: () => getMarketImpl(id), catch: (e) => e as Error }),
	getOrderbook: (tokenId) =>
		Effect.tryPromise({ try: () => getOrderbookImpl(tokenId), catch: (e) => e as Error }),
	getMidpoint: (tokenId) =>
		Effect.tryPromise({ try: () => getMidpointImpl(tokenId), catch: (e) => e as Error }),
	getNegRisk: (tokenId) =>
		Effect.tryPromise({ try: () => getNegRiskImpl(tokenId), catch: (e) => e as Error }),
	getTrades: (tokenId, limit?) =>
		Effect.tryPromise({ try: () => getTradesImpl(tokenId, limit), catch: (e) => e as Error }),
	getEvents: (query?, limit?) =>
		Effect.tryPromise({ try: () => getEventsImpl(query, limit), catch: (e) => e as Error }),
	createApiCredentials: (walletAddress, nonce, signature) =>
		Effect.tryPromise({ try: () => createApiCredentialsImpl(walletAddress, nonce, signature), catch: (e) => e as Error }),
	placeOrder: (credentials, walletAddress, signed) =>
		Effect.tryPromise({ try: () => placeOrderImpl(credentials, walletAddress, signed), catch: (e) => e as Error }),
	cancelOrder: (credentials, walletAddress, orderId) =>
		Effect.tryPromise({ try: () => cancelOrderImpl(credentials, walletAddress, orderId), catch: (e) => e as Error }),
	getPositions: (credentials, walletAddress) =>
		Effect.tryPromise({ try: () => getPositionsImpl(credentials, walletAddress), catch: (e) => e as Error }),
	getOrders: (credentials, walletAddress, status?) =>
		Effect.tryPromise({ try: () => getOrdersImpl(credentials, walletAddress, status), catch: (e) => e as Error }),
})
