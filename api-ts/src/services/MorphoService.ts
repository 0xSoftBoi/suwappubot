import { Context, Effect, Layer } from 'effect'

export interface LendingMarket {
	id: string
	loanToken: string
	collateralToken: string
	lltv: number // liquidation loan-to-value ratio
	supplyApy: number
	borrowApy: number
	totalSupply: number
	totalBorrow: number
	utilization: number
	chainId: number
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

// Morpho Blue API (subgraph-based)
const MORPHO_API = 'https://blue-api.morpho.org/graphql'

export class MorphoService extends Context.Tag('MorphoService')<
	MorphoService,
	{
		getMarkets: (chainId?: number) => Effect.Effect<LendingMarket[], Error>
		getMarket: (id: string) => Effect.Effect<LendingMarketDetail, Error>
		// supply/withdraw/borrow/repay/positions require wallet — stubbed
	}
>() {}

async function getMarketsImpl(chainId = 8453): Promise<LendingMarket[]> {
	const query = `{
		markets(first: 50, where: { chainId_in: [${chainId}] }, orderBy: SupplyAssetsUsd, orderDirection: Desc) {
			items {
				marketId
				loanAsset { symbol }
				collateralAsset { symbol }
				lltv
				state {
					supplyApy
					borrowApy
					supplyAssetsUsd
					borrowAssetsUsd
					utilization
				}
			}
		}
	}`

	const res = await fetch(MORPHO_API, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ query }),
	})

	if (!res.ok) throw new Error(`Morpho API error ${res.status}`)

	const json = (await res.json()) as {
		data?: {
			markets?: {
				items?: Array<{
					marketId: string
					loanAsset: { symbol: string } | null
					collateralAsset: { symbol: string } | null
					lltv: string
					state: {
						supplyApy: number
						borrowApy: number
						supplyAssetsUsd: number
						borrowAssetsUsd: number
						utilization: number
					}
				}>
			}
		}
	}

	const items = json.data?.markets?.items ?? []

	return items.map((m) => ({
		id: m.marketId,
		loanToken: m.loanAsset?.symbol ?? 'Unknown',
		collateralToken: m.collateralAsset?.symbol ?? 'None',
		lltv: parseFloat(m.lltv) / 1e18,
		supplyApy: m.state.supplyApy * 100,
		borrowApy: m.state.borrowApy * 100,
		totalSupply: m.state.supplyAssetsUsd,
		totalBorrow: m.state.borrowAssetsUsd,
		utilization: m.state.utilization * 100,
		chainId,
	}))
}

async function getMarketImpl(id: string): Promise<LendingMarketDetail> {
	const query = `{
		markets(first: 1, where: { uniqueKey_in: ["${id}"] }) {
			items {
				marketId
				loanAsset { symbol }
				collateralAsset { symbol }
				lltv
				oracle { address }
				irmAddress
				creationTimestamp
				chain { id }
				state {
					supplyApy
					borrowApy
					supplyAssetsUsd
					borrowAssetsUsd
					utilization
				}
			}
		}
	}`

	const res = await fetch(MORPHO_API, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ query }),
	})

	if (!res.ok) throw new Error(`Morpho API error ${res.status}`)

	const json = (await res.json()) as {
		data?: {
			markets?: {
				items?: Array<{
					marketId: string
					loanAsset: { symbol: string } | null
					collateralAsset: { symbol: string } | null
					lltv: string
					oracle: { address: string } | null
					irmAddress: string
					creationTimestamp: number
					chain: { id: number } | null
					state: {
						supplyApy: number
						borrowApy: number
						supplyAssetsUsd: number
						borrowAssetsUsd: number
						utilization: number
					}
				}>
			}
		}
	}

	const m = json.data?.markets?.items?.[0]
	if (!m) throw new Error(`Market ${id} not found`)

	return {
		id: m.marketId,
		loanToken: m.loanAsset?.symbol ?? 'Unknown',
		collateralToken: m.collateralAsset?.symbol ?? 'None',
		lltv: parseFloat(m.lltv) / 1e18,
		supplyApy: m.state.supplyApy * 100,
		borrowApy: m.state.borrowApy * 100,
		totalSupply: m.state.supplyAssetsUsd,
		totalBorrow: m.state.borrowAssetsUsd,
		utilization: m.state.utilization * 100,
		chainId: m.chain?.id ?? 8453,
		oracle: m.oracle?.address ?? '',
		irm: m.irmAddress,
		createdAt: new Date(m.creationTimestamp * 1000).toISOString(),
	}
}

export const MorphoServiceLive = Layer.succeed(MorphoService, {
	getMarkets: (chainId?) =>
		Effect.tryPromise({ try: () => getMarketsImpl(chainId), catch: (e) => e as Error }),
	getMarket: (id) =>
		Effect.tryPromise({ try: () => getMarketImpl(id), catch: (e) => e as Error }),
})
