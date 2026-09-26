/**
 * HACKATHON (ETHGlobal Tokyo 2026) — durable World ID nullifier store.
 *
 * Postgres-backed implementation of the NullifierStore contract from
 * ../../../hackathon/tokyo2026/src/world-id/guardianGate.ts. Replaces the
 * in-memory MemoryNullifierStore for the api-ts demo routes so proof
 * consumption survives restarts and works across replicas.
 *
 * ATOMICITY: consume() is a single `INSERT ... ON CONFLICT DO NOTHING`.
 * The UNIQUE (action, nullifier) index on world_id_nullifiers is the
 * replay defense — two concurrent consumes of the same proof let exactly
 * one win. There is no check-then-insert; the database is the lock.
 *
 * Fail-closed: any DB error returns false (proof NOT consumed → verification
 * fails) rather than true. A verification that can't record its nullifier
 * must not pass.
 */

import {
	normalizeNullifier,
	type NullifierStore,
} from './tokyo2026/world-id/guardianGate'
import { type DbClient } from '../db/client'
import { worldIdNullifiers } from '../db/schema/worldIdNullifiers'
import { logger } from '../lib/logger'

export class PostgresNullifierStore implements NullifierStore {
	constructor(private readonly db: DbClient) {}

	/**
	 * Atomically consume (action, nullifier). Returns true on first use,
	 * false when already consumed or on DB error (fail closed). Throws on
	 * malformed nullifiers — callers fail the verification, they don't
	 * treat it as a replay.
	 */
	async consume(action: string, nullifier: string): Promise<boolean> {
		// Canonical decimal form; throws on malformed input (outside the
		// try so it propagates instead of being swallowed as "replay").
		const decimal = normalizeNullifier(nullifier)
		try {
			const rows = await this.db
				.insert(worldIdNullifiers)
				.values({ action, nullifier: decimal })
				.onConflictDoNothing({
					target: [worldIdNullifiers.nullifier, worldIdNullifiers.action],
				})
				.returning({ id: worldIdNullifiers.id })
			// INSERT ... ON CONFLICT DO NOTHING: 1 row = first consume,
			// 0 rows = conflict = replay.
			return rows.length === 1
		} catch (e) {
			logger.warn('[world-id] nullifier consume failed (fail closed): %s', String(e))
			return false
		}
	}
}
