import { eq } from 'drizzle-orm'
import { Context, Effect, Layer, Option } from 'effect'
import { type DrizzleService, requireDb, requireRow, type User, users } from '../db'
import { DatabaseError } from '../errors'

export interface CreateUserParams {
	telegramId: number
	username?: string | undefined
	firstName?: string | undefined
	lastName?: string | undefined
}

export interface UpdateUserPreferencesParams {
	defaultSlippage?: number // stored as basis points (50 = 0.5%)
	notificationsEnabled?: boolean
	twoFaEnabled?: boolean
	twoFaThreshold?: number
	gasMode?: string
}

export interface UserServiceInterface {
	readonly getUserById: (
		id: number,
	) => Effect.Effect<Option.Option<User>, DatabaseError, DrizzleService>
	readonly getUserByTelegramId: (
		telegramId: number,
	) => Effect.Effect<Option.Option<User>, DatabaseError, DrizzleService>
	readonly createUser: (
		params: CreateUserParams,
	) => Effect.Effect<User, DatabaseError, DrizzleService>
	readonly getOrCreateUser: (
		params: CreateUserParams,
	) => Effect.Effect<{ user: User; isNew: boolean }, DatabaseError, DrizzleService>
	readonly updateUserPreferences: (
		userId: number,
		params: UpdateUserPreferencesParams,
	) => Effect.Effect<User, DatabaseError, DrizzleService>
}

export class UserService extends Context.Tag('UserService')<UserService, UserServiceInterface>() {}

export const UserServiceLive = Layer.succeed(UserService, {
	getUserById: (id: number) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

			const result = yield* Effect.tryPromise({
				try: () => db.select().from(users).where(eq(users.id, id)),
				catch: (e) => new DatabaseError({ message: `Failed to get user: ${e}`, cause: e }),
			})

			return Option.fromNullable(result[0])
		}),

	getUserByTelegramId: (telegramId: number) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

			const result = yield* Effect.tryPromise({
				try: () => db.select().from(users).where(eq(users.telegramId, telegramId)),
				catch: (e) =>
					new DatabaseError({
						message: `Failed to get user by telegram_id: ${e}`,
						cause: e,
					}),
			})

			return Option.fromNullable(result[0])
		}),

	createUser: (params: CreateUserParams) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

			const result = yield* Effect.tryPromise({
				try: () =>
					db
						.insert(users)
						.values({
							telegramId: params.telegramId,
							username: params.username || null,
							firstName: params.firstName || null,
							lastName: params.lastName || null,
						})
						.returning(),
				catch: (e) => new DatabaseError({ message: `Failed to create user: ${e}`, cause: e }),
			})

			return yield* requireRow(result, 'Failed to create user: no row returned')
		}),

	getOrCreateUser: (params: CreateUserParams) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

			// Try to find existing user
			const existing = yield* Effect.tryPromise({
				try: () => db.select().from(users).where(eq(users.telegramId, params.telegramId)),
				catch: (e) =>
					new DatabaseError({ message: `Failed to check existing user: ${e}`, cause: e }),
			})

			const existingRow = existing[0]
			if (existingRow) {
				return { user: existingRow, isNew: false }
			}

			// Create new user
			const created = yield* Effect.tryPromise({
				try: () =>
					db
						.insert(users)
						.values({
							telegramId: params.telegramId,
							username: params.username || null,
							firstName: params.firstName || null,
							lastName: params.lastName || null,
						})
						.returning(),
				catch: (e) => new DatabaseError({ message: `Failed to create user: ${e}`, cause: e }),
			})

			const user = yield* requireRow(created, 'Failed to create user: no row returned')
			return { user, isNew: true }
		}),

	updateUserPreferences: (userId: number, params: UpdateUserPreferencesParams) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

			// Build update object with only provided fields
			const updateData: Record<string, unknown> = {
				updatedAt: new Date(),
			}
			if (params.defaultSlippage !== undefined) {
				updateData.defaultSlippage = params.defaultSlippage
			}
			if (params.notificationsEnabled !== undefined) {
				updateData.notificationsEnabled = params.notificationsEnabled
			}
			if (params.twoFaEnabled !== undefined) {
				updateData.twoFaEnabled = params.twoFaEnabled
			}
			if (params.twoFaThreshold !== undefined) {
				updateData.twoFaThreshold = params.twoFaThreshold
			}
			if (params.gasMode !== undefined) {
				updateData.gasMode = params.gasMode
			}

			const result = yield* Effect.tryPromise({
				try: () => db.update(users).set(updateData).where(eq(users.id, userId)).returning(),
				catch: (e) =>
					new DatabaseError({ message: `Failed to update user preferences: ${e}`, cause: e }),
			})

			return yield* requireRow(result, 'Failed to update user preferences: user not found')
		}),
})
