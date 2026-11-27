import { randomUUID } from 'node:crypto'
import { Effect } from 'effect'
import { type DbClient, type DrizzleService, requireDb } from '../../db'
import { BankError, bankErr } from './errors'

/** Run a Drizzle callback, mapping failures to BankError (BankError thrown inside passes through). */
export const bankDb = <A>(
	f: (db: DbClient) => Promise<A>,
): Effect.Effect<A, BankError, DrizzleService> =>
	Effect.gen(function* () {
		const db = yield* requireDb.pipe(Effect.mapError((e) => bankErr('DB', e.message)))
		return yield* Effect.tryPromise({
			try: () => f(db),
			catch: (e) => (e instanceof BankError ? e : bankErr('DB', `Database error: ${String(e)}`, { cause: e })),
		})
	})

export const newId = (prefix: 'acct' | 'xfer' | 'le'): string => `${prefix}_${randomUUID().replace(/-/g, '')}`

export interface BankOwner {
	ownerType: 'user' | 'agent' | 'org' | 'partner_customer'
	ownerId: string
}

/** True for a Postgres unique-violation (23505), whether raw or wrapped by Drizzle. */
export const isUniqueViolation = (e: unknown): boolean => {
	const x = e as { code?: string; cause?: { code?: string } } | null
	return x?.code === '23505' || x?.cause?.code === '23505'
}

/**
 * Cross-replica mutex: a session-level Postgres advisory lock held on a reserved
 * connection for the duration of `inner` (e.g. nonce -> sign -> persist -> broadcast
 * for one wallet). The lock dies with the connection, so a crashed worker cannot wedge it.
 */
export const withDbLock = <A, E, R>(
	key: string,
	inner: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | BankError, R | DrizzleService> =>
	Effect.acquireUseRelease(
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(Effect.mapError((e) => bankErr('DB', e.message)))
			return yield* Effect.tryPromise({
				try: async () => {
					const conn = await db.$client.reserve()
					try {
						await conn`select pg_advisory_lock(hashtextextended(${key}, 0))`
					} catch (e) {
						conn.release()
						throw e
					}
					return conn
				},
				catch: (e) => bankErr('CONFLICT', `Could not acquire wallet lock (${key}): ${String(e)}`, { cause: e }),
			})
		}),
		() => inner,
		(conn) =>
			Effect.promise(async () => {
				try {
					await conn`select pg_advisory_unlock(hashtextextended(${key}, 0))`
				} finally {
					conn.release()
				}
			}),
	)
