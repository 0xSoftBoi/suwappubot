import { Context, Effect, Layer } from 'effect'
import { logger } from '../lib/logger'

export interface PredictionMarket {
	id: string
	question: string
	outcomes: string[]
	outcomePrices: number[]
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

export interface PredictionOrderbook {
	market: string
	asset_id: string
	bids: Array<{ price: string; size: string }>
	asks: Array<{ price: string; size: string }>
	timestamp: string
}

export interface ClobApiCreds {
	apiKey: string
	secret: string
	passphrase: string
}

export interface PlaceOrderParams {
	tokenId: string
	side: 'BUY' | 'SELL'
	price: number
	size: number
	orderType?: 'GTC' | 'GTD' | 'FOK'
	expiration?: number
}

export interface OpenOrder {
	id: string
	market: string
	asset_id: string
	side: 'BUY' | 'SELL'
	price: string
	original_size: string
	size_matched: string
	status: string
	created_at: number
}

const GAMMA_API = 'https://gamma-api.polymarket.com'
const CLOB_API = 'https://clob.polymarket.com'

// Polymarket CTF Exchange on Polygon
const CTF_EXCHANGE = '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E'
const NEG_RISK_CTF_EXCHANGE = '0xC5d563A36AE78145C45a50134d48A1215220f80a'
const POLYGON_CHAIN_ID = 137

// EIP712 domain for Polymarket CTF Exchange
const EIP712_DOMAIN = {
	name: 'Polymarket CTF Exchange',
	version: '1',
	chainId: POLYGON_CHAIN_ID,
	verifyingContract: CTF_EXCHANGE,
} as const

const ORDER_TYPES = {
	Order: [
		{ name: 'salt', type: 'uint256' },
		{ name: 'maker', type: 'address' },
		{ name: 'signer', type: 'address' },
		{ name: 'taker', type: 'address' },
		{ name: 'tokenId', type: 'uint256' },
		{ name: 'makerAmount', type: 'uint256' },
		{ name: 'takerAmount', type: 'uint256' },
		{ name: 'expiration', type: 'uint256' },
		{ name: 'nonce', type: 'uint256' },
		{ name: 'feeRateBps', type: 'uint256' },
		{ name: 'side', type: 'uint8' },
		{ name: 'signatureType', type: 'uint8' },
	],
} as const

export class PolymarketService extends Context.Tag('PolymarketService')<
	PolymarketService,
	{
		getMarkets: (query?: string, limit?: number) => Effect.Effect<PredictionMarket[], Error>
		getMarket: (id: string) => Effect.Effect<PredictionMarketDetail, Error>
		getOrderbook: (tokenId: string) => Effect.Effect<PredictionOrderbook, Error>
		getMidpoint: (tokenId: string) => Effect.Effect<number, Error>
		createApiCreds: (address: string, signFn: (hash: string) => Promise<string>) => Effect.Effect<ClobApiCreds, Error>
		placeOrder: (
			creds: ClobApiCreds,
			params: PlaceOrderParams,
			maker: string,
			signFn: (hash: string) => Promise<string>,
		) => Effect.Effect<PredictionTradeResult, Error>
		cancelOrder: (creds: ClobApiCreds, orderId: string) => Effect.Effect<boolean, Error>
		cancelAll: (creds: ClobApiCreds) => Effect.Effect<boolean, Error>
		getOpenOrders: (creds: ClobApiCreds) => Effect.Effect<OpenOrder[], Error>
		getPositions: (
			creds: ClobApiCreds,
		) => Effect.Effect<PredictionPosition[], Error>
	}
>() {}

// ---- Helpers ----

function clobHeaders(creds: ClobApiCreds): Record<string, string> {
	const ts = Math.floor(Date.now() / 1000).toString()
	return {
		'Content-Type': 'application/json',
		'POLY-ADDRESS': '',
		'POLY-SIGNATURE': '',
		'POLY-TIMESTAMP': ts,
		'POLY-NONCE': crypto.randomUUID(),
		'POLY-API-KEY': creds.apiKey,
		'POLY-PASSPHRASE': creds.passphrase,
		'POLY-SECRET': creds.secret,
	}
}

function buildOrderStruct(params: PlaceOrderParams, maker: string) {
	const SIDE_BUY = 0
	const SIDE_SELL = 1
	const side = params.side === 'BUY' ? SIDE_BUY : SIDE_SELL

	// Price is between 0 and 1, amounts in USDC (6 decimals)
	// makerAmount = USDC to spend (for BUY) or shares to sell (for SELL)
	// takerAmount = shares to receive (for BUY) or USDC to receive (for SELL)
	const rawPrice = params.price
	const rawSize = params.size

	let makerAmount: bigint
	let takerAmount: bigint

	if (side === SIDE_BUY) {
		// Buying: pay price*size USDC, receive size shares
		makerAmount = BigInt(Math.round(rawPrice * rawSize * 1e6))
		takerAmount = BigInt(Math.round(rawSize * 1e6))
	} else {
		// Selling: give size shares, receive price*size USDC
		makerAmount = BigInt(Math.round(rawSize * 1e6))
		takerAmount = BigInt(Math.round(rawPrice * rawSize * 1e6))
	}

	const salt = BigInt('0x' + Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, '0')).join(''))
	const expiration = params.expiration ?? 0 // 0 = no expiration (GTC)
	const nonce = 0n
	const feeRateBps = 0n

	return {
		salt,
		maker: maker as `0x${string}`,
		signer: maker as `0x${string}`,
		taker: '0x0000000000000000000000000000000000000000' as `0x${string}`,
		tokenId: BigInt(params.tokenId),
		makerAmount,
		takerAmount,
		expiration: BigInt(expiration),
		nonce,
		feeRateBps,
		side,
		signatureType: 0, // EOA
	}
}

function encodeOrderForHash(order: ReturnType<typeof buildOrderStruct>): string {
	// Construct EIP712 typed data hash manually
	// This follows the EIP712 spec: keccak256(encode(domainSeparator, structHash))
	// For now, we return the order struct as JSON for the signing function to process
	return JSON.stringify({
		domain: EIP712_DOMAIN,
		types: ORDER_TYPES,
		primaryType: 'Order',
		message: {
			salt: order.salt.toString(),
			maker: order.maker,
			signer: order.signer,
			taker: order.taker,
			tokenId: order.tokenId.toString(),
			makerAmount: order.makerAmount.toString(),
			takerAmount: order.takerAmount.toString(),
			expiration: order.expiration.toString(),
			nonce: order.nonce.toString(),
			feeRateBps: order.feeRateBps.toString(),
			side: order.side,
			signatureType: order.signatureType,
		},
	})
}

// ---- Gamma API (read-only, no auth) ----

async function getMarketsImpl(query?: string, limit = 20): Promise<PredictionMarket[]> {
	const params = new URLSearchParams({
		limit: String(limit),
		active: 'true',
		closed: 'false',
		order: 'volume',
		ascending: 'false',
	})
	if (query) params.set('tag', query)

	const res = await fetch(`${GAMMA_API}/markets?${params}`)
	if (!res.ok) throw new Error(`Polymarket API error ${res.status}`)

	const data = (await res.json()) as Array<{
		condition_id: string
		question: string
		outcomes: string
		outcomePrices: string
		volume: string
		liquidity: string
		end_date_iso: string
		active: boolean
		category: string
	}>

	return data.map((m) => {
		let outcomes: string[] = []
		let outcomePrices: number[] = []
		try {
			outcomes = JSON.parse(m.outcomes)
		} catch {
			outcomes = ['Yes', 'No']
		}
		try {
			outcomePrices = JSON.parse(m.outcomePrices).map(Number)
		} catch {
			outcomePrices = [0.5, 0.5]
		}

		return {
			id: m.condition_id,
			question: m.question,
			outcomes,
			outcomePrices,
			volume: parseFloat(m.volume || '0'),
			liquidity: parseFloat(m.liquidity || '0'),
			endDate: m.end_date_iso || '',
			active: m.active,
			category: m.category || '',
		}
	})
}

async function getMarketImpl(id: string): Promise<PredictionMarketDetail> {
	const res = await fetch(`${GAMMA_API}/markets/${id}`)
	if (!res.ok) throw new Error(`Polymarket market ${id} not found (${res.status})`)

	const m = (await res.json()) as {
		condition_id: string
		question: string
		description: string
		outcomes: string
		outcomePrices: string
		volume: string
		liquidity: string
		end_date_iso: string
		active: boolean
		category: string
		created_at: string
		resolved_outcome: string | null
	}

	let outcomes: string[] = []
	let outcomePrices: number[] = []
	try {
		outcomes = JSON.parse(m.outcomes)
	} catch {
		outcomes = ['Yes', 'No']
	}
	try {
		outcomePrices = JSON.parse(m.outcomePrices).map(Number)
	} catch {
		outcomePrices = [0.5, 0.5]
	}

	return {
		id: m.condition_id,
		question: m.question,
		description: m.description || '',
		outcomes,
		outcomePrices,
		volume: parseFloat(m.volume || '0'),
		liquidity: parseFloat(m.liquidity || '0'),
		endDate: m.end_date_iso || '',
		active: m.active,
		category: m.category || '',
		createdAt: m.created_at || '',
		resolvedOutcome: m.resolved_outcome,
	}
}

// ---- CLOB API (public, no auth) ----

async function getOrderbookImpl(tokenId: string): Promise<PredictionOrderbook> {
	const res = await fetch(`${CLOB_API}/book?token_id=${tokenId}`)
	if (!res.ok) throw new Error(`CLOB orderbook error ${res.status}`)

	const data = (await res.json()) as {
		market: string
		asset_id: string
		bids: Array<{ price: string; size: string }>
		asks: Array<{ price: string; size: string }>
		timestamp: string
	}

	return data
}

async function getMidpointImpl(tokenId: string): Promise<number> {
	const res = await fetch(`${CLOB_API}/midpoint?token_id=${tokenId}`)
	if (!res.ok) throw new Error(`CLOB midpoint error ${res.status}`)

	const data = (await res.json()) as { mid: string }
	return parseFloat(data.mid)
}

// ---- CLOB API (authenticated) ----

async function createApiCredsImpl(
	address: string,
	signFn: (hash: string) => Promise<string>,
): Promise<ClobApiCreds> {
	// Step 1: Get nonce from CLOB
	const nonceRes = await fetch(`${CLOB_API}/auth/nonce`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ address }),
	})
	if (!nonceRes.ok) throw new Error(`Failed to get CLOB nonce: ${nonceRes.status}`)
	const { nonce } = (await nonceRes.json()) as { nonce: string }

	// Step 2: Sign the nonce
	const signature = await signFn(nonce)

	// Step 3: Create API key
	const keyRes = await fetch(`${CLOB_API}/auth/api-key`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ address, signature, nonce }),
	})
	if (!keyRes.ok) throw new Error(`Failed to create CLOB API key: ${keyRes.status}`)

	const creds = (await keyRes.json()) as {
		apiKey: string
		secret: string
		passphrase: string
	}

	return creds
}

async function placeOrderImpl(
	creds: ClobApiCreds,
	params: PlaceOrderParams,
	maker: string,
	signFn: (hash: string) => Promise<string>,
): Promise<PredictionTradeResult> {
	const order = buildOrderStruct(params, maker)
	const typedData = encodeOrderForHash(order)
	const signature = await signFn(typedData)

	const headers = clobHeaders(creds)
	headers['POLY-ADDRESS'] = maker

	const orderPayload = {
		order: {
			salt: order.salt.toString(),
			maker: order.maker,
			signer: order.signer,
			taker: order.taker,
			tokenId: order.tokenId.toString(),
			makerAmount: order.makerAmount.toString(),
			takerAmount: order.takerAmount.toString(),
			expiration: order.expiration.toString(),
			nonce: order.nonce.toString(),
			feeRateBps: order.feeRateBps.toString(),
			side: order.side,
			signatureType: order.signatureType,
			signature,
		},
		owner: maker,
		orderType: params.orderType ?? 'GTC',
	}

	const res = await fetch(`${CLOB_API}/order`, {
		method: 'POST',
		headers,
		body: JSON.stringify(orderPayload),
	})

	if (!res.ok) {
		const errBody = await res.text()
		throw new Error(`CLOB place order error ${res.status}: ${errBody}`)
	}

	const result = (await res.json()) as {
		orderID: string
		status: string
		transactID?: string
	}

	logger.info({ orderId: result.orderID, market: params.tokenId, side: params.side }, 'Polymarket order placed')

	return {
		tradeId: result.orderID,
		marketId: params.tokenId,
		outcome: params.side === 'BUY' ? 'YES' : 'NO',
		shares: params.size,
		price: params.price,
		cost: params.price * params.size,
		status: result.status === 'matched' ? 'filled' : result.status === 'live' ? 'pending' : 'failed',
	}
}

async function cancelOrderImpl(creds: ClobApiCreds, orderId: string): Promise<boolean> {
	const headers = clobHeaders(creds)

	const res = await fetch(`${CLOB_API}/order`, {
		method: 'DELETE',
		headers,
		body: JSON.stringify({ orderID: orderId }),
	})

	if (!res.ok) {
		const errBody = await res.text()
		throw new Error(`CLOB cancel order error ${res.status}: ${errBody}`)
	}

	logger.info({ orderId }, 'Polymarket order cancelled')
	return true
}

async function cancelAllImpl(creds: ClobApiCreds): Promise<boolean> {
	const headers = clobHeaders(creds)

	const res = await fetch(`${CLOB_API}/cancel-all`, {
		method: 'DELETE',
		headers,
	})

	if (!res.ok) {
		const errBody = await res.text()
		throw new Error(`CLOB cancel all error ${res.status}: ${errBody}`)
	}

	logger.info('Polymarket all orders cancelled')
	return true
}

async function getOpenOrdersImpl(creds: ClobApiCreds): Promise<OpenOrder[]> {
	const headers = clobHeaders(creds)

	const res = await fetch(`${CLOB_API}/orders`, {
		method: 'GET',
		headers,
	})

	if (!res.ok) throw new Error(`CLOB open orders error ${res.status}`)

	const data = (await res.json()) as OpenOrder[]
	return data
}

async function getPositionsImpl(creds: ClobApiCreds): Promise<PredictionPosition[]> {
	const headers = clobHeaders(creds)

	const res = await fetch(`${CLOB_API}/positions`, {
		method: 'GET',
		headers,
	})

	if (!res.ok) throw new Error(`CLOB positions error ${res.status}`)

	const data = (await res.json()) as Array<{
		asset_id: string
		condition_id: string
		market_slug: string
		title: string
		outcome: string
		size: string
		avg_price: string
		cur_price: string
		pnl: string
	}>

	return data.map((p) => ({
		marketId: p.condition_id,
		question: p.title || p.market_slug,
		outcome: p.outcome,
		shares: parseFloat(p.size),
		avgPrice: parseFloat(p.avg_price),
		currentPrice: parseFloat(p.cur_price),
		pnl: parseFloat(p.pnl),
	}))
}

// ---- Layer ----

export const PolymarketServiceLive = Layer.succeed(PolymarketService, {
	getMarkets: (query?, limit?) =>
		Effect.tryPromise({ try: () => getMarketsImpl(query, limit), catch: (e) => e as Error }),
	getMarket: (id) =>
		Effect.tryPromise({ try: () => getMarketImpl(id), catch: (e) => e as Error }),
	getOrderbook: (tokenId) =>
		Effect.tryPromise({ try: () => getOrderbookImpl(tokenId), catch: (e) => e as Error }),
	getMidpoint: (tokenId) =>
		Effect.tryPromise({ try: () => getMidpointImpl(tokenId), catch: (e) => e as Error }),
	createApiCreds: (address, signFn) =>
		Effect.tryPromise({ try: () => createApiCredsImpl(address, signFn), catch: (e) => e as Error }),
	placeOrder: (creds, params, maker, signFn) =>
		Effect.tryPromise({ try: () => placeOrderImpl(creds, params, maker, signFn), catch: (e) => e as Error }),
	cancelOrder: (creds, orderId) =>
		Effect.tryPromise({ try: () => cancelOrderImpl(creds, orderId), catch: (e) => e as Error }),
	cancelAll: (creds) =>
		Effect.tryPromise({ try: () => cancelAllImpl(creds), catch: (e) => e as Error }),
	getOpenOrders: (creds) =>
		Effect.tryPromise({ try: () => getOpenOrdersImpl(creds), catch: (e) => e as Error }),
	getPositions: (creds) =>
		Effect.tryPromise({ try: () => getPositionsImpl(creds), catch: (e) => e as Error }),
})
