import { describe, expect, it } from 'bun:test'
import { PgDialect } from 'drizzle-orm/pg-core'
import { pointsDebitCondition } from '../services/PointsService'

// MONEY-PATH. Points redemption used to check the balance in JS and then write
// `currentPoints - cost` computed from that earlier read. Under Postgres READ
// COMMITTED (our default — no isolation level is configured anywhere) two
// concurrent redemptions both read the same balance, both pass the check, and
// the second write clobbers the first: two rewards, one balance. Wrapping it in
// a transaction does not help; only row-level contention does.
//
// The fix makes the check and the debit one statement, guarded by this
// predicate. The race itself cannot be reproduced in this suite — SQLite has a
// single writer, so it serialises the two callers for free and the buggy code
// passes too. So the guarantee is asserted where it is actually decided: in the
// compiled SQL.
describe('pointsDebitCondition', () => {
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
		// Same shape, different bindings — the cost must never be baked into the
		// statement text.
		expect(a.sql).toBe(b.sql)
	})

	it('ands both terms, so a cost guard can never be dropped while the user match survives', () => {
		const query = dialect.sqlToQuery(pointsDebitCondition(3, 10)!)
		expect(query.sql.toLowerCase()).toContain('and')
	})
})
