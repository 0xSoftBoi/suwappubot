import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import {
	createPythonProxyRoutes,
	createTerminalSwapProxyRoutes,
	createTerminalWebappProxyRoutes,
	isPythonProxyAllowed,
	isTerminalSwapProxyAllowed,
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
				expect(headers.get('Content-Type')).toBe('application/json')
				expect(headers.get('X-Internal-Key')).toBeNull()
				expect(await new Response(init?.body).text()).toBe(
					'{"address":"0xabc","signature":"0xsig","nonce":"n"}',
				)

				return Response.json({ token: 'session-token' })
			},
		})
		const app = new Hono().route('/', routes)

		const response = await app.request('/auth/turnkey/verify?source=terminal', {
			method: 'POST',
			headers: {
				Authorization: 'Bearer browser-session',
				Cookie: 'suwappu_auth=cookie-session',
				'Content-Type': 'application/json',
				Origin: 'https://terminal.suwappu.bot',
				'X-Internal-Key': 'must-not-be-forwarded',
			},
			body: '{"address":"0xabc","signature":"0xsig","nonce":"n"}',
		})

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ token: 'session-token' })
		expect(calls).toBe(1)
	})

	it('preserves OAuth redirects and distinct Set-Cookie headers', async () => {
		const routes = createPythonProxyRoutes({
			baseUrl: PYTHON_URL,
			fetchImpl: async (_input, init) => {
				expect(init?.redirect).toBe('manual')
				const headers = new Headers()
				headers.set('Location', 'https://accounts.google.com/o/oauth2/v2/auth?state=abc')
				headers.append('Set-Cookie', 'oauth_nonce=abc; Path=/auth/oauth; HttpOnly; Secure')
				headers.append('Set-Cookie', 'suwappu_auth=jwt; Path=/; HttpOnly; Secure')
				headers.set('Access-Control-Allow-Origin', '*')
				return new Response(null, { status: 302, headers })
			},
		})
		const app = new Hono().route('/', routes)

		const response = await app.request(
			'/auth/oauth/google/authorize?redirect_url=https%3A%2F%2Fterminal.suwappu.bot%2Fauth%2Fcallback%2Fgoogle',
		)

		expect(response.status).toBe(302)
		expect(response.headers.get('Location')).toBe(
			'https://accounts.google.com/o/oauth2/v2/auth?state=abc',
		)
		const cookieHeaders = response.headers as Headers & { getSetCookie: () => string[] }
		expect(cookieHeaders.getSetCookie()).toEqual([
			'oauth_nonce=abc; Path=/auth/oauth; HttpOnly; Secure',
			'suwappu_auth=jwt; Path=/; HttpOnly; Secure',
		])
		expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
	})

	it('allows only reviewed auth, read, wallet, trading, devwatch and bridge compatibility paths', () => {
		for (const [method, path] of [
			['POST', '/auth/turnkey/challenge'],
			['POST', '/auth/solana/verify'],
			['GET', '/auth/me'],
			['POST', '/auth/logout'],
			['POST', '/auth/passkey/authenticate/complete'],
			['GET', '/auth/oauth/google/authorize'],
			['GET', '/auth/oauth/twitter/callback'],
			['GET', '/terminal/chart/ohlcv'],
			['GET', '/terminal/token/safety'],
			['GET', '/terminal/intel/health'],
			['GET', '/terminal/intel/devwatch/hits'],
			['GET', '/terminal/intel/base/0xabc'],
			['POST', '/terminal/intel/devwatch'],
			['DELETE', '/terminal/intel/devwatch/123'],
			['GET', '/terminal/wallet/summary'],
			['POST', '/terminal/wallet/withdraw'],
			['GET', '/terminal/perps/account'],
			['POST', '/terminal/perps/connect'],
			['GET', '/terminal/perps/positions'],
			['POST', '/terminal/perps/execute'],
			['POST', '/terminal/perps/close'],
			['POST', '/terminal/perps/tpsl'],
			['GET', '/terminal/perps/orders'],
			['POST', '/terminal/perps/cancel'],
			['GET', '/terminal/predict/positions'],
			['POST', '/terminal/predict/order'],
			['POST', '/terminal/predict/redeem'],
			['POST', '/webapp/bridge/routes'],
			['POST', '/webapp/bridge/build'],
			['POST', '/webapp/bridge/record'],
			['GET', '/webapp/bridge/transfers/123'],
		] as const) {
			expect(isPythonProxyAllowed(method, path)).toBe(true)
		}

		for (const [method, path] of [
			['GET', '/auth/turnkey/challenge'],
			['GET', '/auth/oauth/github/authorize'],
			['POST', '/auth/oauth/google/link'],
			['DELETE', '/auth/oauth/unlink/google'],
			['POST', '/terminal/wallet/admin-sweep'],
			['DELETE', '/terminal/intel/devwatch/not-a-number'],
			['DELETE', '/webapp/bridge/transfers/123'],
			['GET', '/webapp/bridge/transfers/not-a-number'],
		] as const) {
			expect(isPythonProxyAllowed(method, path)).toBe(false)
		}
	})

	it('allows the standalone Terminal webapp contracts without widening arbitrary /webapp access', () => {
		for (const [method, path] of [
			['GET', '/webapp/referrals/stats'],
			['GET', '/webapp/referrals'],
			['GET', '/webapp/copy-trading/top-traders'],
			['POST', '/webapp/copy-trading/follow/12'],
			['POST', '/webapp/copy-trading/unfollow/12'],
			['PUT', '/webapp/copy-trading/follow/12/settings'],
			['GET', '/webapp/alerts'],
			['POST', '/webapp/alerts'],
			['DELETE', '/webapp/alerts/9'],
			['GET', '/webapp/wallet-tracker/wallets'],
			['DELETE', '/webapp/wallet-tracker/wallets/0xabc'],
			['GET', '/webapp/tweets/accounts'],
			['DELETE', '/webapp/tweets/accounts/suwappu'],
			['GET', '/webapp/limit-orders'],
			['POST', '/webapp/limit-orders'],
			['POST', '/webapp/limit-orders/2/cancel'],
			['GET', '/webapp/dca/orders'],
			['POST', '/webapp/dca/orders/2/pause'],
			['GET', '/webapp/discovery/new'],
			['POST', '/webapp/solana/rpc'],
		] as const) {
			expect(isTerminalWebappProxyAllowed(method, path)).toBe(true)
		}

		for (const [method, path] of [
			['POST', '/webapp/referrals'],
			['DELETE', '/webapp/copy-trading/trades'],
			['POST', '/webapp/points/rewards/1/redeem'],
			['POST', '/webapp/admin/sweep'],
			['DELETE', '/webapp/limit-orders/not-a-number/cancel'],
		] as const) {
			expect(isTerminalWebappProxyAllowed(method, path)).toBe(false)
		}
	})

	it('proxies reviewed session and bridge paths while forwarding end-user auth', async () => {
		const seen: Array<{ method: string; path: string; auth: string | null }> = []
		const routes = createPythonProxyRoutes({
			baseUrl: PYTHON_URL,
			fetchImpl: async (input, init) => {
				const headers = new Headers(init?.headers)
				seen.push({
					method: init?.method ?? '',
					path: new URL(String(input)).pathname,
					auth: headers.get('Authorization'),
				})
				return Response.json({ ok: true })
			},
		})
		const app = new Hono().route('/', routes)
		const requests = [
			['GET', '/terminal/wallet/summary'],
			['POST', '/terminal/wallet/withdraw'],
			['POST', '/terminal/perps/execute'],
			['GET', '/terminal/predict/positions'],
			['POST', '/terminal/predict/order'],
			['POST', '/terminal/intel/devwatch'],
			['DELETE', '/terminal/intel/devwatch/42'],
			['POST', '/webapp/bridge/build'],
			['GET', '/webapp/bridge/transfers/42'],
		] as const

		for (const [method, path] of requests) {
			const response = await app.request(path, {
				method,
				headers: { Authorization: 'Bearer browser-session' },
				...(method === 'POST' ? { body: '{}' } : {}),
			})
			expect(response.status).toBe(200)
		}

		expect(seen).toEqual(
			requests.map(([method, path]) => ({
				method,
				path,
				auth: 'Bearer browser-session',
			})),
		)
	})

	it('returns 404 without touching Python for an unreviewed Terminal money route', async () => {
		let calls = 0
		const routes = createPythonProxyRoutes({
			baseUrl: PYTHON_URL,
			fetchImpl: async () => {
				calls += 1
				return Response.json({ shouldNot: 'happen' })
			},
		})
		const app = new Hono().route('/', routes)

		const response = await app.request('/terminal/wallet/admin-sweep', {
			method: 'POST',
			body: '{}',
		})

		expect(response.status).toBe(404)
		expect(calls).toBe(0)
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

	it('pre-mounted production gateway handles swap and reviewed legacy webapp routes', async () => {
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
			['POST', '/webapp/alerts'],
			['POST', '/webapp/dca/orders'],
		] as const) {
			const response = await app.request(path, {
				method,
				...(method === 'POST' ? { body: '{}' } : {}),
			})
			expect(response.status).toBe(200)
		}
		expect(seen).toEqual([
			'POST /webapp/swap/quote',
			'GET /webapp/referrals/stats',
			'POST /webapp/alerts',
			'POST /webapp/dca/orders',
		])
	})

	it('keeps Telegram swap requests on api-ts', async () => {
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
		app.post('/webapp/swap/execute', (c) =>
			c.json({ source: 'api-ts', initData: c.req.header('X-Telegram-Init-Data') }),
		)

		const response = await app.request('/webapp/swap/execute', {
			method: 'POST',
			headers: { 'X-Telegram-Init-Data': 'query_id=signed-telegram-data' },
			body: '{}',
		})

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({
			source: 'api-ts',
			initData: 'query_id=signed-telegram-data',
		})
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
		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ source: 'api-ts' })
		expect(pythonCalls).toBe(0)
	})

	it('fails closed when the Python service URL is not configured', async () => {
		const app = new Hono().route('/', createPythonProxyRoutes({}))
		const response = await app.request('/auth/me')

		expect(response.status).toBe(503)
		expect(await response.json()).toEqual({ detail: 'Python API is not configured' })
	})
})
