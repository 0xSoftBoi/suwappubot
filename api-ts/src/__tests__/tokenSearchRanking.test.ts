import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { tokenRoutes } from '../routes/tokens'

const originalFetch = globalThis.fetch
const originalInternal = process.env.INTERNAL_API_URL

const CANONICAL_PEPE = '0x6982508145454Ce325dDbE47a25d4ec3d2311933'
const LOOKALIKE_PEPE = '0xbe042e9d09CB588331Ff911c2B46FD833A3E5bd6'
const FLAGGED_PEPE = '0x00000000000000000000000000000000000000f1'

function installMocks(opts: { curatedFails?: boolean } = {}) {
	globalThis.fetch = (async (input: string | URL | Request) => {
		const url = new URL(String(input))
		if (url.hostname === 'li.quest') {
			return Response.json({
				tokens: {
					'1': [
						{ address: FLAGGED_PEPE, symbol: 'PEPE', decimals: 18, name: 'Pepe Scam', chainId: 1, verificationStatus: 'flagged' },
						{ address: LOOKALIKE_PEPE, symbol: 'PEPE', decimals: 18, name: 'Pepe Community', chainId: 1, verificationStatus: 'verified' },
						{ address: '0x00000000000000000000000000000000000000a1', symbol: 'PPBLZ', decimals: 18, name: 'Pepemon Pepeballs', chainId: 1, verificationStatus: 'verified' },
					],
				},
			})
		}
		if (url.hostname === 'python.internal') {
			if (opts.curatedFails) return new Response('boom', { status: 500 })
			expect(url.pathname).toBe('/webapp/tokens/search')
			expect(url.searchParams.get('chain')).toBe('ethereum')
			return Response.json([
				{ symbol: 'PEPE', name: 'Pepe', address: CANONICAL_PEPE, chain: 'ethereum', decimals: 18, logoUrl: null },
			])
		}
		throw new Error(`unexpected fetch ${url}`)
	}) as typeof fetch
}

describe('Terminal token search ranking', () => {
	beforeEach(() => {
		process.env.INTERNAL_API_URL = 'http://python.internal'
	})
	afterEach(() => {
		globalThis.fetch = originalFetch
		if (originalInternal === undefined) delete process.env.INTERNAL_API_URL
		else process.env.INTERNAL_API_URL = originalInternal
	})

	it('ranks the curated registry token above Li.Fi look-alikes and sinks flagged contracts', async () => {
		installMocks()
		const app = new Hono().route('/webapp/tokens', tokenRoutes)
		const res = await app.request('/webapp/tokens/search?q=pepe&chain=ethereum')
		expect(res.status).toBe(200)
		const rows = (await res.json()) as Array<{ address: string; symbol: string }>
		expect(rows.map((r) => r.address)).toEqual([
			CANONICAL_PEPE,
			LOOKALIKE_PEPE,
			'0x00000000000000000000000000000000000000a1',
			FLAGGED_PEPE,
		])
		expect(rows[0]).toMatchObject({ symbol: 'PEPE', name: 'Pepe', chain: 'ethereum', decimals: 18 })
	})

	it('falls back to Li.Fi-only results when the curated registry is unavailable', async () => {
		installMocks({ curatedFails: true })
		const app = new Hono().route('/webapp/tokens', tokenRoutes)
		const res = await app.request('/webapp/tokens/search?q=pepe2&chain=ethereum')
		expect(res.status).toBe(200)
		const rows = (await res.json()) as Array<{ address: string }>
		expect(rows.length).toBe(0)
		const res2 = await app.request('/webapp/tokens/search?q=ppblz&chain=ethereum')
		const rows2 = (await res2.json()) as Array<{ address: string }>
		expect(rows2[0]?.address).toBe('0x00000000000000000000000000000000000000a1')
	})
})
