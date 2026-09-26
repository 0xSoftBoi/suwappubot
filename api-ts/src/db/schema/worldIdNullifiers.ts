import { numeric, pgTable, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

/**
 * World ID nullifier consumption log — durable replay protection for the
 * guardian gate (ETHGlobal Tokyo 2026 trust layer).
 *
 * Each verified World ID proof yields a nullifier bound to one action
 * (e.g. the `suwappu-trade-approval` World action). Consuming a proof =
 * inserting its (action, nullifier) row. The UNIQUE index is the entire
 * replay defense: `INSERT ... ON CONFLICT DO NOTHING` is atomic, so two
 * concurrent consumes of the same proof let exactly one win — no
 * check-then-insert race, no distributed lock.
 *
 * Nullifiers are 0x-prefixed hex strings representing 256-bit integers
 * (uint256 onchain — WorldIDIdentityManager.verifyProof takes
 * `uint256 nullifierHash`). They are canonicalized to decimal and stored
 * as NUMERIC(78,0), per the official Worldcoin integration guide
 * (worldcoin/developer-docs, world-id/idkit/integrate.mdx): text storage
 * invites parsing/casing bugs that become replay vulnerabilities. The
 * canonicalization lives in normalizeNullifier
 * (hackathon/tokyo2026/src/world-id/guardianGate.ts), shared by the
 * in-memory and Postgres stores so both enforce the identical contract.
 *
 * Written only by PostgresNullifierStore (api-ts/src/hackathon/worldIdNullifiers.ts).
 * Read only for debugging/audit — nothing gates on SELECTs from this table.
 */
export const worldIdNullifiers = pgTable(
	'world_id_nullifiers',
	{
		id: serial('id').primaryKey(),
		/** World action the proof was verified for (e.g. 'suwappu-trade-approval'). */
		action: text('action').notNull(),
		/**
		 * Decimal string of the 256-bit nullifier, stored as NUMERIC(78,0).
		 * Drizzle maps numeric to string; pass the output of
		 * normalizeNullifier() directly.
		 */
		nullifier: numeric('nullifier', { precision: 78, scale: 0 }).notNull(),
		/** When the proof was consumed (first verified). */
		consumedAt: timestamp('consumed_at').defaultNow().notNull(),
	},
	(table) => ({
		nullifierActionUnique: uniqueIndex('world_id_nullifiers_nullifier_action_unique').on(
			table.nullifier,
			table.action,
		),
	}),
)

export type WorldIdNullifier = typeof worldIdNullifiers.$inferSelect
export type NewWorldIdNullifier = typeof worldIdNullifiers.$inferInsert
