import { afterEach, describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { tokenRoutes } from '../routes/tokens'
import { webappStubs } from '../routes/webappStubs'

const originalFetch = globalThis.fetch

afterEach(() => {
	globalThis.fetch = originalFetch
})

function installLifiTokenMock(seenChains: string[]) {
	globalThis.fetch = (async (input: string | URL | Request) => {
		const url = new URL(String(input))
		expect(url.hostname).toBe('li.quest')
		const chainId = url.searchParams.get('chains')
		if (!chainId) throw new Error('expected Li.Fi chains query parameter')
		seenChains.push(chainId)

		const numericChainId = Number(chainId.split(',')[0])
		return Response.json({
			tokens: {
				[chainId]: [
					{
						address: chainId === '1151111081099710' ? 'So11111111111111111111111111111111111111112' : '0x0000000000000000000000000000000000000001',
						symbol: 'UNITTESTTOKEN',
						decimals: chainId === '1151111081099710' ? 9 : 18,
						name: 'Unit Test Token',
						chainId: numericChainId,
						logoURI: 'https://example.invalid/token.png',
					},
				],
			},
		})
	}) as typeof fetch
}

describe('Terminal chain compatibility contract', () => {
	it('keeps /webapp/chains as a public bare array with Ethereum and Solana', async () => {
		const app = new Hono().route('/webapp', webappStubs)
		const response = await app.request('/webapp/chains')

		expect(response.status).toBe(200)
		const chains = (await response.json()) as Array<{
			id: string
			chainId: number
			nativeCurrency: string
		}>
		expect(Array.isArray(chains)).toBe(true)
		expect(chains.find((chain) => chain.id === 'ethereum')).toMatchObject({
			chainId: 1,
			nativeCurrency: 'ETH',
		})
		expect(chains.find((chain) => chain.id === 'solana')).toMatchObject({
			chainId: 1151111081099710,
			nativeCurrency: 'SOL',
		})
	})
})

describe('Terminal token compatibility contract', () => {
	it('returns popular Ethereum tokens as the bare array Terminal consumes', async () => {
		const seenChains: string[] = []
		installLifiTokenMock(seenChains)
		const app = new Hono().route('/webapp/tokens', tokenRoutes)

		const response = await app.request('/webapp/tokens/popular?chain=ethereum')
		expect(response.status).toBe(200)
		const tokens = (await response.json()) as Array<Record<string, unknown>>

		expect(seenChains).toEqual(['1'])
		expect(Array.isArray(tokens)).toBe(true)
		expect(tokens[0]).toMatchObject({
			symbol: 'UNITTESTTOKEN',
			name: 'Unit Test Token',
			address: '0x0000000000000000000000000000000000000001',
			chain: 'ethereum',
			decimals: 18,
		})
	})

	it('maps the Terminal Solana alias to Li.Fi canonical chain ID and preserves chain=solana', async () => {
		const seenChains: string[] = []
		installLifiTokenMock(seenChains)
		const app = new Hono().route('/webapp/tokens', tokenRoutes)

		const response = await app.request('/webapp/tokens/popular?chain=solana')
		expect(response.status).toBe(200)
		const tokens = (await response.json()) as Array<Record<string, unknown>>

		expect(seenChains).toEqual(['1151111081099710'])
		expect(tokens[0]).toMatchObject({
			address: 'So11111111111111111111111111111111111111112',
			chain: 'solana',
			decimals: 9,
		})
	})

	it('accepts a one-character standalone Terminal search and returns a bare token array', async () => {
		const seenChains: string[] = []
		installLifiTokenMock(seenChains)
		const app = new Hono().route('/webapp/tokens', tokenRoutes)

		const response = await app.request('/webapp/tokens/search?q=U&chain=ethereum')
		expect(response.status).toBe(200)
		const body = await response.json()

		expect(seenChains).toEqual(['1'])
		expect(Array.isArray(body)).toBe(true)
		expect(body).toHaveLength(1)
		expect(body[0]).toMatchObject({ symbol: 'UNITTESTTOKEN', chain: 'ethereum' })
	})

	it('keeps the Telegram/Mini App search envelope and two-character minimum', async () => {
		const seenChains: string[] = []
		installLifiTokenMock(seenChains)
		const app = new Hono().route('/webapp/tokens', tokenRoutes)

		const tooShort = await app.request('/webapp/tokens/search?q=U')
		expect(tooShort.status).toBe(400)
		expect(await tooShort.json()).toMatchObject({ error: 'Query must be at least 2 characters' })

		const response = await app.request('/webapp/tokens/search?q=UN')
		expect(response.status).toBe(200)
		const body = (await response.json()) as {
			tokens: Array<Record<string, unknown>>
			query: string
			chains: string[]
		}

		expect(Array.isArray(body)).toBe(false)
		expect(body.query).toBe('UN')
		expect(body.chains).toEqual(['1', '137', '42161', '8453', '10'])
		expect(body.tokens[0]).toMatchObject({ symbol: 'UNITTESTTOKEN' })
		expect(seenChains).toEqual(['1,137,42161,8453,10'])
	})
})
