import { describe, expect, it } from 'bun:test'
import { Effect, Layer, Option } from 'effect'
import { DrizzleService } from '../db/DrizzleService'
import { computeEntryHash, verifyAuditChain } from '../services/audit'

/**
 * Regression coverage for finding 1: verifyAuditChain() previously seeded
 * `expectedPrevHash = null` before walking a WINDOWED (LIMIT `limit`,
 * newest-first) selection. Once a chain grows past `limit` rows, the oldest
 * row IN the window has a non-null prevHash pointing outside the fetched
 * window, so the very first comparison always failed — every verify call on
 * a chain longer than `limit` permanently reported `valid: false`. The fix
 * seeds the expectation from the window's own boundary row instead.
 *
 * The fake db below mirrors only the exact chainable shape verifyAuditChain
 * calls: select().from().where().orderBy().limit().
 */

interface FakeRow {
	id: number
	userId: number
	orgId: string | null
	agentId: string | null
	eventType: string
	details: string | null
	createdAt: Date
	prevHash: string | null
	entryHash: string | null
	tsRaw: string | null
}

/** Build a valid hash-chained sequence of `count` rows, oldest first. */
function buildChain(count: number): FakeRow[] {
	const rows: FakeRow[] = []
	let prevHash: string | null = null
	for (let i = 1; i <= count; i++) {
		const ts = new Date(2026, 0, 1, 0, 0, i).toISOString()
		const row = {
			userId: 1,
			orgId: null,
			agentId: `agent-${i}`,
			eventType: 'test.event',
			details: null,
		}
		const entryHash = computeEntryHash({ ...row, ts, prevHash })
		rows.push({
			id: i,
			...row,
			createdAt: new Date(ts),
			prevHash,
			entryHash,
			tsRaw: ts,
		})
		prevHash = entryHash
	}
	return rows
}

function makeFakeDb(allRowsOldestFirst: FakeRow[]) {
	// Full table, newest-first — mirrors ORDER BY id DESC with no LIMIT applied
	// yet, so both the windowed main query and the offset anchor query can be
	// simulated generically from the same underlying data.
	const newestFirst = [...allRowsOldestFirst].reverse()
	const db: unknown = {
		select(_cols?: unknown) {
			return {
				from(_table: unknown) {
					return {
						where(_cond: unknown) {
							return {
								orderBy(_o: unknown) {
									return {
										limit(n: number) {
											const sliced = newestFirst.slice(0, n)
											return {
												// Thenable so `await limit(n)` (no .offset() call) works
												// directly, mirroring the main windowed query.
												then(resolve: (v: FakeRow[]) => void) {
													resolve(sliced)
												},
												// Anchor query: LIMIT n OFFSET m, applied against the
												// full (unwindowed) newest-first ordering.
												offset: async (m: number) => newestFirst.slice(m, m + n),
											}
										},
									}
								},
							}
						},
					}
				},
			}
		},
	}
	return db
}

function runVerify(db: unknown, limit: number) {
	const dbLayer = Layer.succeed(DrizzleService, Option.some(db as never))
	return Effect.runPromise(verifyAuditChain(null, limit).pipe(Effect.provide(dbLayer)))
}

describe('verifyAuditChain', () => {
	it('reports valid on a chain longer than the verify window', async () => {
		const limit = 1000
		const chain = buildChain(limit + 5)
		const db = makeFakeDb(chain)

		const result = await runVerify(db, limit)

		expect(result.valid).toBe(true)
		expect(result.checked).toBe(limit)
		expect(result.firstBreakId).toBeUndefined()
	})

	it('still reports the correct firstBreakId for a genuine mid-window tamper', async () => {
		const limit = 1000
		const chain = buildChain(limit + 5)
		// Tamper with a row inside the fetched window (not the window boundary):
		// corrupt the entryHash of a row in the middle of the window.
		const tamperedId = chain.length - 50 // well inside the newest `limit` rows
		const tamperedRow = chain.find((r) => r.id === tamperedId)
		if (!tamperedRow) throw new Error('test setup: tampered row not found')
		tamperedRow.entryHash = 'deadbeef'.repeat(8)

		const db = makeFakeDb(chain)
		const result = await runVerify(db, limit)

		expect(result.valid).toBe(false)
		expect(result.firstBreakId).toBe(tamperedId)
	})

	it('reports valid for a chain shorter than the window (pre-existing behavior)', async () => {
		const chain = buildChain(10)
		const db = makeFakeDb(chain)

		const result = await runVerify(db, 1000)

		expect(result.valid).toBe(true)
		expect(result.checked).toBe(10)
		expect(result.firstBreakId).toBeUndefined()
	})

	it('catches a tamper of ONLY the window boundary row prevHash (finding 3)', async () => {
		// A chain longer than the window: the oldest row IN the window has a
		// real predecessor OUTSIDE the window. Previously expectedPrevHash was
		// seeded from that boundary row's own prevHash, making its comparison
		// tautological — tampering ONLY that field was undetectable. Now an
		// anchor row just outside the window is fetched and used to seed the
		// expectation, so this must be caught.
		const limit = 1000
		const chain = buildChain(limit + 5)
		const boundaryId = chain.length - limit + 1 // oldest row IN the window
		const boundaryRow = chain.find((r) => r.id === boundaryId)
		if (!boundaryRow) throw new Error('test setup: boundary row not found')
		// Dangle the link: point prevHash at a bogus value instead of the real
		// anchor's entryHash. entryHash itself is untouched (still internally
		// self-consistent) — only the chain link is forged.
		boundaryRow.prevHash = 'forgedforged'.repeat(5)

		const db = makeFakeDb(chain)
		const result = await runVerify(db, limit)

		expect(result.valid).toBe(false)
		expect(result.firstBreakId).toBe(boundaryId)
	})
})
