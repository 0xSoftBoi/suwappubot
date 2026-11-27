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
