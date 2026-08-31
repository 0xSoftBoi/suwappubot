import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { guardedPublicSwapRoutes } from '../routes/publicSwapGuard'

function unsignedJwt(src: string): string {
	const encode = (value: object) =>
		btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
	return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ userId: 123, src })}.signature`
}

describe('guarded public swap router', () => {
	it('rejects weak and cookie-only credentials before execute reaches flexAuth', async () => {
		const app = new Hono().route('/public/swap', guardedPublicSwapRoutes)

		const weak = await app.request('/public/swap/execute', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${unsignedJwt('weak')}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ quoteId: 'not-reached' }),
		})
		expect(weak.status).toBe(403)
		expect(await weak.json()).toMatchObject({ code: 'TRADING_PROOF_REQUIRED' })

		const cookieOnly = await app.request('/public/swap/execute', {
			method: 'POST',
			headers: {
				Cookie: `suwappu_auth=${unsignedJwt('passkey')}`,
				Origin: 'https://terminal.suwappu.bot',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ quoteId: 'not-reached' }),
		})
		expect(cookieOnly.status).toBe(403)
		expect(await cookieOnly.json()).toMatchObject({ code: 'TRADING_PROOF_REQUIRED' })
	})

	it('does not put the trading-proof guard in front of public discovery', async () => {
		const app = new Hono().route('/public/swap', guardedPublicSwapRoutes)
		const response = await app.request('/public/swap/chains')
		expect(response.status).toBe(200)
		const body = (await response.json()) as { chains?: unknown[] }
		expect(Array.isArray(body.chains)).toBe(true)
	})
})
