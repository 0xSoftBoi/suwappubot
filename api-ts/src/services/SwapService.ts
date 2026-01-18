import { Context, Effect, Layer } from 'effect'
import { eq, desc } from 'drizzle-orm'
import { DrizzleService, requireDb, swapTransactions, type SwapTransaction } from '../db'
import { DatabaseError } from '../errors'

export interface SwapServiceInterface {
	readonly getUserSwaps: (
		userId: number,
		limit?: number,
		offset?: number
	) => Effect.Effect<SwapTransaction[], DatabaseError, DrizzleService>
}

export class SwapService extends Context.Tag('SwapService')<
	SwapService,
	SwapServiceInterface
>() {}

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
})
