import { describe, expect, it } from 'bun:test'
import { Effect, Layer, Option } from 'effect'
import { DrizzleService } from '../db/DrizzleService'
import {
	AgentTrustService,
	AgentTrustServiceLive,
	RECOVERY_INTERVAL_MS,
	TRUST_DEFAULT,
} from '../services/AgentTrustService'

/**
 * Unit coverage for AgentTrustService — the per-agent trust record (Phase 2.3
 * analogue of bot/services/aegis_trust.py, adapted to key on agents.id).
 * RECORD-ONLY: nothing here is enforcement; these tests only pin down the
 * read/write semantics — threat decrement + floor, the write-amplification
 * guard (clean verdicts never create a row, and only recover an existing row
 * once per RECOVERY_INTERVAL_MS), the TRUST_DEFAULT fallback, and fail-open
 * behavior on a DB error.
 *
 * The fake db below mirrors only the exact chainable shapes
 * AgentTrustService.ts calls: select().from().where().limit(), a bare
 * insert().values(vals) (no .returning()), and a bare
 * update().set(vals).where(cond) (no .returning()) — matching the precedent
 * in agentServiceStarterCredits.test.ts's makeFakeDb. It intentionally
 * ignores the `where` condition value and instead tracks a single row for
 * the one agentId each test exercises (these tests never need to
 * disambiguate multiple concurrent agentIds against one fake db instance).
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

	const db: unknown = {
		select(_cols?: unknown) {
			return {
				from(_table: unknown) {
					return {
						where(_cond: unknown) {
							return {
								limit: async (_n: number) => {
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
				values: async (vals: Record<string, unknown>) => {
					if (opts.failWrite) throw new Error('simulated insert failure')
					row = {
						id: 1,
						agentId: vals.agentId as number,
						trustScore: vals.trustScore as number,
						threatCount: vals.threatCount as number,
						cleanCount: vals.cleanCount as number,
						quarantinedUntil: (vals.quarantinedUntil as Date | null) ?? null,
						lastThreatAt: (vals.lastThreatAt as Date | null) ?? null,
						lastSeenAt: (vals.lastSeenAt as Date | null) ?? null,
						createdAt: new Date(),
					}
					insertedRows.push(row)
					return []
				},
			}
		},
		update(_table: unknown) {
			return {
				set: (vals: Record<string, unknown>) => ({
					where: async (_cond: unknown) => {
						if (opts.failWrite) throw new Error('simulated update failure')
						updateCalls.push(vals)
						if (row) row = { ...row, ...vals } as FakeRow
						return []
					},
				}),
			}
		},
	}

	return { db, getRow: () => row, insertedRows, updateCalls }
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

	it('caps the recovery bump at TRUST_MAX (100)', async () => {
		const longAgo = new Date(Date.now() - RECOVERY_INTERVAL_MS * 2)
		const { db, getRow } = makeFakeDb({
			seed: { agentId: 42, trustScore: 100, cleanCount: 1, lastSeenAt: longAgo },
		})
		await runRecordVerdict(db, 42, false)
		expect(getRow()?.trustScore).toBe(100)
	})

	it('falls back to createdAt for the recovery gate when lastSeenAt is null', async () => {
		const longAgo = new Date(Date.now() - RECOVERY_INTERVAL_MS * 2)
		const { db, getRow } = makeFakeDb({
			seed: { agentId: 42, trustScore: 50, cleanCount: 0, lastSeenAt: null, createdAt: longAgo },
		})
		await runRecordVerdict(db, 42, false)
		expect(getRow()?.trustScore).toBe(51)
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

	it('recordVerdict (threat) resolves without throwing when the select fails', async () => {
		const { db } = makeFakeDb({ failSelect: true })
		await expect(runRecordVerdict(db, 42, true)).resolves.toBeUndefined()
	})

	it('recordVerdict (threat) resolves without throwing when the insert fails', async () => {
		const { db } = makeFakeDb({ failWrite: true })
		await expect(runRecordVerdict(db, 42, true)).resolves.toBeUndefined()
	})

	it('recordVerdict (clean) resolves without throwing when the update fails', async () => {
		const longAgo = new Date(Date.now() - RECOVERY_INTERVAL_MS * 2)
		const { db } = makeFakeDb({
			seed: { agentId: 42, trustScore: 50, lastSeenAt: longAgo },
			failWrite: true,
		})
		await expect(runRecordVerdict(db, 42, false)).resolves.toBeUndefined()
	})
})
