import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'
import { PgDialect } from 'drizzle-orm/pg-core'
import {
	keySpendReleaseExpression,
	keySpendReservationCondition,
} from '../middleware/x402Payment'

// MONEY-PATH tests for the per-API-key lifetime spend cap.
//
// apiKeys.rateLimitPerMin bounds calls/minute; it does NOT bound money. Without
// a spend cap a leaked or buggy key can drain the whole shared agentCredits
// balance at the rate-limit ceiling. The cap bounds one credential's blast
// radius.
//
// The cap boundary lives in a single conditional UPDATE's WHERE clause, not in
// JS — that is what makes concurrent calls on the same key unable to both slip
// past it. A JS re-implementation of the predicate would therefore prove
// nothing about what actually runs. Following the pattern already used by
// pointsConcurrency.test.ts / pointsDebit.test.ts, we assert the *compiled SQL*
// and that the guard is wired in at every call site.

const dialect = new PgDialect()
const source = readFileSync(new URL('../middleware/x402Payment.ts', import.meta.url), 'utf8')
const schemaSource = readFileSync(new URL('../db/schema/organizations.ts', import.meta.url), 'utf8')

const KEY = '3f8b2c10-0000-4000-8000-000000000001'

describe('spend cap — reservation SQL', () => {
	it('scopes the update to the calling key', () => {
		const q = dialect.sqlToQuery(keySpendReservationCondition(KEY, 5))
		expect(q.sql).toMatch(/"id"/)
		expect(q.params).toContain(KEY)
	})

	it('treats a NULL limit as unlimited so existing keys are unaffected', () => {
		// The regression guard that matters most: every key in production today
		// has spend_limit_credits NULL. If this OR-branch is ever dropped, every
		// existing integration breaks at once.
		const q = dialect.sqlToQuery(keySpendReservationCondition(KEY, 5))
		expect(q.sql.toLowerCase()).toContain('is null')
		expect(q.sql.toLowerCase()).toContain(' or ')
		expect(q.sql).toMatch(/"spend_limit_credits" is null/i)
	})

	it('compares the LIVE column, never a value read earlier in the request', () => {
		// This is what makes the check-and-increment atomic. The predicate must
		// reference spent_credits (the column) on the left of the comparison —
		// if a caller ever pre-reads the balance and passes a JS number here,
		// two concurrent calls can both pass the check and both increment.
		const q = dialect.sqlToQuery(keySpendReservationCondition(KEY, 5))
		expect(q.sql).toMatch(/"spent_credits"\s*\+/)
		expect(q.sql).toMatch(/"spend_limit_credits"/)
		// cost is bound as a parameter, not inlined
		expect(q.params).toContain(5)
	})

	it('uses <= so spending exactly up to the limit succeeds', () => {
		// Boundary: spent + cost === limit MUST be allowed. A `<` here would
		// silently make every cap off-by-one, rejecting the final legitimate
		// credit. This is the single likeliest bug in the feature.
		const q = dialect.sqlToQuery(keySpendReservationCondition(KEY, 5))
		expect(q.sql).toContain('<=')
		expect(q.sql).not.toMatch(/\+\s*\$\d+\s*<\s*[^=]/)
	})

	it('produces an identical predicate on repeated calls (no captured state)', () => {
		const a = dialect.sqlToQuery(keySpendReservationCondition(KEY, 5))
		const b = dialect.sqlToQuery(keySpendReservationCondition(KEY, 5))
		expect(a.sql).toBe(b.sql)
		expect(a.params).toEqual(b.params)
	})
})

describe('spend cap — release SQL', () => {
	it('floors at zero so a double release cannot drive the counter negative', () => {
		const q = dialect.sqlToQuery(keySpendReleaseExpression(5))
		expect(q.sql.toUpperCase()).toContain('GREATEST')
		expect(q.sql).toMatch(/"spent_credits"\s*-/)
		expect(q.params).toContain(5)
	})

	it('decrements the live column rather than assigning a computed constant', () => {
		const q = dialect.sqlToQuery(keySpendReleaseExpression(3))
		expect(q.sql).toMatch(/"spent_credits"/)
	})
})

describe('spend cap — wiring', () => {
	it('reserves against the key BEFORE deducting agent credits', () => {
		// Ordering matters: if agent credits were deducted first and the cap then
		// rejected, the agent would be charged for a call that never ran.
		const reserveAt = source.indexOf('reserveKeySpend(apiKeyId, cost)')
		const deductAt = source.indexOf('deductCredits(agent.id, cost)')
		expect(reserveAt).toBeGreaterThan(-1)
		expect(deductAt).toBeGreaterThan(-1)
		expect(reserveAt).toBeLessThan(deductAt)
	})

	it('releases the reservation when the agent-credit deduction fails', () => {
		// Insufficient balance and the DB fail-open path both reach a point where
		// no agent credits were spent. The key must not burn cap for those.
		const insufficientBlock = source.slice(
			source.indexOf('const newBalance = deductResult.right'),
			source.indexOf("return { kind: 'insufficient'"),
		)
		expect(insufficientBlock).toContain('releaseKeySpend(apiKeyId, cost)')

		const deductErrBlock = source.slice(
			source.indexOf('if (Either.isLeft(deductResult))'),
			source.indexOf('const newBalance = deductResult.right'),
		)
		expect(deductErrBlock).toContain('releaseKeySpend(apiKeyId, cost)')
	})

	it('releases the reservation on the refund path', () => {
		// A call that was charged and then refunded (handler threw / isError)
		// must give the cap back too, or long-running keys bleed cap on failures.
		const refundBlock = source.slice(source.indexOf('export async function refundChargedCall'))
		expect(refundBlock).toContain('releaseKeySpend(apiKeyId, cost)')
	})

	it('rejects an over-cap call with 403, not the 402 payment challenge', () => {
		// 402 means "pay me"; the agent may hold plenty of credits. This is an
		// authorization limit on the CREDENTIAL, so it must not be retried by an
		// x402 client that would just settle on-chain and sail past the cap.
		const limitBlock = source.slice(source.indexOf("if (result.kind === 'limit_exceeded')"))
		expect(limitBlock).toContain('403')
		expect(limitBlock).toContain('SPEND_LIMIT_EXCEEDED')
	})

	it('never consults the cap for free or bypass-tier calls', () => {
		// cost<=0 and BYPASS_TIERS return before the reservation, so free
		// discovery endpoints can't consume a key's cap.
		const bypassAt = source.indexOf("return { kind: 'skip', reason: 'bypass', tier }")
		const freeAt = source.indexOf("return { kind: 'skip', reason: 'free', tier }")
		const reserveAt = source.indexOf('reserveKeySpend(apiKeyId, cost)')
		expect(bypassAt).toBeLessThan(reserveAt)
		expect(freeAt).toBeLessThan(reserveAt)
	})
})

describe('spend cap — schema', () => {
	it('defaults the limit to NULL (unlimited) and the counter to 0', () => {
		expect(schemaSource).toMatch(/spendLimitCredits:\s*integer\('spend_limit_credits'\)/)
		expect(schemaSource).toMatch(
			/spentCredits:\s*integer\('spent_credits'\)\.default\(0\)\.notNull\(\)/,
		)
		// spendLimitCredits must NOT be notNull or defaulted — that would opt
		// every existing key into a cap on migration.
		expect(schemaSource).not.toMatch(/spend_limit_credits'\)\.default/)
		expect(schemaSource).not.toMatch(/spend_limit_credits'\)\.notNull/)
	})
})
