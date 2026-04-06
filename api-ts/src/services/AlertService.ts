import { and, desc, eq } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'
import {
	type DrizzleService,
	type NewPriceAlert,
	priceAlerts,
	type PriceAlert,
	requireDb,
} from '../db'
import { DatabaseError, NotFoundError, ValidationError } from '../errors'
import { fetchTokenPrices } from '../lib/prices'

export interface CreateAlertParams {
	userId: number
	alertType: 'price' | 'volume' | 'whale' | 'listing'
	chain: string
	tokenAddress: string
	tokenSymbol: string
	condition: string
	threshold: number
}

export interface Alert {
	id: number
	userId: number
	tokenAddress: string
	tokenSymbol: string
	chain: string
	alertType: string
	condition: string
	threshold: number
	triggeredAt: Date | null
	active: boolean
	triggered: boolean
	createdAt: Date
	updatedAt: Date | null
}

export interface AlertServiceInterface {
	readonly getUserAlerts: (userId: number, activeOnly?: boolean) => Effect.Effect<Alert[], Error>

	readonly createAlert: (params: CreateAlertParams) => Effect.Effect<Alert, Error>

	readonly toggleAlert: (alertId: number, userId: number) => Effect.Effect<Alert, Error>

	readonly deleteAlert: (alertId: number, userId: number) => Effect.Effect<void, Error>

	readonly getActiveAlerts: () => Effect.Effect<PriceAlert[], Error>

	readonly getTokenPrice: (tokenSymbol: string) => Effect.Effect<number | null, Error>

	readonly markTriggered: (alertId: number) => Effect.Effect<PriceAlert | null, Error>
}

export class AlertService extends Context.Tag('AlertService')<
	AlertService,
	AlertServiceInterface
>() {}

function mapAlert(alert: PriceAlert): Alert {
	return {
		id: alert.id,
		userId: alert.userId,
		tokenAddress: alert.tokenAddress,
		tokenSymbol: alert.tokenSymbol,
		chain: alert.chain,
		alertType: 'price',
		condition: alert.condition,
		threshold: alert.targetPrice,
		triggeredAt: alert.triggeredAt ?? null,
		active: alert.isActive ?? false,
		triggered: alert.isTriggered ?? false,
		createdAt: alert.createdAt ?? new Date(),
		updatedAt: alert.updatedAt ?? null,
	}
}

export const AlertServiceLive = Layer.succeed(AlertService, {
	getUserAlerts: (userId: number, activeOnly = false) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

			const conditions = [eq(priceAlerts.userId, userId)]
			if (activeOnly) {
				conditions.push(eq(priceAlerts.isActive, true))
			}

			const result = yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(priceAlerts)
						.where(and(...conditions))
						.orderBy(desc(priceAlerts.createdAt)),
				catch: (e) => new DatabaseError({ message: `Failed to fetch alerts: ${e}`, cause: e }),
			})

			return result.map(mapAlert)
		}),

	createAlert: (params: CreateAlertParams) =>
		Effect.gen(function* () {
			if (params.alertType !== 'price') {
				return yield* Effect.fail(
					new ValidationError({
						message: 'Only price alerts are currently supported',
						fields: { alertType: 'must be price' },
					}),
				)
			}

			if (!['above', 'below'].includes(params.condition)) {
				return yield* Effect.fail(
					new ValidationError({
						message: 'Price alert condition must be above or below',
						fields: { condition: 'must be above or below' },
					}),
				)
			}

			if (!Number.isFinite(params.threshold) || params.threshold <= 0) {
				return yield* Effect.fail(
					new ValidationError({
						message: 'Alert threshold must be positive',
						fields: { threshold: 'must be positive' },
					}),
				)
			}

			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

			const newAlert: NewPriceAlert = {
				userId: params.userId,
				tokenAddress: params.tokenAddress,
				tokenSymbol: params.tokenSymbol,
				chain: params.chain,
				targetPrice: params.threshold,
				condition: params.condition,
				isActive: true,
				isTriggered: false,
			}

			const result = yield* Effect.tryPromise({
				try: () => db.insert(priceAlerts).values(newAlert).returning(),
				catch: (e) => new DatabaseError({ message: `Failed to create price alert: ${e}`, cause: e }),
			})

			return mapAlert(result[0])
		}),

	toggleAlert: (alertId: number, userId: number) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

			const existing = yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(priceAlerts)
						.where(and(eq(priceAlerts.id, alertId), eq(priceAlerts.userId, userId)))
						.limit(1),
				catch: (e) => new DatabaseError({ message: `Failed to load alert: ${e}`, cause: e }),
			})

			if (existing.length === 0) {
				return yield* Effect.fail(
					new NotFoundError({ message: 'Alert not found', resource: 'price_alert' }),
				)
			}

			const result = yield* Effect.tryPromise({
				try: () =>
					db
						.update(priceAlerts)
						.set({
							isActive: !existing[0].isActive,
							updatedAt: new Date(),
						})
						.where(eq(priceAlerts.id, alertId))
						.returning(),
				catch: (e) => new DatabaseError({ message: `Failed to toggle alert: ${e}`, cause: e }),
			})

			return mapAlert(result[0])
		}),

	deleteAlert: (alertId: number, userId: number) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

			const deleted = yield* Effect.tryPromise({
				try: () =>
					db
						.delete(priceAlerts)
						.where(and(eq(priceAlerts.id, alertId), eq(priceAlerts.userId, userId)))
						.returning(),
				catch: (e) => new DatabaseError({ message: `Failed to delete alert: ${e}`, cause: e }),
			})

			if (deleted.length === 0) {
				return yield* Effect.fail(
					new NotFoundError({ message: 'Alert not found', resource: 'price_alert' }),
				)
			}
		}),

	getActiveAlerts: () =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

			return yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(priceAlerts)
						.where(and(eq(priceAlerts.isActive, true), eq(priceAlerts.isTriggered, false)))
						.orderBy(desc(priceAlerts.createdAt)),
				catch: (e) => new DatabaseError({ message: `Failed to fetch active alerts: ${e}`, cause: e }),
			})
		}),

	getTokenPrice: (tokenSymbol: string) =>
		Effect.tryPromise({
			try: async () => {
				const prices = await fetchTokenPrices([tokenSymbol])
				return prices[tokenSymbol.toUpperCase()]?.usd ?? null
			},
			catch: (e) => new Error(`Failed to fetch token price: ${e}`),
		}),

	markTriggered: (alertId: number) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

			const result = yield* Effect.tryPromise({
				try: () =>
					db
						.update(priceAlerts)
						.set({
							isTriggered: true,
							isActive: false,
							triggeredAt: new Date(),
							updatedAt: new Date(),
						})
						.where(eq(priceAlerts.id, alertId))
						.returning(),
				catch: (e) => new DatabaseError({ message: `Failed to mark alert triggered: ${e}`, cause: e }),
			})

			return result[0] ?? null
		}),
})
