import { describe, expect, it } from 'bun:test'
import { caveatsFor, headline, type ProofRun, summarise } from '../services/tenantBots/proof'

/**
 * The proof surface exists because the category it serves has a credibility
 * problem: only 2 of 11 tracked buyback programs actually shrank supply, and
 * the standard failure is a cumulative "total burned" number that implies an
 * effect it never established.
 *
 * So the tests here are mostly about what the page must REFUSE to claim. A
 * summary that quietly folded a dry run into the burn total, or a headline that
 * said "supply reduced", would be the exact thing this module was built to stop.
 */

const at = (iso: string) => new Date(iso)

function run(over: Partial<ProofRun> = {}): ProofRun {
	return {
		status: 'succeeded',
		reason: null,
		spendUsd: 50,
		tokenAmount: '1.2M',
		txHash: '0xabc',
		startedAt: at('2026-08-25T10:00:00Z'),
		...over,
	}
}

describe('summarise — simulated runs are never burns', () => {
	it('keeps executed and simulated in separate buckets', () => {
		const t = summarise([
			run(),
			run({ status: 'simulated', txHash: null }),
			run({ status: 'simulated', txHash: null }),
		])
		expect(t.executedRuns).toBe(1)
		expect(t.executedSpendUsd).toBe(50) // NOT 150
		expect(t.simulatedRuns).toBe(2)
	})

	it('counts refusals and failures rather than dropping them', () => {
		// A page that only shows successes is a highlight reel.
		const t = summarise([
			run(),
			run({ status: 'skipped', reason: 'daily cap reached', spendUsd: 0 }),
			run({ status: 'failed', reason: 'quote failed', spendUsd: 0 }),
		])
		expect(t.skippedRuns).toBe(1)
		expect(t.failedRuns).toBe(1)
		expect(t.executedSpendUsd).toBe(50)
	})

	it('tracks how many executed runs are actually verifiable', () => {
		const t = summarise([run(), run({ txHash: null }), run()])
		expect(t.executedRuns).toBe(3)
		expect(t.verifiableRuns).toBe(2)
	})

	it('finds the true first and last run regardless of input order', () => {
		const t = summarise([
			run({ startedAt: at('2026-08-25T10:00:00Z') }),
			run({ startedAt: at('2026-08-01T10:00:00Z') }),
			run({ startedAt: at('2026-08-20T10:00:00Z') }),
		])
		expect(t.firstRunAt?.toISOString()).toBe('2026-08-01T10:00:00.000Z')
		expect(t.lastRunAt?.toISOString()).toBe('2026-08-25T10:00:00.000Z')
	})

	it('handles an empty history without inventing anything', () => {
		const t = summarise([])
		expect(t.executedRuns).toBe(0)
		expect(t.firstRunAt).toBeNull()
	})
})

describe('headline — never claims a supply effect', () => {
	it('says what was spent, not what it achieved', () => {
		const h = headline(summarise([run(), run()]), 'buy_and_burn', 'PEPE')
		expect(h).toContain('$100')
		expect(h).toContain('burn address')
		// The forbidden claims.
		expect(h).not.toMatch(/supply (is )?(down|reduced|falling)/i)
		expect(h).not.toMatch(/deflationary|price|moon|value/i)
	})

	it('does not dress up an empty record', () => {
		expect(headline(summarise([]), 'buy_and_burn', 'PEPE')).toBe('No burns executed yet')
	})

	it('excludes simulated spend from the headline figure', () => {
		const h = headline(
			summarise([run(), run({ status: 'simulated', txHash: null })]),
			'buy_and_burn',
			'PEPE',
		)
		expect(h).toContain('$50')
		expect(h).not.toContain('$100')
	})

	it('says bought back, not burned, for a buyback', () => {
		const h = headline(summarise([run()]), 'buyback', 'PEPE')
		expect(h).toContain('bought back')
		expect(h).not.toContain('burn')
	})
})

describe('caveats — what the page does not establish', () => {
	const now = at('2026-08-25T12:00:00Z')

	it('always states the supply caveat on a burn with real runs', () => {
		// This is the single most important line on the page: it is the exact
		// inference the whole category gets marked down for making.
		const c = caveatsFor({
			totals: summarise([run()]),
			fundingSource: 'revenue',
			kind: 'buy_and_burn',
			recentFailures: 0,
			now,
		})
		const supply = c.find((x) => x.code === 'no_supply_context')
		expect(supply).toBeDefined()
		expect(supply!.text).toContain('does not tell you whether total supply is falling')
	})

	it('flags unverifiable runs with the exact count', () => {
		const c = caveatsFor({
			totals: summarise([run(), run({ txHash: null }), run({ txHash: null })]),
			fundingSource: 'revenue',
			kind: 'buy_and_burn',
			recentFailures: 0,
			now,
		})
		const v = c.find((x) => x.code === 'unverifiable_runs')
		expect(v).toBeDefined()
		expect(v!.text).toContain('2 of 3')
	})

	it('does not flag verifiability when every run has a hash', () => {
		const c = caveatsFor({
			totals: summarise([run(), run()]),
			fundingSource: 'revenue',
			kind: 'buy_and_burn',
			recentFailures: 0,
			now,
		})
		expect(c.find((x) => x.code === 'unverifiable_runs')).toBeUndefined()
	})

	it('will not let silence about funding read as the flattering answer', () => {
		const c = caveatsFor({
			totals: summarise([run()]),
			fundingSource: 'undisclosed',
			kind: 'buy_and_burn',
			recentFailures: 0,
			now,
		})
		expect(c.find((x) => x.code === 'funding_undisclosed')).toBeDefined()
	})

	it('names treasury funding as finite', () => {
		const c = caveatsFor({
			totals: summarise([run()]),
			fundingSource: 'treasury',
			kind: 'buy_and_burn',
			recentFailures: 0,
			now,
		})
		const t = c.find((x) => x.code === 'treasury_funded')
		expect(t).toBeDefined()
		expect(t!.text).toContain('while the treasury lasts')
	})

	it('adds no funding caveat for a revenue-funded program', () => {
		const c = caveatsFor({
			totals: summarise([run()]),
			fundingSource: 'revenue',
			kind: 'buy_and_burn',
			recentFailures: 0,
			now,
		})
		expect(c.find((x) => x.code === 'funding_undisclosed')).toBeUndefined()
		expect(c.find((x) => x.code === 'treasury_funded')).toBeUndefined()
	})

	it('says plainly when nothing real has run', () => {
		const c = caveatsFor({
			totals: summarise([run({ status: 'simulated', txHash: null })]),
			fundingSource: 'revenue',
			kind: 'buy_and_burn',
			recentFailures: 0,
			now,
		})
		const none = c.find((x) => x.code === 'no_executed_runs')
		expect(none).toBeDefined()
		expect(none!.text).toContain('move nothing')
	})

	it('surfaces a failing streak', () => {
		const c = caveatsFor({
			totals: summarise([run()]),
			fundingSource: 'revenue',
			kind: 'buy_and_burn',
			recentFailures: 3,
			now,
		})
		expect(c.find((x) => x.code === 'recently_failing')).toBeDefined()
	})

	it('surfaces a stalled program', () => {
		// "It quietly stopped three weeks ago" is exactly what a team will not
		// volunteer and exactly what a holder needs.
		const c = caveatsFor({
			totals: summarise([run({ startedAt: at('2026-08-01T10:00:00Z') })]),
			fundingSource: 'revenue',
			kind: 'buy_and_burn',
			recentFailures: 0,
			now,
		})
		const stalled = c.find((x) => x.code === 'stalled')
		expect(stalled).toBeDefined()
		expect(stalled!.text).toContain('24 days')
	})

	it('does not call a program stalled when it ran today', () => {
		const c = caveatsFor({
			totals: summarise([run({ startedAt: at('2026-08-25T10:00:00Z') })]),
			fundingSource: 'revenue',
			kind: 'buy_and_burn',
			recentFailures: 0,
			now,
		})
		expect(c.find((x) => x.code === 'stalled')).toBeUndefined()
	})
})
