import { Context, Effect, Layer } from 'effect'

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

const GAMMA_API = 'https://gamma-api.polymarket.com'
const CLOB_API = 'https://clob.polymarket.com'

export class PolymarketService extends Context.Tag('PolymarketService')<
	PolymarketService,
	{
		getMarkets: (query?: string, limit?: number) => Effect.Effect<PredictionMarket[], Error>
		getMarket: (id: string) => Effect.Effect<PredictionMarketDetail, Error>
		// buy/sell/positions require wallet credentials — stubbed for now
	}
>() {}

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

export const PolymarketServiceLive = Layer.succeed(PolymarketService, {
	getMarkets: (query?, limit?) =>
		Effect.tryPromise({ try: () => getMarketsImpl(query, limit), catch: (e) => e as Error }),
	getMarket: (id) =>
		Effect.tryPromise({ try: () => getMarketImpl(id), catch: (e) => e as Error }),
})
