import { Context, Effect, Layer } from 'effect'

export interface HLMarket {
	name: string
	asset: string
	szDecimals: number
	maxLeverage: number
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

export interface HLOrderResult {
	orderId: string
	status: 'filled' | 'pending' | 'failed'
	fillPrice: number | null
	filledSize: number | null
}

const INFO_URL = 'https://api.hyperliquid.xyz/info'
const EXCHANGE_URL = 'https://api.hyperliquid.xyz/exchange'

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

const ASSET_INDEX: Record<string, number> = {
	BTC: 0,
	ETH: 1,
	SOL: 2,
	ARB: 3,
	AVAX: 4,
	DOGE: 5,
	MATIC: 6,
	OP: 7,
	SUI: 8,
	APT: 9,
}

const MAX_LEVERAGE = 20
const MIN_MARGIN_USD = 10.0
const FEE_BPS = 2

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
		// open/close/positions require user credentials — stubbed for now
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

async function getMarketsImpl(): Promise<HLMarket[]> {
	const data = (await fetchInfo({ type: 'meta' })) as {
		universe: Array<{
			name: string
			szDecimals: number
			maxLeverage: number
		}>
	}
	const midData = (await fetchInfo({ type: 'allMids' })) as Record<string, string>

	return data.universe
		.filter((u) => MARKETS[`${u.name}-USD`] || Object.values(MARKETS).includes(u.name))
		.map((u) => {
			const marketName = `${u.name}-USD`
			return {
				name: marketName,
				asset: u.name,
				szDecimals: u.szDecimals,
				maxLeverage: u.maxLeverage,
				markPrice: parseFloat(midData[u.name] ?? '0'),
				fundingRate: 0, // funding requires separate call
			}
		})
}

async function getQuoteImpl(
	market: string,
	side: 'long' | 'short',
	size: number,
	leverage: number,
): Promise<HLPositionQuote> {
	const asset = MARKETS[market]
	if (!asset) throw new Error(`Unknown market: ${market}. Available: ${Object.keys(MARKETS).join(', ')}`)
	if (leverage < 1 || leverage > MAX_LEVERAGE)
		throw new Error(`Leverage must be 1-${MAX_LEVERAGE}x`)

	const midData = (await fetchInfo({ type: 'allMids' })) as Record<string, string>
	const markPrice = parseFloat(midData[asset] ?? '0')
	if (!markPrice) throw new Error(`No price available for ${asset}`)

	const notional = size * markPrice
	const margin = notional / leverage
	if (margin < MIN_MARGIN_USD) throw new Error(`Minimum margin is $${MIN_MARGIN_USD}`)

	const fee = notional * (FEE_BPS / 10000)

	// Approximate liquidation price
	const liqDistance = markPrice / leverage
	const liquidationPrice =
		side === 'long' ? markPrice - liqDistance * 0.9 : markPrice + liqDistance * 0.9

	return {
		market,
		side,
		size,
		leverage,
		entryPrice: markPrice,
		margin,
		liquidationPrice,
		fundingRate: 0,
		fee,
	}
}

async function getPositionsImpl(address: string): Promise<HLPosition[]> {
	const data = (await fetchInfo({
		type: 'clearinghouseState',
		user: address,
	})) as {
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

	return data.assetPositions
		.filter((ap) => parseFloat(ap.position.szi) !== 0)
		.map((ap, i) => {
			const pos = ap.position
			const size = parseFloat(pos.szi)
			const entryPrice = parseFloat(pos.entryPx)
			const markPrice = parseFloat(pos.positionValue) / Math.abs(size)

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
				fundingRate: 0,
			}
		})
}

export const HyperliquidServiceLive = Layer.succeed(HyperliquidService, {
	getMarkets: () => Effect.tryPromise({ try: () => getMarketsImpl(), catch: (e) => e as Error }),
	getQuote: (market, side, size, leverage) =>
		Effect.tryPromise({ try: () => getQuoteImpl(market, side, size, leverage), catch: (e) => e as Error }),
	getPositions: (address) =>
		Effect.tryPromise({ try: () => getPositionsImpl(address), catch: (e) => e as Error }),
})
