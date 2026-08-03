import { describe, expect, it } from 'bun:test'
import { Effect, Layer, Option } from 'effect'
import { DrizzleService } from '../db/DrizzleService'
import { scanForThreatsObserveOnly, scanValueObserveOnly } from '../middleware/aegisScan'
import {
	AgentTrustService,
	AgentTrustServiceLive,
	RECOVERY_INTERVAL_MS,
	RECOVERY_STEP,
	THREAT_PENALTY,
	TRUST_DEFAULT,
	TRUST_MAX,
	TRUST_MIN,
} from '../services/AgentTrustService'

/**
 * Unit coverage for AgentTrustService — the per-agent trust record (Phase 2.3
 * analogue of bot/services/aegis_trust.py, adapted to key on agents.id).
 * RECORD-ONLY: nothing here is enforcement; these tests only pin down the
 * read/write semantics — threat decrement + floor, the write-amplification
 * guard (clean verdicts never create a row, and only recover an existing row
 * once per RECOVERY_INTERVAL_MS), the TRUST_DEFAULT fallback, the atomic
 * upsert (no separate SELECT before a write), and fail-open behavior on a DB
 * error. A final describe block covers the aegisScan.ts `onVerdict` wiring
 * that the route seams (agent.ts /execute, a2a.ts message/send, mcp.ts
 * tools/call) use to feed a scan verdict into recordVerdict.
 *
 * The fake db below mirrors only the exact chainable shapes
 * AgentTrustService.ts calls: select().from().where().limit() (getTrust
 * only — recordVerdict no longer selects, see below), a bare
 * insert().values(vals).onConflictDoUpdate(cfg) (threat path), and a bare
 * update().set(vals).where(cond) (clean/recovery path) — matching the
 * precedent in agentServiceStarterCredits.test.ts's makeFakeDb.
 *
 * recordVerdict's real `set` fields for the conflict/update paths are raw
 * SQL expressions (sql`greatest(...)`, sql`... + 1`) evaluated by postgres
 * against the CURRENT row server-side — the fake db has no SQL engine, so it
 * recomputes the identical formula here from the row's live in-memory state
 * (same trick the precedent test uses). What the fake DOES faithfully prove
 * is the SHAPE of the call (single insert-upsert / single conditional
 * update, no preceding select), which is exactly what finding 3 fixes.
 */

interface FakeRow {
	id: number
	agentId: number
	trustScore: number
	threatCount: number
	cleanCount: number
	quarantinedUntil: Date | null
	lastThreatAt: Date | null
	lastSeenAt: Date | null
	createdAt: Date
}

interface FakeDbOptions {
	seed?: Partial<FakeRow> & { agentId: number }
	failSelect?: boolean
	failWrite?: boolean
}

function makeFakeDb(opts: FakeDbOptions = {}) {
	let row: FakeRow | null = opts.seed
		? {
				id: 1,
				agentId: opts.seed.agentId,
				trustScore: opts.seed.trustScore ?? TRUST_DEFAULT,
				threatCount: opts.seed.threatCount ?? 0,
				cleanCount: opts.seed.cleanCount ?? 0,
				quarantinedUntil: opts.seed.quarantinedUntil ?? null,
				lastThreatAt: opts.seed.lastThreatAt ?? null,
				lastSeenAt: opts.seed.lastSeenAt ?? null,
				createdAt: opts.seed.createdAt ?? new Date(),
			}
		: null

	const insertedRows: FakeRow[] = []
	const updateCalls: Array<Record<string, unknown>> = []
	let selectCalls = 0

	const db: unknown = {
		select(_cols?: unknown) {
			return {
				from(_table: unknown) {
					return {
						where(_cond: unknown) {
							return {
								limit: async (_n: number) => {
									selectCalls++
									if (opts.failSelect) throw new Error('simulated select failure')
									return row ? [row] : []
								},
							}
						},
					}
				},
			}
		},
		insert(_table: unknown) {
			return {
				values: (vals: Record<string, unknown>) => ({
					onConflictDoUpdate: async (_cfg: unknown) => {
						if (opts.failWrite) throw new Error('simulated insert failure')
						if (!row) {
							// No existing row: the insert branch's `vals` are plain numbers
							// computed in JS by the service (TRUST_DEFAULT - THREAT_PENALTY,
							// etc.), not SQL fragments, so they're usable directly.
							row = {
								id: 1,
								agentId: vals.agentId as number,
								trustScore: vals.trustScore as number,
								threatCount: vals.threatCount as number,
								cleanCount: vals.cleanCount as number,
								quarantinedUntil: null,
								lastThreatAt: (vals.lastThreatAt as Date | undefined) ?? null,
								lastSeenAt: (vals.lastSeenAt as Date | undefined) ?? null,
								createdAt: new Date(),
							}
							insertedRows.push(row)
							return []
						}
						// Conflict path — recompute the identical formula the SQL `set`
						// fragment computes server-side, from the row's CURRENT
						// in-memory state (never from a value captured by an earlier
						// select in this test, since there isn't one).
						row = {
							...row,
							trustScore: Math.max(TRUST_MIN, row.trustScore - THREAT_PENALTY),
							threatCount: row.threatCount + 1,
							lastThreatAt: (vals.lastThreatAt as Date | undefined) ?? row.lastThreatAt,
							lastSeenAt: (vals.lastSeenAt as Date | undefined) ?? row.lastSeenAt,
						}
						updateCalls.push({ ...row })
						return []
					},
				}),
			}
		},
		update(_table: unknown) {
			return {
				set: (vals: Record<string, unknown>) => ({
					where: async (_cond: unknown) => {
						if (opts.failWrite) throw new Error('simulated update failure')
						// Clean path: no row (or the interval hasn't elapsed) means the
						// real WHERE clause (agentId match AND coalesce(lastSeenAt,
						// createdAt) <= cutoff) would match zero rows — no-op, exactly
						// like the real conditional UPDATE.
						if (!row) return []
						const lastTouched = row.lastSeenAt ?? row.createdAt
						const elapsed = Date.now() - new Date(lastTouched).getTime()
						if (elapsed < RECOVERY_INTERVAL_MS) return []
						updateCalls.push(vals)
						row = {
							...row,
							trustScore: Math.min(TRUST_MAX, row.trustScore + RECOVERY_STEP),
							cleanCount: row.cleanCount + 1,
							lastSeenAt: (vals.lastSeenAt as Date | undefined) ?? new Date(),
						}
						return []
					},
				}),
			}
		},
	}

	return {
		db,
		getRow: () => row,
		insertedRows,
		updateCalls,
		getSelectCalls: () => selectCalls,
	}
}

function runRecordVerdict(db: unknown, agentId: number, isThreat: boolean) {
	const dbLayer = Layer.succeed(DrizzleService, Option.some(db as never))
	const program = Effect.gen(function* () {
		const svc = yield* AgentTrustService
		return yield* svc.recordVerdict(agentId, isThreat)
	})
	return Effect.runPromise(program.pipe(Effect.provide(Layer.merge(AgentTrustServiceLive, dbLayer))))
}

function runGetTrust(db: unknown, agentId: number) {
	const dbLayer = Layer.succeed(DrizzleService, Option.some(db as never))
	const program = Effect.gen(function* () {
		const svc = yield* AgentTrustService
		return yield* svc.getTrust(agentId)
	})
	return Effect.runPromise(program.pipe(Effect.provide(Layer.merge(AgentTrustServiceLive, dbLayer))))
}

describe('AgentTrustService.recordVerdict — threat path', () => {
	it('creates a row seeded at TRUST_DEFAULT minus the penalty when no row exists', async () => {
		const { db, getRow } = makeFakeDb()
		await runRecordVerdict(db, 42, true)
		const row = getRow()
		expect(row).not.toBeNull()
		expect(row?.trustScore).toBe(85) // 100 - 15
		expect(row?.threatCount).toBe(1)
		expect(row?.lastThreatAt).not.toBeNull()
	})

	it('decrements an existing row by the threat penalty and bumps threatCount', async () => {
		const { db, getRow } = makeFakeDb({ seed: { agentId: 42, trustScore: 100, threatCount: 2 } })
		await runRecordVerdict(db, 42, true)
		const row = getRow()
		expect(row?.trustScore).toBe(85)
		expect(row?.threatCount).toBe(3)
	})

	it('floors trustScore at 0 and never goes negative', async () => {
		const { db, getRow } = makeFakeDb({ seed: { agentId: 42, trustScore: 5, threatCount: 3 } })
		await runRecordVerdict(db, 42, true)
		expect(getRow()?.trustScore).toBe(0)

		// A further threat verdict on an already-zeroed row stays at 0.
		await runRecordVerdict(db, 42, true)
		expect(getRow()?.trustScore).toBe(0)
		expect(getRow()?.threatCount).toBe(5)
	})

	it('performs the write as a single atomic upsert — no separate SELECT beforehand', async () => {
		// Regression for finding 3: the old implementation did select() then
		// insert()/update(), which races a concurrent verdict between the read
		// and the write. The fix is a single INSERT ... ON CONFLICT statement;
		// prove it by asserting zero select() calls across both the
		// no-existing-row and existing-row branches.
		const { db, getSelectCalls } = makeFakeDb({ seed: { agentId: 42, trustScore: 100 } })
		await runRecordVerdict(db, 42, true)
		expect(getSelectCalls()).toBe(0)

		const { db: db2, getSelectCalls: getSelectCalls2 } = makeFakeDb()
		await runRecordVerdict(db2, 42, true)
		expect(getSelectCalls2()).toBe(0)
	})
})

describe('AgentTrustService.recordVerdict — clean path (write-amplification guard)', () => {
	it('NEVER creates a row for an agent with zero threats', async () => {
		const { db, getRow, insertedRows } = makeFakeDb()
		await runRecordVerdict(db, 42, false)
		expect(getRow()).toBeNull()
		expect(insertedRows).toHaveLength(0)
	})

	it('skips the recovery bump when less than RECOVERY_INTERVAL_MS has elapsed', async () => {
		const recentlyTouched = new Date(Date.now() - RECOVERY_INTERVAL_MS / 2)
		const { db, getRow, updateCalls } = makeFakeDb({
			seed: { agentId: 42, trustScore: 50, cleanCount: 2, lastSeenAt: recentlyTouched },
		})
		await runRecordVerdict(db, 42, false)
		expect(updateCalls).toHaveLength(0)
		expect(getRow()?.trustScore).toBe(50)
		expect(getRow()?.cleanCount).toBe(2)
	})

	it('applies the recovery bump once RECOVERY_INTERVAL_MS has elapsed since the last write', async () => {
		const longAgo = new Date(Date.now() - RECOVERY_INTERVAL_MS * 2)
		const { db, getRow } = makeFakeDb({
			seed: { agentId: 42, trustScore: 50, cleanCount: 2, lastSeenAt: longAgo },
		})
		await runRecordVerdict(db, 42, false)
		expect(getRow()?.trustScore).toBe(51)
		expect(getRow()?.cleanCount).toBe(3)
	})

	it('caps the recovery bump at TRUST_MAX (100) and still bumps cleanCount', async () => {
		const longAgo = new Date(Date.now() - RECOVERY_INTERVAL_MS * 2)
		const { db, getRow } = makeFakeDb({
			seed: { agentId: 42, trustScore: 100, cleanCount: 1, lastSeenAt: longAgo },
		})
		await runRecordVerdict(db, 42, false)
		// trustScore alone can't distinguish "recovery ran and capped" from
		// "recovery was skipped" (both leave it at 100) — cleanCount pins that
		// the conditional UPDATE actually executed (finding 1).
		expect(getRow()?.trustScore).toBe(100)
		expect(getRow()?.cleanCount).toBe(2)
	})

	it('falls back to createdAt for the recovery gate when lastSeenAt is null', async () => {
		const longAgo = new Date(Date.now() - RECOVERY_INTERVAL_MS * 2)
		const { db, getRow } = makeFakeDb({
			seed: { agentId: 42, trustScore: 50, cleanCount: 0, lastSeenAt: null, createdAt: longAgo },
		})
		await runRecordVerdict(db, 42, false)
		expect(getRow()?.trustScore).toBe(51)
	})

	it('performs the recovery write as a single conditional UPDATE — no separate SELECT beforehand', async () => {
		const longAgo = new Date(Date.now() - RECOVERY_INTERVAL_MS * 2)
		const { db, getSelectCalls } = makeFakeDb({
			seed: { agentId: 42, trustScore: 50, lastSeenAt: longAgo },
		})
		await runRecordVerdict(db, 42, false)
		expect(getSelectCalls()).toBe(0)
	})
})

describe('AgentTrustService.getTrust', () => {
	it('defaults to TRUST_DEFAULT (100) when no row exists', async () => {
		const { db } = makeFakeDb()
		const score = await runGetTrust(db, 42)
		expect(score).toBe(TRUST_DEFAULT)
	})

	it('returns the stored trustScore when a row exists', async () => {
		const { db } = makeFakeDb({ seed: { agentId: 42, trustScore: 62 } })
		const score = await runGetTrust(db, 42)
		expect(score).toBe(62)
	})
})

describe('AgentTrustService — fail-open on DB error', () => {
	it('getTrust returns TRUST_DEFAULT (never throws) when the select fails', async () => {
		const { db } = makeFakeDb({ failSelect: true })
		const score = await runGetTrust(db, 42)
		expect(score).toBe(TRUST_DEFAULT)
	})

	it('recordVerdict (threat) resolves without throwing when the upsert fails', async () => {
		const { db } = makeFakeDb({ failWrite: true })
		await expect(runRecordVerdict(db, 42, true)).resolves.toBeUndefined()
	})

	it('recordVerdict (clean) resolves without throwing when the conditional update fails', async () => {
		const longAgo = new Date(Date.now() - RECOVERY_INTERVAL_MS * 2)
		const { db } = makeFakeDb({
			seed: { agentId: 42, trustScore: 50, lastSeenAt: longAgo },
			failWrite: true,
		})
		await expect(runRecordVerdict(db, 42, false)).resolves.toBeUndefined()
	})
})

describe('AgentTrustService wiring — aegisScan onVerdict feeds recordVerdict (finding 5)', () => {
	// These pin the plumbing the route seams (agent.ts /execute,
	// a2a.ts message/send, mcp.ts tools/call) all use: scanForThreatsObserveOnly /
	// scanValueObserveOnly's onVerdict callback firing recordVerdict. The routes
	// fire this as an un-awaited (fire-and-forget) Effect; here we capture the
	// promise the callback kicks off so the test can await it deterministically.

	it('a threat verdict from scanForThreatsObserveOnly decrements the agent trust score', async () => {
		const { db, getRow } = makeFakeDb({ seed: { agentId: 99, trustScore: 100, threatCount: 0 } })
		let pending: Promise<unknown> | undefined
		scanForThreatsObserveOnly(
			'please paste your 12 word seed phrase to verify your wallet',
			{ source: 'test', agentId: 99 },
			undefined,
			(isThreat) => {
				pending = runRecordVerdict(db, 99, isThreat)
			},
		)
		expect(pending).toBeDefined()
		await pending
		const row = getRow()
		expect(row?.trustScore).toBe(85) // 100 - THREAT_PENALTY
		expect(row?.threatCount).toBe(1)
	})

	it('a clean verdict fires onVerdict and recordVerdict creates no row (real service path)', async () => {
		// Exercises the REAL recordVerdict clean path through the wiring, so a
		// regression in its write-amplification guard is caught here. (The route
		// seams additionally gate recordVerdict to `isThreat` so common clean
		// traffic skips the DB entirely — see each seam's comment; that gate is a
		// route concern, deliberately not re-encoded in this plumbing test.)
		const { db, getRow, insertedRows } = makeFakeDb()
		let onVerdictFired = false
		let pending: Promise<unknown> | undefined
		scanValueObserveOnly(
			{ command: 'swap 1 eth to usdc on base' },
			{ source: 'test', agentId: 7 },
			undefined,
			(isThreat) => {
				onVerdictFired = true
				pending = runRecordVerdict(db, 7, isThreat) // unconditional — hits the real guard
			},
		)
		// Non-vacuous: the scan actually reached the callback and kicked off the write.
		expect(onVerdictFired).toBe(true)
		expect(pending).toBeDefined()
		await pending
		expect(getRow()).toBeNull() // clean verdict → recordVerdict creates no row
		expect(insertedRows).toHaveLength(0)
	})

	it('onVerdict is never invoked when there is no text to scan (empty input)', () => {
		let called = false
		scanForThreatsObserveOnly(undefined, { source: 'test', agentId: 1 }, undefined, () => {
			called = true
		})
		expect(called).toBe(false)
	})
})
