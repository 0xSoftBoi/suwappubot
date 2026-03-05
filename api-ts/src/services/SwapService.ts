import { Context, Effect, Layer } from 'effect'
import { eq, desc } from 'drizzle-orm'
import { DrizzleService, requireDb, swapTransactions, type SwapTransaction, type NewSwapTransaction } from '../db'
import { DatabaseError, ValidationError } from '../errors'
import { getTransactionReceipt } from '../config/chains'

// Li.Fi API base URL
const LIFI_API_BASE = 'https://li.quest/v1'

// Quote request parameters
export interface QuoteParams {
	fromChain: string | number // Chain ID or chain key
	toChain: string | number
	fromToken: string // Token address (use 0x0...0 for native)
	toToken: string
	fromAmount: string // Amount in wei/smallest unit
	fromAddress: string // Wallet address
	toAddress?: string // Defaults to fromAddress
	slippage?: number // 0.01 = 1%, default 0.03
	order?: 'RECOMMENDED' | 'FASTEST' | 'CHEAPEST' | 'SAFEST'
	integrator?: string
}

// Token info from Li.Fi
export interface LifiToken {
	address: string
	symbol: string
	decimals: number
	chainId: number
	name: string
	coinKey?: string
	priceUSD?: string
	logoURI?: string
}

// Gas cost estimate
export interface GasCost {
	type: string
	price: string
	estimate: string
	limit: string
	amount: string
	amountUSD: string
	token: LifiToken
}

// Fee cost
export interface FeeCost {
	name: string
	description?: string
	percentage?: string
	amount: string
	amountUSD: string
	token: LifiToken
	included: boolean
}

// Quote estimate from Li.Fi
export interface QuoteEstimate {
	fromAmount: string
	toAmount: string
	toAmountMin: string
	approvalAddress: string
	feeCosts: FeeCost[]
	gasCosts: GasCost[]
	executionDuration?: number
}

// Transaction request from Li.Fi
export interface TransactionRequest {
	from: string
	to: string
	chainId: number
	data: string
	value: string
	gasPrice?: string
	gasLimit?: string
}

// Full quote response
export interface LifiQuote {
	id: string
	type: string
	tool: string
	toolDetails: {
		key: string
		name: string
		logoURI: string
	}
	action: {
		fromChainId: number
		toChainId: number
		fromToken: LifiToken
		toToken: LifiToken
		fromAmount: string
		slippage: number
		fromAddress: string
		toAddress: string
	}
	estimate: QuoteEstimate
	integrator?: string
	transactionRequest: TransactionRequest
	includedSteps: Array<{
		id: string
		type: string
		tool: string
		toolDetails?: { key: string; name: string; logoURI?: string }
		action: Record<string, unknown>
		estimate: QuoteEstimate
	}>
}

// Simplified quote for frontend
export interface SwapQuote {
	quoteId: string
	fromChain: string
	toChain: string
	fromToken: {
		address: string
		symbol: string
		decimals: number
		logoURI?: string
	}
	toToken: {
		address: string
		symbol: string
		decimals: number
		logoURI?: string
	}
	fromAmount: string
	toAmount: string
	toAmountMin: string
	exchangeRate: string
	priceImpact: string
	estimatedGas: string
	estimatedGasUsd: string
	bridgeFee: string
	bridgeFeeUsd: string
	slippage: number
	estimatedDuration: number
	route: string
	transactionRequest: TransactionRequest
	// Store full quote data for execution
	_rawQuote: LifiQuote
}

// Execute swap parameters
export interface ExecuteSwapParams {
	quoteId: string
	userId: number
	walletAddress: string
	turnkeySubOrgId: string
	turnkeyWalletId: string
	idempotencyKey?: string
}

// Execute swap result
export interface ExecuteSwapResult {
	swapId: number
	txHash: string
	status: string
	fromChain: string
	toChain: string
	fromToken: string
	toToken: string
	fromAmount: string
	expectedToAmount: string
}

// Li.Fi API error
export interface LifiApiError {
	message: string
	code?: number
}

export interface SwapServiceInterface {
	readonly getUserSwaps: (
		userId: number,
		limit?: number,
		offset?: number
	) => Effect.Effect<SwapTransaction[], DatabaseError, DrizzleService>
	
	readonly getQuote: (
		params: QuoteParams
	) => Effect.Effect<SwapQuote, ValidationError | Error>
	
	readonly createSwapRecord: (
		swap: NewSwapTransaction
	) => Effect.Effect<SwapTransaction, DatabaseError, DrizzleService>
	
	readonly updateSwapStatus: (
		swapId: number,
		status: string,
		txHash?: string,
		errorMessage?: string
	) => Effect.Effect<SwapTransaction | null, DatabaseError, DrizzleService>
	
	readonly getSwapById: (
		swapId: number
	) => Effect.Effect<SwapTransaction | null, DatabaseError, DrizzleService>

	readonly checkAndUpdateSwapStatus: (
		swapId: number
	) => Effect.Effect<SwapTransaction | null, DatabaseError, DrizzleService>
}

export class SwapService extends Context.Tag('SwapService')<
	SwapService,
	SwapServiceInterface
>() {}

// Helper to map chain key to chain ID
const CHAIN_IDS: Record<string, number> = {
	ethereum: 1,
	optimism: 10,
	bsc: 56,
	polygon: 137,
	arbitrum: 42161,
	avalanche: 43114,
	base: 8453,
	gnosis: 100,
	fantom: 250,
	linea: 59144,
	scroll: 534352,
	zksync: 324,
	solana: 1151111081099710, // Li.Fi uses this for Solana
}

function resolveChainId(chain: string | number): number {
	if (typeof chain === 'number') return chain
	return CHAIN_IDS[chain.toLowerCase()] || parseInt(chain, 10)
}

// Native token address placeholder
const NATIVE_TOKEN = '0x0000000000000000000000000000000000000000'

export const SwapServiceLive = Layer.succeed(SwapService, {
	getUserSwaps: (userId: number, limit = 20, offset = 0) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message }))
			)

			const result = yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(swapTransactions)
						.where(eq(swapTransactions.userId, userId))
						.orderBy(desc(swapTransactions.createdAt))
						.limit(limit)
						.offset(offset),
				catch: (e) => new DatabaseError({ message: `Failed to get swaps: ${e}`, cause: e }),
			})

			return result
		}),

	getQuote: (params: QuoteParams) =>
		Effect.gen(function* () {
			// Validate required params
			if (!params.fromChain || !params.toChain) {
				return yield* Effect.fail(new ValidationError({ 
					message: 'fromChain and toChain are required',
					fields: { fromChain: 'required', toChain: 'required' }
				}))
			}
			if (!params.fromToken || !params.toToken) {
				return yield* Effect.fail(new ValidationError({ 
					message: 'fromToken and toToken are required',
					fields: { fromToken: 'required', toToken: 'required' }
				}))
			}
			if (!params.fromAmount || params.fromAmount === '0') {
				return yield* Effect.fail(new ValidationError({ 
					message: 'fromAmount must be greater than 0',
					fields: { fromAmount: 'must be greater than 0' }
				}))
			}
			if (!params.fromAddress) {
				return yield* Effect.fail(new ValidationError({ 
					message: 'fromAddress is required',
					fields: { fromAddress: 'required' }
				}))
			}

			// Build query params
			const queryParams = new URLSearchParams({
				fromChain: String(resolveChainId(params.fromChain)),
				toChain: String(resolveChainId(params.toChain)),
				fromToken: params.fromToken,
				toToken: params.toToken,
				fromAmount: params.fromAmount,
				fromAddress: params.fromAddress,
				toAddress: params.toAddress || params.fromAddress,
				slippage: String(params.slippage || 0.03),
				order: params.order || 'RECOMMENDED',
				integrator: params.integrator || 'suwappu',
				referrer: process.env.FEE_WALLET_EVM || '0x6456f69215C470e1545Ed6eea4621C136B30D85d',
				fee: '0.003', // 0.3% integrator fee
			})

			const url = `${LIFI_API_BASE}/quote?${queryParams.toString()}`
			
			console.log('[SwapService] Fetching quote:', url)

			// Call Li.Fi API
			const response = yield* Effect.tryPromise({
				try: async () => {
					const res = await fetch(url, {
						method: 'GET',
						headers: {
							'Accept': 'application/json',
							// Add API key if configured
							...(process.env.LIFI_API_KEY && {
								'x-lifi-api-key': process.env.LIFI_API_KEY,
							}),
						},
					})
					
					if (!res.ok) {
						const errorData = await res.json().catch(() => ({ message: res.statusText })) as LifiApiError
						throw new Error(`Li.Fi API error: ${errorData.message || res.statusText}`)
					}
					
					return await res.json() as LifiQuote
				},
				catch: (e) => new Error(`Failed to fetch quote: ${e}`),
			})

			// Calculate derived values
			const fromAmountNum = parseFloat(response.action.fromAmount) / Math.pow(10, response.action.fromToken.decimals)
			const toAmountNum = parseFloat(response.estimate.toAmount) / Math.pow(10, response.action.toToken.decimals)
			const exchangeRate = toAmountNum / fromAmountNum
			
			// Calculate total gas in USD
			const gasUsd = response.estimate.gasCosts.reduce(
				(sum, g) => sum + parseFloat(g.amountUSD || '0'), 
				0
			)
			
			// Calculate bridge fees
			const bridgeFeeUsd = response.estimate.feeCosts.reduce(
				(sum, f) => sum + parseFloat(f.amountUSD || '0'),
				0
			)
			
			// Calculate price impact (simplified)
			const fromUsd = parseFloat(response.action.fromToken.priceUSD || '0') * fromAmountNum
			const toUsd = parseFloat(response.action.toToken.priceUSD || '0') * toAmountNum
			const priceImpact = fromUsd > 0 ? ((fromUsd - toUsd) / fromUsd * 100) : 0

			// Build route description
			const route = response.includedSteps
				.map((step) => step.toolDetails?.name || step.tool)
				.join(' → ')

			const quote: SwapQuote = {
				quoteId: response.id,
				fromChain: String(response.action.fromChainId),
				toChain: String(response.action.toChainId),
				fromToken: {
					address: response.action.fromToken.address,
					symbol: response.action.fromToken.symbol,
					decimals: response.action.fromToken.decimals,
					logoURI: response.action.fromToken.logoURI,
				},
				toToken: {
					address: response.action.toToken.address,
					symbol: response.action.toToken.symbol,
					decimals: response.action.toToken.decimals,
					logoURI: response.action.toToken.logoURI,
				},
				fromAmount: response.action.fromAmount,
				toAmount: response.estimate.toAmount,
				toAmountMin: response.estimate.toAmountMin,
				exchangeRate: exchangeRate.toFixed(6),
				priceImpact: priceImpact.toFixed(2),
				estimatedGas: response.estimate.gasCosts[0]?.amount || '0',
				estimatedGasUsd: gasUsd.toFixed(2),
				bridgeFee: response.estimate.feeCosts[0]?.amount || '0',
				bridgeFeeUsd: bridgeFeeUsd.toFixed(2),
				slippage: response.action.slippage,
				estimatedDuration: response.estimate.executionDuration || 60,
				route,
				transactionRequest: response.transactionRequest,
				_rawQuote: response,
			}

			return quote
		}),

	createSwapRecord: (swap: NewSwapTransaction) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message }))
			)

			const result = yield* Effect.tryPromise({
				try: () =>
					db
						.insert(swapTransactions)
						.values(swap)
						.returning(),
				catch: (e) => new DatabaseError({ message: `Failed to create swap record: ${e}`, cause: e }),
			})

			return result[0]
		}),

	updateSwapStatus: (swapId: number, status: string, txHash?: string, errorMessage?: string) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message }))
			)

			const updateData: Partial<SwapTransaction> = {
				status,
				updatedAt: new Date(),
			}

			if (txHash) updateData.txHash = txHash
			if (errorMessage) updateData.errorMessage = errorMessage
			if (status === 'completed') updateData.completedAt = new Date()

			const result = yield* Effect.tryPromise({
				try: () =>
					db
						.update(swapTransactions)
						.set(updateData)
						.where(eq(swapTransactions.id, swapId))
						.returning(),
				catch: (e) => new DatabaseError({ message: `Failed to update swap status: ${e}`, cause: e }),
			})

			return result[0] || null
		}),

	getSwapById: (swapId: number) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message }))
			)

			const result = yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(swapTransactions)
						.where(eq(swapTransactions.id, swapId))
						.limit(1),
				catch: (e) => new DatabaseError({ message: `Failed to get swap: ${e}`, cause: e }),
			})

			return result[0] || null
		}),

	checkAndUpdateSwapStatus: (swapId: number) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message }))
			)

			// Fetch the swap
			const swapResult = yield* Effect.tryPromise({
				try: () =>
					db.select().from(swapTransactions).where(eq(swapTransactions.id, swapId)).limit(1),
				catch: (e) => new DatabaseError({ message: `Failed to get swap: ${e}`, cause: e }),
			})

			const swap = swapResult[0]
			if (!swap || swap.status !== 'submitted' || !swap.txHash) {
				return swap || null
			}

			// Check on-chain receipt
			const chainId = parseInt(swap.fromChain, 10)
			const receipt = yield* Effect.tryPromise({
				try: () => getTransactionReceipt(chainId, swap.txHash!),
				catch: () => new DatabaseError({ message: 'Failed to check tx receipt' }),
			})

			if (!receipt.confirmed) return swap // Still pending

			const newStatus = receipt.success ? 'completed' : 'failed'
			const updateData: Partial<SwapTransaction> = {
				status: newStatus,
				updatedAt: new Date(),
			}
			if (newStatus === 'completed') updateData.completedAt = new Date()

			const updated = yield* Effect.tryPromise({
				try: () =>
					db
						.update(swapTransactions)
						.set(updateData)
						.where(eq(swapTransactions.id, swapId))
						.returning(),
				catch: (e) => new DatabaseError({ message: `Failed to update swap: ${e}`, cause: e }),
			})

			return updated[0] || null
		}),
})
