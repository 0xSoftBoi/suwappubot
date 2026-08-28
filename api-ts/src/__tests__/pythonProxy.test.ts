import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import {
	createPythonProxyRoutes,
	createTerminalSwapProxyRoutes,
	createTerminalWebappProxyRoutes,
	isPythonProxyAllowed,
	isTerminalWebappProxyAllowed,
} from '../routes/pythonProxy'

const PYTHON_URL = 'http://python-api.railway.internal:8000'

describe('Python Terminal compatibility gateway', () => {
	it('forwards end-user auth, origin, cookies, query and body without service credentials', async () => {
		let calls = 0
		const routes = createPythonProxyRoutes({
			baseUrl: PYTHON_URL,
			fetchImpl: async (input, init) => {
				calls += 1
				expect(String(input)).toBe(`${PYTHON_URL}/auth/turnkey/verify?source=terminal`)
				expect(init?.method).toBe('POST')
				expect(init?.redirect).toBe('manual')
				const headers = new Headers(init?.headers)
				expect(headers.get('Origin')).toBe('https://terminal.suwappu.bot')
				expect(headers.get('Authorization')).toBe('Bearer browser-session')
				expect(headers.get('Cookie')).toBe('suwappu_auth=cookie-session')
				expect(headers.get('X-Internal-Key')).toBeNull()
				return Response.json({ token: 'session-token' })
			},
		})
		const app = new Hono().route('/', routes)
		const response = await app.request('/auth/turnkey/verify?source=terminal', {
			method: 'POST',
			headers: {
				Authorization: 'Bearer browser-session',
				Cookie: 'suwappu_auth=cookie-session',
				Origin: 'https://terminal.suwappu.bot',
				'X-Internal-Key': 'must-not-be-forwarded',
			},
			body: '{}',
		})
		expect(response.status).toBe(200)
		expect(calls).toBe(1)
	})

	it('allows reviewed Terminal session/read paths and keeps new money paths closed', () => {
		for (const [method, path] of [
			['GET', '/auth/me'],
			['GET', '/terminal/chart/ohlcv'],
			['GET', '/terminal/token/safety'],
			['GET', '/terminal/intel/devwatch/hits'],
			['GET', '/terminal/intel/base/0xabc'],
			['POST', '/terminal/intel/devwatch'],
			['DELETE', '/terminal/intel/devwatch/123'],
			['GET', '/terminal/wallet/summary'],
			['GET', '/terminal/perps/account'],
			['GET', '/terminal/perps/positions'],
			['GET', '/terminal/predict/positions'],
			['POST', '/webapp/bridge/build'],
			['GET', '/webapp/bridge/transfers/123'],
		] as const) {
			expect(isPythonProxyAllowed(method, path)).toBe(true)
		}

		for (const [method, path] of [
			['POST', '/terminal/wallet/withdraw'],
			['POST', '/terminal/predict/order'],
			['POST', '/terminal/predict/redeem'],
			['POST', '/terminal/wallet/admin-sweep'],
			['DELETE', '/terminal/intel/devwatch/not-a-number'],
		] as const) {
			expect(isPythonProxyAllowed(method, path)).toBe(false)
		}
	})

	it('restores read/non-transactional standalone webapp contracts only', () => {
		for (const [method, path] of [
			['GET', '/webapp/referrals/stats'],
			['GET', '/webapp/referrals'],
			['GET', '/webapp/copy-trading/top-traders'],
			['GET', '/webapp/copy-trading/following'],
			['GET', '/webapp/copy-trading/trades'],
			['GET', '/webapp/alerts'],
			['POST', '/webapp/alerts'],
			['DELETE', '/webapp/alerts/9'],
			['GET', '/webapp/wallet-tracker/wallets'],
			['POST', '/webapp/wallet-tracker/wallets'],
			['DELETE', '/webapp/wallet-tracker/wallets/0xabc'],
			['GET', '/webapp/tweets/accounts'],
			['POST', '/webapp/tweets/accounts'],
			['DELETE', '/webapp/tweets/accounts/suwappu'],
			['GET', '/webapp/limit-orders'],
			['GET', '/webapp/dca/orders'],
			['GET', '/webapp/discovery/new'],
			['GET', '/webapp/discovery/trending'],
			['POST', '/webapp/solana/rpc'],
			['GET', '/webapp/solana/tx-history'],
		] as const) {
			expect(isTerminalWebappProxyAllowed(method, path)).toBe(true)
		}

		for (const [method, path] of [
			['POST', '/webapp/copy-trading/follow/12'],
			['POST', '/webapp/copy-trading/unfollow/12'],
			['PUT', '/webapp/copy-trading/follow/12/settings'],
			['POST', '/webapp/limit-orders'],
			['POST', '/webapp/limit-orders/2/cancel'],
			['POST', '/webapp/dca/orders'],
			['POST', '/webapp/dca/orders/2/pause'],
			['POST', '/webapp/points/rewards/1/redeem'],
			['POST', '/webapp/admin/sweep'],
		] as const) {
			expect(isTerminalWebappProxyAllowed(method, path)).toBe(false)
		}
	})

	it('pre-/webapp gateway proxies reviewed Terminal routes and falls through for Telegram', async () => {
		let pythonCalls = 0
		const app = new Hono()
		app.route(
			'/',
			createTerminalWebappProxyRoutes({
				baseUrl: PYTHON_URL,
				fetchImpl: async (input) => {
					pythonCalls += 1
					return Response.json({ source: 'python', path: new URL(String(input)).pathname })
				},
			}),
		)
		app.get('/webapp/alerts', (c) => c.json({ source: 'api-ts' }))

		const terminal = await app.request('/webapp/alerts', {
			headers: { Authorization: 'Bearer browser-session' },
		})
		expect(await terminal.json()).toEqual({ source: 'python', path: '/webapp/alerts' })

		const telegram = await app.request('/webapp/alerts', {
			headers: { 'X-Telegram-Init-Data': 'query_id=signed-telegram-data' },
		})
		expect(await telegram.json()).toEqual({ source: 'api-ts' })
		expect(pythonCalls).toBe(1)
	})

	it('production pre-mounted gateway handles swap plus reviewed legacy reads', async () => {
		const seen: string[] = []
		const routes = createTerminalSwapProxyRoutes({
			baseUrl: PYTHON_URL,
			fetchImpl: async (input, init) => {
				seen.push(`${init?.method} ${new URL(String(input)).pathname}`)
				return Response.json({ source: 'python' })
			},
		})
		const app = new Hono().route('/', routes)
		for (const [method, path] of [
			['POST', '/webapp/swap/quote'],
			['GET', '/webapp/referrals/stats'],
			['GET', '/webapp/alerts'],
			['GET', '/webapp/dca/orders'],
		] as const) {
			const response = await app.request(path, { method })
			expect(response.status).toBe(200)
		}
		expect(seen).toEqual([
			'POST /webapp/swap/quote',
			'GET /webapp/referrals/stats',
			'GET /webapp/alerts',
			'GET /webapp/dca/orders',
		])
	})

	it('keeps Telegram requests on native api-ts routes', async () => {
		let pythonCalls = 0
		const app = new Hono()
		app.route(
			'/',
			createTerminalSwapProxyRoutes({
				baseUrl: PYTHON_URL,
				fetchImpl: async () => {
					pythonCalls += 1
					return Response.json({ source: 'python' })
				},
			}),
		)
		app.get('/webapp/alerts', (c) => c.json({ source: 'api-ts' }))
		const response = await app.request('/webapp/alerts', {
			headers: { 'X-Telegram-Init-Data': 'query_id=signed-telegram-data' },
		})
		expect(await response.json()).toEqual({ source: 'api-ts' })
		expect(pythonCalls).toBe(0)
	})

	it('lets unreviewed /webapp requests fall through instead of widening Python access', async () => {
		let pythonCalls = 0
		const app = new Hono()
		app.route(
			'/',
			createTerminalSwapProxyRoutes({
				baseUrl: PYTHON_URL,
				fetchImpl: async () => {
					pythonCalls += 1
					return Response.json({ source: 'python' })
				},
			}),
		)
		app.post('/webapp/admin/sweep', (c) => c.json({ source: 'api-ts' }))
		const response = await app.request('/webapp/admin/sweep', { method: 'POST' })
		expect(await response.json()).toEqual({ source: 'api-ts' })
		expect(pythonCalls).toBe(0)
	})

	it('fails closed when the Python service URL is not configured', async () => {
		const app = new Hono().route('/', createPythonProxyRoutes({}))
		const response = await app.request('/auth/me')
		expect(response.status).toBe(503)
	})
})
