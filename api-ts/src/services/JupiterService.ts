import { Context, Effect, Layer } from 'effect'
import { ValidationError } from '../errors'
import { logger } from '../lib/logger'

// Jupiter API base URL
const JUPITER_API_BASE = 'https://lite-api.jup.ag/swap/v1'

// Solana token addresses
export const SOLANA_TOKENS: Record<string, { address: string; decimals: number; name: string }> = {
	SOL: { address: 'So11111111111111111111111111111111111111112', decimals: 9, name: 'Solana' },
	WSOL: {
		address: 'So11111111111111111111111111111111111111112',
		decimals: 9,
		name: 'Wrapped SOL',
	},
	USDC: { address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6, name: 'USD Coin' },
	USDT: {
		address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
		decimals: 6,
		name: 'Tether USD',
	},
	BONK: { address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', decimals: 5, name: 'Bonk' },
	WIF: { address: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', decimals: 6, name: 'dogwifhat' },
	JUP: { address: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', decimals: 6, name: 'Jupiter' },
	RAY: { address: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', decimals: 6, name: 'Raydium' },
	PYTH: {
		address: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3',
		decimals: 6,
		name: 'Pyth Network',
	},
	JTO: { address: 'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL', decimals: 9, name: 'Jito' },
	ORCA: { address: 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE', decimals: 6, name: 'Orca' },
	MNDE: { address: 'MNDEFzGvMt87ueuHvVU9VcTqsAP5b3fTGPsHuuPA5ey', decimals: 9, name: 'Marinade' },
	MSOL: {
		address: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
		decimals: 9,
		name: 'Marinade Staked SOL',
	},
	JITOSOL: {
		address: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn',
		decimals: 9,
		name: 'Jito Staked SOL',
	},
}

// Jupiter quote response
export interface JupiterQuote {
	inputMint: string
	inAmount: string
	outputMint: string
	outAmount: string
	otherAmountThreshold: string
	swapMode: string
	slippageBps: number
	platformFee: null | { amount: string; feeBps: number }
	priceImpactPct: string
	routePlan: Array<{
		swapInfo: {
			ammKey: string
			label: string
			inputMint: string
			outputMint: string
			inAmount: string
			outAmount: string
			feeAmount: string
			feeMint: string
		}
		percent: number
	}>
	contextSlot?: number
	timeTaken?: number
}

// Jupiter swap transaction response
export interface JupiterSwapResponse {
	swapTransaction: string // Base64 encoded transaction
	lastValidBlockHeight: number
	prioritizationFeeLamports?: number
}

export interface JupiterServiceInterface {
	readonly getQuote: (params: {
		inputMint: string
		outputMint: string
		amount: string
		slippageBps?: number
	}) => Effect.Effect<JupiterQuote, ValidationError | Error>

	readonly getSwapTransaction: (params: {
		quote: JupiterQuote
		userPublicKey: string
		wrapUnwrapSOL?: boolean
		computeUnitPriceMicroLamports?: number
	}) => Effect.Effect<JupiterSwapResponse, ValidationError | Error>

	readonly resolveToken: (
		symbol: string,
	) => { address: string; decimals: number; name: string } | null
}

export class JupiterService extends Context.Tag('JupiterService')<
	JupiterService,
	JupiterServiceInterface
>() {}

export const JupiterServiceLive = Layer.succeed(JupiterService, {
	getQuote: (params) =>
		Effect.gen(function* () {
			const { inputMint, outputMint, amount, slippageBps = 300 } = params

			if (!inputMint || !outputMint || !amount) {
				return yield* Effect.fail(
					new ValidationError({
						message: 'inputMint, outputMint, and amount are required',
					}),
				)
			}

			// Platform fee: 0.3% (30 bps) to Suwappu
			const platformFeeBps = process.env.FEE_BPS || '30'

			const queryParams = new URLSearchParams({
				inputMint,
				outputMint,
				amount,
				slippageBps: String(slippageBps),
				onlyDirectRoutes: 'false',
				asLegacyTransaction: 'false',
				platformFeeBps,
			})

			const url = `${JUPITER_API_BASE}/quote?${queryParams.toString()}`

			logger.info('[JupiterService] Fetching quote: %s', url)

			const response = yield* Effect.tryPromise({
				try: async () => {
					const res = await fetch(url, {
						method: 'GET',
						headers: { Accept: 'application/json' },
					})

					if (!res.ok) {
						const errorText = await res.text()
						throw new Error(`Jupiter API error: ${res.status} - ${errorText}`)
					}

					return (await res.json()) as JupiterQuote
				},
				catch: (e) => new Error(`Failed to fetch Jupiter quote: ${e}`),
			})

			return response
		}),

	getSwapTransaction: (params) =>
		Effect.gen(function* () {
			const { quote, userPublicKey, wrapUnwrapSOL = true, computeUnitPriceMicroLamports } = params

			if (!quote || !userPublicKey) {
				return yield* Effect.fail(
					new ValidationError({
						message: 'quote and userPublicKey are required',
					}),
				)
			}

			// Fee account for platform fees
			const feeAccount =
				process.env.FEE_WALLET_SOLANA || '4Xxbeusi6NL46AtZQHJrPREtYFCByKE48oxrpLvWEWJh'

			const body: Record<string, unknown> = {
				quoteResponse: quote,
				userPublicKey,
				wrapAndUnwrapSol: wrapUnwrapSOL,
				dynamicComputeUnitLimit: true,
				feeAccount,
			}

			if (computeUnitPriceMicroLamports) {
				body.computeUnitPriceMicroLamports = computeUnitPriceMicroLamports
			}

			const url = `${JUPITER_API_BASE}/swap`

			logger.info('[JupiterService] Getting swap transaction for: %s', userPublicKey)

			const response = yield* Effect.tryPromise({
				try: async () => {
					const res = await fetch(url, {
						method: 'POST',
						headers: {
							Accept: 'application/json',
							'Content-Type': 'application/json',
						},
						body: JSON.stringify(body),
					})

					if (!res.ok) {
						const errorText = await res.text()
						throw new Error(`Jupiter swap API error: ${res.status} - ${errorText}`)
					}

					return (await res.json()) as JupiterSwapResponse
				},
				catch: (e) => new Error(`Failed to get Jupiter swap transaction: ${e}`),
			})

			return response
		}),

	resolveToken: (symbol: string) => {
		const normalized = symbol.toUpperCase().trim()
		return SOLANA_TOKENS[normalized] || null
	},
})
