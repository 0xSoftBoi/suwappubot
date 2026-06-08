import { and, eq } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'
import { type DrizzleService, requireDb, requireRow, type Wallet, wallets } from '../db'
import { DatabaseError } from '../errors'

export interface CreateTurnkeyWalletParams {
	userId: number
	address: string
	turnkeySubOrgId: string
	turnkeyWalletId: string
	turnkeyAccountId: string
}

export interface WalletServiceInterface {
	readonly getUserWallets: (
		userId: number,
	) => Effect.Effect<Wallet[], DatabaseError, DrizzleService>
	readonly getActiveWallets: (
		userId: number,
	) => Effect.Effect<Wallet[], DatabaseError, DrizzleService>
	readonly createTurnkeyWallet: (
		params: CreateTurnkeyWalletParams,
	) => Effect.Effect<Wallet, DatabaseError, DrizzleService>
}

export class WalletService extends Context.Tag('WalletService')<
	WalletService,
	WalletServiceInterface
>() {}

export const WalletServiceLive = Layer.succeed(WalletService, {
	getUserWallets: (userId: number) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
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
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
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

	createTurnkeyWallet: (params: CreateTurnkeyWalletParams) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

			const result = yield* Effect.tryPromise({
				try: () =>
					db
						.insert(wallets)
						.values({
							userId: params.userId,
							address: params.address,
							chainType: 'evm',
							walletProvider: 'turnkey',
							turnkeySubOrgId: params.turnkeySubOrgId,
							turnkeyWalletId: params.turnkeyWalletId,
							turnkeyAccountId: params.turnkeyAccountId,
							isActive: true,
							isDefault: true,
						})
						.returning(),
				catch: (e) =>
					new DatabaseError({ message: `Failed to create Turnkey wallet: ${e}`, cause: e }),
			})

			return yield* requireRow(result, 'Failed to create Turnkey wallet: no row returned')
		}),
})
