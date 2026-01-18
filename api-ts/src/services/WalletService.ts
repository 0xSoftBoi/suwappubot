import { Context, Effect, Layer } from 'effect'
import { eq, and } from 'drizzle-orm'
import { DrizzleService, requireDb, wallets, type Wallet } from '../db'
import { DatabaseError } from '../errors'

export interface WalletServiceInterface {
	readonly getUserWallets: (
		userId: number
	) => Effect.Effect<Wallet[], DatabaseError, DrizzleService>
	readonly getActiveWallets: (
		userId: number
	) => Effect.Effect<Wallet[], DatabaseError, DrizzleService>
}

export class WalletService extends Context.Tag('WalletService')<
	WalletService,
	WalletServiceInterface
>() {}

export const WalletServiceLive = Layer.succeed(WalletService, {
	getUserWallets: (userId: number) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message }))
			)

			const result = yield* Effect.tryPromise({
				try: () => db.select().from(wallets).where(eq(wallets.userId, userId)),
				catch: (e) => new DatabaseError({ message: `Failed to get wallets: ${e}`, cause: e }),
			})

			return result
		}),

	getActiveWallets: (userId: number) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message }))
			)

			const result = yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(wallets)
						.where(and(eq(wallets.userId, userId), eq(wallets.isActive, true))),
				catch: (e) =>
					new DatabaseError({ message: `Failed to get active wallets: ${e}`, cause: e }),
			})

			return result
		}),
})
