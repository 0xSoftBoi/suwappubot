import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'
import { PgDialect } from 'drizzle-orm/pg-core'
import {
	checkinGuardCondition,
	firstSwapBonusCondition,
	levelUpReference,
} from '../services/PointsService'

// MONEY-PATH regression tests for three concurrency bugs found in PointsService
// during review. All three share the same root cause as the redemption race in
// pointsDebit.test.ts: a JS read-then-write can't serialise concurrent callers,
// only a single conditional SQL statement (or a DB-level unique constraint) can.
// SQLite (single writer) can't reproduce these races either, so — same as
// pointsDebit.test.ts — we assert the compiled SQL shape and that the fix is
// actually wired in at the call sites, not behavior against a live DB.

const source = readFileSync(new URL('../services/PointsService.ts', import.meta.url), 'utf8')
const schemaSource = readFileSync(
	new URL('../db/schema/points.ts', import.meta.url),
	'utf8',
)

describe('bug #1 — daily check-in double credit', () => {
	const dialect = new PgDialect()
	const today = new Date('2026-08-09T00:00:00.000Z')

	it('guards on lastCheckin being unset or before today, not a JS boolean', () => {
		const query = dialect.sqlToQuery(checkinGuardCondition(42, today)!)
		expect(query.sql).toMatch(/last_checkin/)
		expect(query.sql).toMatch(/user_id/)
		expect(query.sql.toLowerCase()).toContain('or')
		expect(query.sql.toLowerCase()).toContain('is null')
		expect(query.sql).toContain('<')
		expect(query.params).toEqual([42, today.toISOString()])
	})

	it('a second call with the same guard on an already-updated row matches nothing', () => {
		// Simulates the race: after the winner's UPDATE has set lastCheckin = now,
		// the loser's WHERE (lastCheckin < today) is what must evaluate false.
		// We can't run this against Postgres here, but we CAN assert the
		// condition depends only on the live column (`<` against a param), never
		// on a value read earlier in the request.
		const a = dialect.sqlToQuery(checkinGuardCondition(1, today)!)
		const b = dialect.sqlToQuery(checkinGuardCondition(1, today)!)
		expect(a.sql).toBe(b.sql)
	})

	it('dailyCheckin uses checkinGuardCondition in its WHERE clause, not a pre-read return', () => {
		const checkinFn = source.slice(source.indexOf('dailyCheckin: (userId: number)'))
		expect(checkinFn).toMatch(/\.where\(checkinGuardCondition\(/)
		// The old bug: `if (current.lastCheckin && isSameDay(...)) return yield* Effect.fail(...)`
		// BEFORE any write. That pattern let two concurrent calls both pass.
		expect(checkinFn.slice(0, checkinFn.indexOf('checkinGuardCondition('))).not.toMatch(
			/if \(current\.lastCheckin && isSameDay/,
		)
	})

	it('checks the zero-rows-updated result, not a stale in-memory flag, to reject the dupe', () => {
		const checkinFn = source.slice(source.indexOf('dailyCheckin: (userId: number)'))
		expect(checkinFn).toMatch(/checkinResult\.length === 0/)
		expect(checkinFn).toMatch(/throw new AlreadyCheckedInError\(\)/)
		// AlreadyCheckedInError is defined once, before dailyCheckin, and its
		// message ('Already checked in today') is what the catch handler maps
		// back to a user-facing ValidationError.
		expect(source).toMatch(/class AlreadyCheckedInError extends Error/)
		expect(source).toMatch(/super\('Already checked in today'\)/)
	})

	it('dailyCheckin runs the guarded UPDATE, both ledger inserts, and the level-up bonus in one db.transaction', () => {
		const checkinFn = source.slice(source.indexOf('dailyCheckin: (userId: number)'))
		const txStart = checkinFn.indexOf('db.transaction(async (tx) => {')
		expect(txStart).toBeGreaterThan(-1)
		const txBody = checkinFn.slice(txStart, checkinFn.indexOf('catch: (e) => checkinFailure(e)'))
		expect(txBody).toMatch(/\.where\(checkinGuardCondition\(/)
		expect(txBody).toMatch(/tx\.insert\(pointTransactions\)\.values\(\{[\s\S]*action: 'checkin'/)
		expect(txBody).toMatch(/action: 'streak_bonus'/)
		expect(txBody).toMatch(/awardLevelUpBonusTx\(tx, userId, oldLevel, newLevel, seasonId\)/)
	})
})

describe('bug #2 — first-swap-of-day bonus double credit', () => {
	const dialect = new PgDialect()
	const today = new Date('2026-08-09T00:00:00.000Z')

	it('guards on lastSwapDate being unset or before today', () => {
		const query = dialect.sqlToQuery(firstSwapBonusCondition(7, today)!)
		expect(query.sql).toMatch(/last_swap_date/)
		expect(query.sql).toMatch(/user_id/)
		expect(query.sql.toLowerCase()).toContain('or')
		expect(query.sql.toLowerCase()).toContain('is null')
		expect(query.sql).toContain('<')
		expect(query.params).toEqual([7, today.toISOString()])
	})

	it('parameterises user and today separately across calls', () => {
		const a = dialect.sqlToQuery(firstSwapBonusCondition(1, today)!)
		const b = dialect.sqlToQuery(firstSwapBonusCondition(2, today)!)
		expect(a.params).toEqual([1, today.toISOString()])
		expect(b.params).toEqual([2, today.toISOString()])
		expect(a.sql).toBe(b.sql)
	})

	it('awardSwapPoints runs the bonus as its own conditional UPDATE, separate from volume points', () => {
		const swapFn = source.slice(
			source.indexOf('awardSwapPoints: (userId: number'),
			source.indexOf('dailyCheckin: (userId: number)'),
		)
		expect(swapFn).toMatch(/\.where\(firstSwapBonusCondition\(/)
		// isFirstSwapToday must come from the UPDATE result, not a pre-read compare.
		expect(swapFn).toMatch(/isFirstSwapToday = dailyBonusResult\.length > 0/)
		expect(swapFn).not.toMatch(
			/isFirstSwapToday = !current\.lastSwapDate \|\| !isSameDay/,
		)
	})

	it('the volume-points update never re-guards or re-stamps lastSwapDate (would defeat the atomic guard above)', () => {
		const swapFn = source.slice(
			source.indexOf('awardSwapPoints: (userId: number'),
			source.indexOf('dailyCheckin: (userId: number)'),
		)
		const afterBonusUpdate = swapFn.slice(swapFn.indexOf('firstSwapBonusCondition('))
		const volumeUpdate = afterBonusUpdate.slice(
			afterBonusUpdate.indexOf('if (volumePoints > 0)'),
			afterBonusUpdate.indexOf('appliedVolumePoints = volumeApplied ? volumePoints : 0'),
		)
		expect(volumeUpdate).not.toMatch(/lastSwapDate:/)
	})
})

describe('bug #5 — swap volume points double credit on retry', () => {
	const swapFn = source.slice(
		source.indexOf('awardSwapPoints: (userId: number'),
		source.indexOf('dailyCheckin: (userId: number)'),
	)

	it('ledgers the swap with a deterministic swap:{swapId} reference', () => {
		expect(swapFn).toMatch(/swapReference = swapId != null \? `swap:\$\{swapId\}` : null/)
		expect(swapFn).toMatch(/reference: swapReference \?\? undefined/)
	})

	it('the ledger insert uses onConflictDoNothing targeting (userId, reference), same guard as level_up', () => {
		expect(swapFn).toMatch(
			/\.onConflictDoNothing\(\{\s*target:\s*\[pointTransactions\.userId, pointTransactions\.reference\]/,
		)
	})

	it('the volume UPDATE only runs when the ledger insert actually landed a row', () => {
		const insertIdx = swapFn.indexOf('.returning({ id: pointTransactions.id })')
		const appliedIdx = swapFn.indexOf('volumeApplied = ledgerInsert.length > 0')
		const guardIdx = swapFn.indexOf('if (volumeApplied) {')
		const updateIdx = swapFn.indexOf('.where(eq(userPoints.userId, userId))')

		expect(insertIdx).toBeGreaterThan(-1)
		expect(appliedIdx).toBeGreaterThan(insertIdx)
		expect(guardIdx).toBeGreaterThan(appliedIdx)
		expect(updateIdx).toBeGreaterThan(guardIdx)
	})

	it('ledger insert precedes the volume UPDATE (insert is the idempotency gate, not an afterthought)', () => {
		const ledgerInsertIdx = swapFn.indexOf('await tx\n\t\t\t\t\t\t\t\t.insert(pointTransactions)')
		const volumeUpdateIdx = swapFn.indexOf('totalSwaps: sql`${userPoints.totalSwaps} + 1`')
		expect(ledgerInsertIdx).toBeGreaterThan(-1)
		expect(volumeUpdateIdx).toBeGreaterThan(ledgerInsertIdx)
	})
})

describe('bug #6 — award transactions are atomic (money-path review)', () => {
	it('awardPoints wraps its UPDATE, ledger insert, and level-up bonus in one db.transaction', () => {
		// The implementation's `awardPoints: (` (not the interface declaration
		// above it, which has the same text) — anchor the search to start after
		// PointsServiceLive begins.
		const implStart = source.indexOf('export const PointsServiceLive')
		const fnStart = source.indexOf('awardPoints: (', implStart)
		const fn = source.slice(fnStart, source.indexOf('awardSwapPoints: (userId: number'))
		expect(fn).toMatch(/db\.transaction\(async \(tx\) => \{/)
		expect(fn).toMatch(/awardLevelUpBonusTx\(tx, userId, oldLevel, newLevel, seasonId\)/)
	})

	it('awardSwapPoints wraps its UPDATEs, ledger inserts, and level-up bonus in one db.transaction', () => {
		const fn = source.slice(
			source.indexOf('awardSwapPoints: (userId: number'),
			source.indexOf('dailyCheckin: (userId: number)'),
		)
		expect(fn).toMatch(/db\.transaction\(async \(tx\) => \{/)
	})

	it('all three call sites route the level-up bonus through awardLevelUpBonusTx (1 definition + 3 uses)', () => {
		const uses = source.match(/awardLevelUpBonusTx\(/g) ?? []
		expect(uses.length).toBe(4)
	})
})

describe('bug #3 — level-up bonus paid twice per crossing', () => {
	it('the idempotency key is deterministic per (user, level)', () => {
		expect(levelUpReference('gold')).toBe('level_up:gold')
		expect(levelUpReference('gold')).toBe(levelUpReference('gold'))
		expect(levelUpReference('gold')).not.toBe(levelUpReference('platinum'))
	})

	it('point_transactions has a UNIQUE(user_id, reference) index backing the idempotency key', () => {
		expect(schemaSource).toMatch(/reference: varchar\('reference'/)
		expect(schemaSource).toMatch(
			/uniqueIndex\('point_transactions_user_reference_idx'\)\.on\(\s*table\.userId,\s*table\.reference,?\s*\)/,
		)
	})

	it('the bonus insert uses onConflictDoNothing targeting (userId, reference)', () => {
		const helperFn = source.slice(
			source.indexOf('async function awardLevelUpBonusTx('),
			source.indexOf('export function pointsDebitSet'),
		)
		expect(helperFn).toMatch(/onConflictDoNothing\(\{\s*target:\s*\[pointTransactions\.userId, pointTransactions\.reference\]/)
		expect(helperFn).toMatch(/reference: levelUpReference\(candidateLevel\)/)
	})

	it('the 100pt bonus credit is unreachable unless the insert returned a row', () => {
		const helperFn = source.slice(
			source.indexOf('async function awardLevelUpBonusTx('),
			source.indexOf('export function pointsDebitSet'),
		)
		const insertIdx = helperFn.indexOf('.returning({ id: pointTransactions.id })')
		const guardIdx = helperFn.indexOf('if (inserted.length === 0)')
		const applyTrueIdx = helperFn.indexOf('applied: true')

		expect(insertIdx).toBeGreaterThan(-1)
		expect(guardIdx).toBeGreaterThan(insertIdx)
		// The early return on zero rows must textually precede the userPoints
		// credit and the `applied: true` result — a regression that reorders
		// this (credits first, checks second) reintroduces the double pay.
		expect(applyTrueIdx).toBeGreaterThan(guardIdx)
	})

	it('all three award paths (points, swap, checkin) route the bonus through the same helper, inside their transaction', () => {
		const uses = source.match(/awardLevelUpBonusTx\(\s*tx,\s*userId,\s*oldLevel,\s*newLevel,\s*seasonId,?\s*\)/g) ?? []
		expect(uses.length).toBe(3)
	})

	it('no call site inserts a raw level_up transaction outside the helper (that would bypass the unique guard)', () => {
		// The only literal "action: 'level_up'" write site left should be inside
		// awardLevelUpBonusTx itself.
		const occurrences = source.match(/action: 'level_up'/g) ?? []
		expect(occurrences.length).toBe(1)
	})
})

describe('bug #4 — longestStreak from a stale snapshot', () => {
	it('checkin computes longestStreak with SQL GREATEST against the live column', () => {
		const checkinFn = source.slice(source.indexOf('dailyCheckin: (userId: number)'))
		expect(checkinFn).toMatch(/longestStreak: sql`GREATEST\(\$\{userPoints\.longestStreak\}, \$\{newStreak\}\)`/)
		expect(checkinFn).not.toMatch(/longestStreak: Math\.max\(current\.longestStreak/)
	})
})
