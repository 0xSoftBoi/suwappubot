import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'
import { PgDialect } from 'drizzle-orm/pg-core'
import { pointsDebitCondition, pointsDebitSet } from '../services/PointsService'

// MONEY-PATH. Points redemption used to check the balance in JS and then write
// `currentPoints - cost` computed from that earlier read. Under Postgres READ
// COMMITTED (our default — no isolation level is configured anywhere) two
// concurrent redemptions both read the same balance, both pass the check, and
// the second write clobbers the first: two rewards, one balance. Wrapping it in
// a transaction does not help; only row-level contention does.
//
// The race cannot be reproduced in this suite — SQLite has a single writer, so
// it serialises the two callers for free and the BUGGY code passes too. So the
// guarantee is asserted where it is actually decided: in the compiled SQL.
//
// Both halves are pinned deliberately. Pinning only the WHERE clause would let
// someone revert the `set` to JS arithmetic with every test still green, and
// the SQL-side arithmetic is the more fragile half.
describe('points debit — WHERE guard', () => {
	const dialect = new PgDialect()

	it('constrains the debit to rows that still hold at least the cost', () => {
		const query = dialect.sqlToQuery(pointsDebitCondition(7, 500)!)

		// The >= guard is the whole fix: without it the UPDATE matches the row
		// regardless of balance and the loser of a race still gets its reward.
		expect(query.sql).toContain('>=')
		expect(query.sql).toMatch(/current_points/)
		expect(query.sql).toMatch(/user_id/)
		expect(query.params).toEqual([7, 500])
	})

	it('parameterises user and cost separately, so neither is interpolated', () => {
		const a = dialect.sqlToQuery(pointsDebitCondition(1, 100)!)
		const b = dialect.sqlToQuery(pointsDebitCondition(2, 250)!)

		expect(a.params).toEqual([1, 100])
		expect(b.params).toEqual([2, 250])
		expect(a.sql).toBe(b.sql)
	})

	it('ands both terms, so the cost guard cannot be dropped while the user match survives', () => {
		const query = dialect.sqlToQuery(pointsDebitCondition(3, 10)!)
		expect(query.sql.toLowerCase()).toContain('and')
	})
})

describe('points debit — SET arithmetic', () => {
	const dialect = new PgDialect()

	it('subtracts from the live column, not from a JS-side balance', () => {
		const { sql: setSql, params } = dialect.sqlToQuery(pointsDebitSet(250).currentPoints)

		// Must reference the column itself. A regression to `currentPoints: N - cost`
		// would compile to a bare parameter with no column reference — that is
		// exactly the lost-update bug, and this assertion is what catches it.
		expect(setSql).toMatch(/current_points/)
		expect(setSql).toContain('-')
		expect(params).toEqual([250])
	})

	it('adds the same cost to points_spent from the live column', () => {
		const { sql: setSql, params } = dialect.sqlToQuery(pointsDebitSet(250).pointsSpent)

		expect(setSql).toMatch(/points_spent/)
		expect(setSql).toContain('+')
		expect(params).toEqual([250])
	})

	it('moves the same amount out of currentPoints as into pointsSpent', () => {
		// currentPoints -= cost and pointsSpent += cost must use one value, or the
		// invariant currentPoints = totalPointsEarned - pointsSpent silently drifts.
		const set = pointsDebitSet(1234)
		expect(dialect.sqlToQuery(set.currentPoints).params).toEqual(
			dialect.sqlToQuery(set.pointsSpent).params,
		)
	})
})

describe('points debit — helpers are actually wired in at the call sites', () => {
	// The compiled-SQL tests above pass even if someone inlines
	// `currentPoints: current.currentPoints - cost` back into redeemReward and
	// leaves the helpers untouched. Assert the call sites use them, so the
	// regression that reintroduces the double-spend cannot land silently.
	const source = readFileSync(
		new URL('../services/PointsService.ts', import.meta.url),
		'utf8',
	)

	it('both debit sites go through pointsDebitSet', () => {
		const uses = source.match(/\.set\(pointsDebitSet\(/g) ?? []
		expect(uses.length).toBe(2)
	})

	it('both debit sites go through pointsDebitCondition', () => {
		const uses = source.match(/\.where\(pointsDebitCondition\(/g) ?? []
		expect(uses.length).toBe(2)
	})

	it('no balance is written from a JS-side read', () => {
		// The exact shape of the original bug.
		expect(source).not.toMatch(/currentPoints:\s*\w+\.currentPoints\s*[-+]/)
		expect(source).not.toMatch(/pointsSpent:\s*\w+\.pointsSpent\s*[-+]/)
	})

	it('reward stock is decremented in SQL and guarded, at both redemption paths', () => {
		// The subscription path shipped with `stock: rStock - 1` and no guard —
		// two users could redeem the last unit. Both paths must now be relative.
		expect(source).not.toMatch(/stock:\s*\w+\s*-\s*1\b/)
		const guarded = source.match(/gte\(rewards\.stock,\s*1\)/g) ?? []
		expect(guarded.length).toBe(2)
	})

	it('the level-up bonus adds only the bonus, never the triggering award again', () => {
		// If this is ever "cleaned up" to also add pointAmount, every level-up
		// double-credits the award that triggered it. The preceding statement
		// already applied pointAmount relative to the live row.
		const helperStart = source.indexOf('async function awardLevelUpBonusTx(')
		const bonusWrite = source.slice(helperStart, source.indexOf('export function pointsDebitSet'))
		expect(bonusWrite).toContain('POINT_ACTIONS.level_up.points')
		expect(bonusWrite).not.toMatch(/currentPoints:.*\+ \$\{pointAmount\}/)
	})
})
