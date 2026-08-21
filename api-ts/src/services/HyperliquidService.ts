import { Context, Effect, Layer } from 'effect'

export interface HLMarket {
	name: string
	asset: string
	szDecimals: number
	maxLeverage: number
	venueMaxLeverage: number
	markPrice: number
	fundingRate: number
}

export interface HLPositionQuote {
	market: string
	side: 'long' | 'short'
	size: number
	leverage: number
	entryPrice: number
	margin: number
	liquidationPrice: number
	fundingRate: number
	fee: number
}

export interface HLPosition {
	id: string
	market: string
	side: 'long' | 'short'
	size: number
	leverage: number
	entryPrice: number
	markPrice: number
	margin: number
	unrealizedPnl: number
	liquidationPrice: number
	fundingRate: number
}

const INFO_URL = 'https://api.hyperliquid.xyz/info'

const MARKETS: Record<string, string> = {
	'ETH-USD': 'ETH',
	'BTC-USD': 'BTC',
	'SOL-USD': 'SOL',
	'ARB-USD': 'ARB',
	'AVAX-USD': 'AVAX',
	'DOGE-USD': 'DOGE',
	'MATIC-USD': 'MATIC',
	'OP-USD': 'OP',
	'SUI-USD': 'SUI',
	'APT-USD': 'APT',
}

const MAX_LEVERAGE = 20
const MIN_MARGIN_USD = 10.0
const FEE_BPS = 2

interface HLAssetMeta {
	name: string
	szDecimals: number
	maxLeverage: number
}

interface HLAssetContext {
	funding: string
	markPx: string | null
	midPx?: string | null
}

interface HLPerpSnapshot {
	universe: HLAssetMeta[]
	contexts: HLAssetContext[]
}

export class HyperliquidService extends Context.Tag('HyperliquidService')<
	HyperliquidService,
	{
		getMarkets: () => Effect.Effect<HLMarket[], Error>
		getQuote: (
			market: string,
			side: 'long' | 'short',
			size: number,
			leverage: number,
		) => Effect.Effect<HLPositionQuote, Error>
		// Read-only address state. Perps execution is intentionally not exposed here.
		getPositions: (address: string) => Effect.Effect<HLPosition[], Error>
	}
>() {}

async function fetchInfo(body: Record<string, unknown>): Promise<unknown> {
	const res = await fetch(INFO_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	})
	if (!res.ok) throw new Error(`Hyperliquid API error ${res.status}`)
	return res.json()
}

function requiredFinite(value: string | number | null | undefined, label: string): number {
	if (value === null || value === undefined || value === '') {
		throw new Error(`Hyperliquid ${label} is unavailable`)
	}
	const parsed = typeof value === 'number' ? value : Number.parseFloat(value)
	if (!Number.isFinite(parsed)) {
		throw new Error(`Hyperliquid ${label} is invalid`)
	}
	return parsed
}

function requiredPositive(value: string | number | null | undefined, label: string): number {
	const parsed = requiredFinite(value, label)
	if (parsed <= 0) throw new Error(`Hyperliquid ${label} must be positive`)
	return parsed
}

async function getPerpSnapshot(): Promise<HLPerpSnapshot> {
	const data = await fetchInfo({ type: 'metaAndAssetCtxs' })
	if (!Array.isArray(data) || data.length < 2) {
		throw new Error('Invalid Hyperliquid metaAndAssetCtxs response')
	}

	const meta = data[0] as { universe?: HLAssetMeta[] }
	const contexts = data[1] as HLAssetContext[]
	if (!Array.isArray(meta?.universe) || !Array.isArray(contexts)) {
		throw new Error('Invalid Hyperliquid metaAndAssetCtxs response')
	}

	return { universe: meta.universe, contexts }
}

function assetFromSnapshot(snapshot: HLPerpSnapshot, asset: string) {
	const index = snapshot.universe.findIndex((item) => item.name === asset)
	if (index < 0) throw new Error(`No live Hyperliquid market data for ${asset}`)
	const meta = snapshot.universe[index]
	const context = snapshot.contexts[index]
	if (!meta || !context) throw new Error(`No live Hyperliquid market context for ${asset}`)
	return { meta, context }
}

function marketFromSnapshot(snapshot: HLPerpSnapshot, asset: string): HLMarket {
	const { meta, context } = assetFromSnapshot(snapshot, asset)
	const venueMaxLeverage = requiredPositive(meta.maxLeverage, `${asset} max leverage`)
	return {
		name: `${asset}-USD`,
		asset,
		szDecimals: meta.szDecimals,
		maxLeverage: Math.min(venueMaxLeverage, MAX_LEVERAGE),
		venueMaxLeverage,
		markPrice: requiredPositive(context.markPx, `${asset} mark price`),
		fundingRate: requiredFinite(context.funding, `${asset} funding rate`),
	}
}

async function getMarketsImpl(): Promise<HLMarket[]> {
	const snapshot = await getPerpSnapshot()
	const supported = new Set(Object.values(MARKETS))
	return snapshot.universe
		.filter((item) => supported.has(item.name))
		.map((item) => marketFromSnapshot(snapshot, item.name))
}

async function getQuoteImpl(
	market: string,
	side: 'long' | 'short',
	size: number,
	leverage: number,
): Promise<HLPositionQuote> {
	const asset = MARKETS[market]
	if (!asset)
		throw new Error(`Unknown market: ${market}. Available: ${Object.keys(MARKETS).join(', ')}`)
	const snapshot = await getPerpSnapshot()
	const { context } = assetFromSnapshot(snapshot, asset)
	const marketData = marketFromSnapshot(snapshot, asset)
	if (leverage < 1 || leverage > marketData.maxLeverage)
		throw new Error(`Leverage must be 1-${marketData.maxLeverage}x for ${market}`)

	const markPrice = marketData.markPrice
	const entryPrice =
		context.midPx === null || context.midPx === undefined || context.midPx === ''
			? markPrice
			: requiredPositive(context.midPx, `${asset} midpoint`)

	const notional = size * entryPrice
	const margin = notional / leverage
	if (margin < MIN_MARGIN_USD) throw new Error(`Minimum margin is $${MIN_MARGIN_USD}`)

	const fee = notional * (FEE_BPS / 10000)

	// Approximate liquidation price
	const liqDistance = entryPrice / leverage
	const liquidationPrice =
		side === 'long' ? entryPrice - liqDistance * 0.9 : entryPrice + liqDistance * 0.9

	return {
		market,
		side,
		size,
		leverage,
		entryPrice,
		margin,
		liquidationPrice,
		fundingRate: marketData.fundingRate,
		fee,
	}
}

async function getPositionsImpl(address: string): Promise<HLPosition[]> {
	const [data, snapshot] = (await Promise.all([
		fetchInfo({
			type: 'clearinghouseState',
			user: address,
		}),
		getPerpSnapshot(),
	])) as [unknown, HLPerpSnapshot]
	const state = data as {
		assetPositions: Array<{
			position: {
				coin: string
				szi: string
				entryPx: string
				positionValue: string
				unrealizedPnl: string
				liquidationPx: string | null
				leverage: { value: string }
				marginUsed: string
			}
		}>
	}

	return state.assetPositions
		.filter((ap) => parseFloat(ap.position.szi) !== 0)
		.map((ap, i) => {
			const pos = ap.position
			const size = parseFloat(pos.szi)
			const entryPrice = parseFloat(pos.entryPx)
			const markPrice = parseFloat(pos.positionValue) / Math.abs(size)
			const { context } = assetFromSnapshot(snapshot, pos.coin)

			return {
				id: `${pos.coin}-${i}`,
				market: `${pos.coin}-USD`,
				side: (size > 0 ? 'long' : 'short') as 'long' | 'short',
				size: Math.abs(size),
				leverage: parseFloat(pos.leverage.value),
				entryPrice,
				markPrice,
				margin: parseFloat(pos.marginUsed),
				unrealizedPnl: parseFloat(pos.unrealizedPnl),
				liquidationPrice: pos.liquidationPx ? parseFloat(pos.liquidationPx) : 0,
				fundingRate: requiredFinite(context.funding, `${pos.coin} funding rate`),
			}
		})
}

export const HyperliquidServiceLive = Layer.succeed(HyperliquidService, {
	getMarkets: () => Effect.tryPromise({ try: () => getMarketsImpl(), catch: (e) => e as Error }),
	getQuote: (market, side, size, leverage) =>
		Effect.tryPromise({
			try: () => getQuoteImpl(market, side, size, leverage),
			catch: (e) => e as Error,
		}),
	getPositions: (address) =>
		Effect.tryPromise({ try: () => getPositionsImpl(address), catch: (e) => e as Error }),
})
