import { Context, Effect, Layer } from 'effect'
import { TTLCache } from '../lib/cache'

/** Best-effort asset classification for perp markets, including HIP-3 builder-dex listings. */
export type AssetClass = 'crypto' | 'equity' | 'fx' | 'commodity' | 'bond' | 'other'

/** A Hyperliquid perp dex: the default venue (name '') or a HIP-3 builder-deployed dex. */
export interface HLPerpDex {
	name: string
	fullName: string
}

export interface HLMarket {
	name: string
	asset: string
	szDecimals: number
	maxLeverage: number
	venueMaxLeverage: number
	markPrice: number
	fundingRate: number
	/** '' for the default Hyperliquid dex, otherwise the HIP-3 builder-dex name (e.g. "xyz"). */
	dex: string
	assetClass: AssetClass
}

export interface GetMarketsOptions {
	/** Fetch a single dex's markets. Pass '' for the default dex, or a builder-dex name. */
	dex?: string
	/** When true (and `dex` is not set), aggregate the default dex plus all HIP-3 builder dexs. */
	includeBuilderDexs?: boolean
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
		getMarkets: (options?: GetMarketsOptions) => Effect.Effect<HLMarket[], Error>
		getQuote: (
			market: string,
			side: 'long' | 'short',
			size: number,
			leverage: number,
		) => Effect.Effect<HLPositionQuote, Error>
		// Read-only address state. Perps execution is intentionally not exposed here.
		getPositions: (address: string) => Effect.Effect<HLPosition[], Error>
		// HIP-3 builder-dex registry (default dex + any builder-deployed dexs).
		getPerpDexs: () => Effect.Effect<HLPerpDex[], Error>
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

// dex is omitted for the default Hyperliquid venue; HIP-3 builder dexs pass their
// registered name (e.g. "xyz") and the returned universe entries are prefixed
// "xyz:TSLA" etc. Verified live against POST /info {"type":"metaAndAssetCtxs","dex":"xyz"}.
async function fetchPerpSnapshot(dex?: string): Promise<HLPerpSnapshot> {
	const body: Record<string, unknown> = { type: 'metaAndAssetCtxs' }
	if (dex) body.dex = dex
	const data = await fetchInfo(body)
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

// Uncached — used by quote/position paths where mark-price freshness matters most.
async function getPerpSnapshot(dex?: string): Promise<HLPerpSnapshot> {
	return fetchPerpSnapshot(dex)
}

// Short-TTL cache used only by the markets listing path (getMarketsImpl), which can
// fan out to many builder dexs per request. Keeps /markets responsive without
// materially staling mark prices/funding.
const MARKETS_SNAPSHOT_TTL = 5_000
const marketsSnapshotCache = new TTLCache<HLPerpSnapshot>(MARKETS_SNAPSHOT_TTL, 50)

async function getMarketsSnapshot(dex?: string): Promise<HLPerpSnapshot> {
	const key = dex ?? ''
	const cached = marketsSnapshotCache.get(key)
	if (cached) return cached
	const snapshot = await fetchPerpSnapshot(dex)
	marketsSnapshotCache.set(key, snapshot)
	return snapshot
}

// perpDexs enumerates the default venue (null entry) plus all HIP-3 builder-deployed
// dexs. Verified live against POST /info {"type":"perpDexs"}.
const PERP_DEXS_TTL = 5 * 60_000
const perpDexsCache = new TTLCache<HLPerpDex[]>(PERP_DEXS_TTL, 10)

async function fetchPerpDexs(): Promise<HLPerpDex[]> {
	const data = await fetchInfo({ type: 'perpDexs' })
	if (!Array.isArray(data)) throw new Error('Invalid Hyperliquid perpDexs response')
	return data.map((entry) => {
		if (entry === null) return { name: '', fullName: 'Hyperliquid' }
		const dex = entry as { name?: unknown; fullName?: unknown }
		if (typeof dex.name !== 'string') throw new Error('Invalid Hyperliquid perpDexs entry')
		return {
			name: dex.name,
			fullName: typeof dex.fullName === 'string' ? dex.fullName : dex.name,
		}
	})
}

async function getPerpDexsCached(): Promise<HLPerpDex[]> {
	const cached = perpDexsCache.get('all')
	if (cached) return cached
	const dexs = await fetchPerpDexs()
	perpDexsCache.set('all', dexs)
	return dexs
}

// FX/commodity/bond token lists are the observed non-crypto tickers across HL's
// live builder dexs (xyz, flx, vntl, hyna, km, cash, para, mkts) as of 2026-08-15.
const FX_CODES = new Set([
	'EUR',
	'GBP',
	'JPY',
	'KRW',
	'CHF',
	'CNH',
	'CNY',
	'AUD',
	'CAD',
	'NZD',
	'SEK',
	'NOK',
	'MXN',
	'ZAR',
	'SGD',
	'HKD',
	'INR',
	'TRY',
	'DXY',
])

const COMMODITY_TOKENS = new Set([
	'GOLD',
	'SILVER',
	'COPPER',
	'PALLADIUM',
	'PLATINUM',
	'OIL',
	'WTI',
	'CL',
	'BRENTOIL',
	'NATGAS',
	'ALUMINIUM',
	'CORN',
	'WHEAT',
	'SOY',
	'URANIUM',
	'URNM',
	'GLDMINE',
	'SILVERJM',
	'GOLDJM',
	'TTF',
])

const BOND_TOKENS = new Set(['USBOND', '10Y'])

// Common crypto tickers that also appear on builder dexs (e.g. "cash:BTC", "hyna:LIT").
const CRYPTO_TOKENS = new Set([
	'BTC',
	'ETH',
	'SOL',
	'ARB',
	'AVAX',
	'DOGE',
	'MATIC',
	'OP',
	'SUI',
	'APT',
	'XRP',
	'LTC',
	'BCH',
	'LINK',
	'DOT',
	'ADA',
	'UNI',
	'ATOM',
	'NEAR',
	'FTM',
	'INJ',
	'TIA',
	'SEI',
	'WLD',
	'PEPE',
	'SHIB',
	'BONK',
	'FIL',
	'ICP',
	'AAVE',
	'MKR',
	'CRV',
	'LDO',
	'RUNE',
	'KAS',
	'TON',
	'XMR',
	'HYPE',
	'LIGHTER',
	'LIT',
	'USDE',
	'IP',
])

/**
 * Best-effort asset classification. The default Hyperliquid dex is crypto-only
 * (verified: our curated MARKETS list). Builder dexs mix crypto, equities, indices,
 * fx and commodities — classify via known lookup tables first, then fall back to a
 * ticker-shape heuristic ("equity" for alphabetic-only symbols) since HIP-3 dexs are
 * currently dominated by stock/index perps.
 */
function classifyAsset(coin: string, dex: string): AssetClass {
	if (!dex) return 'crypto'
	const colonIndex = coin.indexOf(':')
	const symbol = (colonIndex >= 0 ? coin.slice(colonIndex + 1) : coin).toUpperCase()
	if (FX_CODES.has(symbol)) return 'fx'
	if (COMMODITY_TOKENS.has(symbol)) return 'commodity'
	if (BOND_TOKENS.has(symbol)) return 'bond'
	if (CRYPTO_TOKENS.has(symbol)) return 'crypto'
	if (/^[A-Z]{1,6}\d{0,4}$/.test(symbol)) return 'equity'
	return 'other'
}

function assetFromSnapshot(snapshot: HLPerpSnapshot, asset: string) {
	const index = snapshot.universe.findIndex((item) => item.name === asset)
	if (index < 0) throw new Error(`No live Hyperliquid market data for ${asset}`)
	const meta = snapshot.universe[index]
	const context = snapshot.contexts[index]
	if (!meta || !context) throw new Error(`No live Hyperliquid market context for ${asset}`)
	return { meta, context }
}

// `coin` is the raw universe entry name: bare (e.g. "ETH") on the default dex, or
// dex-prefixed (e.g. "xyz:TSLA") on a builder dex. `dex` is '' for the default venue.
function marketFromSnapshot(snapshot: HLPerpSnapshot, coin: string, dex: string): HLMarket {
	const { meta, context } = assetFromSnapshot(snapshot, coin)
	const venueMaxLeverage = requiredPositive(meta.maxLeverage, `${coin} max leverage`)
	return {
		name: dex ? coin : `${coin}-USD`,
		asset: coin,
		szDecimals: meta.szDecimals,
		maxLeverage: Math.min(venueMaxLeverage, MAX_LEVERAGE),
		venueMaxLeverage,
		markPrice: requiredPositive(context.markPx, `${coin} mark price`),
		fundingRate: requiredFinite(context.funding, `${coin} funding rate`),
		dex,
		assetClass: classifyAsset(coin, dex),
	}
}

async function getMarketsImpl(options: GetMarketsOptions = {}): Promise<HLMarket[]> {
	const { dex, includeBuilderDexs } = options

	// Explicit single-dex request. dex === '' means the default venue.
	if (dex !== undefined) {
		const targetDex = dex.trim()
		const snapshot = await getMarketsSnapshot(targetDex || undefined)
		return snapshot.universe.map((item) => marketFromSnapshot(snapshot, item.name, targetDex))
	}

	if (includeBuilderDexs) {
		const dexs = await getPerpDexsCached()
		const perDex = await Promise.all(
			dexs.map(async (d) => {
				try {
					const snapshot = await getMarketsSnapshot(d.name || undefined)
					return { dex: d, snapshot }
				} catch {
					// A single misbehaving/halted builder dex should not fail the whole listing.
					return null
				}
			}),
		)
		const markets: HLMarket[] = []
		for (const entry of perDex) {
			if (!entry) continue
			for (const item of entry.snapshot.universe) {
				markets.push(marketFromSnapshot(entry.snapshot, item.name, entry.dex.name))
			}
		}
		return markets
	}

	// Default, backward-compatible behavior: curated crypto majors on the default dex.
	const snapshot = await getPerpSnapshot()
	const supported = new Set(Object.values(MARKETS))
	return snapshot.universe
		.filter((item) => supported.has(item.name))
		.map((item) => marketFromSnapshot(snapshot, item.name, ''))
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
	const marketData = marketFromSnapshot(snapshot, asset, '')
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
	getMarkets: (options) =>
		Effect.tryPromise({ try: () => getMarketsImpl(options), catch: (e) => e as Error }),
	getQuote: (market, side, size, leverage) =>
		Effect.tryPromise({
			try: () => getQuoteImpl(market, side, size, leverage),
			catch: (e) => e as Error,
		}),
	getPositions: (address) =>
		Effect.tryPromise({ try: () => getPositionsImpl(address), catch: (e) => e as Error }),
	getPerpDexs: () =>
		Effect.tryPromise({ try: () => getPerpDexsCached(), catch: (e) => e as Error }),
})
