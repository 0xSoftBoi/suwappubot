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
