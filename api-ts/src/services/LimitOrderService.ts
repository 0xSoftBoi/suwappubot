import { and, desc, eq, inArray, isNotNull, lt } from 'drizzle-orm'
import { Context, Effect, Layer, Option } from 'effect'
import { logger } from '../lib/logger'
import {
	type DrizzleService,
	type LimitOrder,
	limitOrders,
	type NewLimitOrder,
	requireDb,
} from '../db'
import { DatabaseError, NotFoundError, ValidationError } from '../errors'

// Li.Fi API for price checking
const LIFI_API_BASE = 'https://li.quest/v1'

export interface CreateLimitOrderParams {
	userId: number
	fromChain: string
	fromToken: string
	fromTokenSymbol: string
	fromAmount: string
	toChain: string
	toToken: string
	toTokenSymbol: string
	targetPrice: number
	triggerType: 'lte' | 'gte' // less than or equal, greater than or equal
	slippage?: number
	walletAddress: string
	expiresAt?: Date
}

export interface LimitOrderWithPrice extends LimitOrder {
	priceDistance?: number // how far from target (percentage)
}

export interface PriceCheckResult {
	orderId: number
	currentPrice: number
	targetPrice: number
	shouldTrigger: boolean
	triggerType: string
}

export interface LimitOrderServiceInterface {
	readonly createOrder: (
		params: CreateLimitOrderParams,
	) => Effect.Effect<LimitOrder, ValidationError | DatabaseError, DrizzleService>

	readonly getUserOrders: (
		userId: number,
		status?: string,
		limit?: number,
		offset?: number,
	) => Effect.Effect<LimitOrder[], DatabaseError, DrizzleService>

	readonly getOrderById: (
		orderId: number,
		userId?: number,
	) => Effect.Effect<Option.Option<LimitOrder>, DatabaseError, DrizzleService>

	readonly cancelOrder: (
		orderId: number,
		userId: number,
	) => Effect.Effect<LimitOrder, NotFoundError | ValidationError | DatabaseError, DrizzleService>

	readonly getActiveOrders: () => Effect.Effect<LimitOrder[], DatabaseError, DrizzleService>

	readonly updateOrderPrice: (
		orderId: number,
		currentPrice: number,
	) => Effect.Effect<LimitOrder | null, DatabaseError, DrizzleService>

	readonly markOrderFilled: (
		orderId: number,
		executedPrice: number,
		txHash: string,
		swapTransactionId?: number,
	) => Effect.Effect<LimitOrder | null, DatabaseError, DrizzleService>

	readonly markOrderFailed: (
		orderId: number,
		errorMessage: string,
	) => Effect.Effect<LimitOrder | null, DatabaseError, DrizzleService>

	readonly expireOrders: () => Effect.Effect<number, DatabaseError, DrizzleService>

	readonly getTokenPrice: (
		chain: string,
		tokenAddress: string,
	) => Effect.Effect<number | null, Error>
}

export class LimitOrderService extends Context.Tag('LimitOrderService')<
	LimitOrderService,
	LimitOrderServiceInterface
>() {}

// Chain ID mapping
const CHAIN_IDS: Record<string, number> = {
	ethereum: 1,
	optimism: 10,
	bsc: 56,
	polygon: 137,
	arbitrum: 42161,
	avalanche: 43114,
	base: 8453,
}

function resolveChainId(chain: string): number {
	return CHAIN_IDS[chain.toLowerCase()] || parseInt(chain, 10)
}

export const LimitOrderServiceLive = Layer.succeed(LimitOrderService, {
	createOrder: (params: CreateLimitOrderParams) =>
		Effect.gen(function* () {
			// Validate
			if (params.targetPrice <= 0) {
				return yield* Effect.fail(
					new ValidationError({
						message: 'Target price must be positive',
						fields: { targetPrice: 'must be positive' },
					}),
				)
			}

			if (!['lte', 'gte'].includes(params.triggerType)) {
				return yield* Effect.fail(
					new ValidationError({
						message: 'Trigger type must be lte or gte',
						fields: { triggerType: 'must be lte or gte' },
					}),
				)
			}

			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

			const newOrder: NewLimitOrder = {
				userId: params.userId,
				fromChain: params.fromChain,
				fromToken: params.fromToken,
				fromTokenSymbol: params.fromTokenSymbol,
				fromAmount: params.fromAmount,
				toChain: params.toChain,
				toToken: params.toToken,
				toTokenSymbol: params.toTokenSymbol,
				targetPrice: params.targetPrice,
				triggerType: params.triggerType,
				slippage: params.slippage ?? 50,
				walletAddress: params.walletAddress,
				expiresAt: params.expiresAt,
				status: 'active',
			}

			const result = yield* Effect.tryPromise({
				try: () => db.insert(limitOrders).values(newOrder).returning(),
				catch: (e) =>
					new DatabaseError({ message: `Failed to create limit order: ${e}`, cause: e }),
			})

			return result[0]
		}),

	getUserOrders: (userId: number, status?: string, limit = 20, offset = 0) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

			const conditions = [eq(limitOrders.userId, userId)]
			if (status) {
				conditions.push(eq(limitOrders.status, status as any))
			}

			const result = yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(limitOrders)
						.where(and(...conditions))
						.orderBy(desc(limitOrders.createdAt))
						.limit(limit)
						.offset(offset),
				catch: (e) => new DatabaseError({ message: `Failed to get orders: ${e}`, cause: e }),
			})

			return result
		}),

	getOrderById: (orderId: number, userId?: number) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

			const conditions = [eq(limitOrders.id, orderId)]
			if (userId !== undefined) {
				conditions.push(eq(limitOrders.userId, userId))
			}

			const result = yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(limitOrders)
						.where(and(...conditions))
						.limit(1),
				catch: (e) => new DatabaseError({ message: `Failed to get order: ${e}`, cause: e }),
			})

			return result.length > 0 ? Option.some(result[0]) : Option.none()
		}),

	cancelOrder: (orderId: number, userId: number) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

			// Get the order first
			const existing = yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(limitOrders)
						.where(and(eq(limitOrders.id, orderId), eq(limitOrders.userId, userId)))
						.limit(1),
				catch: (e) => new DatabaseError({ message: `Failed to get order: ${e}`, cause: e }),
			})

			if (existing.length === 0) {
				return yield* Effect.fail(
					new NotFoundError({ message: 'Order not found', resource: 'limit_order' }),
				)
			}

			if (existing[0].status !== 'active') {
				return yield* Effect.fail(
					new ValidationError({
						message: `Cannot cancel order with status: ${existing[0].status}`,
						fields: { status: 'must be active' },
					}),
				)
			}

			const result = yield* Effect.tryPromise({
				try: () =>
					db
						.update(limitOrders)
						.set({ status: 'cancelled', updatedAt: new Date() })
						.where(eq(limitOrders.id, orderId))
						.returning(),
				catch: (e) => new DatabaseError({ message: `Failed to cancel order: ${e}`, cause: e }),
			})

			return result[0]
		}),

	getActiveOrders: () =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

			const result = yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(limitOrders)
						.where(eq(limitOrders.status, 'active'))
						.orderBy(limitOrders.lastCheckedAt),
				catch: (e) => new DatabaseError({ message: `Failed to get active orders: ${e}`, cause: e }),
			})

			return result
		}),

	updateOrderPrice: (orderId: number, currentPrice: number) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

			const result = yield* Effect.tryPromise({
				try: () =>
					db
						.update(limitOrders)
						.set({
							currentPrice,
							lastCheckedAt: new Date(),
							updatedAt: new Date(),
						})
						.where(eq(limitOrders.id, orderId))
						.returning(),
				catch: (e) => new DatabaseError({ message: `Failed to update price: ${e}`, cause: e }),
			})

			return result[0] || null
		}),

	markOrderFilled: (
		orderId: number,
		executedPrice: number,
		txHash: string,
		swapTransactionId?: number,
	) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

			const result = yield* Effect.tryPromise({
				try: () =>
					db
						.update(limitOrders)
						.set({
							status: 'filled',
							executedAt: new Date(),
							executedPrice,
							executedTxHash: txHash,
							swapTransactionId,
							updatedAt: new Date(),
						})
						.where(eq(limitOrders.id, orderId))
						.returning(),
				catch: (e) => new DatabaseError({ message: `Failed to mark filled: ${e}`, cause: e }),
			})

			return result[0] || null
		}),

	markOrderFailed: (orderId: number, errorMessage: string) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

			// Increment retry count and potentially mark as failed
			const existing = yield* Effect.tryPromise({
				try: () => db.select().from(limitOrders).where(eq(limitOrders.id, orderId)).limit(1),
				catch: (e) => new DatabaseError({ message: `Failed to get order: ${e}`, cause: e }),
			})

			if (existing.length === 0) return null

			const retryCount = (existing[0].retryCount ?? 0) + 1
			const shouldFail = retryCount >= 3 // Mark as failed after 3 retries

			const result = yield* Effect.tryPromise({
				try: () =>
					db
						.update(limitOrders)
						.set({
							status: shouldFail ? 'failed' : 'active',
							errorMessage,
							retryCount,
							updatedAt: new Date(),
						})
						.where(eq(limitOrders.id, orderId))
						.returning(),
				catch: (e) => new DatabaseError({ message: `Failed to mark failed: ${e}`, cause: e }),
			})

			return result[0] || null
		}),

	expireOrders: () =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

			const now = new Date()

			const result = yield* Effect.tryPromise({
				try: async () => {
					// Find and update expired orders
					const expired = await db
						.update(limitOrders)
						.set({ status: 'expired', updatedAt: now })
						.where(
							and(
								eq(limitOrders.status, 'active'),
								isNotNull(limitOrders.expiresAt),
								lt(limitOrders.expiresAt, now),
							),
						)
						.returning()
					return expired.length
				},
				catch: (e) => new DatabaseError({ message: `Failed to expire orders: ${e}`, cause: e }),
			})

			return result
		}),

	getTokenPrice: (chain: string, tokenAddress: string) =>
		Effect.gen(function* () {
			const chainId = resolveChainId(chain)
			const url = `${LIFI_API_BASE}/token?chain=${chainId}&token=${tokenAddress}`

			const response = yield* Effect.tryPromise({
				try: () => fetch(url),
				catch: (e) => new Error(`Failed to fetch token: ${e}`),
			})

			if (!response.ok) {
				logger.warn(
					`[LimitOrderService] Failed to get price for ${tokenAddress}: ${response.status}`,
				)
				return null
			}

			const data = yield* Effect.tryPromise({
				try: () => response.json() as Promise<{ priceUSD?: string }>,
				catch: (e) => new Error(`Failed to parse response: ${e}`),
			})

			if (!data.priceUSD) return null

			return parseFloat(data.priceUSD)
		}),
})
