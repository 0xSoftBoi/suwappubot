import { describe, expect, it } from 'bun:test'
import { evaluateGates, shouldExit, exitSlippageBps } from '../services/autopilot/gates'
import {
	type AutopilotRules,
	type Candidate,
	DEFAULT_RULES,
	type PortfolioState,
	type Thesis,
} from '../services/autopilot/types'

const NOW = 1_800_000_000_000
const TOKEN = '0xAbCdef0000000000000000000000000000000001'

const candidate = (over: Partial<Candidate> = {}): Candidate => ({
	chain: 'base',
	tokenAddress: TOKEN,
	symbol: 'CATE',
	priceUsd: 0.0012,
	liquidityUsd: 250_000,
	volume24hUsd: 400_000,
	ageMinutes: 720,
	security: {
		isHoneypot: false,
		buyTaxBps: 100,
		sellTaxBps: 100,
		topHolderPct: 22,
		lpLocked: true,
	},
	...over,
})

const thesis = (over: Partial<Thesis> = {}): Thesis => ({
	action: 'buy',
	chain: 'base',
	tokenAddress: TOKEN,
	symbol: 'CATE',
	sizeUsd: 50,
	confidence: 0.8,
	headline: 'liquidity + volume expansion',
	reasoning: 'depth is rising faster than price',
	evidence: { liquidityUsd: 250_000 },
	exit: { stopLossPct: 20, takeProfitPct: 60, invalidation: 'liquidity drops below $100k' },
	engine: 'rules',
	engineVersion: '1',
	formedAt: new Date(NOW).toISOString(),
	...over,
})

const portfolio = (over: Partial<PortfolioState> = {}): PortfolioState => ({
	equityUsd: 1000,
	deployedUsd: 100,
	openPositions: [],
	spentTodayUsd: 0,
	realizedPnlTodayUsd: 0,
	unrealizedPnlUsd: 0,
	lastTradeAtByToken: {},
	...over,
})

const failedRules = (v: { results: { rule: string; passed: boolean }[] }) =>
	v.results.filter((r) => !r.passed).map((r) => r.rule)

describe('evaluateGates — happy path', () => {
	it('passes a clean entry', () => {
		const v = evaluateGates(thesis(), candidate(), portfolio(), DEFAULT_RULES, NOW)
		expect(failedRules(v)).toEqual([])
		expect(v.passed).toBe(true)
		expect(v.rejectionReason).toBeUndefined()
	})

	it('runs every rule instead of short-circuiting on the first failure', () => {
		const v = evaluateGates(
			thesis({ sizeUsd: 10_000, confidence: 0.1 }),
			candidate({ liquidityUsd: 100 }),
			portfolio(),
			DEFAULT_RULES,
			NOW,
		)
		expect(failedRules(v).length).toBeGreaterThan(2)
		expect(v.rejectionReason).toContain('max_position_size')
	})
})

describe('evaluateGates — refusals', () => {
	it('refuses an oversized position', () => {
		const v = evaluateGates(thesis({ sizeUsd: 500 }), candidate(), portfolio(), DEFAULT_RULES, NOW)
		expect(failedRules(v)).toContain('max_position_size')
	})

	it('refuses thin liquidity and refuses being too big a share of the pool', () => {
		const v = evaluateGates(
			thesis({ sizeUsd: 90 }),
			candidate({ liquidityUsd: 8_000 }),
			portfolio(),
			DEFAULT_RULES,
			NOW,
		)
		expect(failedRules(v)).toContain('min_liquidity')
		expect(failedRules(v)).toContain('max_pool_share')
	})

	it('refuses a honeypot and a high-tax token', () => {
		const v = evaluateGates(
			thesis(),
			candidate({
				security: {
					isHoneypot: true,
					buyTaxBps: 2000,
					sellTaxBps: 9000,
					topHolderPct: 10,
					lpLocked: true,
				},
			}),
			portfolio(),
			DEFAULT_RULES,
			NOW,
		)
		expect(failedRules(v)).toContain('not_honeypot')
		expect(failedRules(v)).toContain('max_buy_tax')
		expect(failedRules(v)).toContain('max_sell_tax')
	})

	it('refuses when security data or pool age is missing rather than assuming the best', () => {
		const noSec = candidate()
		delete (noSec as { security?: unknown }).security
		delete (noSec as { ageMinutes?: unknown }).ageMinutes
		const v = evaluateGates(thesis(), noSec, portfolio(), DEFAULT_RULES, NOW)
		expect(failedRules(v)).toContain('min_token_age')
		expect(failedRules(v)).toContain('security_scan_present')
	})

	it('refuses when no market snapshot backs the thesis', () => {
		const v = evaluateGates(thesis(), undefined, portfolio(), DEFAULT_RULES, NOW)
		expect(failedRules(v)).toContain('market_data_present')
	})

	it('refuses an unlocked LP when the rule demands one', () => {
		const v = evaluateGates(
			thesis(),
			candidate({
				security: {
					isHoneypot: false,
					buyTaxBps: 0,
					sellTaxBps: 0,
					topHolderPct: 10,
					lpLocked: false,
				},
			}),
			portfolio(),
			DEFAULT_RULES,
			NOW,
		)
		expect(failedRules(v)).toContain('lp_locked')
	})

	it('refuses concentrated supply', () => {
		const v = evaluateGates(
			thesis(),
			candidate({
				security: {
					isHoneypot: false,
					buyTaxBps: 0,
					sellTaxBps: 0,
					topHolderPct: 88,
					lpLocked: true,
				},
			}),
			portfolio(),
			DEFAULT_RULES,
			NOW,
		)
		expect(failedRules(v)).toContain('holder_concentration')
	})

	it('refuses a chain outside the allowlist and a denied token', () => {
		const rules: AutopilotRules = { ...DEFAULT_RULES, deniedTokens: [TOKEN.toLowerCase()] }
		const v = evaluateGates(
			thesis({ chain: 'ethereum' }),
			candidate({ chain: 'ethereum' }),
			portfolio(),
			rules,
			NOW,
		)
		expect(failedRules(v)).toContain('chain_allowed')
		expect(failedRules(v)).toContain('token_not_denied')
	})

	it("refuses to buy the book's own quote asset", () => {
		// Observed live: the screener handed back USDC and WETH as candidates for a
		// USDC-denominated agent. The screener is fixed; this is the backstop.
		const p = portfolio({ baseToken: TOKEN })
		expect(failedRules(evaluateGates(thesis(), candidate(), p, DEFAULT_RULES, NOW))).toContain(
			'not_base_token',
		)
	})

	it('allows a normal token when a base token is known', () => {
		const p = portfolio({ baseToken: '0xUSDC000000000000000000000000000000000001' })
		expect(failedRules(evaluateGates(thesis(), candidate(), p, DEFAULT_RULES, NOW))).not.toContain(
			'not_base_token',
		)
	})

	it('refuses a second position in a token it already holds', () => {
		const p = portfolio({
			openPositions: [
				{
					id: 1,
				chain: 'base',
					tokenAddress: TOKEN.toLowerCase(),
					symbol: 'CATE',
					amount: '1',
					costBasisUsd: 50,
					avgEntryPriceUsd: 0.001,
					openedAt: NOW - 10_000,
				},
			],
		})
		const v = evaluateGates(thesis(), candidate(), p, DEFAULT_RULES, NOW)
		expect(failedRules(v)).toContain('no_duplicate_position')
	})

	it('refuses once the daily spend cap or the loss halt is hit', () => {
		const capped = evaluateGates(
			thesis({ sizeUsd: 60 }),
			candidate(),
			portfolio({ spentTodayUsd: 480 }),
			DEFAULT_RULES,
			NOW,
		)
		expect(failedRules(capped)).toContain('daily_spend_cap')

		const halted = evaluateGates(
			thesis(),
			candidate(),
			portfolio({ realizedPnlTodayUsd: -250 }),
			DEFAULT_RULES,
			NOW,
		)
		expect(failedRules(halted)).toContain('daily_loss_halt')
	})

	it('enforces the per-token cooldown', () => {
		const p = portfolio({ lastTradeAtByToken: { [TOKEN.toLowerCase()]: NOW - 60_000 } })
		expect(failedRules(evaluateGates(thesis(), candidate(), p, DEFAULT_RULES, NOW))).toContain(
			'token_cooldown',
		)

		const cooled = portfolio({
			lastTradeAtByToken: { [TOKEN.toLowerCase()]: NOW - 5 * 60 * 60 * 1000 },
		})
		expect(
			failedRules(evaluateGates(thesis(), candidate(), cooled, DEFAULT_RULES, NOW)),
		).not.toContain('token_cooldown')
	})

	it('refuses low confidence and a missing exit plan', () => {
		const v = evaluateGates(
			thesis({ confidence: 0.2, exit: { invalidation: '' } }),
			candidate(),
			portfolio(),
			DEFAULT_RULES,
			NOW,
		)
		expect(failedRules(v)).toContain('min_confidence')
		expect(failedRules(v)).toContain('exit_plan_committed')
	})

	it('refuses to deploy capital it does not have', () => {
		const v = evaluateGates(
			thesis({ sizeUsd: 80 }),
			candidate(),
			portfolio({ equityUsd: 100, deployedUsd: 60 }),
			DEFAULT_RULES,
			NOW,
		)
		expect(failedRules(v)).toContain('sufficient_dry_powder')
	})
})

describe('evaluateGates — exits are never blocked by risk rules', () => {
	const held = portfolio({
		equityUsd: 100,
		deployedUsd: 100,
		spentTodayUsd: 10_000,
		realizedPnlTodayUsd: -10_000,
		openPositions: [
			{
				id: 1,
				chain: 'base',
				tokenAddress: TOKEN.toLowerCase(),
				symbol: 'CATE',
				amount: '1000',
				costBasisUsd: 100,
				avgEntryPriceUsd: 0.001,
				openedAt: NOW - 3_600_000,
			},
		],
		lastTradeAtByToken: { [TOKEN.toLowerCase()]: NOW - 1000 },
	})

	it('lets a sell through even when every entry rule would have failed', () => {
		const v = evaluateGates(
			thesis({ action: 'sell', sizeUsd: 100 }),
			candidate({ liquidityUsd: 1 }),
			held,
			DEFAULT_RULES,
			NOW,
		)
		expect(v.passed).toBe(true)
	})

	it('still refuses to sell what it does not hold', () => {
		const v = evaluateGates(
			thesis({ action: 'sell' }),
			candidate(),
			portfolio(),
			DEFAULT_RULES,
			NOW,
		)
		expect(failedRules(v)).toContain('position_exists')
	})

	it('holds pass the universal gates without touching sizing rules', () => {
		const v = evaluateGates(
			thesis({ action: 'hold', sizeUsd: 0 }),
			candidate(),
			portfolio(),
			DEFAULT_RULES,
			NOW,
		)
		expect(v.passed).toBe(true)
	})
})

describe('shouldExit', () => {
	const pos = { avgEntryPriceUsd: 100, takeProfitPct: 50, stopLossPct: 20, openedAt: NOW }

	it('fires the stop-loss', () => {
		expect(shouldExit(pos, 79, undefined, NOW).exit).toBe(true)
		expect(shouldExit(pos, 79, undefined, NOW).reason).toContain('stop-loss')
	})

	it('fires the take-profit', () => {
		expect(shouldExit(pos, 151, undefined, NOW).exit).toBe(true)
		expect(shouldExit(pos, 151, undefined, NOW).reason).toContain('take-profit')
	})

	it('fires the time stop', () => {
		const r = shouldExit(pos, 100, 60, NOW + 61 * 60_000)
		expect(r.exit).toBe(true)
		expect(r.reason).toContain('time stop')
	})

	it('holds inside the band', () => {
		expect(shouldExit(pos, 110, 600, NOW + 60_000).exit).toBe(false)
	})

	it('is inert on garbage prices', () => {
		expect(shouldExit({ ...pos, avgEntryPriceUsd: 0 }, 10, undefined, NOW).exit).toBe(false)
		expect(shouldExit(pos, 0, undefined, NOW).exit).toBe(false)
	})
})

describe('exitSlippageBps', () => {
	it('starts at the normal allowance and doubles per failure', () => {
		expect(exitSlippageBps(0, DEFAULT_RULES)).toBe(DEFAULT_RULES.maxSlippageBps)
		expect(exitSlippageBps(1, DEFAULT_RULES)).toBe(300)
		expect(exitSlippageBps(2, DEFAULT_RULES)).toBe(600)
	})

	it('never exceeds the ceiling however many times it has failed', () => {
		// Escalation is a way out of a position, not a blank cheque.
		expect(exitSlippageBps(50, DEFAULT_RULES)).toBe(DEFAULT_RULES.exitSlippageCeilingBps)
	})

	it('treats a missing or negative attempt count as none', () => {
		expect(exitSlippageBps(-3, DEFAULT_RULES)).toBe(DEFAULT_RULES.maxSlippageBps)
	})
})

describe('the daily loss halt counts the open book', () => {
	it('halts on unrealized losses alone', () => {
		// The blow-up shape: nothing closed, so realized P&L is zero and a halt
		// reading only realized lets the agent keep buying while the book bleeds.
		// Unrealized losses are losses.
		const verdict = evaluateGates(
			thesis(),
			candidate(),
			portfolio({ realizedPnlTodayUsd: 0, unrealizedPnlUsd: -250 }),
			{ ...DEFAULT_RULES, dailyLossHaltUsd: 200 },
			NOW,
		)
		const halt = verdict.results.find((r) => r.rule === 'daily_loss_halt')
		expect(halt?.passed).toBe(false)
		expect(halt?.detail).toContain('unrealized')
	})

	it('nets an unrealized gain against a realized loss', () => {
		const verdict = evaluateGates(
			thesis(),
			candidate(),
			portfolio({ realizedPnlTodayUsd: -150, unrealizedPnlUsd: 120 }),
			{ ...DEFAULT_RULES, dailyLossHaltUsd: 200 },
			NOW,
		)
		expect(verdict.results.find((r) => r.rule === 'daily_loss_halt')?.passed).toBe(true)
	})
})
