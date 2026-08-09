import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import {
	createPythonProxyRoutes,
	createTerminalSwapProxyRoutes,
	isPythonProxyAllowed,
	isTerminalSwapProxyAllowed,
} from '../routes/pythonProxy'

const PYTHON_URL = 'http://python-api.railway.internal:8000'

describe('Python Terminal compatibility gateway', () => {
	it('forwards end-user auth, origin, cookies, query and body without service credentials', async () => {
		let calls = 0
		const routes = createPythonProxyRoutes({
			baseUrl: PYTHON_URL,
			fetchImpl: async (input, init) => {
				calls += 1
				expect(String(input)).toBe(
					`${PYTHON_URL}/auth/turnkey/verify?source=terminal`,
				)
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
		// The api-ts CORS middleware, not the Python service, owns the public CORS policy.
		expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
	})

	it('allows only the auth methods and read-only Terminal compatibility paths', () => {
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
		] as const) {
			expect(isPythonProxyAllowed(method, path)).toBe(true)
		}

		for (const [method, path] of [
			['GET', '/auth/turnkey/challenge'],
			['GET', '/auth/oauth/github/authorize'],
			['POST', '/auth/oauth/google/link'],
			['DELETE', '/auth/oauth/unlink/google'],
			['POST', '/terminal/wallet/withdraw'],
			['POST', '/terminal/perps/connect'],
			['POST', '/terminal/perps/execute'],
			['POST', '/terminal/predict/order'],
			['POST', '/terminal/predict/redeem'],
			['POST', '/terminal/intel/devwatch'],
			['POST', '/webapp/dca'],
			['POST', '/webapp/bridge/build'],
			['POST', '/webapp/points/rewards/1/redeem'],
		] as const) {
			expect(isPythonProxyAllowed(method, path)).toBe(false)
		}
	})

	it('returns 404 without touching Python for a money-changing Terminal route', async () => {
		let calls = 0
		const routes = createPythonProxyRoutes({
			baseUrl: PYTHON_URL,
			fetchImpl: async () => {
				calls += 1
				return Response.json({ shouldNot: 'happen' })
			},
		})
		const app = new Hono().route('/', routes)

		const response = await app.request('/terminal/wallet/withdraw', {
			method: 'POST',
			body: JSON.stringify({ amount: 'all' }),
		})

		expect(response.status).toBe(404)
		expect(calls).toBe(0)
	})

	it('proxies only the five POST routes in the standalone Terminal swap contract', async () => {
		const seen: string[] = []
		const routes = createTerminalSwapProxyRoutes({
			baseUrl: PYTHON_URL,
			fetchImpl: async (input, init) => {
				seen.push(`${init?.method} ${new URL(String(input)).pathname}`)
				return Response.json({ source: 'python' })
			},
		})
		const app = new Hono().route('/', routes)
		const paths = [
			'/webapp/swap/quote',
			'/webapp/swap/build',
			'/webapp/swap/record',
			'/webapp/swap/submit-jito',
			'/webapp/swap/execute',
		]

		for (const path of paths) {
			expect(isTerminalSwapProxyAllowed('POST', path)).toBe(true)
			const response = await app.request(path, { method: 'POST', body: '{}' })
			expect(response.status).toBe(200)
			expect(await response.json()).toEqual({ source: 'python' })
		}

		expect(seen).toEqual(paths.map((path) => `POST ${path}`))
		for (const [method, path] of [
			['GET', '/webapp/swap/quote'],
			['POST', '/webapp/swap/status'],
			['POST', '/webapp/bridge/build'],
			['POST', '/webapp/dca/orders'],
			['POST', '/webapp/copy-trading/follow/1'],
			['POST', '/webapp/points/rewards/1/redeem'],
		] as const) {
			expect(isTerminalSwapProxyAllowed(method, path)).toBe(false)
		}
	})

	it('falls through to api-ts swap routes when Telegram init-data is present', async () => {
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
		// Represents swapRoutes, which createApp mounts immediately after the gateway.
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

	it('lets non-POST swap requests fall through instead of widening the Python proxy', async () => {
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
		app.get('/webapp/swap/quote', (c) => c.json({ source: 'api-ts' }))

		const response = await app.request('/webapp/swap/quote')

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
