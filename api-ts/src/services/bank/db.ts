import { randomUUID } from 'node:crypto'
import { Effect } from 'effect'
import { type DbClient, type DrizzleService, requireDb } from '../../db'
import { logger } from '../../lib/logger'
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

// MONEY-PATH: bounded wallet-lock acquisition. Waiters queue IN MEMORY per key (they hold no DB connection); only the one
// process-local head per key reserves a connection, and at most MAX_LOCK_CONNS are reserved process-wide (pool max is 20),
// so a burst on one wallet can never exhaust the pool or starve the lock holder's own queries.
const LOCK_TOTAL_TIMEOUT_MS = 20_000
const MAX_LOCK_WAITERS = 64
const MAX_LOCK_CONNS = 6
const localTails = new Map<string, Promise<void>>()
let lockWaiters = 0
let lockConns = 0

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const busy = (key: string, why: string) => bankErr('LOCK_BUSY', `Wallet lock busy (${key}): ${why}; retry shortly`)

type ReservedConn = Awaited<ReturnType<DbClient['$client']['reserve']>>

async function acquireWalletLock(db: DbClient, key: string): Promise<{ conn: ReservedConn; releaseLocal: () => void }> {
	if (lockWaiters >= MAX_LOCK_WAITERS) throw busy(key, 'too many concurrent waiters')
	const deadline = Date.now() + LOCK_TOTAL_TIMEOUT_MS
	lockWaiters++
	let releaseLocal!: () => void
	const prev = localTails.get(key) ?? Promise.resolve()
	const mine = new Promise<void>((r) => (releaseLocal = r))
	const tail = prev.then(() => mine)
	localTails.set(key, tail)
	const cleanup = () => {
		releaseLocal()
		if (localTails.get(key) === tail) localTails.delete(key)
	}
	try {
		await Promise.race([prev, sleep(Math.max(0, deadline - Date.now())).then(() => Promise.reject(busy(key, 'timed out queueing')))])
		while (lockConns >= MAX_LOCK_CONNS) {
			if (Date.now() > deadline) throw busy(key, 'lock connection budget exhausted')
			await sleep(25 + Math.random() * 75)
		}
		lockConns++
		let conn: ReservedConn
		try {
			conn = await db.$client.reserve()
		} catch (e) {
			lockConns--
			throw e
		}
		try {
			for (;;) {
				const r = await conn`select pg_try_advisory_lock(hashtextextended(${key}, 0)) as ok`
				if ((r as unknown as Array<{ ok: boolean }>)[0]?.ok) return { conn, releaseLocal: cleanup }
				if (Date.now() > deadline) throw busy(key, 'held by another worker')
				await sleep(25 + Math.random() * 100)
			}
		} catch (e) {
			conn.release()
			lockConns--
			throw e
		}
	} catch (e) {
		cleanup()
		throw e
	} finally {
		lockWaiters--
	}
}

/**
 * Cross-replica mutex: a session-level Postgres advisory lock held on a reserved connection for the duration of `inner`
 * (e.g. nonce -> sign -> persist -> broadcast for one wallet). The lock dies with the connection, so a crashed worker
 * cannot wedge it. Acquisition is bounded (try-lock + jittered backoff, 20s) and fails with the retryable LOCK_BUSY (503).
 */
export const withDbLock = <A, E, R>(
	key: string,
	inner: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | BankError, R | DrizzleService> =>
	Effect.acquireUseRelease(
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(Effect.mapError((e) => bankErr('DB', e.message)))
			return yield* Effect.tryPromise({
				try: () => acquireWalletLock(db, key),
				catch: (e) => (e instanceof BankError ? e : bankErr('CONFLICT', `Could not acquire wallet lock (${key}): ${String(e)}`, { cause: e })),
			})
		}),
		() => inner,
		({ conn, releaseLocal }) =>
			Effect.promise(async () => {
				// MONEY-PATH: an unlock error must never mask the protected work's result, and a session that may still
				// hold the lock must not return to the pool: terminate its backend (server drops session locks) first.
				try {
					const [r] = await conn`select pg_advisory_unlock(hashtextextended(${key}, 0)) as ok`
					if (r && r.ok === false) throw new Error('advisory lock was not held by this session')
				} catch (e) {
					logger.error({ key, err: String(e) }, '[bank] advisory unlock failed; discarding lock connection')
					try {
						await conn`select pg_terminate_backend(pg_backend_pid())`
					} catch {
						/* session already gone: lock died with it */
					}
				}
				try {
					conn.release()
				} catch (e) {
					logger.error({ key, err: String(e) }, '[bank] releasing lock connection failed')
				} finally {
					lockConns--
					releaseLocal()
				}
			}),
	)
