import { describe, expect, it } from 'bun:test'
import { parseBootstrapConfig } from '../services/autopilot/bootstrap'

const valid = {
	slug: 'suwappu-alpha',
	name: 'Suwappu Alpha',
	chain: 'base',
	baseToken: 'USDC',
	startingEquityUsd: 1000,
}

const parse = (o: unknown) => parseBootstrapConfig(JSON.stringify(o))

describe('parseBootstrapConfig', () => {
	it('accepts a well-formed paper agent', () => {
		const r = parse(valid)
		expect(r.ok).toBe(true)
		if (r.ok) expect(r.config.slug).toBe('suwappu-alpha')
	})

	it('refuses to bootstrap a live agent — that has to be deliberate', () => {
		const r = parse({ ...valid, mode: 'live' })
		expect(r.ok).toBe(false)
		if (!r.ok) expect(r.error).toContain('paper')
	})

	it('accepts an explicit mode of paper', () => {
		expect(parse({ ...valid, mode: 'paper' }).ok).toBe(true)
	})

	it('rejects malformed JSON and non-objects', () => {
		expect(parseBootstrapConfig('not json').ok).toBe(false)
		expect(parseBootstrapConfig('[]').ok).toBe(false)
		expect(parseBootstrapConfig('"nope"').ok).toBe(false)
	})

	it('rejects a bad slug, missing fields and a non-positive equity', () => {
		expect(parse({ ...valid, slug: 'Bad Slug' }).ok).toBe(false)
		expect(parse({ ...valid, name: '' }).ok).toBe(false)
		expect(parse({ ...valid, chain: '' }).ok).toBe(false)
		expect(parse({ ...valid, baseToken: '' }).ok).toBe(false)
		expect(parse({ ...valid, startingEquityUsd: 0 }).ok).toBe(false)
		expect(parse({ ...valid, startingEquityUsd: '1000' }).ok).toBe(false)
	})

	it('rejects non-object rules rather than coercing them', () => {
		expect(parse({ ...valid, rules: 'strict' }).ok).toBe(false)
	})

	it('carries through the optional fields it recognises, and drops the rest', () => {
		const r = parse({
			...valid,
			description: 'paper agent',
			baseTokenSymbol: 'USDC',
			thesisEngine: 'rules',
			rules: { maxPositionUsd: 25 },
			active: true,
			somethingElse: 'ignored',
		})
		expect(r.ok).toBe(true)
		if (!r.ok) return
		expect(r.config.description).toBe('paper agent')
		expect(r.config.rules).toEqual({ maxPositionUsd: 25 })
		expect(r.config.active).toBe(true)
		expect((r.config as Record<string, unknown>).somethingElse).toBeUndefined()
	})

	it('treats a non-true active flag as not active', () => {
		const r = parse({ ...valid, active: 'yes' })
		expect(r.ok).toBe(true)
		if (r.ok) expect(r.config.active).toBeUndefined()
	})
})
