import { Context, Effect, Layer } from 'effect'
import { DEFAULT_AGENT_FEE_BPS, DEFAULT_FEE_WALLET_SOLANA } from '../config/constants'
import { SOLANA_TOKENS } from '../config/tokenRegistry'
import { ValidationError } from '../errors'
import { logger } from '../lib/logger'

// Jupiter API base URL
const JUPITER_API_BASE = 'https://lite-api.jup.ag/swap/v1'

// SOLANA_TOKENS now lives in config/tokenRegistry.ts (imported above, re-exported
// below) — single source of truth shared with routes/data.ts's reference API.
export { SOLANA_TOKENS }

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

			// Platform fee to Suwappu (flat agent-surface rate; default 0.3% / 30 bps).
			// Sourced from the single DEFAULT_AGENT_FEE_BPS constant so the quote we
			// build can never diverge from EnvService's FEE_BPS default.
			const platformFeeBps = process.env.FEE_BPS || String(DEFAULT_AGENT_FEE_BPS)

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

			// Fee account for platform fees (same default as EnvService.FEE_WALLET_SOLANA)
			const feeAccount = process.env.FEE_WALLET_SOLANA || DEFAULT_FEE_WALLET_SOLANA

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
