import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { createTerminalSwapProxyRoutes } from '../routes/pythonProxy'

const PYTHON_URL = 'http://python-api.railway.internal:8000'

function unsignedJwt(src: string): string {
	const encode = (value: object) =>
		btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
	return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ userId: 123, src })}.signature`
}

const firstPartyCookie = {
	Cookie: `suwappu_auth=${unsignedJwt('weak')}`,
	Origin: 'https://terminal.suwappu.bot',
}
const strongBearer = { Authorization: `Bearer ${unsignedJwt('passkey')}` }

describe('Terminal mutation trust classification', () => {
	it('does not demand trading proof for ordinary authenticated product settings', async () => {
		const seen: string[] = []
		const app = new Hono().route('/', createTerminalSwapProxyRoutes({
			baseUrl: PYTHON_URL,
			fetchImpl: async (input, init) => {
				seen.push(`${init?.method} ${new URL(String(input)).pathname}`)
				return Response.json({ ok: true })
			},
		}))

		for (const [method, path] of [
			['POST', '/webapp/alerts'],
			['POST', '/webapp/wallet-tracker/wallets'],
			['POST', '/webapp/tweets/accounts'],
		] as const) {
			const response = await app.request(path, {
				method,
				headers: { ...firstPartyCookie, 'Content-Type': 'application/json' },
				body: '{}',
			})
			expect(response.status).toBe(200)
		}
		expect(seen).toEqual([
			'POST /webapp/alerts',
			'POST /webapp/wallet-tracker/wallets',
			'POST /webapp/tweets/accounts',
		])
	})

	it('allows first-party cookie sessions to pause/cancel scheduled orders only', async () => {
		const seen: string[] = []
		const app = new Hono().route('/', createTerminalSwapProxyRoutes({
			baseUrl: PYTHON_URL,
			fetchImpl: async (input, init) => {
				seen.push(`${init?.method} ${new URL(String(input)).pathname}`)
				return Response.json({ success: true })
			},
		}))

		const limit = await app.request('/webapp/me/limit-orders/42', {
			method: 'DELETE', headers: firstPartyCookie,
		})
		const pause = await app.request('/webapp/dca/orders/7/pause', {
			method: 'POST', headers: firstPartyCookie,
		})
		const cancel = await app.request('/webapp/dca/orders/7/cancel', {
			method: 'POST', headers: firstPartyCookie,
		})
		expect(limit.status).toBe(200)
		expect(pause.status).toBe(200)
		expect(cancel.status).toBe(200)
		expect(seen).toEqual([
			'POST /webapp/limit-orders/42/cancel',
			'POST /webapp/dca/orders/7/pause',
			'POST /webapp/dca/orders/7/cancel',
		])
	})

	it('rejects cross-site cookie stop controls and cookie-only execution', async () => {
		let calls = 0
		const app = new Hono().route('/', createTerminalSwapProxyRoutes({
			baseUrl: PYTHON_URL,
			fetchImpl: async () => {
				calls += 1
				return Response.json({ ok: true })
			},
		}))

		const crossSiteStop = await app.request('/webapp/dca/orders/7/pause', {
			method: 'POST',
			headers: {
				Cookie: `suwappu_auth=${unsignedJwt('weak')}`,
				Origin: 'https://evil.example',
			},
		})
		expect(crossSiteStop.status).toBe(403)
		expect(await crossSiteStop.json()).toMatchObject({ code: 'CONTROL_AUTH_REQUIRED' })

		const cookieExecute = await app.request('/webapp/swap/execute', {
			method: 'POST', headers: firstPartyCookie, body: '{}',
		})
		expect(cookieExecute.status).toBe(403)
		expect(await cookieExecute.json()).toMatchObject({ code: 'TRADING_PROOF_REQUIRED' })
		expect(calls).toBe(0)
	})

	it('still forwards execution for a strong trading bearer', async () => {
		let calls = 0
		const app = new Hono().route('/', createTerminalSwapProxyRoutes({
			baseUrl: PYTHON_URL,
			fetchImpl: async () => {
				calls += 1
				return Response.json({ ok: true })
			},
		}))

		const response = await app.request('/webapp/swap/execute', {
			method: 'POST', headers: { ...strongBearer, 'Content-Type': 'application/json' }, body: '{}',
		})
		expect(response.status).toBe(200)
		expect(calls).toBe(1)
	})
})
