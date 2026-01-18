import { Context, Effect, Layer, Option } from 'effect'
import { eq } from 'drizzle-orm'
import { DrizzleService, requireDb, users, type User } from '../db'
import { DatabaseError } from '../errors'

export interface UserServiceInterface {
	readonly getUserById: (
		id: number
	) => Effect.Effect<Option.Option<User>, DatabaseError, DrizzleService>
	readonly getUserByTelegramId: (
		telegramId: number
	) => Effect.Effect<Option.Option<User>, DatabaseError, DrizzleService>
}

export class UserService extends Context.Tag('UserService')<
	UserService,
	UserServiceInterface
>() {}

export const UserServiceLive = Layer.succeed(UserService, {
	getUserById: (id: number) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message }))
			)

			const result = yield* Effect.tryPromise({
				try: () => db.select().from(users).where(eq(users.id, id)),
				catch: (e) => new DatabaseError({ message: `Failed to get user: ${e}`, cause: e }),
			})

			return result.length > 0 ? Option.some(result[0]) : Option.none()
		}),

	getUserByTelegramId: (telegramId: number) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message }))
			)

			const result = yield* Effect.tryPromise({
				try: () => db.select().from(users).where(eq(users.telegramId, telegramId)),
				catch: (e) =>
					new DatabaseError({
						message: `Failed to get user by telegram_id: ${e}`,
						cause: e,
					}),
			})

			return result.length > 0 ? Option.some(result[0]) : Option.none()
		}),
})
