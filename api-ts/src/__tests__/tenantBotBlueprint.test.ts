import { describe, expect, it } from 'bun:test'
import {
	heuristicBlueprint,
	sanitizeBlueprint,
	SKILL_CATALOG,
} from '../services/tenantBots/blueprint'

/**
 * Coverage for the composer's sanitisation boundary.
 *
 * `sanitizeBlueprint` is the only thing standing between a model's output and a
 * stored configuration that can spend an organisation's treasury. Everything
 * here is written from the attacker's side: what happens when the blueprint
 * asks for a skill that does not exist, a $10,000,000 burn, a live automation
 * that is already enabled, or a cron expression carrying a shell fragment.
 *
 * These are pure-function tests on purpose — no DB, no network, no model. If
 * the boundary holds here it holds regardless of what produced the input.
 */

const INPUT = { brief: 'buy and burn', tokenSymbol: 'PEPE', tokenChain: 'base' }

describe('sanitizeBlueprint — skill allowlist', () => {
	it('drops skills that are not in the catalogue', () => {
		const bp = sanitizeBlueprint(
			{ skills: [{ key: 'price', enabled: true }, { key: 'drain_treasury', enabled: true }] },
			INPUT,
			'llm',
		)
		expect(bp.skills.map((s) => s.key)).toEqual(['price'])
	})

	it('keeps every catalogue key that is offered', () => {
		const all = Object.keys(SKILL_CATALOG).map((key) => ({ key, enabled: true }))
		const bp = sanitizeBlueprint({ skills: all }, INPUT, 'llm')
		expect(bp.skills).toHaveLength(all.length)
	})

	it('de-duplicates a repeated skill', () => {
		const bp = sanitizeBlueprint(
			{ skills: [{ key: 'price', enabled: true }, { key: 'price', enabled: false }] },
			INPUT,
			'llm',
		)
		expect(bp.skills).toHaveLength(1)
	})

	it('survives skills being the wrong type entirely', () => {
		for (const junk of [null, 'price', 42, { key: 'price' }]) {
			expect(() => sanitizeBlueprint({ skills: junk }, INPUT, 'llm')).not.toThrow()
		}
	})
})

describe('sanitizeBlueprint — spending automations cannot arm themselves', () => {
	it('forces simulate mode and disabled, even when the blueprint says otherwise', () => {
		const bp = sanitizeBlueprint(
			{
				automations: [
					{ kind: 'buy_and_burn', name: 'burn', cron: '0 * * * *', mode: 'live', enabled: true },
				],
			},
			INPUT,
			'llm',
		)
		expect(bp.automations[0].mode).toBe('simulate')
		expect(bp.automations[0].enabled).toBe(false)
	})

	it('clamps an absurd per-run cap to the composed ceiling', () => {
		const bp = sanitizeBlueprint(
			{
				automations: [
					{ kind: 'buy_and_burn', name: 'burn', cron: '0 * * * *', maxUsdPerRun: 10_000_000 },
				],
			},
			INPUT,
			'llm',
		)
		expect(bp.automations[0].maxUsdPerRun).toBe(500)
		expect(bp.automations[0].maxUsdPerDay).toBeLessThanOrEqual(2000)
	})

	it('never emits a zero or negative cap for a spending automation', () => {
		for (const bad of [0, -1, -99999, Number.NaN, 'lots', null, undefined]) {
			const bp = sanitizeBlueprint(
				{ automations: [{ kind: 'buyback', name: 'b', cron: null, maxUsdPerRun: bad }] },
				INPUT,
				'llm',
			)
			expect(bp.automations[0].maxUsdPerRun).toBeGreaterThan(0)
		}
	})

	it('keeps the daily cap at or above the per-run cap', () => {
		const bp = sanitizeBlueprint(
			{
				automations: [
					{ kind: 'buy_and_burn', name: 'b', cron: null, maxUsdPerRun: 400, maxUsdPerDay: 5 },
				],
			},
			INPUT,
			'llm',
		)
		expect(bp.automations[0].maxUsdPerDay).toBeGreaterThanOrEqual(bp.automations[0].maxUsdPerRun)
	})

	it('leaves non-spending automations at a zero cap', () => {
		const bp = sanitizeBlueprint(
			{ automations: [{ kind: 'price_post', name: 'daily', cron: '0 13 * * *' }] },
			INPUT,
			'llm',
		)
		expect(bp.automations[0].maxUsdPerRun).toBe(0)
	})

	it('drops automation kinds it does not know', () => {
		const bp = sanitizeBlueprint(
			{
				automations: [
					{ kind: 'withdraw_everything', name: 'x', cron: '* * * * *' },
					{ kind: 'buyback', name: 'ok', cron: null, maxUsdPerRun: 10 },
				],
			},
			INPUT,
			'llm',
		)
		expect(bp.automations.map((a) => a.kind)).toEqual(['buyback'])
	})
})

describe('sanitizeBlueprint — cron', () => {
	it('accepts a well-formed 5-field expression', () => {
		const bp = sanitizeBlueprint(
			{ automations: [{ kind: 'price_post', name: 'p', cron: '*/15 9-17 * * 1-5' }] },
			INPUT,
			'llm',
		)
		expect(bp.automations[0].cron).toBe('*/15 9-17 * * 1-5')
	})

	it('nulls anything that is not five plain fields', () => {
		const bad = [
			'0 * * *', // four fields
			'0 * * * * *', // six
			'@hourly',
			'0 * * * *; rm -rf /',
			'0 * * * $(whoami)',
			'',
		]
		for (const cron of bad) {
			const bp = sanitizeBlueprint(
				{ automations: [{ kind: 'price_post', name: 'p', cron }] },
				INPUT,
				'llm',
			)
			expect(bp.automations[0].cron).toBeNull()
		}
	})
})

describe('sanitizeBlueprint — token context wins over the blueprint', () => {
	it('overwrites chain and buyToken with the operator-supplied values', () => {
		const bp = sanitizeBlueprint(
			{
				automations: [
					{
						kind: 'buy_and_burn',
						name: 'b',
						cron: null,
						maxUsdPerRun: 10,
						// A model that picked its own token/chain must not win here.
						config: { chain: 'ethereum', buyToken: '0xNOTOURS' },
					},
				],
			},
			{ ...INPUT, tokenChain: 'base', tokenAddress: '0xOURS' },
			'llm',
		)
		expect(bp.automations[0].config.chain).toBe('base')
		expect(bp.automations[0].config.buyToken).toBe('0xOURS')
	})
})

describe('sanitizeBlueprint — commands', () => {
	it('keeps only well-formed slash commands', () => {
		const bp = sanitizeBlueprint(
			{
				commands: [
					{ command: 'price', description: 'ok' }, // gets a slash
					{ command: '/chart', description: 'ok' },
					{ command: '/bad command', description: 'space' },
					{ command: '/../etc/passwd', description: 'traversal' },
					{ command: '', description: 'empty' },
				],
			},
			INPUT,
			'llm',
		)
		expect(bp.commands.map((c) => c.command)).toEqual(['/price', '/chart'])
	})
})

describe('heuristicBlueprint — the no-model fallback', () => {
	it('proposes a disabled, simulated buy-and-burn when the brief mentions burning', () => {
		const bp = heuristicBlueprint({ brief: 'buy and burn our token hourly', tokenSymbol: 'PEPE' })
		const burn = bp.automations.find((a) => a.kind === 'buy_and_burn')
		expect(burn).toBeDefined()
		expect(burn!.mode).toBe('simulate')
		expect(burn!.enabled).toBe(false)
		expect(bp.source).toBe('heuristic')
	})

	it('proposes no spending automation for a brief that asks for none', () => {
		const bp = heuristicBlueprint({ brief: 'just show the price and a chart' })
		expect(bp.automations.filter((a) => a.maxUsdPerRun > 0)).toHaveLength(0)
	})

	it('always returns at least one usable skill', () => {
		const bp = heuristicBlueprint({ brief: '???' })
		expect(bp.skills.length).toBeGreaterThan(0)
	})
})
