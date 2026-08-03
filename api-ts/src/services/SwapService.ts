import { and, desc, eq, notInArray } from 'drizzle-orm'
import { Context, Effect, Exit, Fiber, Layer, Option } from 'effect'
import { logger } from '../lib/logger'
import { captureQuoteRoutes, shouldCapture } from '../lib/routeCapture'
import {
	type DrizzleService,
	type NewSwapTransaction,
	requireDb,
	requireRow,
	type SwapTransaction,
	swapTransactions,
} from '../db'
import { DatabaseError, ValidationError } from '../errors'
import { getTransactionReceipt } from '../config/chains'
import { AGENT_FEE_FRACTION_EVM, DEFAULT_FEE_WALLET_EVM } from '../config/constants'

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
		logoURI?: string | undefined
	}
	toToken: {
		address: string
		symbol: string
		decimals: number
		logoURI?: string | undefined
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
	fromAmountUsd: string
	toAmountUsd: string
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
		offset?: number,
	) => Effect.Effect<SwapTransaction[], DatabaseError, DrizzleService>

	readonly getQuote: (params: QuoteParams) => Effect.Effect<SwapQuote, ValidationError | Error>

	readonly createSwapRecord: (
		swap: NewSwapTransaction,
	) => Effect.Effect<SwapTransaction, DatabaseError, DrizzleService>

	readonly updateSwapStatus: (
		swapId: number,
		status: string,
		txHash?: string,
		errorMessage?: string,
	) => Effect.Effect<SwapTransaction | null, DatabaseError, DrizzleService>

	readonly getSwapById: (
		swapId: number,
	) => Effect.Effect<SwapTransaction | null, DatabaseError, DrizzleService>

	readonly checkAndUpdateSwapStatus: (
		swapId: number
	) => Effect.Effect<SwapTransaction | null, DatabaseError, DrizzleService>
}

export class SwapService extends Context.Tag('SwapService')<SwapService, SwapServiceInterface>() {}

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
	ftm: 250,
	linea: 59144,
	mantle: 5000,
	mnt: 5000,
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

// ---------------------------------------------------------------------------
// Multi-provider quote racing (comparison-only)
//
// The webapp quote path historically only ever called Li.Fi, while the
// Telegram bot races 5+ aggregators (Li.Fi, 1inch, 0x, KyberSwap, OKX, CoW).
// This adds KyberSwap as a second SAME-CHAIN EVM data point so we can see how
// much routing quality the webapp is leaving on the table.
//
// IMPORTANT — comparison-only, not selectable: SwapQuote._rawQuote and
// transactionRequest are consumed downstream by webapp/execute AND by
// agent.ts / mcp.ts / publicSwap.ts, all of which reach directly into
// Li.Fi-specific shapes (`_rawQuote.estimate.approvalAddress`,
// `_rawQuote.action.toAddress`, `_rawQuote.action.*.priceUSD`). Making the
// KyberSwap quote executable would mean re-deriving all of those fields (and
// updating every one of those call sites) for a shape KyberSwap doesn't
// return the same way — a much larger, higher-risk change than this task's
// budget. KyberSwap is therefore raced for comparison/telemetry ONLY: it can
// never win execution. See SwapService.getQuote for the race + log line.
// ---------------------------------------------------------------------------

const KYBERSWAP_API_BASE = 'https://aggregator-api.kyberswap.com'

// KyberSwap native-token sentinel (differs from Li.Fi's all-zero address).
const KYBERSWAP_NATIVE_TOKEN = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

// Chain ID -> KyberSwap URL slug. Only chains KyberSwap's aggregator covers.
const KYBERSWAP_CHAIN_SLUGS: Record<number, string> = {
	1: 'ethereum',
	10: 'optimism',
	56: 'bsc',
	137: 'polygon',
	8453: 'base',
	42161: 'arbitrum',
	43114: 'avalanche',
	250: 'fantom',
	59144: 'linea',
	5000: 'mantle',
	534352: 'scroll',
	324: 'zksync',
}

function toKyberToken(address: string): string {
	return address.toLowerCase() === NATIVE_TOKEN ? KYBERSWAP_NATIVE_TOKEN : address
}

interface KyberComparisonQuote {
	provider: 'kyberswap'
	toAmount: string
	toAmountUsd: number | null
	gasUsd: number | null
}

interface KyberRoutesResponse {
	code?: number
	message?: string
	data?: {
		routeSummary?: {
			amountOut?: string
			amountOutUsd?: string
			gasUsd?: string
		}
	}
}

/**
 * Fetch a KyberSwap Aggregator quote for comparison/telemetry only (GET
 * /routes — price discovery, no tx calldata). Deliberately does NOT call
 * /route/build: since this quote is never executed, paying for the build
 * step would be wasted KyberSwap API budget.
 *
 * Carries the SAME platform fee KyberSwap-side (feeAmount/isInBps/
 * chargeFeeBy/feeReceiver) as we'd charge if we ever did execute through it,
 * so the comparison is fee-inclusive and honest — never a fee-free quote
 * artificially beating Li.Fi's fee-inclusive one.
 */
function fetchKyberComparisonQuote(
	params: QuoteParams,
	feeBps: number,
	feeReceiver: string,
): Effect.Effect<KyberComparisonQuote, Error> {
	const chainId = resolveChainId(params.fromChain)
	const slug = KYBERSWAP_CHAIN_SLUGS[chainId]
	if (!slug) {
		return Effect.fail(new Error(`KyberSwap: unsupported chain ${chainId}`))
	}

	const qp = new URLSearchParams({
		tokenIn: toKyberToken(params.fromToken),
		tokenOut: toKyberToken(params.toToken),
		amountIn: params.fromAmount,
		feeAmount: String(feeBps),
		isInBps: 'true',
		chargeFeeBy: 'currency_in',
		feeReceiver,
	})

	return Effect.tryPromise({
		try: async () => {
			const res = await fetch(`${KYBERSWAP_API_BASE}/${slug}/api/v1/routes?${qp.toString()}`, {
				headers: {
					Accept: 'application/json',
					'x-client-id': 'SuwappuProduction',
				},
			})
			const data = (await res.json()) as KyberRoutesResponse
			if (!res.ok || (data.code !== undefined && data.code !== 0)) {
				throw new Error(`KyberSwap error: ${data.message || res.statusText}`)
			}
			const summary = data.data?.routeSummary
			if (!summary?.amountOut || summary.amountOut === '0') {
				throw new Error('KyberSwap: empty route')
			}
			return {
				provider: 'kyberswap' as const,
				toAmount: summary.amountOut,
				toAmountUsd: summary.amountOutUsd ? parseFloat(summary.amountOutUsd) : null,
				gasUsd: summary.gasUsd ? parseFloat(summary.gasUsd) : null,
			}
		},
		catch: (e) => new Error(`KyberSwap comparison fetch failed: ${e}`),
	})
}

export const SwapServiceLive = Layer.succeed(SwapService, {
	getUserSwaps: (userId: number, limit = 20, offset = 0) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
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
				return yield* Effect.fail(
					new ValidationError({
						message: 'fromChain and toChain are required',
						fields: { fromChain: 'required', toChain: 'required' },
					}),
				)
			}
			if (!params.fromToken || !params.toToken) {
				return yield* Effect.fail(
					new ValidationError({
						message: 'fromToken and toToken are required',
						fields: { fromToken: 'required', toToken: 'required' },
					}),
				)
			}
			if (!params.fromAmount || params.fromAmount === '0') {
				return yield* Effect.fail(
					new ValidationError({
						message: 'fromAmount must be greater than 0',
						fields: { fromAmount: 'must be greater than 0' },
					}),
				)
			}
			if (!params.fromAddress) {
				return yield* Effect.fail(
					new ValidationError({
						message: 'fromAddress is required',
						fields: { fromAddress: 'required' },
					}),
				)
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
				integrator: process.env.LIFI_INTEGRATOR_ID || 'SuwappuProduction',
				referrer: process.env.FEE_WALLET_EVM || DEFAULT_FEE_WALLET_EVM,
				// EVM agent integrator fee (0.8%). Single source: AGENT_FEE_FRACTION_EVM
				// in config/constants — see that constant for the known EVM↔Solana
				// agent-fee divergence and why it is intentionally not unified here.
				fee: AGENT_FEE_FRACTION_EVM,
			})

			const url = `${LIFI_API_BASE}/quote?${queryParams.toString()}`

			logger.info('[SwapService] Fetching quote: %s', url)

			// Li.Fi is the ONLY provider that can be executed today (see the
			// comparison-only note above SwapServiceLive) — its failure fails the
			// whole quote, unchanged from prior behavior.
			const lifiEffect = Effect.tryPromise({
				try: async () => {
					const res = await fetch(url, {
						method: 'GET',
						headers: {
							Accept: 'application/json',
							// Add API key if configured
							...(process.env.LIFI_API_KEY && {
								'x-lifi-api-key': process.env.LIFI_API_KEY,
							}),
						},
					})

					if (!res.ok) {
						const errorData = (await res
							.json()
							.catch(() => ({ message: res.statusText }))) as LifiApiError
						throw new Error(`Li.Fi API error: ${errorData.message || res.statusText}`)
					}

					return (await res.json()) as LifiQuote
				},
				catch: (e) => new Error(`Failed to fetch quote: ${e}`),
			})

			// Race a KyberSwap quote alongside Li.Fi for SAME-CHAIN EVM swaps, purely
			// for comparison/telemetry (see the block above SwapServiceLive for why
			// it can't be selected for execution yet). Kill switch:
			// KYBERSWAP_COMPARISON_ENABLED=false disables without a redeploy.
			// Bounded to ~3.5s (3s race + short grace) via Effect.timeout, and
			// Effect.option swallows both provider errors and the timeout into
			// `None` — but crucially this is FORKED, not awaited: the user's quote
			// must never wait on KyberSwap. We `Fiber.poll` (non-blocking) it later,
			// once Li.Fi's own response is in hand, and simply skip the comparison
			// log if KyberSwap hasn't resolved by then. Zero added latency to the
			// user path, whether KyberSwap answers in 200ms or hangs for 10s.
			const fromChainId = resolveChainId(params.fromChain)
			const toChainId = resolveChainId(params.toChain)
			const kyberComparisonEnabled =
				(process.env.KYBERSWAP_COMPARISON_ENABLED ?? 'true').toLowerCase() !== 'false' &&
				fromChainId === toChainId &&
				KYBERSWAP_CHAIN_SLUGS[fromChainId] !== undefined

			const feeBpsEvm = Math.round(parseFloat(AGENT_FEE_FRACTION_EVM) * 10000)
			const feeReceiverEvm = process.env.FEE_WALLET_EVM || DEFAULT_FEE_WALLET_EVM

			const kyberEffect: Effect.Effect<Option.Option<KyberComparisonQuote>, never> =
				kyberComparisonEnabled
					? fetchKyberComparisonQuote(params, feeBpsEvm, feeReceiverEvm).pipe(
							Effect.timeout(3500),
							Effect.option,
						)
					: Effect.succeed(Option.none())

			// Fork — do NOT await. The fiber runs in the background while we await
			// Li.Fi below; we only ever check on it non-blockingly via Fiber.poll.
			const kyberFiber = yield* Effect.fork(kyberEffect)

			const response = yield* lifiEffect

			// Calculate derived values
			const fromAmountNum =
				parseFloat(response.action.fromAmount) / 10 ** response.action.fromToken.decimals
			const toAmountNum =
				parseFloat(response.estimate.toAmount) / 10 ** response.action.toToken.decimals
			const exchangeRate = toAmountNum / fromAmountNum

			// Calculate total gas in USD
			const gasUsd = response.estimate.gasCosts.reduce(
				(sum, g) => sum + parseFloat(g.amountUSD || '0'),
				0,
			)

			// Calculate bridge fees
			const bridgeFeeUsd = response.estimate.feeCosts.reduce(
				(sum, f) => sum + parseFloat(f.amountUSD || '0'),
				0,
			)

			// Calculate price impact (simplified)
			const fromUsd = parseFloat(response.action.fromToken.priceUSD || '0') * fromAmountNum
			const toUsd = parseFloat(response.action.toToken.priceUSD || '0') * toAmountNum
			const priceImpact = fromUsd > 0 ? ((fromUsd - toUsd) / fromUsd) * 100 : 0

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
				fromAmountUsd: fromUsd.toFixed(2),
				toAmountUsd: toUsd.toFixed(2),
				route,
				transactionRequest: response.transactionRequest,
				_rawQuote: response,
			}

			// Multi-provider race comparison line (mirrors the Python bot's
			// route_comparison telemetry). Always executes Li.Fi (`executed=lifi`);
			// `would_win` records which provider had the better fee-inclusive net
			// output, for later evaluation of whether KyberSwap execution support
			// is worth building.
			//
			// Fiber.poll is NON-BLOCKING — it returns immediately with None if the
			// forked KyberSwap fetch hasn't completed yet, rather than waiting on
			// it. Li.Fi has already resolved by this point, so this adds ~0ms: a
			// fast KyberSwap response (typically the case) is captured; a slow one
			// is simply skipped for this quote, never delaying the response.
			const kyberPolled = yield* Fiber.poll(kyberFiber)
			const kyberResultOption: Option.Option<KyberComparisonQuote> = Option.isSome(kyberPolled)
				? Exit.isSuccess(kyberPolled.value)
					? kyberPolled.value.value
					: Option.none()
				: Option.none()

			if (Option.isSome(kyberResultOption)) {
				const kyber = kyberResultOption.value
				const lifiToAmountBig = BigInt(response.estimate.toAmount || '0')
				const kyberToAmountBig = BigInt(kyber.toAmount || '0')

				const lifiNet = toUsd - gasUsd
				const kyberNet =
					kyber.toAmountUsd !== null && kyber.gasUsd !== null ? kyber.toAmountUsd - kyber.gasUsd : null
				const canCompareNet = kyberNet !== null && toUsd > 0

				const deltaBps =
					lifiToAmountBig > 0n
						? Number(((kyberToAmountBig - lifiToAmountBig) * 10000n) / lifiToAmountBig)
						: 0

				const wouldWin: 'lifi' | 'kyberswap' = canCompareNet
					? (kyberNet as number) > lifiNet
						? 'kyberswap'
						: 'lifi'
					: kyberToAmountBig > lifiToAmountBig
						? 'kyberswap'
						: 'lifi'

				logger.info(
					'[SwapService] route_race executed=lifi would_win=%s from=%s to=%s lifi_out=%s lifi_out_usd=%s kyber_out=%s kyber_out_usd=%s delta_bps=%d net_compared=%s',
					wouldWin,
					quote.fromToken.symbol,
					quote.toToken.symbol,
					response.estimate.toAmount,
					toUsd.toFixed(2),
					kyber.toAmount,
					kyber.toAmountUsd?.toFixed(2) ?? 'n/a',
					deltaBps,
					canCompareNet,
				)
			}

			// EXECUTION INTELLIGENCE — fire-and-forget counterfactual capture.
			//
			// `/quote` gives us the single route we are about to offer; the
			// alternatives it beat are never returned, so without this the
			// counterfactual is lost the moment we respond. Mirrors a sampled
			// share of quotes to `/advanced/routes` and records the options.
			//
			// Deliberately NOT awaited: this must add zero latency to the user's
			// quote and can never fail it. Errors are swallowed inside
			// captureQuoteRoutes(). See lib/routeCapture.ts for the sampling and
			// rate-limit guards that keep it off the user's LI.FI budget.
			if (shouldCapture()) {
				void captureQuoteRoutes({
					quoteId: quote.quoteId,
					fromChain: quote.fromChain,
					toChain: quote.toChain,
					fromTokenAddress: params.fromToken,
					toTokenAddress: params.toToken,
					fromTokenSymbol: quote.fromToken.symbol,
					toTokenSymbol: quote.toToken.symbol,
					fromAmount: quote.fromAmount,
					fromAmountUsd: parseFloat(quote.fromAmountUsd) || null,
					fromAddress: params.fromAddress,
					selectedTool: response.toolDetails?.name ?? response.tool ?? null,
				})
			}

			return quote
		}),

	createSwapRecord: (swap: NewSwapTransaction) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

			// Idempotency: if a non-terminal record with this key already exists, return it
			if (swap.idempotencyKey) {
				const existing = yield* Effect.tryPromise({
					try: () =>
						db
							.select()
							.from(swapTransactions)
							.where(
								and(
									eq(swapTransactions.idempotencyKey, swap.idempotencyKey!),
									notInArray(swapTransactions.status, ['failed', 'cancelled']),
								),
							)
							.limit(1),
					catch: (e) =>
						new DatabaseError({ message: `Idempotency check failed: ${e}`, cause: e }),
				})
				const existingRecord = existing[0]
				if (existingRecord) return existingRecord
			}

			const result = yield* Effect.tryPromise({
				try: () => db.insert(swapTransactions).values(swap).returning(),
				catch: (e) =>
					new DatabaseError({ message: `Failed to create swap record: ${e}`, cause: e }),
			})

			return yield* requireRow(result, 'Failed to create swap record: no row returned')
		}),

	updateSwapStatus: (swapId: number, status: string, txHash?: string, errorMessage?: string) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
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
				catch: (e) =>
					new DatabaseError({ message: `Failed to update swap status: ${e}`, cause: e }),
			})

			return result[0] || null
		}),

	getSwapById: (swapId: number) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

			const result = yield* Effect.tryPromise({
				try: () =>
					db.select().from(swapTransactions).where(eq(swapTransactions.id, swapId)).limit(1),
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

			if (!receipt) return swap // Still pending

			const newStatus = receipt.status === 'completed' ? 'completed' : 'failed'
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
