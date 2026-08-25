import { describe, expect, it } from 'bun:test'
import { nextRunAfter, parseCron, slotKey } from '../services/tenantBots/cron'
import {
	BURN_SINKS,
	evaluatePostGuards,
	formatPricePost,
	DEFAULT_BURN_ADDRESS,
	evaluateGuards,
	FAILURE_CIRCUIT_LIMIT,
	formatReceipt,
	type GuardInput,
	readBurnConfig,
	usdToTokenUnits,
} from '../services/tenantBots/executor'

/**
 * The money path. Everything here is a question of the form "what stops this
 * from spending someone's treasury when it shouldn't?", so the tests are the
 * adversarial cases rather than the happy one.
 *
 * All pure — no DB, no wallet, no network. The guards are deliberately
 * separable from the orchestration so that this file can exist.
 */

const ARMED: GuardInput = {
	botStatus: 'live',
	enabled: true,
	mode: 'live',
	kind: 'buy_and_burn',
	maxUsdPerRun: 50,
	maxUsdPerDay: 200,
	spentUsd24h: 0,
	requestedUsd: 50,
	treasuryAddress: '0xTREASURY',
	spendTokenSymbol: 'USDC',
	burnAddress: DEFAULT_BURN_ADDRESS,
	consecutiveFailures: 0,
	manual: false,
}

describe('guards — caps are ceilings, not suggestions', () => {
	it('lets a correctly-sized run through', () => {
		expect(evaluateGuards(ARMED)).toEqual({ ok: true, spendUsd: 50 })
	})

	it('clamps a config asking for more than the per-run cap', () => {
		const v = evaluateGuards({ ...ARMED, requestedUsd: 10_000_000 })
		expect(v).toEqual({ ok: true, spendUsd: 50 })
	})

	it('refuses the run that would cross the daily cap', () => {
		const v = evaluateGuards({ ...ARMED, spentUsd24h: 175 })
		expect(v.ok).toBe(false)
		if (!v.ok) expect(v.reason).toBe('daily_cap_reached')
	})

	it('allows the run that exactly reaches the daily cap', () => {
		// 150 + 50 === 200. Off-by-one here is either a spurious refusal every
		// day or a cap that is quietly one run too generous.
		const v = evaluateGuards({ ...ARMED, spentUsd24h: 150 })
		expect(v).toEqual({ ok: true, spendUsd: 50 })
	})

	it('refuses one dollar past the cap', () => {
		const v = evaluateGuards({ ...ARMED, spentUsd24h: 151 })
		expect(v.ok).toBe(false)
	})

	it('falls back to the per-run cap when no daily cap is set', () => {
		const v = evaluateGuards({ ...ARMED, maxUsdPerDay: 0, spentUsd24h: 20 })
		expect(v.ok).toBe(false) // 20 + 50 > 50
	})

	it('refuses a zero or missing per-run cap', () => {
		for (const cap of [0, -5, Number.NaN]) {
			const v = evaluateGuards({ ...ARMED, maxUsdPerRun: cap })
			expect(v.ok).toBe(false)
		}
	})

	it('refuses a spend that rounds to nothing', () => {
		const v = evaluateGuards({ ...ARMED, requestedUsd: 0.4, maxUsdPerRun: 50 })
		expect(v.ok).toBe(false)
		if (!v.ok) expect(v.reason).toBe('no_amount')
	})
})

describe('guards — a burn must actually burn', () => {
	it('accepts every allowlisted sink', () => {
		for (const sink of BURN_SINKS) {
			expect(evaluateGuards({ ...ARMED, burnAddress: sink }).ok).toBe(true)
		}
	})

	it('is case-insensitive about the sink', () => {
		expect(evaluateGuards({ ...ARMED, burnAddress: DEFAULT_BURN_ADDRESS.toUpperCase() }).ok).toBe(
			true,
		)
	})

	it("refuses to send a 'burn' to an arbitrary address", () => {
		const v = evaluateGuards({
			...ARMED,
			burnAddress: '0x1111111111111111111111111111111111111111',
		})
		expect(v.ok).toBe(false)
		if (!v.ok) expect(v.reason).toBe('bad_burn_address')
	})

	it('does not apply the burn allowlist to a buyback', () => {
		// A buyback legitimately keeps its tokens; only buy_and_burn claims to
		// destroy them, so only buy_and_burn is held to it.
		const v = evaluateGuards({ ...ARMED, kind: 'buyback', burnAddress: null })
		expect(v.ok).toBe(true)
	})
})

describe('guards — the simulate/live boundary', () => {
	it('lets a human dry-run a switched-off automation', () => {
		const v = evaluateGuards({ ...ARMED, enabled: false, mode: 'simulate', manual: true })
		expect(v.ok).toBe(true)
	})

	it('never lets the scheduler touch a switched-off automation', () => {
		const v = evaluateGuards({ ...ARMED, enabled: false, mode: 'simulate', manual: false })
		expect(v.ok).toBe(false)
		if (!v.ok) expect(v.reason).toBe('automation_disabled')
	})

	it('never lets a manual LIVE run bypass the disabled flag', () => {
		// The dashboard's run button must not become a way to spend from an
		// automation the operator deliberately switched off.
		const v = evaluateGuards({ ...ARMED, enabled: false, mode: 'live', manual: true })
		expect(v.ok).toBe(false)
		if (!v.ok) expect(v.reason).toBe('automation_disabled')
	})
})

describe('guards — bot state and circuit breaker', () => {
	it('stops spending when the bot is not live', () => {
		for (const status of ['paused', 'draft', 'error', 'provisioning'] as const) {
			const v = evaluateGuards({ ...ARMED, botStatus: status })
			expect(v.ok).toBe(false)
			if (!v.ok) expect(v.reason).toBe('bot_not_live')
		}
	})

	it('opens the circuit at the failure limit', () => {
		expect(evaluateGuards({ ...ARMED, consecutiveFailures: FAILURE_CIRCUIT_LIMIT - 1 }).ok).toBe(
			true,
		)
		const v = evaluateGuards({ ...ARMED, consecutiveFailures: FAILURE_CIRCUIT_LIMIT })
		expect(v.ok).toBe(false)
		if (!v.ok) expect(v.reason).toBe('circuit_open')
	})

	it('refuses without a treasury', () => {
		const v = evaluateGuards({ ...ARMED, treasuryAddress: null })
		expect(v.ok).toBe(false)
		if (!v.ok) expect(v.reason).toBe('no_treasury')
	})

	it('refuses a non-stablecoin spend side', () => {
		// "$50" is only true if the thing being spent is a dollar. Spending 50
		// ETH because someone typed ETH is the bug this prevents.
		for (const sym of ['ETH', 'WBTC', 'PEPE', '']) {
			const v = evaluateGuards({ ...ARMED, spendTokenSymbol: sym })
			expect(v.ok).toBe(false)
			if (!v.ok) expect(v.reason).toBe('unsupported_spend_token')
		}
	})

	it('refuses a kind that does not spend', () => {
		const v = evaluateGuards({ ...ARMED, kind: 'price_post' })
		expect(v.ok).toBe(false)
		if (!v.ok) expect(v.reason).toBe('not_a_spending_automation')
	})
})

describe('usdToTokenUnits', () => {
	it('scales exactly for 6- and 18-decimal tokens', () => {
		expect(usdToTokenUnits(50, 6)).toBe('50000000')
		expect(usdToTokenUnits(1, 6)).toBe('1000000')
		expect(usdToTokenUnits(0.5, 18)).toBe('500000000000000000')
	})

	it('keeps cents rather than drifting on a float', () => {
		expect(usdToTokenUnits(0.07, 6)).toBe('70000')
		expect(usdToTokenUnits(1234.56, 6)).toBe('1234560000')
	})
})

describe('readBurnConfig', () => {
	const bot = { tokenChain: 'base', tokenAddress: '0xTOKEN' }

	it('falls back to the bot token and chain', () => {
		const c = readBurnConfig({ kind: 'buy_and_burn', config: {} }, bot)
		expect(c.chain).toBe('base')
		expect(c.buyToken).toBe('0xTOKEN')
		expect(c.spendToken).toBe('USDC')
		expect(c.burnAddress).toBe(DEFAULT_BURN_ADDRESS)
	})

	it('never invents a spend amount', () => {
		// A missing amount has to mean zero (and be refused downstream), not a
		// default somebody picked.
		expect(readBurnConfig({ kind: 'buy_and_burn', config: {} }, bot).amountUsd).toBe(0)
		expect(
			readBurnConfig({ kind: 'buy_and_burn', config: { amountUsd: 'lots' } }, bot).amountUsd,
		).toBe(0)
	})

	it('leaves a buyback without a burn address', () => {
		expect(readBurnConfig({ kind: 'buyback', config: {} }, bot).burnAddress).toBeNull()
	})
})

describe('formatReceipt', () => {
	it('marks a dry run unmistakably', () => {
		const body = formatReceipt(
			'buy_and_burn',
			{ status: 'simulated', spendUsd: 50, tokenAmount: '1,200' },
			{ symbol: 'PEPE', mark: '🔥 ', simulated: true },
		)
		expect(body).toContain('Dry run')
		expect(body).toContain('Nothing was spent')
	})

	it('does not say "dry run" on a real burn, and links the tx', () => {
		const body = formatReceipt(
			'buy_and_burn',
			{ status: 'succeeded', spendUsd: 50, tokenAmount: '1,200', txHash: '0xabc' },
			{ symbol: 'PEPE', mark: '', simulated: false, explorerUrl: 'https://basescan.org/tx/0xabc' },
		)
		expect(body).not.toContain('Dry run')
		expect(body).toContain('basescan.org/tx/0xabc')
		expect(body).toContain('Burn complete')
	})
})

describe('cron', () => {
	const from = new Date('2026-03-10T08:17:30Z') // a Tuesday

	it('computes common schedules', () => {
		const cases: [string, string][] = [
			['0 * * * *', '2026-03-10T09:00:00.000Z'],
			['*/15 * * * *', '2026-03-10T08:30:00.000Z'],
			['0 */6 * * *', '2026-03-10T12:00:00.000Z'],
			['0 13 * * *', '2026-03-10T13:00:00.000Z'],
			['30 9 * * 1', '2026-03-16T09:30:00.000Z'], // next Monday
			['0 0 1 * *', '2026-04-01T00:00:00.000Z'],
		]
		for (const [expr, expected] of cases) {
			expect(nextRunAfter(expr, from)?.toISOString()).toBe(expected)
		}
	})

	it('is strictly after `from`, so walking never repeats a slot', () => {
		const exact = new Date('2026-03-10T09:00:00.000Z')
		expect(nextRunAfter('0 * * * *', exact)?.toISOString()).toBe('2026-03-10T10:00:00.000Z')
	})

	it('returns null rather than guessing', () => {
		const bad = [
			'@hourly',
			'0 * * *',
			'0 * * * * *',
			'60 * * * *',
			'0 24 * * *',
			'0 * * * 7',
			'0 * * * *; rm -rf /',
			'$(whoami) * * * *',
			'',
			'   ',
			null,
			undefined,
		]
		for (const expr of bad) {
			expect(nextRunAfter(expr as string, from)).toBeNull()
		}
	})

	it('implements the day-of-month / day-of-week OR rule', () => {
		// Classic cron: both restricted means EITHER matches. 2026-03-10 is a
		// Tuesday, so a "1st of the month OR Monday" schedule hits Monday the 16th.
		const f = parseCron('0 0 1 * 1')
		expect(f?.domRestricted && f?.dowRestricted).toBe(true)
		expect(nextRunAfter('0 0 1 * 1', from)?.toISOString()).toBe('2026-03-16T00:00:00.000Z')
	})

	it('handles a leap-day schedule without hanging', () => {
		expect(nextRunAfter('0 0 29 2 *', from)?.toISOString()).toBe('2028-02-29T00:00:00.000Z')
	})

	it('gives up on a date that never comes', () => {
		// 30 February. Must return null rather than search forever.
		expect(nextRunAfter('0 0 30 2 *', from)).toBeNull()
	})
})

describe('slotKey', () => {
	it('is stable to the minute, so a retry in the same slot collides', () => {
		const a = slotKey('auto-1', new Date('2026-03-10T09:00:00.000Z'))
		const b = slotKey('auto-1', new Date('2026-03-10T09:00:59.999Z'))
		expect(a).toBe(b)
	})

	it('separates slots, automations and minutes', () => {
		expect(slotKey('auto-1', new Date('2026-03-10T09:00:00Z'))).not.toBe(
			slotKey('auto-1', new Date('2026-03-10T10:00:00Z')),
		)
		expect(slotKey('auto-1', new Date('2026-03-10T09:00:00Z'))).not.toBe(
			slotKey('auto-2', new Date('2026-03-10T09:00:00Z')),
		)
	})
})

describe('posting automations', () => {
	const POST = {
		botStatus: 'live' as const,
		enabled: true,
		kind: 'price_post',
		tokenAddress: '0xTOKEN',
		announceChatId: '-100123',
		manual: false,
	}

	it('posts when armed and configured', () => {
		expect(evaluatePostGuards(POST).ok).toBe(true)
	})

	it('will not post from a paused bot', () => {
		const v = evaluatePostGuards({ ...POST, botStatus: 'paused' })
		expect(v.ok).toBe(false)
		if (!v.ok) expect(v.reason).toBe('bot_not_live')
	})

	it('needs a chat on the scheduled path but not for a manual preview', () => {
		expect(evaluatePostGuards({ ...POST, announceChatId: undefined }).ok).toBe(false)
		expect(evaluatePostGuards({ ...POST, announceChatId: undefined, manual: true }).ok).toBe(true)
	})

	it('refuses a spending kind', () => {
		// The two paths must not be able to swap places: a buy_and_burn routed
		// into the posting branch would skip every spend guard there is.
		const v = evaluatePostGuards({ ...POST, kind: 'buy_and_burn' })
		expect(v.ok).toBe(false)
		if (!v.ok) expect(v.reason).toBe('not_a_spending_automation')
	})

	it('needs a token', () => {
		expect(evaluatePostGuards({ ...POST, tokenAddress: null }).ok).toBe(false)
	})
})

describe('formatPricePost', () => {
	it('states measured facts and never predicts', () => {
		const body = formatPricePost(
			'price_post',
			{ symbol: 'PEPE', priceUsd: 0.00000123, change24h: 12, volume24hUsd: 250_000, liquidityUsd: 90_000 },
			'🔥 ',
		)
		expect(body).toContain('PEPE')
		expect(body).toContain('24h')
		expect(body).not.toMatch(/moon|pump|will|guarantee|expect/i)
	})

	it('reports no burns honestly rather than omitting the line', () => {
		const body = formatPricePost('holder_report', { symbol: 'PEPE', priceUsd: 1 }, '')
		expect(body).toContain('No burns executed yet')
	})

	it('reports burn totals when there are some', () => {
		const body = formatPricePost(
			'holder_report',
			{ symbol: 'PEPE', priceUsd: 1, burnedRuns: 4, burnedSpendUsd: 200 },
			'',
		)
		expect(body).toContain('Burns executed: *4*')
		expect(body).toContain('$200')
	})

	it('renders a missing number as an em dash, not as zero', () => {
		const body = formatPricePost('price_post', { symbol: 'X', priceUsd: null }, '')
		expect(body).toContain('—')
		expect(body).not.toContain('$0.00')
	})
})
