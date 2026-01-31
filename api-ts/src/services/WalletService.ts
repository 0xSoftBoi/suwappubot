import { Context, Effect, Layer } from 'effect'
import { eq, and } from 'drizzle-orm'
import { DrizzleService, requireDb, wallets, type Wallet } from '../db'
import { DatabaseError } from '../errors'

export interface CreateTurnkeyWalletParams {
	userId: number
	address: string
	turnkeySubOrgId: string
	turnkeyWalletId: string
	turnkeyAccountId: string
}

export interface AddExternalWalletParams {
	userId: number
	address: string
	chainType: 'evm' | 'solana'
	name?: string
}

export interface WalletServiceInterface {
	readonly getUserWallets: (
		userId: number
	) => Effect.Effect<Wallet[], DatabaseError, DrizzleService>
	readonly getActiveWallets: (
		userId: number
	) => Effect.Effect<Wallet[], DatabaseError, DrizzleService>
	readonly createTurnkeyWallet: (
		params: CreateTurnkeyWalletParams
	) => Effect.Effect<Wallet, DatabaseError, DrizzleService>
	readonly addExternalWallet: (
		params: AddExternalWalletParams
	) => Effect.Effect<Wallet, DatabaseError, DrizzleService>
	readonly removeWallet: (
		userId: number,
		address: string
	) => Effect.Effect<boolean, DatabaseError, DrizzleService>
	readonly getWalletByAddress: (
		userId: number,
		address: string
	) => Effect.Effect<Wallet | null, DatabaseError, DrizzleService>
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

	createTurnkeyWallet: (params: CreateTurnkeyWalletParams) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message }))
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

			return result[0]
		}),

	addExternalWallet: (params: AddExternalWalletParams) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message }))
			)

			// Check if wallet already exists for this user
			const existing = yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(wallets)
						.where(and(eq(wallets.userId, params.userId), eq(wallets.address, params.address.toLowerCase()))),
				catch: (e) => new DatabaseError({ message: `Failed to check existing wallet: ${e}`, cause: e }),
			})

			if (existing.length > 0) {
				return existing[0]
			}

			const result = yield* Effect.tryPromise({
				try: () =>
					db
						.insert(wallets)
						.values({
							userId: params.userId,
							address: params.address.toLowerCase(),
							chainType: params.chainType,
							walletProvider: 'external',
							name: params.name || 'External Wallet',
							isActive: true,
							isDefault: false,
						})
						.returning(),
				catch: (e) =>
					new DatabaseError({ message: `Failed to add external wallet: ${e}`, cause: e }),
			})

			return result[0]
		}),

	removeWallet: (userId: number, address: string) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message }))
			)

			const result = yield* Effect.tryPromise({
				try: () =>
					db
						.update(wallets)
						.set({ isActive: false })
						.where(and(eq(wallets.userId, userId), eq(wallets.address, address.toLowerCase())))
						.returning(),
				catch: (e) =>
					new DatabaseError({ message: `Failed to remove wallet: ${e}`, cause: e }),
			})

			return result.length > 0
		}),

	getWalletByAddress: (userId: number, address: string) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message }))
			)

			const result = yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(wallets)
						.where(and(eq(wallets.userId, userId), eq(wallets.address, address.toLowerCase()))),
				catch: (e) =>
					new DatabaseError({ message: `Failed to get wallet: ${e}`, cause: e }),
			})

			return result[0] || null
		}),
})
