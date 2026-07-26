import { describe, expect, it } from 'bun:test'
import { PROMPTS, RESOURCES, TOOLS_WITH_ANNOTATIONS, readResource } from '../routes/mcp'

describe('mcp tool annotations', () => {
	it('attaches behavioural annotations to every tool', () => {
		expect(TOOLS_WITH_ANNOTATIONS.length).toBeGreaterThan(0)
		for (const tool of TOOLS_WITH_ANNOTATIONS) {
			const ann = (tool as { annotations?: Record<string, unknown> }).annotations
			expect(ann, `tool ${tool.name} missing annotations`).toBeDefined()
			expect(typeof ann!.title).toBe('string')
			expect(typeof ann!.readOnlyHint).toBe('boolean')
			expect(typeof ann!.openWorldHint).toBe('boolean')
		}
	})

	it('marks read tools read-only and the swap-prep tool as non-read-only/non-destructive', () => {
		const byName = Object.fromEntries(
			TOOLS_WITH_ANNOTATIONS.map((t) => [t.name, (t as { annotations: Record<string, unknown> }).annotations]),
		)
		expect(byName.get_quote.readOnlyHint).toBe(true)
		expect(byName.get_portfolio.readOnlyHint).toBe(true)
		// execute_swap only builds an unsigned tx — not read-only, but not destructive either.
		expect(byName.execute_swap.readOnlyHint).toBe(false)
		expect(byName.execute_swap.destructiveHint).toBe(false)
	})
})

describe('mpp gating', () => {
	// The MPP hosts (api.mpp.dev / directory.mpp.dev) did not resolve as of
	// 2026-07-26, so browse_mpp_directory could only ever return an error.
	// It must stay hidden from tools/list unless MPP_ENABLED=true, otherwise we
	// advertise a capability that always fails.
	it('does not advertise browse_mpp_directory when MPP_ENABLED is unset', () => {
		expect(process.env.MPP_ENABLED).not.toBe('true')
		const names = TOOLS_WITH_ANNOTATIONS.map((t) => t.name)
		expect(names).not.toContain('browse_mpp_directory')
	})

	it('still advertises the non-MPP tools', () => {
		const names = TOOLS_WITH_ANNOTATIONS.map((t) => t.name)
		for (const expected of ['get_quote', 'execute_swap', 'get_portfolio', 'predict_markets']) {
			expect(names).toContain(expected)
		}
	})
})

describe('mcp resources', () => {
	it('reads every advertised resource as valid JSON', () => {
		for (const r of RESOURCES) {
			const res = readResource(r.uri)
			expect(res, `resource ${r.uri} not readable`).not.toBeNull()
			const content = res!.contents[0]
			expect(content.uri).toBe(r.uri)
			expect(content.mimeType).toBe(r.mimeType)
			// All advertised resources are application/json — must parse.
			expect(() => JSON.parse(content.text)).not.toThrow()
		}
	})

	it('returns null for an unknown resource uri', () => {
		expect(readResource('suwappu://nope')).toBeNull()
	})

	it('exposes the OpenAPI spec as a resource', () => {
		const res = readResource('suwappu://openapi.json')
		const spec = JSON.parse(res!.contents[0].text)
		expect(spec.openapi ?? spec.swagger).toBeDefined()
		expect(spec.paths).toBeDefined()
	})
})

describe('mcp prompts', () => {
	it('builds prompt text when all args are supplied', () => {
		const swap = PROMPTS.find((p) => p.name === 'swap_tokens')!
		const text = swap.build({ from_token: 'ETH', to_token: 'USDC', amount: '0.5', chain: 'base' })
		expect(text).toContain('0.5 ETH')
		expect(text).toContain('USDC')
		expect(text).toContain('base')
		expect(text).toContain('get_quote')
		expect(text).toContain('execute_swap')
	})

	it('declares required arguments for each prompt', () => {
		for (const p of PROMPTS) {
			expect(p.arguments.length).toBeGreaterThan(0)
			expect(p.arguments.some((a) => a.required)).toBe(true)
		}
	})
})
