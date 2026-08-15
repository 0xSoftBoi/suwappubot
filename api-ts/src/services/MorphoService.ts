import { Context, Effect, Layer } from 'effect'

export interface LendingMarketWarning {
	type: string
	level: string
}

export interface LendingMarket {
	id: string
	loanToken: string
	collateralToken: string
	lltv: number // liquidation loan-to-value ratio
	supplyApy: number
	borrowApy: number
	/** @deprecated Use totalSupplyUsd; retained for backwards compatibility. */
	totalSupply: number | null
	/** @deprecated Use totalBorrowUsd; retained for backwards compatibility. */
	totalBorrow: number | null
	totalSupplyUsd: number | null
	totalBorrowUsd: number | null
	availableLiquidityUsd: number | null
	utilization: number
	chainId: number
	listed: boolean
	warnings: LendingMarketWarning[]
}

export interface LendingMarketDetail extends LendingMarket {
	oracle: string
	irm: string // interest rate model address
	createdAt: string
}

export interface LendingPosition {
	marketId: string
	loanToken: string
	collateralToken: string
	type: 'supply' | 'borrow'
	amount: number
	value: number
	apy: number
}

export interface LendingTxResult {
	txHash: string
	type: 'supply' | 'withdraw' | 'borrow' | 'repay'
	amount: number
	token: string
	status: 'confirmed' | 'pending' | 'failed'
}

// Current Morpho API GraphQL endpoint. The legacy subgraphs are deprecated.
const MORPHO_API = 'https://api.morpho.org/graphql'

interface MorphoMarketState {
	supplyApy: number
	borrowApy: number
	supplyAssetsUsd: number | null
	borrowAssetsUsd: number | null
	liquidityAssetsUsd: number | null
	utilization: number
}

interface MorphoMarketNode {
	marketId: string
	listed: boolean
	loanAsset: { symbol: string } | null
	collateralAsset: { symbol: string } | null
	lltv: string
	warnings?: Array<{ type: string; level: string }>
	state: MorphoMarketState
}

interface MorphoMarketDetailNode extends MorphoMarketNode {
	oracle: { address: string } | null
	irmAddress: string
	creationTimestamp: string | number
	chain: { id: number } | null
}

async function queryMorpho<T>(query: string, variables: Record<string, unknown>): Promise<T> {
	const res = await fetch(MORPHO_API, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ query, variables }),
	})
	if (!res.ok) throw new Error(`Morpho API error ${res.status}`)

	const json = (await res.json()) as {
		data?: T
		errors?: Array<{ message?: string }>
	}
	if (json.errors?.length) {
		const message = json.errors.map((error) => error.message ?? 'unknown GraphQL error').join('; ')
		throw new Error(`Morpho API GraphQL error: ${message}`)
	}
	if (!json.data) throw new Error('Morpho API response missing data')
	return json.data
}

function toLendingMarket(m: MorphoMarketNode, chainId: number): LendingMarket {
	return {
		id: m.marketId,
		loanToken: m.loanAsset?.symbol ?? 'Unknown',
		collateralToken: m.collateralAsset?.symbol ?? 'None',
		lltv: parseFloat(m.lltv) / 1e18,
		supplyApy: m.state.supplyApy * 100,
		borrowApy: m.state.borrowApy * 100,
		totalSupply: m.state.supplyAssetsUsd,
		totalBorrow: m.state.borrowAssetsUsd,
		totalSupplyUsd: m.state.supplyAssetsUsd,
		totalBorrowUsd: m.state.borrowAssetsUsd,
		availableLiquidityUsd: m.state.liquidityAssetsUsd,
		utilization: m.state.utilization * 100,
		chainId,
		listed: m.listed,
		warnings: (m.warnings ?? []).map((warning) => ({
			type: warning.type,
			level: warning.level,
		})),
	}
}

export class MorphoService extends Context.Tag('MorphoService')<
	MorphoService,
	{
		getMarkets: (chainId?: number) => Effect.Effect<LendingMarket[], Error>
		getMarket: (id: string, chainId?: number) => Effect.Effect<LendingMarketDetail, Error>
		// supply/withdraw/borrow/repay/positions require wallet — stubbed
	}
>() {}

async function getMarketsImpl(chainId = 8453): Promise<LendingMarket[]> {
	const query = `query LendingMarkets($chainId: Int!) {
		markets(first: 50, where: { chainId_in: [$chainId] }, orderBy: SupplyAssetsUsd, orderDirection: Desc) {
			items {
				marketId
				listed
				loanAsset { symbol }
				collateralAsset { symbol }
				lltv
				warnings { type level }
				state {
					supplyApy
					borrowApy
					supplyAssetsUsd
					borrowAssetsUsd
					liquidityAssetsUsd
					utilization
				}
			}
		}
	}`

	const data = await queryMorpho<{ markets?: { items?: MorphoMarketNode[] } }>(query, { chainId })
	const items = data.markets?.items
	if (!items) throw new Error('Morpho API response missing markets')
	return items.map((market) => toLendingMarket(market, chainId))
}

async function getMarketImpl(id: string, chainId = 8453): Promise<LendingMarketDetail> {
	const query = `query LendingMarket($marketId: String!, $chainId: Int!) {
		marketById(marketId: $marketId, chainId: $chainId) {
			marketId
			listed
			loanAsset { symbol }
			collateralAsset { symbol }
			lltv
			oracle { address }
			irmAddress
			creationTimestamp
			chain { id }
			warnings { type level }
			state {
				supplyApy
				borrowApy
				supplyAssetsUsd
				borrowAssetsUsd
				liquidityAssetsUsd
				utilization
			}
		}
	}`

	const data = await queryMorpho<{ marketById?: MorphoMarketDetailNode | null }>(query, {
		marketId: id,
		chainId,
	})
	const market = data.marketById
	if (!market) throw new Error(`Market ${id} not found on chain ${chainId}`)

	return {
		...toLendingMarket(market, market.chain?.id ?? chainId),
		oracle: market.oracle?.address ?? '',
		irm: market.irmAddress,
		createdAt: new Date(Number(market.creationTimestamp) * 1000).toISOString(),
	}
}

export const MorphoServiceLive = Layer.succeed(MorphoService, {
	getMarkets: (chainId?) =>
		Effect.tryPromise({ try: () => getMarketsImpl(chainId), catch: (e) => e as Error }),
	getMarket: (id, chainId?) =>
		Effect.tryPromise({ try: () => getMarketImpl(id, chainId), catch: (e) => e as Error }),
})
