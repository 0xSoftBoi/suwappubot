import { and, desc, eq, inArray, lte } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'
import {
	type DCAExecution as DbDCAExecution,
	dcaExecutions,
	dcaOrders,
	type DrizzleService,
	type DCAOrder as DbDCAOrder,
	type NewDCAExecution,
	type NewDCAOrder,
	requireDb,
} from '../db'
import { DatabaseError, NotFoundError, ValidationError } from '../errors'

export interface CreateDCAOrderParams {
	userId: number
	fromChain: string
	fromToken: string
	fromTokenSymbol: string
	toChain: string
	toToken: string
	toTokenSymbol: string
	amountPerExecution: string
	frequency: 'hourly' | 'daily' | 'weekly' | 'monthly'
	totalExecutions?: number
	walletAddress: string
	slippage?: number
}

export interface DCAOrder {
	id: number
	userId: number
	fromChain: string
	fromToken: string
	fromTokenSymbol: string
	toChain: string
	toToken: string
	toTokenSymbol: string
	amountPerExecution: string
	interval: 'hourly' | 'daily' | 'weekly'
	totalExecutions: number | null
	executionsCompleted: number
	maxSlippage: number
	walletAddress: string
	status: string
	nextExecutionAt: Date
	lastExecutedAt: Date | null
	createdAt: Date
	updatedAt: Date | null
}

export interface DCAExecution {
	id: number
	orderId: number
	executedAt: Date
	txHash?: string
}

export interface DCAStats {
	totalOrders: number
	activeOrders: number
	totalExecutions: number
	totalVolumeUsd: number
}

export interface DCAServiceInterface {
	readonly createOrder: (params: CreateDCAOrderParams) => Effect.Effect<DCAOrder, Error>

	readonly getUserOrders: (
		userId: number,
		status?: string,
		limit?: number,
		offset?: number,
	) => Effect.Effect<DCAOrder[], Error>

	readonly pauseOrder: (orderId: number, userId: number) => Effect.Effect<DCAOrder, Error>

	readonly resumeOrder: (orderId: number, userId: number) => Effect.Effect<DCAOrder, Error>

	readonly cancelOrder: (orderId: number, userId: number) => Effect.Effect<DCAOrder, Error>

	readonly getExecutions: (orderId: number, userId: number) => Effect.Effect<DCAExecution[], Error>

	readonly getStats: (userId: number) => Effect.Effect<DCAStats, Error>

	readonly getDueOrders: () => Effect.Effect<DbDCAOrder[], Error>

	readonly recordExecution: (
		orderId: number,
		amountSpent: string,
		amountReceived: string,
		price: number,
		txHash?: string,
	) => Effect.Effect<DbDCAOrder, Error>

	readonly markFailed: (orderId: number, message: string) => Effect.Effect<DbDCAOrder | null, Error>
}

export class DCAService extends Context.Tag('DCAService')<DCAService, DCAServiceInterface>() {}

const SUPPORTED_FREQUENCIES = ['hourly', 'daily', 'weekly'] as const

function computeNextExecution(interval: CreateDCAOrderParams['frequency'], from = new Date()): Date {
	const next = new Date(from)
	if (interval === 'hourly') {
		next.setHours(next.getHours() + 1)
		return next
	}
	if (interval === 'daily') {
		next.setDate(next.getDate() + 1)
		return next
	}
	next.setDate(next.getDate() + 7)
	return next
}

function ensureSupportedFrequency(interval: CreateDCAOrderParams['frequency']) {
	if (!SUPPORTED_FREQUENCIES.includes(interval as (typeof SUPPORTED_FREQUENCIES)[number])) {
		return Effect.fail(
			new ValidationError({
				message: 'DCA frequency must be hourly, daily, or weekly',
				fields: { frequency: 'unsupported interval' },
			}),
		)
	}
	return Effect.void
}

function mapOrder(order: DbDCAOrder): DCAOrder {
	return {
		id: order.id,
		userId: order.userId,
		fromChain: order.fromChain,
		fromToken: order.fromToken,
		fromTokenSymbol: order.fromTokenSymbol,
		toChain: order.toChain,
		toToken: order.toToken,
		toTokenSymbol: order.toTokenSymbol,
		amountPerExecution: order.amountPerExecution,
		interval: order.interval,
		totalExecutions: order.totalExecutions ?? null,
		executionsCompleted: order.executionsCompleted ?? 0,
		maxSlippage: order.maxSlippage ?? 50,
		walletAddress: order.walletAddress,
		status: order.status ?? 'active',
		nextExecutionAt: order.nextExecutionAt,
		lastExecutedAt: order.lastExecutedAt ?? null,
		createdAt: order.createdAt ?? new Date(),
		updatedAt: order.updatedAt ?? null,
	}
}

function mapExecution(execution: DbDCAExecution): DCAExecution {
	return {
		id: execution.id,
		orderId: execution.dcaOrderId,
		executedAt: execution.executedAt ?? new Date(),
		txHash: execution.txHash ?? undefined,
	}
}

function loadOwnedOrder(orderId: number, userId: number) {
	return Effect.gen(function* () {
		const db = yield* requireDb.pipe(
			Effect.mapError((e) => new DatabaseError({ message: e.message })),
		)

		const result = yield* Effect.tryPromise({
			try: () =>
				db
					.select()
					.from(dcaOrders)
					.where(and(eq(dcaOrders.id, orderId), eq(dcaOrders.userId, userId)))
					.limit(1),
			catch: (e) => new DatabaseError({ message: `Failed to load DCA order: ${e}`, cause: e }),
		})

		if (result.length === 0) {
			return yield* Effect.fail(
				new NotFoundError({ message: 'DCA order not found', resource: 'dca_order' }),
			)
		}

		return { db, order: result[0] }
	})
}

export const DCAServiceLive = Layer.succeed(DCAService, {
	createOrder: (params: CreateDCAOrderParams) =>
		Effect.gen(function* () {
			yield* ensureSupportedFrequency(params.frequency)

			const amount = Number(params.amountPerExecution)
			if (!Number.isFinite(amount) || amount <= 0) {
				return yield* Effect.fail(
					new ValidationError({
						message: 'Amount per execution must be positive',
						fields: { amountPerExecution: 'must be a positive number string' },
					}),
				)
			}

			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

			const newOrder: NewDCAOrder = {
				userId: params.userId,
				fromChain: params.fromChain,
				fromToken: params.fromToken,
				fromTokenSymbol: params.fromTokenSymbol,
				toChain: params.toChain,
				toToken: params.toToken,
				toTokenSymbol: params.toTokenSymbol,
				amountPerExecution: params.amountPerExecution,
				interval: params.frequency as 'hourly' | 'daily' | 'weekly',
				totalExecutions: params.totalExecutions,
				maxSlippage: Math.round((params.slippage ?? 0.5) * 100),
				walletAddress: params.walletAddress,
				status: 'active',
				nextExecutionAt: computeNextExecution(params.frequency),
			}

			const result = yield* Effect.tryPromise({
				try: () => db.insert(dcaOrders).values(newOrder).returning(),
				catch: (e) => new DatabaseError({ message: `Failed to create DCA order: ${e}`, cause: e }),
			})

			return mapOrder(result[0])
		}),

	getUserOrders: (userId: number, status?: string, limit = 20, offset = 0) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

			const conditions = [eq(dcaOrders.userId, userId)]
			if (status) {
				conditions.push(eq(dcaOrders.status, status as any))
			}

			const result = yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(dcaOrders)
						.where(and(...conditions))
						.orderBy(desc(dcaOrders.createdAt))
						.limit(limit)
						.offset(offset),
				catch: (e) => new DatabaseError({ message: `Failed to fetch DCA orders: ${e}`, cause: e }),
			})

			return result.map(mapOrder)
		}),

	pauseOrder: (orderId: number, userId: number) =>
		Effect.gen(function* () {
			const { db, order } = yield* loadOwnedOrder(orderId, userId)
			if (order.status !== 'active') {
				return yield* Effect.fail(
					new ValidationError({
						message: `Cannot pause order with status: ${order.status}`,
						fields: { status: 'must be active' },
					}),
				)
			}

			const result = yield* Effect.tryPromise({
				try: () =>
					db
						.update(dcaOrders)
						.set({ status: 'paused', updatedAt: new Date() })
						.where(eq(dcaOrders.id, orderId))
						.returning(),
				catch: (e) => new DatabaseError({ message: `Failed to pause DCA order: ${e}`, cause: e }),
			})

			return mapOrder(result[0])
		}),

	resumeOrder: (orderId: number, userId: number) =>
		Effect.gen(function* () {
			const { db, order } = yield* loadOwnedOrder(orderId, userId)
			if (order.status !== 'paused') {
				return yield* Effect.fail(
					new ValidationError({
						message: `Cannot resume order with status: ${order.status}`,
						fields: { status: 'must be paused' },
					}),
				)
			}

			const result = yield* Effect.tryPromise({
				try: () =>
					db
						.update(dcaOrders)
						.set({
							status: 'active',
							nextExecutionAt: computeNextExecution(order.interval),
							updatedAt: new Date(),
						})
						.where(eq(dcaOrders.id, orderId))
						.returning(),
				catch: (e) => new DatabaseError({ message: `Failed to resume DCA order: ${e}`, cause: e }),
			})

			return mapOrder(result[0])
		}),

	cancelOrder: (orderId: number, userId: number) =>
		Effect.gen(function* () {
			const { db, order } = yield* loadOwnedOrder(orderId, userId)
			if (order.status === 'cancelled' || order.status === 'completed') {
				return yield* Effect.fail(
					new ValidationError({
						message: `Cannot cancel order with status: ${order.status}`,
						fields: { status: 'already terminal' },
					}),
				)
			}

			const result = yield* Effect.tryPromise({
				try: () =>
					db
						.update(dcaOrders)
						.set({ status: 'cancelled', updatedAt: new Date() })
						.where(eq(dcaOrders.id, orderId))
						.returning(),
				catch: (e) => new DatabaseError({ message: `Failed to cancel DCA order: ${e}`, cause: e }),
			})

			return mapOrder(result[0])
		}),

	getExecutions: (orderId: number, userId: number) =>
		Effect.gen(function* () {
			yield* loadOwnedOrder(orderId, userId)
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

			const result = yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(dcaExecutions)
						.where(eq(dcaExecutions.dcaOrderId, orderId))
						.orderBy(desc(dcaExecutions.executedAt)),
				catch: (e) =>
					new DatabaseError({ message: `Failed to fetch DCA executions: ${e}`, cause: e }),
			})

			return result.map(mapExecution)
		}),

	getStats: (userId: number) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

			const orders = yield* Effect.tryPromise({
				try: () => db.select().from(dcaOrders).where(eq(dcaOrders.userId, userId)),
				catch: (e) => new DatabaseError({ message: `Failed to fetch DCA stats: ${e}`, cause: e }),
			})

			const userOrderIds = orders.map((order) => order.id)
			const executions =
				userOrderIds.length === 0
					? []
					: yield* Effect.tryPromise({
							try: () =>
								db
									.select()
									.from(dcaExecutions)
									.where(inArray(dcaExecutions.dcaOrderId, userOrderIds)),
							catch: (e) =>
								new DatabaseError({
									message: `Failed to fetch DCA execution stats: ${e}`,
									cause: e,
								}),
					  })

			return {
				totalOrders: orders.length,
				activeOrders: orders.filter((order) => order.status === 'active').length,
				totalExecutions: executions.length,
				totalVolumeUsd: executions.reduce((sum, execution) => sum + Number(execution.amountSpent || 0), 0),
			}
		}),

	getDueOrders: () =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

			return yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(dcaOrders)
						.where(and(eq(dcaOrders.status, 'active'), lte(dcaOrders.nextExecutionAt, new Date())))
						.orderBy(dcaOrders.nextExecutionAt),
				catch: (e) => new DatabaseError({ message: `Failed to fetch due DCA orders: ${e}`, cause: e }),
			})
		}),

	recordExecution: (orderId: number, amountSpent: string, amountReceived: string, price: number, txHash?: string) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

			const existing = yield* Effect.tryPromise({
				try: () => db.select().from(dcaOrders).where(eq(dcaOrders.id, orderId)).limit(1),
				catch: (e) => new DatabaseError({ message: `Failed to load DCA order: ${e}`, cause: e }),
			})

			if (existing.length === 0) {
				return yield* Effect.fail(
					new NotFoundError({ message: 'DCA order not found', resource: 'dca_order' }),
				)
			}

			const order = existing[0]

			const execution: NewDCAExecution = {
				dcaOrderId: orderId,
				amountSpent,
				amountReceived,
				price,
				txHash,
			}

			yield* Effect.tryPromise({
				try: () => db.insert(dcaExecutions).values(execution),
				catch: (e) => new DatabaseError({ message: `Failed to record DCA execution: ${e}`, cause: e }),
			})

			const executionsCompleted = (order.executionsCompleted ?? 0) + 1
			const reachedLimit =
				order.totalExecutions != null && executionsCompleted >= order.totalExecutions

			const result = yield* Effect.tryPromise({
				try: () =>
					db
						.update(dcaOrders)
						.set({
							executionsCompleted,
							lastExecutedAt: new Date(),
							nextExecutionAt: computeNextExecution(order.interval),
							status: reachedLimit ? 'completed' : 'active',
							updatedAt: new Date(),
						})
						.where(eq(dcaOrders.id, orderId))
						.returning(),
				catch: (e) => new DatabaseError({ message: `Failed to update DCA order: ${e}`, cause: e }),
			})

			return result[0]
		}),

	markFailed: (orderId: number, _message: string) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

			const result = yield* Effect.tryPromise({
				try: () =>
					db
						.update(dcaOrders)
						.set({ status: 'failed', updatedAt: new Date() })
						.where(eq(dcaOrders.id, orderId))
						.returning(),
				catch: (e) => new DatabaseError({ message: `Failed to mark DCA order failed: ${e}`, cause: e }),
			})

			return result[0] ?? null
		}),
})
