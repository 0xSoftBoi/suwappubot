/**
 * PostgresNullifierStore — atomic consume contract, tested against a mocked
 * Drizzle client (no test DB in this suite).
 *
 * The atomicity itself comes from Postgres (`INSERT ... ON CONFLICT DO
 * NOTHING` + UNIQUE (nullifier, action) index over NUMERIC(78,0)); what we
 * verify here is the store's side of the contract:
 *  - 1 inserted row → true (first consume wins)
 *  - 0 rows (conflict) → false (replay rejected)
 *  - DB error → false (fail closed, never fail open)
 *  - nullifier canonicalized hex → decimal before write (official Worldcoin
 *    pattern: 0x-prefixed 256-bit hex stored as NUMERIC(78,0))
 *  - malformed nullifier → throws, NOT swallowed as a replay (callers fail
 *    the verification with a distinct reason)
 */
import { describe, expect, test } from 'bun:test'
import { PostgresNullifierStore } from '../hackathon/worldIdNullifiers'

function mockDb(rows: Array<{ id: number }> | Error, capture?: { values?: unknown }) {
	const returning = async () => {
		if (rows instanceof Error) throw rows
		return rows
	}
	return {
		insert: () => ({
			values: (v: unknown) => {
				if (capture) capture.values = v
				return {
					onConflictDoNothing: () => ({ returning }),
				}
			},
		}),
	} as never
}

describe('PostgresNullifierStore', () => {
	test('first consume returns true', async () => {
		const store = new PostgresNullifierStore(mockDb([{ id: 1 }]))
		await expect(store.consume('suwappu-trade-approval', '0xABC')).resolves.toBe(true)
	})

	test('conflicting consume returns false (replay)', async () => {
		const store = new PostgresNullifierStore(mockDb([]))
		await expect(store.consume('suwappu-trade-approval', '0xABC')).resolves.toBe(false)
	})

	test('DB error fails closed (false, not throw)', async () => {
		const store = new PostgresNullifierStore(mockDb(new Error('connection refused')))
		await expect(store.consume('suwappu-trade-approval', '0xABC')).resolves.toBe(false)
	})

	test('nullifier stored as canonical decimal (NUMERIC(78,0))', async () => {
		const capture: { values?: unknown } = {}
		const store = new PostgresNullifierStore(mockDb([{ id: 1 }], capture))
		await store.consume('act', '0xAbC')
		expect(capture.values).toMatchObject({ action: 'act', nullifier: '2748' })
	})

	test('casing and leading zeros collapse before insert', async () => {
		const capture: { values?: unknown } = {}
		const store = new PostgresNullifierStore(mockDb([{ id: 1 }], capture))
		await store.consume('act', '0x00ABC')
		expect(capture.values).toMatchObject({ nullifier: '2748' })
	})

	test('malformed nullifier throws (fail closed, not a replay)', async () => {
		const store = new PostgresNullifierStore(mockDb([{ id: 1 }]))
		await expect(store.consume('act', 'not-hex')).rejects.toThrow('malformed nullifier')
	})

	test('full 256-bit nullifier fits without overflow', async () => {
		const capture: { values?: unknown } = {}
		const store = new PostgresNullifierStore(mockDb([{ id: 1 }], capture))
		await store.consume('act', '0x' + 'f'.repeat(64))
		expect(capture.values).toMatchObject({
			nullifier: (2n ** 256n - 1n).toString(10),
		})
	})
})
