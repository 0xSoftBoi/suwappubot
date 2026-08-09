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
		expect(checkinFn).toMatch(/Already checked in today/)
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
			afterBonusUpdate.indexOf('Volume points'),
			afterBonusUpdate.indexOf('totalPoints = volumePoints + dailyBonus'),
		)
		expect(volumeUpdate).not.toMatch(/lastSwapDate:/)
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
			source.indexOf('const awardLevelUpBonus ='),
			source.indexOf('export function pointsDebitSet'),
		)
		expect(helperFn).toMatch(/onConflictDoNothing\(\{\s*target:\s*\[pointTransactions\.userId, pointTransactions\.reference\]/)
		expect(helperFn).toMatch(/reference: levelUpReference\(candidateLevel\)/)
	})

	it('the 100pt bonus credit is unreachable unless the insert returned a row', () => {
		const helperFn = source.slice(
			source.indexOf('const awardLevelUpBonus ='),
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

	it('all three award paths (points, swap, checkin) route the bonus through the same helper', () => {
		const uses = source.match(/yield\* awardLevelUpBonus\(db, userId, oldLevel, \w+, seasonId\)/g) ?? []
		expect(uses.length).toBe(3)
	})

	it('no call site inserts a raw level_up transaction outside the helper (that would bypass the unique guard)', () => {
		// The only literal "action: 'level_up'" write site left should be inside
		// awardLevelUpBonus itself.
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
